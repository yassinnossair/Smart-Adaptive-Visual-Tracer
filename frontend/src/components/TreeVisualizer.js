import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Alert, Spinner, Card, Button, Badge } from 'react-bootstrap';
import axios from 'axios';
import * as d3 from 'd3';
import './TreeVisualizer.css';

function TreeVisualizer() {
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
  const hierarchicalRef = useRef(null);
  const radialRef = useRef(null);

  // Function to fetch data
  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch tree data
      const dataResponse = await axios.get('http://localhost:8000/api/data/trees');
      
      // Fetch visualization selection
      const visualizationResponse = await axios.get('http://localhost:8000/api/visualization/trees');
      
      setData(dataResponse.data);
      setVisualizationType(visualizationResponse.data.visualization_type);
      setVisualizationRationale(visualizationResponse.data.rationale);
      setError(null);
      
      // Reset current step when new data is loaded
      setCurrentStep(0);
      setIsPlaying(false);
    } catch (error) {
      console.error('Error fetching tree data:', error);
      setError(error.response?.data?.error || 'Error fetching tree data');
    } finally {
      setLoading(false);
    }
  };

  // Helper function to calculate changes between tree states
  const calculateChanges = (current, previous, enableDetailedLogging = false) => { // Keep logging flag for testing
    if (!previous || !current) { return { added: [], modified: [] }; }
    const added = [];
    const modified = [];

    const compareNodes = (currentNode, previousNode, path = '') => {
      if (enableDetailedLogging) console.log(`[compareNodes START] Path='${path}', PrevVal=${previousNode?.value}, CurrVal=${currentNode?.value}`);
      if (!currentNode && !previousNode) { if (enableDetailedLogging) console.log(`[compareNodes END] Path='${path}' - Both null.`); return; }

      // --- Added Block ---
      if (currentNode && !previousNode) {
        if (!added.includes(path)) { // Prevent duplicates just in case
             added.push(path);
        }
        if (enableDetailedLogging) console.log(`[compareNodes ADDED] >>> Pushed to added: '${path}'`);

        // --- Explicitly define children to iterate ---
        let childrenToRecurse = [];
        if (currentNode.left) { childrenToRecurse.push({ node: currentNode.left, segment: '.left' }); }
        if (currentNode.right) { childrenToRecurse.push({ node: currentNode.right, segment: '.right' }); }
        if (Array.isArray(currentNode.children)) {
             currentNode.children.forEach((child, index) => {
                 if (child) { childrenToRecurse.push({ node: child, segment: `.children[${index}]` }); }
             });
        }

        // --- Perform recursive calls ---
        if(enableDetailedLogging && childrenToRecurse.length > 0) console.log(`[compareNodes ADDED] Path='${path}' recursing for ${childrenToRecurse.length} children...`);
        childrenToRecurse.forEach(childInfo => {
            const childPath = path + childInfo.segment;
            compareNodes(childInfo.node, null, childPath); // Pass null for previousNode
        });
        // --- End explicit recursion ---

        if (enableDetailedLogging) console.log(`[compareNodes END - Added Branch] Path='${path}'`);
        return; // Return AFTER processing children
      }

      // Removed block... (same as before)
      if (!currentNode && previousNode) { if (enableDetailedLogging) console.log(`[compareNodes END - Removed Branch] Path='${path}'`); return; }

      // Modified block... (same logic as before, ensure recursion checks all possibilities)
      if (currentNode && previousNode) {
        if (currentNode.value !== previousNode.value) {
          if (!modified.includes(path)) modified.push(path); // Prevent duplicates
          if (enableDetailedLogging) console.log(`[compareNodes MODIFIED] >>> Pushed modified: '${path}'`);
        } else {
          if (enableDetailedLogging) console.log(`[compareNodes CHECK] Path='${path}' - Values same.`);
        }

        // *** Ensure full comparison of children ***
        // Compare .left
        compareNodes(currentNode.left, previousNode.left, path + '.left');
        // Compare .right
        compareNodes(currentNode.right, previousNode.right, path + '.right');
        // Compare .children arrays
        const currentChildren = currentNode.children || [];
        const previousChildren = previousNode.children || [];
        const maxLen = Math.max(currentChildren.length, previousChildren.length);
        for (let i = 0; i < maxLen; i++) {
            // Handle added/removed children within the loop
            compareNodes(currentChildren[i], previousChildren[i], path + '.children[' + i + ']');
        }
        // *** End full comparison ***
      }
      if (enableDetailedLogging) console.log(`[compareNodes END] Path='${path}'`);
    };

    compareNodes(current, previous, 'root');

    // Log just before returning
    if (enableDetailedLogging) console.log(`[CALCCHANGES RETURN] Final Added: ${JSON.stringify(added)}, Mod: ${JSON.stringify(modified)}`);

    return { added, modified };
  };

  // Process tree data for visualization with complete tree reconstruction
  const treeStates = useMemo(() => {
    if (!data) return [];
    
    console.log("Processing tree data:", data);
    
    // Step 1: Filter out internal calls and exits
    const initialFiltered = data.filter(item => 
      item.operation !== "call" && 
      item.operation !== "exit"
    );
    
    // Step 2: Let's identify which events belong to the main tree structure
    // First, find out the primary tree name from the final state
    let mainTreeName = null;
    const finalStates = initialFiltered.filter(state => state.operation === "final_state");
    
    // First try to find the final state with the most complex tree structure
    if (finalStates.length > 0) {
      let mostComplexState = null;
      let maxComplexity = -1;
      
      for (const state of finalStates) {
        const complexity = countNodesInTree(state.content);
        if (complexity > maxComplexity) {
          maxComplexity = complexity;
          mostComplexState = state;
        }
      }
      
      if (mostComplexState) {
        mainTreeName = mostComplexState.name;
        console.log(`Identified main tree as "${mainTreeName}" with ${maxComplexity} nodes`);
      }
    }
    
    // If no final state with a complex structure, try to find the most common node name
    if (!mainTreeName) {
      const nameCounts = {};
      initialFiltered.forEach(state => {
        nameCounts[state.name] = (nameCounts[state.name] || 0) + 1;
      });
      
      let maxCount = 0;
      for (const [name, count] of Object.entries(nameCounts)) {
        if (count > maxCount) {
          maxCount = count;
          mainTreeName = name;
        }
      }
      
      console.log(`Using most common node name "${mainTreeName}" as main tree`);
    }
    
    if (!mainTreeName) {
      console.warn("Could not identify main tree structure, defaulting to 'root'");
      mainTreeName = "root";
    }
    
    // Function to deep clone a tree object to avoid reference issues
    function cloneTree(node) {
      if (!node) return null;
      
      const clone = { ...node };
      
      if (node.children && Array.isArray(node.children)) {
        clone.children = node.children.map(child => cloneChild(child));
      }
      
      if (node.left) {
        clone.left = cloneTree(node.left);
      }
      
      if (node.right) {
        clone.right = cloneTree(node.right);
      }
      
      return clone;
    }
    
    // Helper for cloning child nodes in an array
    function cloneChild(child) {
      return cloneTree(child);
    }
    
    // Functions to count nodes in a tree
    function countNodesInTree(node) {
      if (!node) return 0;
      let count = 1; // Count this node
      
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(child => {
          count += countNodesInTree(child);
        });
      }
      
      if (node.left) count += countNodesInTree(node.left);
      if (node.right) count += countNodesInTree(node.right);
      
      return count;
    }
    
    // Get the root value from the final state to identify the main tree
    let mainRootValue = null;
    if (finalStates.length > 0) {
      // Find the most complex final state
      let mostComplexFinalState = finalStates[0];
      let maxComplexity = countNodesInTree(mostComplexFinalState.content);
      
      for (let i = 1; i < finalStates.length; i++) {
        const complexity = countNodesInTree(finalStates[i].content);
        if (complexity > maxComplexity) {
          maxComplexity = complexity;
          mostComplexFinalState = finalStates[i];
        }
      }
      
      // Get the root value of the most complex final state
      if (mostComplexFinalState && mostComplexFinalState.content) {
        mainRootValue = mostComplexFinalState.content.value;
        console.log(`Identified main root value as ${mainRootValue}`);
      }
    }
    
    // If we couldn't find a root value from the final state, get it from the first state
    if (mainRootValue === null && initialFiltered.length > 0) {
      // Find the first event with content
      for (const event of initialFiltered) {
        if (event.content && event.content.value !== undefined) {
          mainRootValue = event.content.value;
          console.log(`Using initial root value as ${mainRootValue}`);
          break;
        }
      }
    }
    
    // Process events chronologically
    const sortedEvents = [...initialFiltered].sort((a, b) => a.timestamp - b.timestamp);
    
    // First, find all events for the main tree
    const mainTreeEvents = sortedEvents.filter(evt => evt.name === mainTreeName);
    
    // Track the maximum tree size we've seen so far
    let maxTreeSize = 0;
    
    // We'll build up the main tree progressively, screening out subtree operations
    let lastKnownMainTree = null;
    const significantTreeStates = [];
    
    // Process all main tree events in chronological order
    for (let i = 0; i < mainTreeEvents.length; i++) {
      const event = mainTreeEvents[i];
      
      // Skip events without content
      if (!event.content) continue;
      
      // CRITICAL: Skip events where the root value doesn't match the main tree's root value
      // This is the key to eliminating the subtree flickering
      if (mainRootValue !== null && event.content.value !== mainRootValue) {
        console.log(`Skipping event with different root value: ${event.content.value} vs ${mainRootValue}`);
        continue;
      }
      
      const currentTreeNodeCount = countNodesInTree(event.content);
      
      // For the first event, always include it
      if (!lastKnownMainTree) {
        lastKnownMainTree = cloneTree(event.content);
        significantTreeStates.push({
          ...event,
          content: cloneTree(event.content)
        });
        maxTreeSize = currentTreeNodeCount;
        continue;
      }
      
      const lastTreeNodeCount = countNodesInTree(lastKnownMainTree);
      
      // Check operation type - important for tracking modifications
      const isModificationOperation = event.operation_details && 
                                    event.operation_details.code && 
                                    (event.operation_details.code.includes("value") || 
                                    event.operation_details.code.includes("= None") || 
                                    event.operation_details.code.includes("= TreeNode"));
      
      // For modifications, always include the event even if node count decreases
      if (isModificationOperation) {
        console.log(`Including modification operation: ${event.operation_details.code}`);
        lastKnownMainTree = cloneTree(event.content);
        significantTreeStates.push({
          ...event,
          content: cloneTree(event.content)
        });
        maxTreeSize = Math.max(maxTreeSize, currentTreeNodeCount);
        continue;
      }
      
      // Main filtering criteria:
      // 1. Tree must be at least as large as previous state OR
      // 2. This is the final state (which might be smaller due to removals)
      const isFinalState = event.operation === "final_state";
      const isGrowingTree = currentTreeNodeCount >= lastTreeNodeCount;
      
      // Never accept a tree that's substantially smaller than the max size we've seen
      // unless it's a final state or explicit modification
      if (!isFinalState && currentTreeNodeCount < maxTreeSize * 0.9) {
        console.log(`Skipping tree that's too small: ${currentTreeNodeCount} vs max ${maxTreeSize}`);
        continue;
      }
      
      // Include the state if it's growing or it's the final state
      if (isGrowingTree || isFinalState) {
        // Check for structural differences to avoid duplicates
        if (!areTreesStructurallyIdentical(lastKnownMainTree, event.content)) {
          lastKnownMainTree = cloneTree(event.content);
          significantTreeStates.push({
            ...event,
            content: cloneTree(event.content)
          });
          maxTreeSize = Math.max(maxTreeSize, currentTreeNodeCount);
        }
      }
    }
    
    // Helper function to compare trees for structural equality
    function areTreesStructurallyIdentical(tree1, tree2) {
      // Handle null cases
      if (!tree1 && !tree2) return true;
      if (!tree1 || !tree2) return false;
      
      // Compare values
      if (tree1.value !== tree2.value) return false;
      
      // Compare children arrays (non-binary trees)
      if (tree1.children && tree2.children) {
        if (tree1.children.length !== tree2.children.length) return false;
        
        // Check each child
        for (let i = 0; i < tree1.children.length; i++) {
          if (!areTreesStructurallyIdentical(tree1.children[i], tree2.children[i])) {
            return false;
          }
        }
      } 
      else if (tree1.children || tree2.children) {
        return false; // One has children, the other doesn't
      }
      
      // Compare left/right properties (binary trees)
      if (tree1.left || tree2.left) {
        if (!areTreesStructurallyIdentical(tree1.left, tree2.left)) {
          return false;
        }
      }
      
      if (tree1.right || tree2.right) {
        if (!areTreesStructurallyIdentical(tree1.right, tree2.right)) {
          return false;
        }
      }
      
      return true;
    }
    
    console.log(`Reconstructed ${significantTreeStates.length} meaningful tree states`);
    
    // Step 4: Calculate changes between consecutive states
    return significantTreeStates.map((treeData, index) => {
      // Set a consistent name for the tree states
      const stateWithConsistentName = {
        ...treeData,
        name: mainTreeName, // Ensure all states have the same name
        stepNumber: index + 1,
      };
      
      // Calculate changes from previous state
      if (index > 0) {
        stateWithConsistentName.changes = calculateChanges(
          treeData.content,
          significantTreeStates[index - 1].content
        );
      } else {
        // For the first state, everything is considered "added"
        stateWithConsistentName.changes = calculateInitialChanges(treeData.content);
      }
      
      return stateWithConsistentName;
    });
    
    // Helper to calculate changes for the first state
    function calculateInitialChanges(tree) {
      const added = [];
      
      // Function to mark all nodes as added
      function markNodesAsAdded(node, path = 'root') {
        if (!node) return;
        
        // Add this node
        added.push(path);
        
        // Process children array (non-binary tree)
        if (node.children && Array.isArray(node.children)) {
          node.children.forEach((child, index) => {
            markNodesAsAdded(child, `${path}.children[${index}]`);
          });
        }
        
        // Process left/right (binary tree)
        if (node.left) {
          markNodesAsAdded(node.left, `${path}.left`);
        }
        
        if (node.right) {
          markNodesAsAdded(node.right, `${path}.right`);
        }
      }
      
      markNodesAsAdded(tree);
      
      return {
        added: added,
        modified: []
      };
    }
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
    
    if (isPlaying && treeStates.length > 0) {
      // Get the current tree state
      const currentTreeState = treeStates[currentStep];
      
      // Count the number of nodes in the current tree state (if available)
      let nodeCount = 0;
      if (currentTreeState && currentTreeState.content) {
        // Simple recursive function to count nodes
        const countNodes = (node) => {
          if (!node) return 0;
          let count = 1; // Count this node
          
          // Count binary tree children
          if (node.left) count += countNodes(node.left);
          if (node.right) count += countNodes(node.right);
          
          // Count general tree children
          if (node.children && Array.isArray(node.children)) {
            node.children.forEach(child => {
              count += countNodes(child);
            });
          }
          
          return count;
        };
        
        nodeCount = countNodes(currentTreeState.content);
      }
      
      // Base interval is 2000ms, but add more time for larger trees
      // The 50ms * nodeCount adds time proportional to the number of nodes
      // The Math.min ensures we don't wait too long for very large trees
      const baseInterval = 2000;
      const nodeAnimationTime = Math.min(50 * nodeCount, 3000);
      const interval = (baseInterval + nodeAnimationTime) / playbackSpeed;
      
      animationTimer = setTimeout(() => {
        if (currentStep < treeStates.length - 1) {
          setCurrentStep(prev => prev + 1);
        } else {
          setIsPlaying(false); // Stop at the end
        }
      }, interval);
    }
    
    return () => {
      if (animationTimer) clearTimeout(animationTimer);
    };
  }, [isPlaying, currentStep, treeStates, playbackSpeed]);

  // D3 Hierarchical Tree Visualization
  useEffect(() => {
    if (!treeStates.length || !hierarchicalRef.current || 
        visualizationType !== "HIERARCHICAL_TREE") return;
    
    const container = d3.select(hierarchicalRef.current);
    container.selectAll("*").remove(); // Clear previous visualization
    
    const currentState = treeStates[currentStep];
    if (!currentState || !currentState.content) return;
    
    // Function to count depth that works for BOTH binary and non-binary trees
    const getTreeDepth = (node) => {
      if (!node) return 0;
      
      let leftDepth = 0;
      let rightDepth = 0;
      let childrenDepth = 0;
      
      if (node.left) leftDepth = getTreeDepth(node.left);
      if (node.right) rightDepth = getTreeDepth(node.right);
      
      if (node.children && node.children.length) {
        childrenDepth = Math.max(...node.children.map(child => getTreeDepth(child)));
      }
      
      return 1 + Math.max(leftDepth, rightDepth, childrenDepth);
    };
    
    // Function to count max width at any level of the tree
    const getTreeWidth = (node) => {
      if (!node) return 0;
      
      // Count nodes at each level using BFS
      const queue = [{ node, level: 0 }];
      const levelCounts = {};
      
      while (queue.length > 0) {
        const { node, level } = queue.shift();
        
        // Count this node at its level
        if (!levelCounts[level]) levelCounts[level] = 0;
        levelCounts[level]++;
        
        // Add children to queue
        if (node.left) queue.push({ node: node.left, level: level + 1 });
        if (node.right) queue.push({ node: node.right, level: level + 1 });
        
        if (node.children && node.children.length) {
          node.children.forEach(child => {
            queue.push({ node: child, level: level + 1 });
          });
        }
      }
      
      // Find the maximum width at any level
      return Math.max(...Object.values(levelCounts));
    };
    
    // Calculate the tree depth and width
    const treeDepth = getTreeDepth(currentState.content);
    const maxTreeWidth = getTreeWidth(currentState.content);
    
    console.log("Tree depth:", treeDepth, "Max width:", maxTreeWidth);
    
    const containerWidth = hierarchicalRef.current.clientWidth;
    
    // Reserve more space for right-side legend
    const legendWidth = 250; // Increased legend width for better separation
    const availableWidth = containerWidth - legendWidth;
    
    // Calculate height based on depth - ensure enough space per level
    const nodeSpacing = 80; // Vertical space between levels
    const calculatedHeight = Math.max(400, treeDepth * nodeSpacing + 100);
    
    // Create SVG that will be tall enough for all levels
    const svg = container.append("svg")
      .attr("width", containerWidth)
      .attr("height", calculatedHeight)
      .attr("class", "tree-svg");
    
    // Add a viewBox to enable panning if needed
    svg.attr("viewBox", `0 0 ${containerWidth} ${calculatedHeight}`);
    
    // Calculate the horizontal space needed per node
    const nodeHorizontalSpacing = 80; // Minimum space between nodes
    const estimatedTreeWidth = maxTreeWidth * nodeHorizontalSpacing;
    
    // Position the tree on the left side, leaving room for the legend on the right
    // Use 25% of available width as left margin to keep tree left-aligned but not at the edge
    const leftMargin = Math.min(availableWidth * 0.25, 100);
    
    // Create separate groups for tree and legend
    const treeGroup = svg.append("g")
      .attr("class", "tree-group")
      .attr("transform", `translate(${leftMargin}, 40)`); // Position tree on the left
    
    const legendGroup = svg.append("g")
      .attr("class", "legend-group")
      .attr("transform", `translate(${availableWidth + 50}, 40)`); // Position legend on the right
    
    // Helper function to convert our tree format to D3 hierarchy
    const buildHierarchy = (node) => {
      if (!node) return null;
      
      const result = { 
        name: node.value.toString(),
        originalNode: node  // Store reference to original node
      };
      
      // Handle both types of tree structures
      const children = [];
      
      // Try binary tree structure
      if (node.left) children.push(buildHierarchy(node.left));
      if (node.right) children.push(buildHierarchy(node.right));
      
      // Try non-binary tree structure
      if (node.children && node.children.length) {
        node.children.forEach(child => {
          children.push(buildHierarchy(child));
        });
      }
      
      if (children.length > 0) {
        result.children = children;
      }
      
      return result;
    };
    
    // Transform the tree data into a format D3 hierarchy can use
    const hierarchyData = buildHierarchy(currentState.content);
    if (!hierarchyData) return;
    
    // Create the root node
    const root = d3.hierarchy(hierarchyData);
    
    // Calculate the max width needed based on the number of nodes at the widest level
    const maxNodesAtLevel = d3.max(d3.group(root.descendants(), d => d.depth), d => d[1].length || 0);
    
    // Calculate a more aggressive constraint for tree width
    // This ensures even large trees stay within the available space
    const constrainedWidth = Math.min(
      availableWidth - 80, // Leave 80px safe margin
      maxNodesAtLevel * nodeHorizontalSpacing * 1.2 // 20% more space for nodes
    );
    
    // Create tree layout with aggressive space constraints
    const treeLayout = d3.tree()
      .size([constrainedWidth, calculatedHeight - 80])
      .separation((a, b) => {
        // Reduce separation for wider trees
        const baseSeparation = maxNodesAtLevel > 8 ? 1.2 : 1.5;
        return (a.parent === b.parent ? baseSeparation : 1.8);
      });
    
    // Apply layout to get node positions
    treeLayout(root);
    
    // Track nodes that first appear in this step
    /*const getFirstAppearanceStep = (path) => {
      for (let i = 0; i <= currentStep; i++) {
        if (i < treeStates.length && 
            treeStates[i].changes && 
            treeStates[i].changes.added && 
            treeStates[i].changes.added.includes(path)) {
          return i;
        }
      }
      return -1; // Not found or was present from beginning
    };*/
    
    // Add links between nodes
    treeGroup.selectAll(".link")
      .data(root.links())
      .join("path")
      .attr("class", "link")
      .attr("d", d3.linkVertical()
        .x(d => d.x)
        .y(d => d.y)
      )
      .attr("fill", "none")
      .attr("stroke", "#6c757d")
      .attr("stroke-width", 1.5)
      .attr("opacity", 0)
      .transition()
      .duration(500)
      .delay((d, i) => i * 50)
      .attr("opacity", 1);
    
    // Helper function to get a node's path (REVISED AGAIN - FINAL)
    function getNodePath(d) { // d is a D3 hierarchy node
      // Root node is handled separately
      if (d.depth === 0) {
          // Assuming 'root' is consistently used as the base path identifier
          // even if the actual root variable name in the code differs.
          // This matches the starting path in calculateChanges.
          return 'root';
      }

      const pathParts = [];
      let current = d; // The current D3 node
      let parent = d.parent; // The parent D3 node

      while (parent) {
        // Get the original data objects linked to the D3 nodes
        const originalParentData = parent.data.originalNode;
        const originalCurrentData = current.data.originalNode;

        // Ensure we have the original data to work with
        if (!originalParentData || !originalCurrentData) {
           console.warn("getNodePath: Missing originalNode data for parent or current D3 node:", parent, current);
           // Fallback using D3 index if original data is missing
           const index = parent.children ? parent.children.findIndex(c => c === current) : -1;
           pathParts.unshift(index !== -1 ? `unknown_index[${index}]` : 'unknown_parent_child');
           current = parent;
           parent = current.parent;
           continue; // Move to the next level up
        }

        let segmentFound = false;

        // 1. Check 'left' child relationship (Prioritize Object Identity)
        if (originalParentData.left === originalCurrentData) {
          pathParts.unshift('left');
          segmentFound = true;
        }
        // 2. Check 'right' child relationship (Prioritize Object Identity)
        else if (originalParentData.right === originalCurrentData) {
          pathParts.unshift('right');
          segmentFound = true;
        }
        // 3. Fallback: Check 'left' child relationship based on VALUE
        else if (originalParentData.left && originalParentData.left.value === originalCurrentData.value) {
           // Check if right child *also* has the same value to resolve ambiguity
           if (!originalParentData.right || originalParentData.right.value !== originalCurrentData.value) {
              pathParts.unshift('left');
              segmentFound = true;
           }
           // If both left and right have the same value, we *must* use index fallback later
        }
        // 4. Fallback: Check 'right' child relationship based on VALUE
        else if (originalParentData.right && originalParentData.right.value === originalCurrentData.value) {
           // We already checked if left also matched in the previous step
           pathParts.unshift('right');
           segmentFound = true;
        }

        // 5. Check 'children' array relationship if not found via left/right
        if (!segmentFound && Array.isArray(originalParentData.children)) {
          // Try finding by object identity first
          let originalIndex = originalParentData.children.findIndex(child => child === originalCurrentData);
          // Fallback to value if identity fails (be cautious of duplicates)
          if (originalIndex === -1) {
              originalIndex = originalParentData.children.findIndex(child => child && child.value === originalCurrentData.value);
              // Potential improvement: If multiple matches by value, maybe use D3 index? For now, take first match.
          }

          if (originalIndex !== -1) {
            pathParts.unshift(`children[${originalIndex}]`);
            segmentFound = true;
          }
        }

        // 6. Absolute Fallback: Use D3 hierarchy index (if nothing else worked)
        if (!segmentFound) {
            const index = parent.children ? parent.children.findIndex(c => c === current) : -1;
            console.warn(`getNodePath: Using D3 index fallback for node ${originalCurrentData.value}. Parent:`, originalParentData);
            // Try to guess format based on original parent structure
            if (originalParentData.left !== undefined || originalParentData.right !== undefined) {
                 pathParts.unshift(index === 0 ? 'left' : 'right'); // Guess binary based on keys
            } else {
                 pathParts.unshift(index !== -1 ? `children[${index}]` : 'unknown_fallback'); // Guess n-ary
            }
        }

        // Move up the hierarchy
        current = parent;
        parent = current.parent;
      }

      // Construct the full path string
      let path = 'root';
      if (pathParts.length > 0) {
        path += '.' + pathParts.join('.');
      }
      return path;
    }
    const nodeRadius = 20;
    
    // Add nodes
    const nodes = treeGroup.selectAll(".node")
      .data(root.descendants())
      .join("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${d.x}, ${d.y})`)
      .attr("opacity", 0) // Start invisible for animation
      .on("mouseover", function(event, d) {
        // Highlight this node
        d3.select(this).select("circle")
          .transition()
          .duration(200)
          .attr("r", nodeRadius * 1.2)
          .attr("stroke-width", 3);
        
        // Show simplified tooltip with only Value and Depth
        const tooltip = d3.select("body").append("div")
          .attr("class", "d3-tooltip")
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 25) + "px")
          .style("opacity", 0);
        
        tooltip.html(`
          <strong>Value:</strong> ${d.data.name}<br>
          <strong>Depth:</strong> ${d.depth}
        `);
        
        tooltip.transition()
          .duration(200)
          .style("opacity", 1);
      })
      .on("mouseout", function() {
        // Remove highlight
        d3.select(this).select("circle")
          .transition()
          .duration(200)
          .attr("r", nodeRadius)
          .attr("stroke-width", 1.5);
        
        // Remove tooltip
        d3.selectAll(".d3-tooltip").transition()
          .duration(200)
          .style("opacity", 0)
          .remove();
      });
    
    // Add node circles with appropriate classes
    nodes.append("circle")
      .attr("r", nodeRadius)
      // ********************************************************
      // * START MODIFICATION - Replace class assignment logic  *
      // ********************************************************
      .attr("class", d => {
        const path = getNodePath(d); // Get the path for the current node

        // Ensure changes object exists before trying to access it
        const changes = currentState.changes || { added: [], modified: [] };

        // Check if this path was ADDED in this specific step's changes
        // Use optional chaining (?.) just in case `changes.added` is undefined
        if (changes.added?.includes(path)) {
          return "node-added"; // Apply GREEN
        }

        // ELSE, check if this path was MODIFIED in this specific step's changes
        // Use optional chaining (?.) just in case `changes.modified` is undefined
        if (changes.modified?.includes(path)) {
          return "node-modified"; // Apply YELLOW
        }

        // Otherwise, it's a standard node in this step's structure
        return "node-normal"; // Apply BLUE
      })
      // ******************************************************
      // * END MODIFICATION - End replaced class logic        *
      // ******************************************************
      .attr("stroke", "#303030")
      .attr("stroke-width", 1.5)
    
    // Add node labels - CENTERED IN CIRCLES
    nodes.append("text")
      .attr("dy", "0.3em")
      .attr("text-anchor", "middle") // Center text horizontally
      .attr("font-size", "12px")
      .attr("fill", "#ffffff")
      .text(d => d.data.name);
    
    // Animate nodes in
    nodes.transition()
      .duration(500)
      .delay((d, i) => 500 + i * 50)
      .attr("opacity", 1);
    
    // Add legend title
    legendGroup.append("text")
      .attr("x", 0)
      .attr("y", 0)
      .attr("font-size", "14px")
      .attr("font-weight", "bold")
      .attr("fill", "#e0e0e0")
      .text("Legend");
    
      const legendItems = [
        { color: "node-normal", label: "Standard Nodes" },
        { color: "node-modified", label: "Modified Nodes" },
        { color: "node-added", label: "New Path Nodes" }
      ];
    
    // Add legend items vertically
    legendItems.forEach((item, index) => {
      const itemY = 30 + (index * 30); // Vertical spacing between items
      
      // Colored circle
      legendGroup.append("circle")
        .attr("cx", 10)
        .attr("cy", itemY)
        .attr("r", 8)
        .attr("class", item.color);
      
      // Label
      legendGroup.append("text")
        .attr("x", 25)
        .attr("y", itemY + 4)
        .attr("font-size", "12px")
        .attr("fill", "#e0e0e0")
        .text(item.label);
    });
    
  }, [treeStates, currentStep, visualizationType]);
    
  // D3 Radial Tree Visualization
  useEffect(() => {
    // Check dependencies and refs
    if (!treeStates || treeStates.length === 0 || !radialRef.current ||
      visualizationType !== "RADIAL_TREE") {
       // Clear previous viz if conditions not met or states are empty
       d3.select(radialRef.current).selectAll("*").remove();
       return;
    }
    const stateForThisStep = treeStates[currentStep];

    if (!stateForThisStep || !stateForThisStep.content) {
      console.warn(`No valid state data found for step ${currentStep}`);
      d3.select(radialRef.current).selectAll("*").remove();
      return;
  }
    const container = d3.select(radialRef.current);
    container.selectAll("*").remove(); // Clear previous visualization

    console.log(`Rendering radial tree step ${currentStep + 1}/${treeStates.length}`, stateForThisStep);
    
    const currentState = treeStates[currentStep];
    if (!currentState || !currentState.content) return;
    
    // Log current state for debugging
    console.log(`Rendering radial tree step ${currentStep + 1}/${treeStates.length}`, currentState);
    
    const width = radialRef.current.clientWidth;
    const height = 500;
    const nodeRadius = 20;
    
    // Reserve space for legend on the right
    const legendWidth = 180;
    const chartWidth = width - legendWidth;
    
    // Create SVG
    const svg = container.append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "max-width: 100%; height: auto;");
        
    // Create a group centered in the available chart area (shifted left)
    const g = svg.append("g")
      .attr("transform", `translate(${chartWidth / 2}, ${height / 2})`);
    
    // Helper function to convert our tree format to D3 hierarchy
    const buildHierarchy = (node) => {
      if (!node) return null;
      
      const result = { name: node.value.toString(), originalNode: node };
      
      // Handle both tree structures in one unified approach
      const children = [];
      
      // Process children array for non-binary trees
      if (node.children && Array.isArray(node.children) && node.children.length > 0) {
        node.children.forEach(child => {
          const childNode = buildHierarchy(child);
          if (childNode) children.push(childNode);
        });
      }
      
      // Process left/right for binary trees
      if (node.left) {
        const leftNode = buildHierarchy(node.left);
        if (leftNode) children.push(leftNode);
      }
      
      if (node.right) {
        const rightNode = buildHierarchy(node.right);
        if (rightNode) children.push(rightNode);
      }
      
      // Add children array if we found any children
      if (children.length > 0) {
        result.children = children;
      }
      
      return result;
    };
    
    // Transform the tree data into a format D3 hierarchy can use
    const hierarchyData = buildHierarchy(currentState.content);
    if (!hierarchyData) return;
    
    // Create the root node
    const root = d3.hierarchy(hierarchyData);
    
    // Count total nodes to determine radius
    const nodeCount = root.descendants().length;
    
    // Determine radius based on node count (more nodes = larger radius)
    // Reduce radius to ensure tree stays within available space
    const radius = Math.min(chartWidth, height) / 2 - 80;
    
    // Add depth rings to help visualize levels
    const maxDepth = d3.max(root.descendants(), d => d.depth);
    for (let i = 1; i <= maxDepth; i++) {
      g.append("circle")
        .attr("r", i * (radius / maxDepth))
        .attr("fill", "none")
        .attr("stroke", "#3a3f52")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,3")
        .attr("opacity", 0.3);
    }
    
    // Create radial tree layout
    const treeLayout = d3.tree()
      .size([2 * Math.PI, radius])
      .separation((a, b) => {
        // Increase separation for larger trees
        return (a.parent === b.parent ? 1 : 2) / (a.depth || 1);
      });
    
    // Apply layout to hierarchy
    treeLayout(root);

    // Helper function for radial coordinates
    const radialPoint = (x, y) => [(y = +y) * Math.cos(x -= Math.PI / 2), y * Math.sin(x)];
    
    
    
    // Helper function to get a node's path (REVISED AGAIN - FINAL - Unified Version)
    function getNodePath(d) { // d is a D3 hierarchy node
      if (d.depth === 0) {
          return 'root';
      }

      const pathParts = [];
      let current = d;
      let parent = d.parent;

      while (parent) {
        const originalParentData = parent.data.originalNode;
        const originalCurrentData = current.data.originalNode;

        if (!originalParentData || !originalCurrentData) {
           console.warn("getNodePath: Missing originalNode data for parent or current D3 node:", parent, current);
           const index = parent.children ? parent.children.findIndex(c => c === current) : -1;
           pathParts.unshift(index !== -1 ? `unknown_index[${index}]` : 'unknown_parent_child');
           current = parent;
           parent = current.parent;
           continue;
        }

        let segmentFound = false;

        // 1. Check 'left' child relationship (Prioritize Object Identity)
        if (originalParentData.left === originalCurrentData) {
          pathParts.unshift('left');
          segmentFound = true;
        }
        // 2. Check 'right' child relationship (Prioritize Object Identity)
        else if (originalParentData.right === originalCurrentData) {
          pathParts.unshift('right');
          segmentFound = true;
        }
        // 3. Fallback: Check 'left' child relationship based on VALUE (with ambiguity check)
        else if (originalParentData.left && originalParentData.left.value === originalCurrentData.value) {
           if (!originalParentData.right || originalParentData.right.value !== originalCurrentData.value) {
              pathParts.unshift('left');
              segmentFound = true;
           }
        }
        // 4. Fallback: Check 'right' child relationship based on VALUE (with ambiguity check)
        else if (originalParentData.right && originalParentData.right.value === originalCurrentData.value) {
           if (!originalParentData.left || originalParentData.left.value !== originalCurrentData.value) {
              pathParts.unshift('right');
              segmentFound = true;
           }
        }

        // 5. Check 'children' array relationship if not found via left/right
        if (!segmentFound && Array.isArray(originalParentData.children)) {
          let originalIndex = originalParentData.children.findIndex(child => child === originalCurrentData);
          if (originalIndex === -1) {
              originalIndex = originalParentData.children.findIndex(child => child && child.value === originalCurrentData.value);
          }
          if (originalIndex !== -1) {
            pathParts.unshift(`children[${originalIndex}]`);
            segmentFound = true;
          }
        }

        // 6. Absolute Fallback: Use D3 hierarchy index
        if (!segmentFound) {
            const index = parent.children ? parent.children.findIndex(c => c === current) : -1;
            console.warn(`getNodePath: Using D3 index fallback for node ${originalCurrentData.value}. Parent:`, originalParentData);
            if (originalParentData.left !== undefined || originalParentData.right !== undefined) {
                 pathParts.unshift(index === 0 ? 'left' : 'right');
            } else {
                 pathParts.unshift(index !== -1 ? `children[${index}]` : 'unknown_fallback');
            }
            segmentFound = true; // Mark as found to prevent issues in rare fallbacks
        }

        current = parent;
        parent = current.parent;
      }

      let path = 'root';
      if (pathParts.length > 0) {
        path += '.' + pathParts.join('.');
      }
      // Remove potential redundant 'root' prefix if currentState.name is used elsewhere
      // This normalizePath might need adjustment based on how paths are stored in 'changes'
      // Let's ensure consistency by always using 'root.' prefix from calculateChanges side.
      // For now, returning path starting with 'root.' generated here.
      return path;
    }

    
    // Pre-compute all node paths and store them in the map
    /*const nodePaths = new Map();
    root.descendants().forEach(d => {
      const path = getNodePath(d);
      nodePaths.set(d, path);
    });*/
    
    // Helper to normalize path for comparison
    function normalizePath(path) {
      // Handle root node case
      if (path === 'root' || path === currentState.name) {
        return 'root';
      }
      
      // For non-root nodes, normalize by removing the root prefix
      if (path.startsWith('root.')) {
        return path;
      } else if (path.startsWith(`${currentState.name}.`)) {
        return 'root' + path.substring(currentState.name.length);
      }
      
      return path;
    }
    
    // Find the exact added path in the current state
    const addedPath = currentState.changes.added && currentState.changes.added.length > 0 
      ? normalizePath(currentState.changes.added[0]) 
      : null;
    
    // Add links
    g.selectAll(".link")
      .data(root.links())
      .join("path")
      .attr("class", "link")
      .attr("d", d3.linkRadial()
        .angle(d => d.x)
        .radius(d => d.y)
      )
      .attr("fill", "none")
      .attr("stroke", "#6c757d")
      .attr("stroke-width", 1.5)
      .attr("opacity", 0)
      .transition()
      .duration(500)
      .delay((d, i) => i * 50)
      .attr("opacity", 1);
    
    // Add nodes
    const nodes = g.selectAll(".node")
      .data(root.descendants())
      .join("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${radialPoint(d.x, d.y)})`)
      .attr("opacity", 0)
      .on("mouseover", function(event, d) {
        // Highlight this node
        d3.select(this).select("circle")
          .transition()
          .duration(200)
          .attr("r", nodeRadius * 1.2)
          .attr("stroke-width", 3);
        
        // Show tooltip
        const tooltip = d3.select("body").append("div")
          .attr("class", "d3-tooltip")
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 25) + "px")
          .style("opacity", 0);
        
        // Simplified tooltip with just value and depth
        tooltip.html(`
          <strong>Value:</strong> ${d.data.name}<br>
          <strong>Depth:</strong> ${d.depth}
        `);
        
        tooltip.transition()
          .duration(200)
          .style("opacity", 1);
      })
      .on("mouseout", function() {
        // Remove highlight
        d3.select(this).select("circle")
          .transition()
          .duration(200)
          .attr("r", nodeRadius)
          .attr("stroke-width", 1.5);
        
        // Remove tooltip
        d3.selectAll(".d3-tooltip").transition()
          .duration(200)
          .style("opacity", 0)
          .remove();
      });
    
    // Check if this state has a changes object
    const hasChanges = currentState.changes && 
      (currentState.changes.added || currentState.changes.modified);
    
    // Add node circles with appropriate classes
    nodes.append("circle")
      .attr("r", nodeRadius)
      // --- START CORRECTED CLASS LOGIC ---
      // Replace this block entirely
      .attr("class", d => { // d is a D3 hierarchy node
        const path = getNodePath(d); // Use the robust, unified version

        // *** CRITICAL FIX: Use the changes from the CORRECT step's state object ***
        const changes = stateForThisStep.changes || { added: [], modified: [] };
        const addedList = changes.added || [];
        const modifiedList = changes.modified || [];
        const currentPath = path;

        let isAdded = false;
        // Using explicit loop as it worked for debugging, .includes() should also work now
        for (let i = 0; i < addedList.length; i++) {
            if (addedList[i] === currentPath) { isAdded = true; break; }
        }

        let isModified = false;
        if (!isAdded) {
            for (let i = 0; i < modifiedList.length; i++) {
                if (modifiedList[i] === currentPath) { isModified = true; break; }
            }
        }

        let nodeClass = "node-normal";
        if (isAdded) {
            nodeClass = "node-added";
        } else if (isModified) {
            nodeClass = "node-modified";
        }

        // Keep the logging for Node 121 temporarily to confirm the fix
        if (currentPath === 'root.children[1].children[1].children[0]') {
             console.warn(`[FINAL CHECK] Node 121 Path='${currentPath}'`);
             console.warn(`  >>> Using addedList from stateForThisStep:`, JSON.stringify(addedList));
             console.warn(`  >>> Final isAdded result:`, isAdded);
             console.warn(`  >>> Final Class: ${nodeClass}`);
        }

        return nodeClass;
    })
      // --- END CORRECTED CLASS LOGIC ---
      .attr("stroke", "#303030")
      .attr("stroke-width", 1.5);
    
    // Add node labels
    nodes.append("text")
      .attr("dy", "0.3em")
      .attr("text-anchor", "middle")
      .attr("font-size", d => d.depth === 0 ? "14px" : "12px") // Slightly larger text for root
      .attr("font-weight", d => d.depth === 0 ? "bold" : "normal") // Bold text for root
      .attr("fill", "#ffffff")
      .text(d => d.data.name);
    
    // Animate nodes in with depth-based delay
    nodes.transition()
      .duration(500)
      .delay(d => 300 + (d.depth * 100)) // Delay based on depth
      .attr("opacity", 1);
    
    // Add legend on the right side
    const legendX = chartWidth + 20; // Start legend 20px from the chart area
    const legendItems = [
      { color: "node-normal", label: "Standard Nodes" },
      { color: "node-modified", label: "Modified Nodes" },
      { color: "node-added", label: "Newly Added Nodes" }
    ];
    
    // Add legend items vertically
    legendItems.forEach((item, index) => {
      const itemY = height / 2 - 40 + (index * 30); // Center legend vertically
      
      // Colored circle
      svg.append("circle")
        .attr("cx", legendX + 8)
        .attr("cy", itemY)
        .attr("r", 8)
        .attr("class", item.color);
      
      // Label
      svg.append("text")
        .attr("x", legendX + 24)
        .attr("y", itemY + 4)
        .attr("font-size", "12px")
        .attr("fill", "#e0e0e0")
        .text(item.label);
    });
    
  }, [treeStates, currentStep, visualizationType]);

  
  // Function to manually refresh data
  const handleRefresh = () => {
    setLastUpdated(Date.now());
  };

  // Playback controls
  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };
  
  const handleStepForward = () => {
    if (currentStep < treeStates.length - 1) {
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
      <div className="d-flex justify-content-center my-5">
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  // Combined error and empty data handling for TreeVisualizer
  if (error || !data || data.length === 0) {
    return (
      <div className="empty-visualization">
        <div className="friendly-message-container">
          <div className="empty-state-icon">
            <i className="bi bi-diagram-3"></i>
          </div>
          <h3 className="empty-state-title">No Tree Data Found</h3>
          
          {error ? (
            <p className="empty-state-message">
              We couldn't find any tree structures in your code or encountered an error while analyzing it.
            </p>
          ) : (
            <p className="empty-state-message">
              Your code doesn't appear to contain any tree operations we can visualize.
            </p>
          )}
          
          <div className="suggestion-box">
            <h4>Try adding tree operations like:</h4>
            <pre className="example-code">
              class TreeNode:<br/>
              &nbsp;&nbsp;def __init__(self, value):<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;self.value = value<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;self.left = None<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;self.right = None<br/>
              <br/>
              root = TreeNode(10)<br/>
              root.left = TreeNode(5)<br/>
              root.right = TreeNode(15)
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
    if (treeStates.length > 0 && currentStep >= treeStates.length) {
      setCurrentStep(treeStates.length - 1);
    }
    
    switch(visualizationType) {
      case "HIERARCHICAL_TREE":
        return (
          <div className="visualization-container hierarchical-container" ref={hierarchicalRef}>
            {/* D3 visualization will be rendered here */}
          </div>
        );
      case "RADIAL_TREE":
        return (
          <div className="visualization-container radial-container" ref={radialRef}>
            {/* D3 visualization will be rendered here */}
          </div>
        );
      default:
        // Default to Hierarchical if no visualization type is specified
        return (
          <div className="visualization-container hierarchical-container" ref={hierarchicalRef}>
            {/* D3 visualization will be rendered here */}
          </div>
        );
    }
  };

  return (
    <div className="tree-visualizer">
      <Card className="visualization-main-card">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <h4 className="mb-0">Tree Visualization</h4>
            <Badge bg="primary" className="mt-2">
              {visualizationType || "HIERARCHICAL_TREE"}
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
            <p>{visualizationRationale || "Showing tree structure and node relationships."}</p>
          </div>
          
          {/* Visualization area */}
          {renderVisualization()}
          
          {/* Playback controls */}
          {treeStates.length > 0 && (
            <div className="playback-controls mt-4">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="step-indicator">
                  Step {currentStep + 1} of {treeStates.length}
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
                max={treeStates.length - 1}
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
                  disabled={currentStep === treeStates.length - 1}
                >
                  Next →
                </Button>
              </div>
            </div>
          )}
          
          {/* Code context */}
          {treeStates.length > 0 && (
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
                      <strong>Operation:</strong> {treeStates[currentStep-1].operation}
                    </div>
                    {treeStates[currentStep-1].operation_details?.code && (
                      <div className="code-snippet mb-2">
                        <strong>Code:</strong>
                        <pre className="mb-0 mt-1">{treeStates[currentStep-1].operation_details.code}</pre>
                      </div>
                    )}
                    <div className="code-location">
                      <strong>Location:</strong> {treeStates[currentStep-1].location}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}

export default TreeVisualizer;