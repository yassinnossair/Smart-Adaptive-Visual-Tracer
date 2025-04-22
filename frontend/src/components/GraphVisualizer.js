import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Alert, Spinner, Card, Button, Badge } from 'react-bootstrap';
import axios from 'axios';
import * as d3 from 'd3';
import './GraphVisualizer.css';

function GraphVisualizer() {
  const [data, setData] = useState(null);
  const [visualizationType, setVisualizationType] = useState(null);
  const [visualizationRationale, setVisualizationRationale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  
  // Animation state
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  
  // Refs for D3 visualization
  const forceDirectedRef = useRef(null);
  const adjacencyMatrixRef = useRef(null);
  

  // Function to fetch data
  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch graph data
      const dataResponse = await axios.get('http://localhost:8000/api/data/graphs');
      
      // Fetch visualization selection
      const visualizationResponse = await axios.get('http://localhost:8000/api/visualization/graphs');
      
      setData(dataResponse.data);
      setVisualizationType(visualizationResponse.data.visualization_type);
      setVisualizationRationale(visualizationResponse.data.rationale);
      setError(null);
      
      // Reset current step when new data is loaded
      setCurrentStep(0);
      setIsPlaying(false);
    } catch (error) {
      console.error('Error fetching graph data:', error);
      setError(error.response?.data?.error || 'Error fetching graph data');
    } finally {
      setLoading(false);
    }
  };

  // Helper function to calculate changes between graph states
  const calculateGraphChanges = (current, previous) => {
    if (!previous || !current) {
      return { addedNodes: [], removedNodes: [], addedEdges: [], removedEdges: [], modifiedNodes: [] };
    }
    
    const addedNodes = [];
    const removedNodes = [];
    const addedEdges = [];
    const removedEdges = [];
    const modifiedNodes = [];
    
    // Check for added or removed nodes
    const currentNodes = Object.keys(current);
    const previousNodes = Object.keys(previous);
    
    // Find added nodes
    currentNodes.forEach(node => {
      if (!previousNodes.includes(node)) {
        addedNodes.push(node);
      }
    });
    
    // Find removed nodes
    previousNodes.forEach(node => {
      if (!currentNodes.includes(node)) {
        removedNodes.push(node);
      }
    });
    
    // Find modified nodes and check for edge changes
    currentNodes.forEach(node => {
      if (previousNodes.includes(node)) {
        const currentEdges = current[node];
        const previousEdges = previous[node];
        
        // Check if edges list has changed
        if (JSON.stringify(currentEdges) !== JSON.stringify(previousEdges)) {
          modifiedNodes.push(node);
          
          // Identify added edges
          if (Array.isArray(currentEdges) && Array.isArray(previousEdges)) {
            currentEdges.forEach(edge => {
              if (!previousEdges.includes(edge)) {
                addedEdges.push({ source: node, target: edge });
              }
            });
            
            // Identify removed edges
            previousEdges.forEach(edge => {
              if (!currentEdges.includes(edge)) {
                removedEdges.push({ source: node, target: edge });
              }
            });
          }
        }
      }
    });
    
    return { addedNodes, removedNodes, addedEdges, removedEdges, modifiedNodes };
  };

  // Process graph data for visualization
  const graphStates = useMemo(() => {
    if (!data) return [];
    
    // Step 1: Filter out internal calls and exits
    const initialFiltered = data.filter(item => 
      item.operation !== "call" && 
      item.operation !== "exit"
    );
    
    // Step 2: Process and deduplicate graph states
    const uniqueGraphStates = [];
    let previousContentStr = null;
    
    // Sort by timestamp to ensure chronological order
    const sortedStates = [...initialFiltered].sort((a, b) => a.timestamp - b.timestamp);
    
    // Only keep states that represent a change in the graph structure
    sortedStates.forEach(state => {
      if (!state.content) return;
      
      const contentStr = JSON.stringify(state.content);
      
      // If this is the first state or represents a change, keep it
      if (previousContentStr === null || contentStr !== previousContentStr || state.operation === "final_state") {
        uniqueGraphStates.push(state);
        previousContentStr = contentStr;
      }
    });
    
    // Step 3: Calculate changes for each state
    return uniqueGraphStates.map((graphData, index) => {
      const previousState = index > 0 ? uniqueGraphStates[index - 1].content : null;
      const changes = calculateGraphChanges(
        graphData.content, 
        previousState
      );
      
      return {
        ...graphData,
        stepNumber: index + 1,
        changes
      };
    });
  }, [data]);

  // Set up polling for data updates and initial load
  useEffect(() => {
    fetchData();
    
    // Poll for updates every 5 minutes
    const intervalId = setInterval(() => {
      fetchData();
    }, 300000);
    
    // Clean up interval on unmount
    return () => clearInterval(intervalId);
  }, [lastUpdated]);

  // Animation playback effect
  useEffect(() => {
    let animationTimer;
    
    if (isPlaying && graphStates.length > 0) {
      // Calculate time interval based on playback speed
      const interval = 2000 / playbackSpeed;
      
      animationTimer = setTimeout(() => {
        if (currentStep < graphStates.length - 1) {
          setCurrentStep(prev => prev + 1);
        } else {
          setIsPlaying(false); // Stop at the end
        }
      }, interval);
    }
    
    return () => {
      if (animationTimer) clearTimeout(animationTimer);
    };
  }, [isPlaying, currentStep, graphStates.length, playbackSpeed]);

  // Helper function to extract all node labels from a graph
  const extractGraphNodes = (graph) => {
    if (!graph) return [];
    
    // Start with all nodes that have explicit entries
    const nodes = new Set(Object.keys(graph));
    
    // Add any nodes that appear as edges but don't have explicit entries
    Object.values(graph).forEach(edges => {
      if (Array.isArray(edges)) {
        edges.forEach(edge => nodes.add(edge));
      }
    });
    
    return Array.from(nodes);
  };

  // Helper function to convert adjacency list to edge array
  const getEdgesFromGraph = (graph) => {
    if (!graph) return [];
    
    const edges = [];
    
    Object.entries(graph).forEach(([source, targets]) => {
      if (Array.isArray(targets)) {
        targets.forEach(target => {
          edges.push({ source, target });
        });
      }
    });
    
    return edges;
  };
  // D3 Force-Directed Graph Visualization
  useEffect(() => {
    if (!graphStates.length || !forceDirectedRef.current || 
        visualizationType !== "FORCE_DIRECTED") return;
    
    const container = d3.select(forceDirectedRef.current);
    container.selectAll("*").remove(); // Clear previous visualization
    
    const currentState = graphStates[currentStep];
    const width = forceDirectedRef.current.clientWidth;
    const height = 500;
    const nodeRadius = 22; // Slightly smaller for better spacing
    
    // Extract nodes and edges from the current state
    const nodes = extractGraphNodes(currentState.content).map(id => ({
      id,
      isAdded: currentState.changes.addedNodes.includes(id),
      isModified: currentState.changes.modifiedNodes.includes(id)
    }));
    
    const links = getEdgesFromGraph(currentState.content).map(link => ({
      ...link,
      isAdded: currentState.changes.addedEdges.some(
        edge => edge.source === link.source && edge.target === link.target
      )
    }));
    
    // Create SVG
    const svg = container.append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("class", "force-directed-svg");
    
    // Create a group for zoom/pan functionality
    const g = svg.append("g")
      .attr("class", "zoom-group");
    
    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.25, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    
    svg.call(zoom);
    
    // Add definitions for arrowheads
    const defs = svg.append("defs");
    
    // Standard arrowhead
    defs.append("marker")
      .attr("id", "arrow-standard")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", nodeRadius + 9) // Adjust to keep arrow outside of node
      .attr("refY", 0)
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#6384ff");
    
    // Added arrowhead (green)
    defs.append("marker")
      .attr("id", "arrow-added")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", nodeRadius + 9)
      .attr("refY", 0)
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#28a745");
    
    // Container for links to keep them behind nodes
    const linkGroup = g.append("g").attr("class", "links");
    const nodeGroup = g.append("g").attr("class", "nodes");
    
    // Create links with proper styling
    const link = linkGroup.selectAll(".link")
      .data(links)
      .join("path") // Use paths instead of lines for curved edges
      .attr("class", d => d.isAdded ? "link added-link" : "link")
      .attr("stroke", d => d.isAdded ? "#28a745" : "#6384ff")
      .attr("stroke-width", 2)
      .attr("fill", "none")
      .attr("marker-end", d => d.isAdded ? "url(#arrow-added)" : "url(#arrow-standard)")
      .attr("opacity", 0);
    
    // Create node groups
    const node = nodeGroup.selectAll(".node")
      .data(nodes)
      .join("g")
      .attr("class", "node")
      .call(d3.drag()
        .on("start", dragStarted)
        .on("drag", dragged)
        .on("end", dragEnded))
      .on("mouseover", showTooltip)
      .on("mouseout", hideTooltip);
    
    // Add base circles for nodes
    node.append("circle")
      .attr("r", nodeRadius)
      .attr("class", d => {
        if (d.isAdded) return "node-circle node-added";
        if (d.isModified) return "node-circle node-modified";
        return "node-circle node-normal";
      })
      .attr("stroke", d => {
        if (d.isAdded) return "#1e7e34";
        if (d.isModified) return "#d39e00";
        return "#3857c0";
      })
      .attr("stroke-width", 2)
      .attr("opacity", 0)
      .transition()
      .duration(800)
      .attr("opacity", 1);
    
    // Add text labels to nodes (larger and more prominent)
    node.append("text")
      .text(d => d.id)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central") // Better vertical centering
      .attr("font-size", "16px") // Larger font
      .attr("font-weight", "bold") // Make it bold
      .attr("fill", "#ffffff")
      .attr("pointer-events", "none");
    
    // Add smaller degree badges
    node.append("circle")
      .attr("class", "degree-badge")
      .attr("r", 8) // Smaller radius
      .attr("cx", nodeRadius - 5) // Position it at the right edge
      .attr("cy", -nodeRadius + 5) // Position it at the top
      .attr("fill", "rgba(255, 255, 255, 0.2)")
      .attr("stroke", "rgba(255, 255, 255, 0.4)")
      .attr("stroke-width", 1);
    
    // Add degree count text
    node.append("text")
      .attr("class", "degree-text")
      .attr("x", nodeRadius - 5)
      .attr("y", -nodeRadius + 5)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", "9px") // Smaller font
      .attr("font-weight", "bold")
      .attr("fill", "#ffffff")
      .attr("pointer-events", "none")
      .text(d => {
        // Count the number of connections for this node
        const outDegree = currentState.content[d.id]?.length || 0;
        const inDegree = Object.entries(currentState.content)
          .filter(([_, targets]) => Array.isArray(targets) && targets.includes(d.id))
          .length;
        return outDegree + inDegree;
      });
    
    // Create the force simulation with better parameters
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links)
        .id(d => d.id)
        .distance(120) // Increase distance between nodes
        .strength(0.8)) // Stronger link force
      .force("charge", d3.forceManyBody()
        .strength(-500)) // Stronger repulsion
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide(nodeRadius * 1.8)); // Prevent overlap
    
    // Update link paths and node positions on each tick
    simulation.on("tick", () => {
      // Keep nodes within bounds
      nodes.forEach(d => {
        d.x = Math.max(nodeRadius, Math.min(width - nodeRadius, d.x));
        d.y = Math.max(nodeRadius, Math.min(height - nodeRadius, d.y));
      });
      
      // Update link paths with slight curvature
      link.attr("d", d => {
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        const dr = Math.sqrt(dx * dx + dy * dy);
        
        // Calculate path offsets to prevent arrow from overlapping node
        const offsetX = (dx * nodeRadius) / dr;
        const offsetY = (dy * nodeRadius) / dr;
        
        // Check if it's a self-loop
        if (d.source === d.target) {
          // Create a loop
          const x = d.source.x;
          const y = d.source.y;
          return `M${x},${y} C${x+50},${y-50} ${x+50},${y+50} ${x},${y}`;
        }
        
        // Use a curved line with slight arc
        const curveFactor = 0; // Set to 0 for straight lines, increase for more curve
        
        if (curveFactor === 0) {
          // Straight line with node radius offsets
          return `M${d.source.x},${d.source.y} L${d.target.x-offsetX},${d.target.y-offsetY}`;
        } else {
          // Curved path
          return `M${d.source.x},${d.source.y} 
                  Q${(d.source.x + d.target.x) / 2 + dy * curveFactor},${(d.source.y + d.target.y) / 2 - dx * curveFactor} 
                  ${d.target.x-offsetX},${d.target.y-offsetY}`;
        }
      });
      
      // Update node positions
      node.attr("transform", d => `translate(${d.x}, ${d.y})`);
    });
    
    // Define drag functions
    function dragStarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
      
      // Highlight this node during drag
      d3.select(this).select("circle")
        .attr("stroke-width", 3)
        .attr("stroke", "#ffffff");
    }
    
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    
    function dragEnded(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      
      // Option 1: Reset fx/fy to allow node to move again with simulation
      // d.fx = null;
      // d.fy = null;
      
      // Option 2: Keep node fixed where user dropped it (often better UX)
      // No need to do anything - fx/fy are already set
      
      // Reset highlight
      d3.select(this).select("circle")
        .attr("stroke-width", 2)
        .attr("stroke", d => {
          if (d.isAdded) return "#1e7e34";
          if (d.isModified) return "#d39e00";
          return "#3857c0";
        });
    }
    
    // Define tooltip functions with enhanced highlighting
    function showTooltip(event, d) {
      // Fade out all nodes and links
      node.selectAll("circle")
        .attr("opacity", 0.3);
      link.attr("opacity", 0.1);
      
      // Highlight this node
      d3.select(this).select("circle")
        .attr("opacity", 1)
        .attr("stroke-width", 3)
        .attr("stroke", "#ffffff");
      
      // Find connected nodes and links
      const outgoingLinks = links.filter(link => link.source.id === d.id);
      const incomingLinks = links.filter(link => link.target.id === d.id);
      const connectedNodeIds = new Set();
      
      // Add outgoing connections
      outgoingLinks.forEach(link => connectedNodeIds.add(link.target.id));
      
      // Add incoming connections
      incomingLinks.forEach(link => connectedNodeIds.add(link.source.id));
      
      // Highlight connected nodes
      node.filter(n => connectedNodeIds.has(n.id))
        .select("circle")
        .attr("opacity", 0.8);
      
      // Highlight outgoing links with different styling
      link.filter(link => link.source.id === d.id)
        .attr("opacity", 1)
        .attr("stroke-width", 3)
        .attr("stroke-dasharray", "none")
        .each(function() {
          // Add animated directional flow
          const path = d3.select(this);
          const length = path.node().getTotalLength();
          if (!isNaN(length) && length > 0) {
            path.attr("stroke-dasharray", `${length / 3} ${length / 6}`)
              .attr("stroke-dashoffset", length)
              .transition()
              .duration(1500)
              .ease(d3.easeLinear)
              .attr("stroke-dashoffset", 0)
              .on("end", function() {
                d3.select(this).attr("stroke-dasharray", "none");
              });
          }
        });
      
      // Highlight incoming links
      link.filter(link => link.target.id === d.id)
        .attr("opacity", 1)
        .attr("stroke-width", 3)
        .style("stroke-dasharray", "none");
      
      // Create and show tooltip
      const tooltip = d3.select("body").append("div")
        .attr("class", "d3-tooltip")
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 25) + "px")
        .style("opacity", 0);
      
      // Get connection details
      const outDegree = currentState.content[d.id]?.length || 0;
      const inDegree = Object.entries(currentState.content)
        .filter(([_, targets]) => Array.isArray(targets) && targets.includes(d.id))
        .length;
      
      // Enhanced tooltip content
      tooltip.html(`
        <div style="font-weight: bold; color: #6384ff; font-size: 1.1em; margin-bottom: 5px;">Node ${d.id}</div>
        <div><strong>Total Connections:</strong> ${outDegree + inDegree}</div>
        <div><strong>Outgoing:</strong> ${outDegree} connection${outDegree !== 1 ? 's' : ''}</div>
        <div><strong>Incoming:</strong> ${inDegree} connection${inDegree !== 1 ? 's' : ''}</div>
        ${outDegree > 0 ? `<div style="margin-top: 5px;"><strong>Connected to:</strong> ${currentState.content[d.id]?.join(', ')}</div>` : ''}
      `);
      
      // Animate tooltip
      tooltip.transition()
        .duration(200)
        .style("opacity", 1);
    }
    
    function hideTooltip() {
      // Restore node appearances
      node.selectAll("circle")
        .attr("opacity", 1)
        .attr("stroke-width", 2)
        .attr("stroke", d => {
          if (d.isAdded) return "#1e7e34";
          if (d.isModified) return "#d39e00";
          return "#3857c0";
        });
      
      // Restore links
      link.attr("opacity", 0.8)
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "none");
      
      // Remove tooltip
      d3.selectAll(".d3-tooltip").transition()
        .duration(200)
        .style("opacity", 0)
        .remove();
    }
    
    // Animate links appearing
    link.transition()
      .duration(800)
      .delay((d, i) => 300 + i * 50)
      .attr("opacity", 0.8);
    
    // Modified: Add legend on the right side with safe distance from visualization
    // Legend background to set it apart from the visualization
    const legendBgWidth = 180;
    const legendBgHeight = 130;
    const legendX = width - legendBgWidth - 40; // 20px padding from right edge
    const legendY = 20; // 20px from top

    // Constrain the simulation to avoid legend area
    // Update the force center to shift nodes away from the legend
    simulation.force("center", d3.forceCenter((width - legendBgWidth - 60) / 2, height / 2));

    // Add an additional force to repel nodes away from the legend area
    simulation.force("legend-repel", d3.forceX((d) => {
      // Calculate distance from the right side
      const distanceFromRight = width - d.x;
      
      // If node is close to the legend area, apply a leftward force
      if (distanceFromRight > (width - legendX - 30)) {
        return (width - legendBgWidth - 100);
      }
      return d.x; // Otherwise, no additional force
    }).strength(0.1));
    
    // Add a background for the legend
    svg.append("rect")
      .attr("x", legendX)
      .attr("y", legendY)
      .attr("width", legendBgWidth)
      .attr("height", legendBgHeight)
      .attr("rx", 8) // Rounded corners
      .attr("ry", 8)
      .attr("fill", "rgba(37, 42, 60, 0.8)") // Semi-transparent dark background
      .attr("stroke", "#3a3f52")
      .attr("stroke-width", 1);
    
    // Add legend title
    svg.append("text")
      .attr("x", legendX + legendBgWidth / 2)
      .attr("y", legendY + 20)
      .attr("text-anchor", "middle")
      .attr("font-size", "14px")
      .attr("font-weight", "bold")
      .attr("fill", "#e0e0e0")
      .text("Legend");
    
    // Legend items
    const legendItems = [
      { color: "node-normal", label: "Standard Nodes" },
      { color: "node-modified", label: "Modified Nodes" },
      { color: "node-added", label: "Newly Added Nodes" }
    ];
    
    // Add legend items vertically
    legendItems.forEach((item, index) => {
      const itemY = legendY + 45 + (index * 25); // Vertical spacing between items
      
      // Colored circle
      svg.append("circle")
        .attr("cx", legendX + 20)
        .attr("cy", itemY)
        .attr("r", 8)
        .attr("class", item.color);
      
      // Label
      svg.append("text")
        .attr("x", legendX + 35)
        .attr("y", itemY + 4)
        .attr("font-size", "12px")
        .attr("fill", "#e0e0e0")
        .text(item.label);
    });
    
    // Improve initial stabilization 
    simulation.alpha(0.6).restart();
    
    // Gradually slow down to a stable state
    const stabilizeSimulation = () => {
      // Let it run a little bit first
      setTimeout(() => {
        simulation.alphaDecay(0.03); // Slower decay for smoother stabilization
        
        // After some more time, fix it to a lower alpha
        setTimeout(() => {
          simulation.alpha(0.05).alphaTarget(0);
        }, 1000);
      }, 800);
    };
    
    stabilizeSimulation();
    
  }, [graphStates, currentStep, visualizationType]);

   // D3 Adjacency Matrix Visualization
  useEffect(() => {
    if (!graphStates.length || !adjacencyMatrixRef.current || 
        visualizationType !== "ADJACENCY_MATRIX") return;
    
    const container = d3.select(adjacencyMatrixRef.current);
    container.selectAll("*").remove(); // Clear previous visualization
    
    const currentState = graphStates[currentStep];
    const width = adjacencyMatrixRef.current.clientWidth;
    const height = 500;
    
    // Extract all unique nodes
    const allNodes = extractGraphNodes(currentState.content);
    
    // Sort nodes alphabetically for consistent ordering
    allNodes.sort();
    
    // Create a matrix of connections
    const matrix = [];
    
    // Initialize matrix with zeros
    for (let i = 0; i < allNodes.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < allNodes.length; j++) {
        matrix[i][j] = 0;
      }
    }
    
    // Fill in the matrix with connection values
    Object.entries(currentState.content).forEach(([source, targets]) => {
      if (Array.isArray(targets)) {
        const sourceIndex = allNodes.indexOf(source);
        targets.forEach(target => {
          const targetIndex = allNodes.indexOf(target);
          if (sourceIndex >= 0 && targetIndex >= 0) {
            // Check if this is a newly added edge
            const isAdded = currentState.changes.addedEdges.some(
              edge => edge.source === source && edge.target === target
            );
            
            // Use 2 for added edges, 1 for regular edges
            matrix[sourceIndex][targetIndex] = isAdded ? 2 : 1;
          }
        });
      }
    });
    
    // Set up dimensions with more balanced spacing
    const margin = { top: 80, right: 150, bottom: 20, left: 80 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    
    // Create SVG
    const svg = container.append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("class", "adjacency-matrix-svg");
    
    // Create a group with margins - centered more
    const g = svg.append("g")
      .attr("transform", `translate(${margin.left + 30},${margin.top})`);
    
    // Calculate cell size
    const cellSize = Math.min(
      innerWidth / allNodes.length,
      innerHeight / allNodes.length
    );
    
    // Create color scale
    const colorScale = d3.scaleOrdinal()
      .domain([0, 1, 2])
      .range(["#252a3c", "#6384ff", "#28a745"]);
    
    // Draw the matrix cells
    allNodes.forEach((source, i) => {
      allNodes.forEach((target, j) => {
        // Create a cell
        const cell = g.append("rect")
          .attr("x", j * cellSize)
          .attr("y", i * cellSize)
          .attr("width", cellSize)
          .attr("height", cellSize)
          .attr("class", "matrix-cell")
          .attr("fill", colorScale(matrix[i][j]))
          .attr("stroke", "#3a3f52")
          .attr("stroke-width", 1)
          .attr("opacity", 0)
          .on("mouseover", function(event) { // Added event parameter
            // Highlight row and column
            g.selectAll(".matrix-cell")
              .attr("opacity", 0.3);
            
            // Highlight this cell
            d3.select(this)
              .attr("opacity", 1)
              .attr("stroke-width", 2);
            
            // Highlight row and column
            g.selectAll(`.matrix-cell-row-${i}`)
              .attr("opacity", 0.7);
            
            g.selectAll(`.matrix-cell-col-${j}`)
              .attr("opacity", 0.7);
            
            // Show tooltip
            const tooltip = d3.select("body").append("div")
              .attr("class", "d3-tooltip")
              .style("left", (event.pageX + 10) + "px") // Use event parameter
              .style("top", (event.pageY - 25) + "px") // Use event parameter
              .style("opacity", 0);
            
            const connectionType = matrix[i][j] === 0 
              ? "No connection" 
              : matrix[i][j] === 2 
                ? "Newly added connection" 
                : "Connection exists";
            
            tooltip.html(`
              <strong>From:</strong> ${source}<br>
              <strong>To:</strong> ${target}<br>
              <strong>Status:</strong> ${connectionType}
            `);
            
            tooltip.transition()
              .duration(200)
              .style("opacity", 1);
          })
          .on("mouseout", function() {
            // Restore all cells
            g.selectAll(".matrix-cell")
              .attr("opacity", 1)
              .attr("stroke-width", 1);
            
            // Remove tooltip
            d3.selectAll(".d3-tooltip").transition()
              .duration(200)
              .style("opacity", 0)
              .remove();
          });
        
        // Add additional classes for row/column selection
        cell.classed(`matrix-cell-row-${i}`, true);
        cell.classed(`matrix-cell-col-${j}`, true);
        
        // Animate the cells
        cell.transition()
          .duration(500)
          .delay((i * allNodes.length + j) * 5)
          .attr("opacity", 1);
      });
    });
    
    // Add row labels (source nodes)
    allNodes.forEach((node, i) => {
      g.append("text")
        .attr("x", -5)
        .attr("y", i * cellSize + cellSize / 2)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("font-size", "12px")
        .attr("fill", "#e0e0e0")
        .text(node)
        .attr("class", () => {
          if (currentState.changes.addedNodes.includes(node)) return "matrix-label added-node";
          if (currentState.changes.modifiedNodes.includes(node)) return "matrix-label modified-node";
          return "matrix-label";
        });
    });
    
    // Add column labels (target nodes) - horizontally instead of diagonally
    allNodes.forEach((node, i) => {
      g.append("text")
        .attr("x", i * cellSize + cellSize / 2)
        .attr("y", -5)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "bottom")
        .attr("font-size", "10px") // Smaller font size to avoid overlap
        .attr("fill", "#e0e0e0")
        // Remove the rotation transform
        .text(node)
        .attr("class", () => {
          if (currentState.changes.addedNodes.includes(node)) return "matrix-label added-node";
          if (currentState.changes.modifiedNodes.includes(node)) return "matrix-label modified-node";
          return "matrix-label";
        });
    });
    
    // Add legend on the right side
    const legendX = width - margin.right - 100; // Position on the right, but closer
    
    // Legend items
    const legendItems = [
      { color: "#252a3c", label: "No Connection" },
      { color: "#6384ff", label: "Connection Exists" },
      { color: "#28a745", label: "Newly Added Connection" }
    ];
    
    // Add legend background to set it apart
    svg.append("rect")
      .attr("x", legendX - 10)
      .attr("y", margin.top)
      .attr("width", 170)
      .attr("height", 120)
      .attr("rx", 8)
      .attr("ry", 8)
      .attr("fill", "rgba(37, 42, 60, 0.8)")
      .attr("stroke", "#3a3f52")
      .attr("stroke-width", 1);
    
    // Add legend title
    svg.append("text")
      .attr("x", legendX + 75)
      .attr("y", margin.top + 25)
      .attr("text-anchor", "middle")
      .attr("font-size", "14px")
      .attr("font-weight", "bold")
      .attr("fill", "#e0e0e0")
      .text("Legend");
    
    // Add legend items vertically
    legendItems.forEach((item, index) => {
      const itemY = margin.top + 50 + (index * 25); // Vertical spacing between items
      
      // Colored square
      svg.append("rect")
        .attr("x", legendX)
        .attr("y", itemY)
        .attr("width", 16)
        .attr("height", 16)
        .attr("fill", item.color)
        .attr("stroke", "#3a3f52")
        .attr("stroke-width", 1);
      
      // Label
      svg.append("text")
        .attr("x", legendX + 25)
        .attr("y", itemY + 12)
        .attr("font-size", "12px")
        .attr("fill", "#e0e0e0")
        .text(item.label);
    });
    
  }, [graphStates, currentStep, visualizationType]);

 

  // Function to manually refresh data
  const handleRefresh = () => {
    setLastUpdated(Date.now());
  };

  // Playback controls
  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };
  
  const handleStepForward = () => {
    if (currentStep < graphStates.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };
  
  const handleStepBackward = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };
  
  const handleSpeedChange = (newSpeed) => {
    setPlaybackSpeed(newSpeed);
  };
  
  const handleSliderChange = (e) => {
    const newStep = parseInt(e.target.value, 10);
    setCurrentStep(newStep);
  };

  // Show loading spinner only on initial load, not during refreshes
  if (loading && !data) {
    return (
      <div className="d3-flex justify-content-center my-5">
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  // Combined error and empty data handling for GraphVisualizer
  if (error || !data || data.length === 0) {
    return (
      <div className="empty-visualization">
        <div className="friendly-message-container">
          <div className="empty-state-icon">
            <i className="bi bi-diagram-3"></i>
          </div>
          <h3 className="empty-state-title">No Graph Data Found</h3>
          
          {error ? (
            <p className="empty-state-message">
              We couldn't find any graph structures in your code or encountered an error while analyzing it.
            </p>
          ) : (
            <p className="empty-state-message">
              Your code doesn't appear to contain any graph operations we can visualize.
            </p>
          )}
          
          <div className="suggestion-box">
            <h4>Try adding graph operations like:</h4>
            <pre className="example-code">
              graph = {'{}'}<br/>
              graph['A'] = ['B', 'C']<br/>
              graph['B'] = ['D']<br/>
              graph['C'] = ['D', 'E']<br/>
              graph['D'] = []<br/>
              graph['E'] = ['A']<br/>
              <br/>
              # Add a new edge<br/>
              graph['D'].append('E')
            </pre>
          </div>
          
          {error && (
            <Button 
              variant="outline-primary" 
              className="refresh-button mt-3"
              onClick={handleRefresh}
            >
              Try Again
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Render the visualization based on type
  const renderVisualization = () => {
    // Reset current step when switching visualization types
    // to prevent out of bounds errors
    if (graphStates.length > 0 && currentStep >= graphStates.length) {
      setCurrentStep(graphStates.length - 1);
    }
    
    switch(visualizationType) {
      case "FORCE_DIRECTED":
        return (
          <div className="visualization-container force-directed-container" ref={forceDirectedRef}>
            {/* D3 visualization will be rendered here */}
          </div>
        );
      case "ADJACENCY_MATRIX":
        return (
          <div className="visualization-container adjacency-matrix-container" ref={adjacencyMatrixRef}>
            {/* D3 visualization will be rendered here */}
          </div>
        );
      default:
        // Default to Force Directed if no visualization type is specified
        return (
          <div className="visualization-container force-directed-container" ref={forceDirectedRef}>
            {/* D3 visualization will be rendered here */}
          </div>
        );
    }
  };

  return (
    <div className="graph-visualizer">
    <Card className="visualization-main-card">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <div>
          <h4 className="mb-0">Graph Visualization</h4>
          <Badge bg="primary" className="mt-2">
            {visualizationType || "FORCE_DIRECTED"}
          </Badge>
        </div>
        <Button 
          variant="outline-primary" 
          onClick={handleRefresh} 
          disabled={loading}
          className="refresh-button"
        >
          {loading ? (
            <>
              <Spinner
                as="span"
                animation="border"
                size="sm"
                role="status"
                aria-hidden="true"
                className="me-2"
              />
              Refreshing...
            </>
          ) : (
            <>Refresh Data</>
          )}
        </Button>
      </Card.Header>
      <Card.Body>
        <div className="rationale-box mb-4">
          <h5>Visualization Strategy</h5>
          <p>{visualizationRationale || "Visualizing graph structure and relationships."}</p>
        </div>
        
        {/* Visualization area */}
        {renderVisualization()}
        
        {/* Playback controls */}
        {graphStates.length > 0 && (
          <div className="playback-controls mt-4">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="step-indicator">
                Step {currentStep + 1} of {graphStates.length}
              </div>
              <div className="speed-controls">
                <span className="me-2">Speed:</span>
                <Button 
                  variant={playbackSpeed === 0.5 ? "primary" : "outline-primary"} 
                  size="sm" 
                  onClick={() => handleSpeedChange(0.5)}
                  className="me-1"
                >
                  0.5x
                </Button>
                <Button 
                  variant={playbackSpeed === 1 ? "primary" : "outline-primary"} 
                  size="sm" 
                  onClick={() => handleSpeedChange(1)}
                  className="me-1"
                >
                  1x
                </Button>
                <Button 
                  variant={playbackSpeed === 2 ? "primary" : "outline-primary"} 
                  size="sm" 
                  onClick={() => handleSpeedChange(2)}
                >
                  2x
                </Button>
              </div>
            </div>
            
            <input
              type="range"
              className="form-range mb-3"
              min="0"
              max={graphStates.length - 1}
              value={currentStep}
              onChange={handleSliderChange}
            />
            
            <div className="d-flex justify-content-center">
              <Button 
                variant="outline-primary" 
                onClick={handleStepBackward}
                disabled={currentStep === 0}
                className="me-2"
              >
                ← Previous
              </Button>
  
              <Button 
                variant={isPlaying ? "danger" : "primary"} 
                onClick={handlePlayPause}
                className="me-2"
              >
                {isPlaying ? "Pause" : "Play"}
              </Button>
  
              <Button 
                variant="outline-primary" 
                onClick={handleStepForward}
                disabled={currentStep === graphStates.length - 1}
              >
                Next →
              </Button>
            </div>
          </div>
        )}
          
          {/* Code context */}
          {graphStates.length > 0 && (
            <div className="code-context mt-4">
              <h5>Operation Details</h5>
              <div className="code-details p-3 rounded">
                {currentStep === 0 ? (
                  // For the first step, show this is the initial state
                  <div className="code-operation mb-2">
                    <strong>Initial State</strong>
                  </div>
                ) : (
                  // For subsequent steps, show the operation from the PREVIOUS step
                  // that led to the current state
                  <>
                    <div className="code-operation mb-2">
                      <strong>Operation:</strong> {graphStates[currentStep-1].operation}
                    </div>
                    {graphStates[currentStep-1].operation_details?.code && (
                      <div className="code-snippet mb-2">
                        <strong>Code:</strong>
                        <pre className="mb-0 mt-1">{graphStates[currentStep-1].operation_details.code}</pre>
                      </div>
                    )}
                    <div className="code-location">
                      <strong>Location:</strong> {graphStates[currentStep-1].location}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          
          {/* Graph statistics */}
          {graphStates.length > 0 && (
            <div className="graph-stats-container mt-4">
              <h5>Graph Statistics</h5>
              <div className="graph-stats p-3 rounded">
                {(() => {
                  // Calculate graph statistics
                  const currentGraph = graphStates[currentStep].content;
                  const nodes = extractGraphNodes(currentGraph);
                  const edges = getEdgesFromGraph(currentGraph);
                  
                  // Calculate node degrees
                  const nodeDegrees = {};
                  nodes.forEach(node => {
                    // Out-degree: number of edges going out from this node
                    const outDegree = currentGraph[node]?.length || 0;
                    
                    // In-degree: number of edges coming into this node
                    const inDegree = edges.filter(edge => edge.target === node).length;
                    
                    nodeDegrees[node] = {
                      out: outDegree,
                      in: inDegree,
                      total: outDegree + inDegree
                    };
                  });
                  
                  // Find nodes with max degree
                  let maxDegreeNode = nodes[0] || "";
                  let maxDegree = 0;
                  
                  Object.entries(nodeDegrees).forEach(([node, degrees]) => {
                    if (degrees.total > maxDegree) {
                      maxDegree = degrees.total;
                      maxDegreeNode = node;
                    }
                  });
                  
                  return (
                    <div className="row">
                      <div className="col-md-3">
                        <div className="stat-item">
                          <div className="stat-value">{nodes.length}</div>
                          <div className="stat-label">Nodes</div>
                        </div>
                      </div>
                      
                      <div className="col-md-3">
                        <div className="stat-item">
                          <div className="stat-value">{edges.length}</div>
                          <div className="stat-label">Edges</div>
                        </div>
                      </div>
                      
                      <div className="col-md-3">
                        <div className="stat-item">
                          <div className="stat-value">{(edges.length / (nodes.length > 0 ? nodes.length : 1)).toFixed(2)}</div>
                          <div className="stat-label">Avg. Degree</div>
                        </div>
                      </div>
                      
                      <div className="col-md-3">
                        <div className="stat-item">
                          <div className="stat-value">{maxDegreeNode} ({maxDegree})</div>
                          <div className="stat-label">Highest Degree Node</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}

export default GraphVisualizer;