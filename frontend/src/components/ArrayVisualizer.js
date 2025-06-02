import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Alert, Spinner, Card, Button, Badge } from 'react-bootstrap';
import axios from 'axios';
import * as d3 from 'd3';
import './ArrayVisualizer.css';

function ArrayVisualizer() {
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
  const timelineRef = useRef(null);
  const elementFocusedRef = useRef(null);
  const comparisonRef = useRef(null);

  // Function to fetch data
  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch array data
      const dataResponse = await axios.get('http://localhost:8000/api/data/arrays');
      
      // Fetch visualization selection
      const visualizationResponse = await axios.get('http://localhost:8000/api/visualization/arrays');
      
      setData(dataResponse.data);
      setVisualizationType(visualizationResponse.data.visualization_type);
      setVisualizationRationale(visualizationResponse.data.rationale);
      setError(null);
      
      // Reset current step when new data is loaded
      setCurrentStep(0);
      setIsPlaying(false);
    } catch (error) {
      console.error('Error fetching array data:', error);
      setError(error.response?.data?.error || 'Error fetching array data');
    } finally {
      setLoading(false);
    }
  };

  // Helper function to calculate changes between array states
  const calculateChanges = (current, previous) => {
    if (!previous || !current || 
        !Array.isArray(current.content) || 
        !Array.isArray(previous.content)) {
      return { added: [], removed: [], modified: [] };
    }
    
    const added = [];
    const removed = [];
    const modified = [];
    
    // Check for modified elements
    const minLength = Math.min(current.content.length, previous.content.length);
    for (let i = 0; i < minLength; i++) {
      if (current.content[i] !== previous.content[i]) {
        modified.push(i);
      }
    }
    
    // Check for added elements
    if (current.content.length > previous.content.length) {
      for (let i = previous.content.length; i < current.content.length; i++) {
        added.push(i);
      }
    }
    
    // Check for removed elements
    if (current.content.length < previous.content.length) {
      for (let i = current.content.length; i < previous.content.length; i++) {
        removed.push(i);
      }
    }
    
    // Special case for operations
    if (current.operation === "append") {
      added.push(current.content.length - 1);
      const modifiedIndex = modified.indexOf(current.content.length - 1);
      if (modifiedIndex >= 0) {
        modified.splice(modifiedIndex, 1);
      }
    } else if (current.operation === "insert") {
      // In many cases, insert at 0 will shift all elements
      if (current.operation_details && 
          current.operation_details.code && 
          current.operation_details.code.includes(".insert(0")) {
        added.push(0);
        modified.splice(0, modified.length);
      }
    } else if (current.operation === "pop") {
      removed.push(previous.content.length - 1);
    }
    
    return { added, removed, modified };
  };

   // Process array data for visualization - FIXED
  const arrayStates = useMemo(() => {
    if (!data) return [];
    
    // Step 1: Filter out internal calls and exits
    const initialFiltered = data.filter(item => 
      item.operation !== "call" && 
      item.operation !== "exit"
    );
    
    // Step 2: Process and deduplicate array states
    const uniqueContentStates = [];
    const seenContentByName = {}; // Track last seen content by array name
    const arrayNames = new Set(); // Track all array names
    const statesByName = {}; // Group states by array name
    const finalStatesByName = {}; // Track final states by name
    
    // First, collect all array names and group states
    initialFiltered.forEach(state => {
      const arrayName = state.name;
      arrayNames.add(arrayName);
      
      // Group states by array name
      if (!statesByName[arrayName]) {
        statesByName[arrayName] = [];
      }
      statesByName[arrayName].push(state);
      
      // Track final states separately
      if (state.operation === "final_state") {
        finalStatesByName[arrayName] = state;
      }
    });
  
  // Process each array's states, ensuring we retain at least one state per array
  initialFiltered.forEach(state => {
    const contentStr = JSON.stringify(state.content);
    const arrayName = state.name;
    
    // Check if this is a new array or has different content than last seen
    if (!seenContentByName[arrayName] || seenContentByName[arrayName] !== contentStr) {
      // This is a meaningful change - keep it
      uniqueContentStates.push(state);
      seenContentByName[arrayName] = contentStr;
    } else if (state.operation !== "final_state") {
      // Not a final_state with same content, keep it (could be important operation)
      uniqueContentStates.push(state);
    }
    // Otherwise, it's a redundant final_state with same content - skip it
  });
  
  // Ensure each array has at least one state in the result
  arrayNames.forEach(arrayName => {
    // Check if this array has any states in uniqueContentStates
    const hasState = uniqueContentStates.some(state => state.name === arrayName);
    
    if (!hasState) {
      // This array has no states in the result - add its final state or any state
      if (finalStatesByName[arrayName]) {
        // Add the final state and mark it as special
        const finalState = {...finalStatesByName[arrayName], _onlyState: true};
        uniqueContentStates.push(finalState);
      } else if (statesByName[arrayName] && statesByName[arrayName].length > 0) {
        // Add the first available state
        uniqueContentStates.push({...statesByName[arrayName][0], _onlyState: true});
      }
    }
  });
  
  // Sort states by timestamp to maintain chronological order
  uniqueContentStates.sort((a, b) => a.timestamp - b.timestamp);
  
  // Step 3: Calculate changes for each state
  return uniqueContentStates.map((arrayData, index) => ({
    ...arrayData,
    stepNumber: index + 1,
    changes: calculateChanges(
      arrayData, 
      index > 0 ? uniqueContentStates[index - 1] : null
    )
  }));
}, [data]);

  

  // Set up polling for data updates and initial load
  useEffect(() => {
    fetchData();
    
    // Poll for updates every 3 seconds
    const intervalId = setInterval(() => {
      fetchData();
    }, 300000);
    
    // Clean up interval on unmount
    return () => clearInterval(intervalId);
  }, [lastUpdated]);

  // Animation playback effect
  useEffect(() => {
    let animationTimer;
    
    if (isPlaying && arrayStates.length > 0) {
      // Calculate time interval based on playback speed
      const interval = 2000 / playbackSpeed;
      
      animationTimer = setTimeout(() => {
        if (currentStep < arrayStates.length - 1) {
          setCurrentStep(prev => prev + 1);
        } else {
          setIsPlaying(false); // Stop at the end
        }
      }, interval);
    }
    
    return () => {
      if (animationTimer) clearTimeout(animationTimer);
    };
  }, [isPlaying, currentStep, arrayStates.length, playbackSpeed]);

  // Helper function to normalize LLM visualization type strings
  const normalizeLLMVizType = (typeStr) => {
    if (typeof typeStr !== 'string' || !typeStr.trim()) {
      return ""; // Return empty string for non-strings or empty/whitespace-only strings
    }

    let normalized = typeStr.trim();

    // Attempt to split known compound words if no spaces/underscores exist
    // This specifically targets "TimelineArray" and "timelinearray" for TIMELINE_ARRAY
    if (/^timelinearray$/i.test(normalized)) { // Matches "timelinearray" or "TimelineArray" etc.
      normalized = "Timeline Array"; // Convert to a spaced version first
    }
    // Add similar specific rules here if other types have common conjoined variations
    // e.g., if (/^elementfocused$/i.test(normalized)) normalized = "Element Focused";


    // Add a space before any uppercase letter that is preceded by a lowercase letter or number
    // or an uppercase letter followed by a lowercase letter (helps with PascalCase/camelCase)
    normalized = normalized.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    normalized = normalized.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');

    // Convert to uppercase
    normalized = normalized.toUpperCase();

    // Replace one or more whitespace characters OR existing underscores with a single underscore.
    // Also, remove any leading/trailing underscores.
    normalized = normalized.replace(/[\s_]+/g, '_').replace(/^_+|_+$/g, '');

    return normalized;
  };

  // D3 Timeline Visualization - Simplified
useEffect(() => {
  if (!arrayStates.length || !timelineRef.current ||
    normalizeLLMVizType(visualizationType) !== "TIMELINE_ARRAY") return;
  
  const container = d3.select(timelineRef.current);
  container.selectAll("*").remove(); // Clear previous visualization
  
  const currentState = arrayStates[currentStep];
  const width = timelineRef.current.clientWidth;
  const height = 180; // Reduced height since we removed progress line and operation indicator
  const cellSize = 50;
  const cellPadding = 10;
  
  // Calculate dynamic array name width based on text length
  const textNode = document.createElement("text");
  textNode.textContent = currentState.name + ":";
  textNode.style.font = "16px sans-serif"; // Approximate font style
  document.body.appendChild(textNode);
  const textWidth = textNode.getBoundingClientRect().width;
  document.body.removeChild(textNode);
  
  // Ensure minimum margin with padding
  const arrayNameWidth = Math.max(120, textWidth + 30); // At least 120px or text width + padding
  
  // Create SVG
  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height);
    
  // Add array name
  svg.append("text")
    .attr("class", "array-name")
    .attr("x", 10)
    .attr("y", cellSize + cellPadding + 5)
    .text(currentState.name + ":");
    
  // Array container group
  const arrayGroup = svg.append("g")
    .attr("transform", `translate(${arrayNameWidth}, ${cellPadding})`);
    
  // Function to find all indices of an element
  function findAllIndices(arr, val) {
    let indices = [];
    for(let i = 0; i < arr.length; i++) {
      if (arr[i] === val) {
        indices.push(i);
      }
    }
    return indices;
  }
  
  // Create elements with enter/update/exit pattern for better animations
  // We'll use the original index to ensure duplicates are handled correctly
  const contentWithIndices = currentState.content.map((value, index) => ({value, index}));
  
  const elementGroups = arrayGroup.selectAll(".array-element")
    .data(contentWithIndices, d => `element-${d.index}`);
  
  // Remove old elements with exit animation
  elementGroups.exit()
    .transition()
    .duration(500)
    .attr("transform", d => `translate(${d.index * (cellSize + 5)}, ${height})`)
    .remove();
  
  // Add new elements
  const enterGroups = elementGroups.enter()
    .append("g")
    .attr("class", "array-element")
    .attr("transform", d => `translate(${d.index * (cellSize + 5)}, -60)`)
    .style("opacity", 0);
  
  // Add rectangles for new elements
  enterGroups.append("rect")
    .attr("width", cellSize)
    .attr("height", cellSize)
    .attr("rx", 4)
    .attr("ry", 4)
    .attr("class", d => {
      if (currentState.changes.added.includes(d.index)) return "element-added";
      if (currentState.changes.modified.includes(d.index)) return "element-modified";
      return "element-normal";
    });
  
  // Add text for values
  enterGroups.append("text")
    .attr("x", cellSize / 2)
    .attr("y", cellSize / 2)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .text(d => d.value);
  
  // Add index labels
  enterGroups.append("text")
    .attr("class", "index-label")
    .attr("x", cellSize / 2)
    .attr("y", cellSize + 15)
    .attr("text-anchor", "middle")
    .text(d => d.index);
  
  // Animate new elements in
  enterGroups.transition()
    .duration(600)
    .attr("transform", d => `translate(${d.index * (cellSize + 5)}, 0)`)
    .style("opacity", 1);
  
  // Update existing elements
  elementGroups.attr("class", "array-element")
    .transition()
    .duration(600)
    .attr("transform", d => `translate(${d.index * (cellSize + 5)}, 0)`);
  
  elementGroups.select("rect")
    .transition()
    .duration(300)
    .attr("class", d => {
      if (currentState.changes.added.includes(d.index)) return "element-added";
      if (currentState.changes.modified.includes(d.index)) return "element-modified";
      return "element-normal";
    });
  
  elementGroups.select(".index-label")
    .transition()
    .duration(300)
    .text(d => d.index);
  
  // Merge enter and update selections for further operations
  const allElements = enterGroups.merge(elementGroups);
  
  // Add legend at the bottom
  const legendY = height - 30;
  
  // Legend items
  const legendItems = [
    { color: "element-normal", label: "Standard Elements" },
    { color: "element-modified", label: "Modified Elements" },
    { color: "element-added", label: "Newly Added Elements" }
  ];
  
  // Calculate legend layout
  const legendWidth = 180; // Width per legend item
  const totalLegendWidth = legendItems.length * legendWidth;
  const legendStartX = (width - totalLegendWidth) / 2;
  
  // Add legend items
  legendItems.forEach((item, index) => {
    const itemX = legendStartX + (index * legendWidth);
    
    // Colored square
    svg.append("rect")
      .attr("x", itemX)
      .attr("y", legendY)
      .attr("width", 16)
      .attr("height", 16)
      .attr("rx", 3)
      .attr("ry", 3)
      .attr("class", item.color);
    
    // Label
    svg.append("text")
      .attr("x", itemX + 24)
      .attr("y", legendY + 12)
      .attr("font-size", "12px")
      .attr("fill", "#e0e0e0")
      .text(item.label);
  });
  
}, [arrayStates, currentStep, visualizationType]);
  

// D3 Element-Focused Visualization - Simplified
useEffect(() => {
  if (!arrayStates.length || !elementFocusedRef.current || 
      visualizationType !== "ELEMENT_FOCUSED") return;
  
  const container = d3.select(elementFocusedRef.current);
  container.selectAll("*").remove(); // Clear previous visualization
  
  const currentState = arrayStates[currentStep];
  const width = elementFocusedRef.current.clientWidth;
  const height = 250; // Reduced height since we removed several elements
  const cellSize = 60;
  const cellPadding = 15;
  const arrayNameWidth = 120;
  
  // Calculate minimum margin needed based on array name length
  const textNode = document.createElement("text");
  textNode.textContent = currentState.name + ":";
  textNode.style.font = "16px sans-serif"; // Approximate font style
  document.body.appendChild(textNode);
  const textWidth = textNode.getBoundingClientRect().width;
  document.body.removeChild(textNode);
  
  // Ensure minimum margin is at least the text width plus some padding
  const minArrayNameWidth = Math.max(arrayNameWidth, textWidth + 30);
  
  // Create SVG with appropriate height for visualization
  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height);
    
  // Add array name
  svg.append("text")
    .attr("class", "array-name")
    .attr("x", 10)
    .attr("y", cellSize + cellPadding + 5)
    .text(currentState.name + ":");
    
  // Main array container group - use the adjusted margin
  const arrayGroup = svg.append("g")
    .attr("transform", `translate(${minArrayNameWidth}, ${cellPadding})`);
    
  // Find the elements that changed in this operation
  const changedIndices = [
    ...currentState.changes.added,
    ...currentState.changes.modified
  ];
  
  // Create elements first as selections, not transitions
  const elementSelections = arrayGroup.selectAll(".array-element")
    .data(currentState.content)
    .enter()
    .append("g")
    .attr("class", "array-element")
    .attr("transform", (d, i) => {
      const isChanged = changedIndices.includes(i);
      const yOffset = isChanged ? -10 : 0;
      return `translate(${i * (cellSize + 10)}, ${yOffset})`;
    })
    .style("opacity", 0); // Start invisible for animation
  
  // Add rectangles for elements - now using the selection, not transition
  elementSelections.append("rect")
    .attr("width", cellSize)
    .attr("height", cellSize)
    .attr("rx", 6)
    .attr("ry", 6)
    .attr("class", (d, i) => {
      if (currentState.changes.added.includes(i)) return "element-added";
      if (currentState.changes.modified.includes(i)) return "element-modified";
      return "element-normal";
    });
    
  // Add text for values with special animation for changed values
  elementSelections.append("text")
    .attr("x", cellSize / 2)
    .attr("y", cellSize / 2)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("class", (d, i) => {
      if (changedIndices.includes(i)) {
        return "element-text-highlight";
      }
      return "element-text";
    })
    .text(d => d);
    
  // Add index labels
  elementSelections.append("text")
    .attr("class", "index-label")
    .attr("x", cellSize / 2)
    .attr("y", cellSize + 15)
    .attr("text-anchor", "middle")
    .text((d, i) => i);
  
  // Now apply the transitions to the elements
  elementSelections.transition()
    .duration(500)
    .delay((d, i) => i * 100) // Stagger the animations
    .style("opacity", 1);
    
  // Add special highlight effects for changed elements
  const changedElements = arrayGroup.selectAll(".changed-element")
    .data(changedIndices)
    .enter();
    
  // Add highlight glow for changed elements
  changedElements.append("rect")
    .attr("width", cellSize + 10)
    .attr("height", cellSize + 10)
    .attr("x", d => d * (cellSize + 10) - 5)
    .attr("y", -15)
    .attr("rx", 8)
    .attr("ry", 8)
    .attr("class", "element-highlight")
    .style("opacity", 0)
    .transition()
    .duration(800)
    .style("opacity", 1);
  
  // Add legend at the bottom - COPIED FROM ARRAY COMPARISON
  const legendY = height - 30;
  
  // Legend items
  const legendItems = [
    { color: "element-normal", label: "Standard Elements" },
    { color: "element-modified", label: "Modified Elements" },
    { color: "element-added", label: "Newly Added Elements" }
  ];
  
  // Calculate legend layout
  const legendWidth = 180; // Width per legend item
  const totalLegendWidth = legendItems.length * legendWidth;
  const legendStartX = (width - totalLegendWidth) / 2;
  
  // Add legend items
  legendItems.forEach((item, index) => {
    const itemX = legendStartX + (index * legendWidth);
    
    // Colored square
    svg.append("rect")
      .attr("x", itemX)
      .attr("y", legendY)
      .attr("width", 16)
      .attr("height", 16)
      .attr("rx", 3)
      .attr("ry", 3)
      .attr("class", item.color);
    
    // Label
    svg.append("text")
      .attr("x", itemX + 24)
      .attr("y", legendY + 12)
      .attr("font-size", "12px")
      .attr("fill", "#e0e0e0")
      .text(item.label);
  });
  
}, [arrayStates, currentStep, visualizationType]);


 // D3 Array Comparison Visualization - FIXED
useEffect(() => {
  if (!arrayStates.length || !comparisonRef.current || 
      visualizationType !== "ARRAY_COMPARISON") return;
  
  console.log("All array states:", arrayStates.map(s => ({ name: s.name, op: s.operation, content: s.content })));
  
  const container = d3.select(comparisonRef.current);
  container.selectAll("*").remove(); // Clear previous visualization
  
  // Get the container dimensions
  const width = comparisonRef.current.clientWidth;
  let height = 450; // Starting height - will adjust based on array count
  
  // Constants for layout
  const cellSize = 45;
  const cellSpacing = 8;
  const rowHeight = 90; // More compact rows
  const minLabelWidth = 90; // Minimum width for label area
  
  // Group array events by name
  const arrayHistory = {};
  const creationOrder = []; // Track creation order of arrays
  
  // First pass: gather basic array info and find creation order
  arrayStates.forEach(state => {
    if (!arrayHistory[state.name]) {
      arrayHistory[state.name] = [];
      if (!creationOrder.includes(state.name)) {
        creationOrder.push(state.name);
      }
    }
    arrayHistory[state.name].push(state);
  });
  
  // Calculate how many rows we need based on unique arrays
  const arrayNames = creationOrder;
  console.log("Array names in order:", arrayNames);
  
  // Calculate the required label width based on array names
  let labelWidth = minLabelWidth;
  
  // Create a temporary text element to measure text width
  const tempText = document.createElement('span');
  tempText.style.visibility = 'hidden';
  tempText.style.fontFamily = 'sans-serif';
  tempText.style.fontSize = '16px';
  tempText.style.fontWeight = 'bold';
  document.body.appendChild(tempText);
  
  // Find the longest array name
  arrayNames.forEach(name => {
    tempText.textContent = `${name}:`;
    const nameWidth = tempText.getBoundingClientRect().width;
    // Add padding (30px) to the measured width
    labelWidth = Math.max(labelWidth, nameWidth + 30);
  });
  
  // Clean up temporary element
  document.body.removeChild(tempText);
  
  // First, process the data to identify significant changes and perform event mapping
  
  // 1. Get all unique timestamps from the original data
  const originalTimestamps = [...new Set(arrayStates.map(s => s.timestamp))].sort((a, b) => a - b);
  console.log("Original timestamps:", originalTimestamps);
  
  // 2. Identify meaningful changes for each array
  const significantEvents = [];
  const arrayMaxSizes = {}; // Track maximum array sizes for column width calculation
  
  // Track arrays that only appear in final states
  const onlyFinalStateArrays = new Set();
  
  arrayNames.forEach(arrayName => {
    let hasNonFinalState = false;
    const states = arrayHistory[arrayName];
    
    // Check if this array has any non-final states
    for (const state of states) {
      if (state.operation !== "final_state" && !state._onlyState) {
        hasNonFinalState = true;
        break;
      }
    }
    
    if (!hasNonFinalState) {
      onlyFinalStateArrays.add(arrayName);
    }
  });
  
  console.log("Arrays only in final states:", Array.from(onlyFinalStateArrays));
  
  // Collect significant events from all arrays
  arrayNames.forEach(arrayName => {
    const states = arrayHistory[arrayName];
    let prevContentStr = null;
    
    states.forEach(state => {
      // For arrays only in final states, mark their final states as significant
      if (onlyFinalStateArrays.has(arrayName) || state._onlyState) {
        state._significantFinalState = true;
      }
      
      const contentStr = JSON.stringify(state.content);
      
      // Record this state if it represents a meaningful change or is a significant final state
      if (prevContentStr === null || contentStr !== prevContentStr || state._significantFinalState) {
        significantEvents.push({
          timestamp: state.timestamp,
          arrayName: arrayName,
          state: state
        });
        
        // Track the maximum array size for column width calculations
        if (Array.isArray(state.content)) {
          if (!arrayMaxSizes[arrayName] || state.content.length > arrayMaxSizes[arrayName]) {
            arrayMaxSizes[arrayName] = state.content.length;
          }
        }
        
        prevContentStr = contentStr;
      }
    });
  });
  
  // 3. Sort events by timestamp to get a true chronological order
  significantEvents.sort((a, b) => a.timestamp - b.timestamp);
  console.log("Significant events:", significantEvents.map(e => ({ name: e.arrayName, timestamp: e.timestamp })));
  
  // 4. Create timestamps from significant events only
  const significantTimestamps = [...new Set(significantEvents.map(e => e.timestamp))].sort((a, b) => a - b);
  console.log("Significant timestamps:", significantTimestamps);
  
  // 5. Get the significant changes at each timestamp for step-by-step animation
  const significantChanges = {};
  significantTimestamps.forEach(timestamp => {
    significantChanges[timestamp] = new Set();
  });
  
  // Assign arrays to timestamps where they have significant events
  significantEvents.forEach(event => {
    significantChanges[event.timestamp].add(event.arrayName);
  });
  
  console.log("Significant changes by timestamp:", Object.fromEntries(
    Object.entries(significantChanges).map(([ts, arrays]) => [ts, Array.from(arrays)])
  ));
  
  // Now ensure all arrays are assigned to at least one timestamp
  // Find arrays that aren't in any timestamp's changes
  const unassignedArrays = new Set(arrayNames);
  
  // Remove arrays that are already assigned
  Object.values(significantChanges).forEach(changedArrays => {
    changedArrays.forEach(arrayName => {
      unassignedArrays.delete(arrayName);
    });
  });
  
  console.log("Unassigned arrays:", Array.from(unassignedArrays));
  
  // Assign unassigned arrays to appropriate timestamps
  if (unassignedArrays.size > 0 && significantTimestamps.length > 0) {
    // Use the latest timestamp for unassigned arrays
    const lastTimestamp = significantTimestamps[significantTimestamps.length - 1];
    
    unassignedArrays.forEach(arrayName => {
      console.log(`Assigning unassigned array ${arrayName} to timestamp ${lastTimestamp}`);
      significantChanges[lastTimestamp].add(arrayName);
    });
  }
  
  // Adjust height based on array count
  const calculatedHeight = (arrayNames.length * rowHeight) + 60; // +60 for legend
  height = Math.max(height, calculatedHeight);
  
  // Calculate column widths based on array content sizes
  const timestampArraySizes = {};
  
  // For each timestamp, find the largest array to determine column width
  significantEvents.forEach(event => {
    const { timestamp, arrayName, state } = event;
    
    if (!timestampArraySizes[timestamp]) {
      timestampArraySizes[timestamp] = 0;
    }
    
    if (Array.isArray(state.content)) {
      const arrayWidth = state.content.length * (cellSize + cellSpacing);
      timestampArraySizes[timestamp] = Math.max(timestampArraySizes[timestamp], arrayWidth);
    }
  });
  
  // All significant timestamps are active
  const activeTimestamps = significantTimestamps;
  console.log("Active timestamps:", activeTimestamps);
  
  // Set minimum column widths based on array sizes
  const columnWidths = {};
  activeTimestamps.forEach(timestamp => {
    // Minimum width of 100px, or enough for the largest array plus padding
    columnWidths[timestamp] = Math.max(120, (timestampArraySizes[timestamp] || 0) + 20);
  });
  
  // Calculate total timeline width
  let totalTimelineWidth = labelWidth;
  activeTimestamps.forEach(timestamp => {
    totalTimelineWidth += columnWidths[timestamp];
  });
  
  // Create SVG with proper width
  const svg = container.append("svg")
    .attr("width", Math.max(width, totalTimelineWidth))
    .attr("height", height);
  
  // Create a horizontal scrollable container for timeline
  const timelineContainer = svg.append("g")
    .attr("transform", `translate(0, 0)`);
  
  // Create time columns only for active timestamps
  let xOffset = labelWidth;
  
  activeTimestamps.forEach((timestamp, timeIndex) => {
    const columnWidth = columnWidths[timestamp];
    
    // Add vertical grid line
    timelineContainer.append("line")
      .attr("x1", xOffset)
      .attr("y1", 0)
      .attr("x2", xOffset)
      .attr("y2", arrayNames.length * rowHeight)
      .attr("stroke", "#3a3f52")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3");
    
    // Add time column label
    timelineContainer.append("text")
      .attr("class", "time-label")
      .attr("x", xOffset + columnWidth / 2)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .attr("font-size", "12px")
      .attr("fill", "#a0a6b5")
      .text(`T${timeIndex + 1}`);
    
    // Update xOffset for next column
    xOffset += columnWidth;
  });
  
  // Create rows for each array
  arrayNames.forEach((arrayName, rowIndex) => {
    const yPosition = rowIndex * rowHeight + 30; // Add padding from top
    
    // Add array name label background
    timelineContainer.append("rect")
      .attr("x", 0)
      .attr("y", yPosition)
      .attr("width", labelWidth)
      .attr("height", rowHeight - 10)
      .attr("fill", "#252a3c")
      .attr("opacity", 0.8);
    
    // Add array name text
    timelineContainer.append("text")
      .attr("class", "array-name")
      .attr("x", 10)
      .attr("y", yPosition + (rowHeight - 10) / 2)
      .attr("dominant-baseline", "middle")
      .attr("font-size", "16px")
      .attr("font-weight", "bold")
      .attr("fill", "#6384ff")
      .text(`${arrayName}:`);
    
    // Add horizontal grid line
    timelineContainer.append("line")
      .attr("x1", 0)
      .attr("y1", yPosition + rowHeight - 10)
      .attr("x2", totalTimelineWidth)
      .attr("y2", yPosition + rowHeight - 10)
      .attr("stroke", "#3a3f52")
      .attr("stroke-width", 1);
  });
  
  // Track previous states to detect changes
  const previousStates = {};
  
  // Render array states up to current step
  xOffset = labelWidth;
  
  // Track which arrays were rendered
  const renderedArrays = new Set();

  // Calculate the appropriate current step
  const currentMeaningfulStep = Math.min(
    Math.min(currentStep + 1, activeTimestamps.length),
    significantTimestamps.length
  );
  
  for (let timeIndex = 0; timeIndex < currentMeaningfulStep; timeIndex++) {
    // Skip if we're beyond the active timestamps
    if (timeIndex >= activeTimestamps.length) break;
    
    const timestamp = activeTimestamps[timeIndex];
    const columnWidth = columnWidths[timestamp];
    const changedArrays = significantChanges[timestamp];
    
    console.log(`Rendering timestamp ${timestamp} (T${timeIndex+1}), arrays:`, Array.from(changedArrays || []));
    
    // For each array, try to render its state at this timestamp
    arrayNames.forEach((arrayName, rowIndex) => {
      // Skip arrays with no changes at this timestamp
      if (!changedArrays || !changedArrays.has(arrayName)) {
        console.log(`Skipping ${arrayName} at T${timeIndex+1} - not in changed arrays`);
        return;
      }
      
      console.log(`Attempting to render ${arrayName} at T${timeIndex+1}`);
      
      const yPosition = rowIndex * rowHeight + 30;
      const states = arrayHistory[arrayName];
      
      // Improve state selection logic to handle final states better
      let state = null;
      
      // Strategy 1: Look for exact match at this timestamp
      for (const s of states) {
        if (s.timestamp === timestamp) {
          state = s;
          console.log(`Found exact match for ${arrayName} at T${timeIndex+1}`);
          break;
        }
      }
      
      // Strategy 2: If no exact match, look for most recent state before this timestamp
      if (!state) {
        let maxTimestamp = -Infinity;
        for (const s of states) {
          if (s.timestamp <= timestamp && s.timestamp > maxTimestamp) {
            state = s;
            maxTimestamp = s.timestamp;
          }
        }
        if (state) {
          console.log(`Found prior state for ${arrayName} at T${timeIndex+1}`);
        }
      }
      
      // Strategy 3: If still no state, use any state available
      if (!state && states.length > 0) {
        state = states[0]; // Use first available state as fallback
        console.log(`Using fallback state for ${arrayName} at T${timeIndex+1}`);
      }
      
      // If we still don't have a state, skip this array
      if (!state) {
        console.log(`No state found for ${arrayName} at T${timeIndex+1} - SKIPPING`);
        return;
      }
      
      // Mark this array as rendered
      renderedArrays.add(arrayName);
      
      // Identify changes relative to previous state
      const prevState = previousStates[arrayName];
      const changes = { added: [], modified: [] };
      
      if (prevState && state.content && Array.isArray(state.content) && 
          Array.isArray(prevState.content)) {
        // Check for new elements
        if (state.content.length > prevState.content.length) {
          for (let i = prevState.content.length; i < state.content.length; i++) {
            changes.added.push(i);
          }
        }
        
        // Check for modified elements
        const minLength = Math.min(state.content.length, prevState.content.length);
        for (let i = 0; i < minLength; i++) {
          if (state.content[i] !== prevState.content[i]) {
            changes.modified.push(i);
          }
        }
      }
      
      // Create the cell group centered in the column
      const cellGroup = timelineContainer.append("g")
        .attr("class", "array-state-cell")
        .style("opacity", 0);
      
      // Calculate the remaining space in the column after array width
      const arrayWidth = state.content && Array.isArray(state.content) && state.content.length > 0 ? 
                        state.content.length * (cellSize + cellSpacing) - cellSpacing :
                        cellSize; // Minimum width for empty arrays
      
      const leftPadding = (columnWidth - arrayWidth) / 2;
      
      // Center the array in the column
      cellGroup.attr("transform", `translate(${xOffset + leftPadding}, ${yPosition + 10})`);
      
      // Create array elements in a strict horizontal layout
      if (state.content && Array.isArray(state.content)) {
        // Create a container for the array elements
        const elementsGroup = cellGroup.append("g")
          .attr("class", "elements-group");
        
        // Render each element at a fixed horizontal position
        state.content.forEach((value, elemIndex) => {
          const elemX = elemIndex * (cellSize + cellSpacing);
          const elemY = 0; // All elements at Y=0 to guarantee horizontal layout
          
          // Determine element class
          let elementClass;
          if (changes.added.includes(elemIndex)) {
            elementClass = "element-added";
          } else if (changes.modified.includes(elemIndex)) {
            elementClass = "element-modified";
          } else {
            elementClass = "element-normal";
          }
          
          // Create element rectangle
          const rect = elementsGroup.append("rect")
            .attr("class", elementClass)
            .attr("x", elemX)
            .attr("y", elemY)
            .attr("width", cellSize)
            .attr("height", cellSize)
            .attr("rx", 4)
            .attr("ry", 4)
            .style("opacity", 0)
            .on("mouseover", function(event) {
              // Show tooltip
              const tooltip = d3.select("body").append("div")
                .attr("class", "d3-tooltip")
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 25) + "px")
                .style("opacity", 0);
              
              tooltip.html(`
                <strong>Value:</strong> ${value}<br>
                <strong>Array:</strong> ${arrayName}
              `);
              
              tooltip.transition()
                .duration(200)
                .style("opacity", 1);
              
              // Highlight element
              d3.select(this)
                .transition()
                .duration(200)
                .attr("stroke-width", 3);
              
              // Highlight matching values
              highlightMatchingValues(value);
            })
            .on("mouseout", function() {
              // Remove tooltip
              d3.selectAll(".d3-tooltip").transition()
                .duration(200)
                .style("opacity", 0)
                .remove();
              
              // Remove highlight
              d3.select(this)
                .transition()
                .duration(200)
                .attr("stroke-width", 1.5);
              
              // Remove matching highlights
              removeMatchingHighlights();
            });
          
          // Element value text
          const text = elementsGroup.append("text")
            .attr("x", elemX + cellSize / 2)
            .attr("y", elemY + cellSize / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-size", "14px")
            .attr("fill", "#ffffff")
            .text(value)
            .style("opacity", 0);
          
          // Animate elements in with staggered delay
          rect.transition()
            .duration(500)
            .delay(elemIndex * 30)
            .style("opacity", 1);
          
          text.transition()
            .duration(500)
            .delay(elemIndex * 30)
            .style("opacity", 1);
        });
      } else {
        // Handle empty arrays or non-array content
        const emptyIndicator = cellGroup.append("text")
          .attr("x", cellSize / 2)
          .attr("y", cellSize / 2)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("font-size", "12px")
          .attr("fill", "#a0a6b5")
          .text("(empty)")
          .style("opacity", 0);
          
        emptyIndicator.transition()
          .duration(500)
          .style("opacity", 0.7);
      }
      
      // Animate the cell in
      cellGroup.transition()
        .duration(500)
        .style("opacity", 1);
      
      // Update previous state
      previousStates[arrayName] = state;
    });
    
    // Move to the next column
    xOffset += columnWidth;
  }
  
  // Check if any arrays weren't rendered
  const unrenderedArrays = arrayNames.filter(name => !renderedArrays.has(name));
  if (unrenderedArrays.length > 0) {
    console.warn("Arrays not rendered:", unrenderedArrays);
  }
  
  // Add legend at the bottom
  const legendY = arrayNames.length * rowHeight + 30;
  
  // Legend items
  const legendItems = [
    { color: "element-normal", label: "Standard Elements" },
    { color: "element-modified", label: "Modified Elements" },
    { color: "element-added", label: "Newly Added Elements" }
  ];
  
  // Calculate legend layout
  const legendWidth = 180; // Width per legend item
  const totalLegendWidth = legendItems.length * legendWidth;
  const legendStartX = (Math.min(width, totalTimelineWidth) - totalLegendWidth) / 2;
  
  // Add legend items
  legendItems.forEach((item, index) => {
    const itemX = legendStartX + (index * legendWidth);
    
    // Colored square
    timelineContainer.append("rect")
      .attr("x", itemX)
      .attr("y", legendY)
      .attr("width", 16)
      .attr("height", 16)
      .attr("rx", 3)
      .attr("ry", 3)
      .attr("class", item.color);
    
    // Label
    timelineContainer.append("text")
      .attr("x", itemX + 24)
      .attr("y", legendY + 12)
      .attr("font-size", "12px")
      .attr("fill", "#e0e0e0")
      .text(item.label);
  });
  
  // Function to highlight matching values across arrays
  function highlightMatchingValues(value) {
    svg.selectAll("rect").each(function() {
      // Find the value text associated with this rect
      const parent = d3.select(this.parentNode);
      const valueText = parent.select("text");
      
      if (valueText.size() && valueText.text() == value) {
        // Create highlight circle around the matching element
        const rect = d3.select(this);
        const x = parseFloat(rect.attr("x"));
        const y = parseFloat(rect.attr("y"));
        
        parent.append("circle")
          .attr("class", "match-highlight")
          .attr("cx", x + cellSize/2)
          .attr("cy", y + cellSize/2)
          .attr("r", cellSize/2 + 5)
          .attr("fill", "none")
          .attr("stroke", "#ff5a5f")
          .attr("stroke-width", 2)
          .attr("stroke-dasharray", "3,3")
          .attr("opacity", 0)
          .transition()
          .duration(300)
          .attr("opacity", 0.7);
      }
    });
  }
  
  // Function to remove matching highlights
  function removeMatchingHighlights() {
    svg.selectAll(".match-highlight").transition()
      .duration(200)
      .attr("opacity", 0)
      .remove();
  }
  
  // Add horizontal scrolling listener
  const scrollArea = container.node();
  scrollArea.addEventListener("wheel", function(event) {
    if (event.deltaY !== 0) {
      event.preventDefault();
      scrollArea.scrollLeft += event.deltaY;
    }
  });
  
  // Add styles for the new classes if they don't exist in CSS
  if (!document.getElementById("array-comparison-styles")) {
    const styleElement = document.createElement("style");
    styleElement.id = "array-comparison-styles";
    styleElement.textContent = `
      .element-normal {
        fill: #6384ff;
        stroke: #3857c0;
      }
      .element-modified {
        fill: #ffc107;
        stroke: #d39e00;
        animation: pulse-yellow 2s infinite;
      }
      .element-added {
        fill: #28a745;
        stroke: #1e7e34;
        animation: pulse-green 2s infinite;
      }
      .array-state-cell {
        transition: all 0.3s ease;
      }
      .array-state-cell:hover {
        filter: brightness(1.1);
      }
      .time-label {
        font-weight: 500;
      }
      .match-highlight {
        pointer-events: none;
      }
      .elements-group {
        display: inline-block;
        white-space: nowrap;
      }
    `;
    document.head.appendChild(styleElement);
  }
  
  // Initial scroll position to show the current position
  let scrollPositionX = labelWidth;
  for (let i = 0; i < Math.min(currentMeaningfulStep - 1, activeTimestamps.length - 1); i++) {
    scrollPositionX += columnWidths[activeTimestamps[i]];
  }
  
  const scrollPosition = Math.max(0, scrollPositionX - width / 3);
  scrollArea.scrollLeft = scrollPosition;
  
}, [arrayStates, currentStep, visualizationType]);

  

  // Function to manually refresh data
  const handleRefresh = () => {
    setLastUpdated(Date.now());
  };

  // Playback controls
  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };
  
  const handleStepForward = () => {
    if (currentStep < arrayStates.length - 1) {
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

  // Combined error and empty data handling for ArrayVisualizer
  if (error || !data || data.length === 0) {
    return (
      <div className="empty-visualization">
        <div className="friendly-message-container">
          <div className="empty-state-icon">
            <i className="bi bi-collection"></i>
          </div>
          <h3 className="empty-state-title">No Array Data Found</h3>
          
          {error ? (
            <p className="empty-state-message">
              We couldn't find any arrays in your code or encountered an error while analyzing it.
            </p>
          ) : (
            <p className="empty-state-message">
              Your code doesn't appear to contain any array operations we can visualize.
            </p>
          )}
          
          <div className="suggestion-box">
            <h4>Try adding array operations like:</h4>
            <pre className="example-code">
              my_array = [1, 2, 3, 4, 5]<br/>
              my_array.append(6)<br/>
              my_array[2] = 10
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
    if (arrayStates.length > 0 && currentStep >= arrayStates.length) {
      setCurrentStep(arrayStates.length - 1);
    }
    
    switch(visualizationType) {
      case "TIMELINE_ARRAY":
        return (
          <div className="visualization-container timeline-container" ref={timelineRef}>
            {/* D3 visualization will be rendered here */}
          </div>
        );
      case "ELEMENT_FOCUSED":
        return (
          <div className="visualization-container element-focused-container" ref={elementFocusedRef}>
            {/* D3 visualization will be rendered here */}
          </div>
        );
      case "ARRAY_COMPARISON":
        return (
          <div className="visualization-container comparison-container" ref={comparisonRef}>
            {/* D3 visualization will be rendered here */}
          </div>
        );
      default:
        // Default to Timeline if no visualization type is specified
        return (
          <div className="visualization-container timeline-container" ref={timelineRef}>
            {/* D3 visualization will be rendered here */}
          </div>
        );
    }
  };

  return (
    <div className="array-visualizer">
      <Card className="visualization-main-card">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <h4 className="mb-0">Array Visualization</h4>
            <Badge bg="primary" className="mt-2">
              {visualizationType || "TIMELINE_ARRAY"}
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
            <p>{visualizationRationale || "Showing array state changes over time."}</p>
          </div>
          
          {/* Visualization area */}
          {renderVisualization()}
          
          {/* Playback controls */}
          {arrayStates.length > 0 && (
            <div className="playback-controls mt-4">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="step-indicator">
                  Step {currentStep + 1} of {arrayStates.length}
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
                max={arrayStates.length - 1}
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
                  disabled={currentStep === arrayStates.length - 1}
                >
                  Next →
                </Button>
              </div>
            </div>
          )}
          
          {/* Code context */}
          {arrayStates.length > 0 && (
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
                // This is the operation that led to the current state
                <>
                  <div className="code-operation mb-2">
                    <strong>Operation:</strong> {arrayStates[currentStep-1].operation}
                  </div>
                  {arrayStates[currentStep-1].operation_details?.code && (
                    <div className="code-snippet mb-2">
                      <strong>Code:</strong>
                      <pre className="mb-0 mt-1">{arrayStates[currentStep-1].operation_details.code}</pre>
                    </div>
                  )}
                  <div className="code-location">
                    <strong>Location:</strong> {arrayStates[currentStep-1].location}
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

export default ArrayVisualizer;