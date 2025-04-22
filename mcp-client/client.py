import time
import traceback
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from typing import Optional, Dict, Any, List
import json
import re
import asyncio
from contextlib import AsyncExitStack
from dotenv import load_dotenv
import os
import sys
from mistralai.client import MistralClient
from mistralai.models.chat_completion import ChatMessage
import redis.asyncio as redis

load_dotenv()

class MCPClient:
    def __init__(self):
        self.session: Optional[ClientSession] = None
        self.exit_stack = AsyncExitStack()
        api_key = os.getenv("MISTRAL_API_KEY")
        if not api_key:
            print("ERROR: Mistral API key is missing! Make sure it's in your .env file.")
            exit(1)
        else:
            print(f"API Key Loaded: {api_key[:10]}... (hidden for security)")
        self.mistral = MistralClient(api_key=api_key)
        self.redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)
        self.connected = False

    def _parse_llm_json_response(self, raw_response):
        """
        Utility function to robustly parse JSON from LLM responses
        Handles common issues like escape sequences and extracts data even from malformed JSON
        """
        try:
            # First, try direct JSON parsing
            selection_data = json.loads(raw_response)
            return selection_data
        except json.JSONDecodeError:
            try:
                # Try to extract just the JSON part
                json_match = re.search(r'\{.*\}', raw_response, re.DOTALL)
                if not json_match:
                    raise ValueError("Could not find JSON in response")
                
                # Try to clean up the JSON string before parsing
                json_str = json_match.group(0)
                
                # Replace problematic escape sequences
                json_str = json_str.replace('\\_', '_')
                # Handle other common escape issues
                json_str = re.sub(r'\\([^"\\/bfnrtu])', r'\1', json_str)
                
                selection_data = json.loads(json_str)
                return selection_data
            except json.JSONDecodeError:
                try:
                    # Last resort: manual parsing with regex
                    selection_match = re.search(r'"selection":\s*["\']?(\d+)["\']?', raw_response)
                    viz_type_match = re.search(r'"visualization_type":\s*["]([A-Z_]+)["]', raw_response)
                    rationale_match = re.search(r'"rationale":\s*["\']([^"\']+)["\']', raw_response)
                    
                    if not (selection_match and viz_type_match):
                        raise ValueError("Could not extract required fields from response")
                    
                    rationale = "No rationale provided"
                    if rationale_match:
                        rationale = rationale_match.group(1)
                    
                    return {
                        "selection": selection_match.group(1),
                        "visualization_type": viz_type_match.group(1),
                        "rationale": rationale
                    }
                except Exception as e:
                    print(f"All JSON parsing attempts failed: {str(e)}")
                    raise
    
    def filter_data_structure_events(self, events, structure_type):
        """
        Filter data structure events to retain only meaningful visualization-ready data
        
        Args:
            events (list): List of data structure events from the MCP server
            structure_type (str): The type of data structure ('arrays', 'trees', or 'graphs')
            
        Returns:
            list: Filtered list of events suitable for visualization
        """
        if not events:
            return []
            
        # Track important variables (usually user-defined)
        important_variables = set()
        
        # First pass: identify important variables (user-defined structures)
        for event in events:
            # Focus on create, final_state, and user-specified operations
            name = event.get("name", "")
            operation = event.get("operation", "")
            
            # Variables to always keep
            if any([
                operation in ["create", "final_state"],  # Creation and final state events
                operation.startswith("add_"),  # Addition operations (add_child, add_edge, etc.)
                operation in ["append", "insert", "pop", "remove"],  # List modifications
                "serialized" not in name.lower() and  # Skip internal serialization variables
                not name.startswith("obj") and  # Skip internal object references
                not name.startswith("v") and  # Skip iteration variables
                name not in ["node", "result", "return_value", "event_data"],  # Skip processing variables
            ]):
                important_variables.add(name)
                
        # Add special cases for specific data structures
        if structure_type == "trees":
            important_variables.add("root")  # Root nodes are always important
        elif structure_type == "graphs":
            important_variables.add("graph")  # Graph variables are always important
            
        # Second pass: keep only events for important variables and meaningful operations
        filtered_events = []
        
        # Track previously seen tree structures for more accurate change detection
        previous_trees = {}
        
        for event in events:
            name = event.get("name", "")
            operation = event.get("operation", "")
            content = event.get("content")
            
            # Skip events for non-important variables
            if name not in important_variables:
                continue
                
            # Skip internal operations
            if operation in ["call", "exit"] and "operation_details" in event and event["operation_details"] and "code" in event["operation_details"] and "@staticmethod" in event["operation_details"]["code"]:
                continue
                
            # Special handling for tree structures to detect node additions and changes
            if structure_type == "trees" and content:
                # Check if this is a new or changed tree structure
                is_meaningful_change = True
                
                if name in previous_trees:
                    prev_tree = previous_trees[name]
                    
                    # For trees, compare the structure more thoroughly
                    if self._is_identical_tree_state(prev_tree, content):
                        # Skip if this is truly identical (but still keep final_state)
                        if operation not in ["create", "final_state"]:
                            is_meaningful_change = False
                
                # Store the current tree structure for future comparisons
                if is_meaningful_change:
                    previous_trees[name] = content
                    filtered_events.append(event)
                
            # Regular handling for non-tree structures
            else:
                # Generate a unique key for this state to detect duplicates
                if content:
                    try:
                        # Hash the full content for more accurate duplicate detection
                        state_key = f"{name}_{hash(json.dumps(content, sort_keys=True))}"
                        
                        # Check if we've seen this exact state before
                        if hasattr(self, '_seen_states') and state_key in self._seen_states and operation not in ["create", "final_state"]:
                            continue
                        
                        # Initialize _seen_states if it doesn't exist
                        if not hasattr(self, '_seen_states'):
                            self._seen_states = set()
                            
                        self._seen_states.add(state_key)
                        
                    except:
                        pass  # If we can't hash the content, just include the event
                
                # Remove internal details that aren't needed for visualization
                if "operation_details" in event and event["operation_details"] and "code" in event["operation_details"]:
                    # Keep only user code in operation_details
                    code = event["operation_details"]["code"]
                    if any([
                        "@staticmethod" in code,
                        "getattr" in code,
                        "hasattr" in code,
                        "operation_history" in code,
                        "state_key" in code,
                        "return result" in code
                    ]):
                        # Replace with generic description
                        event["operation_details"]["code"] = f"{operation} operation"
                
                # Add the filtered event
                filtered_events.append(event)
        
        # Sort events by timestamp to ensure proper animation sequence
        filtered_events.sort(key=lambda e: e.get("timestamp", 0))
        
        return filtered_events

    def _is_identical_tree_state(self, tree1, tree2):
        """
        Compare two tree structures to determine if they are functionally identical.
        This method performs a deep comparison of tree nodes.
        
        Args:
            tree1: First tree structure
            tree2: Second tree structure
            
        Returns:
            bool: True if trees are identical, False if they differ
        """
        # Handle None cases
        if tree1 is None and tree2 is None:
            return True
        if tree1 is None or tree2 is None:
            return False
        
        # Compare node values
        if "value" in tree1 and "value" in tree2:
            if tree1["value"] != tree2["value"]:
                return False
        elif "value" in tree1 or "value" in tree2:
            return False
        
        # Compare binary tree structure (left/right children)
        for child in ["left", "right"]:
            if child in tree1 or child in tree2:
                if child not in tree1 or child not in tree2:
                    return False
                if not self._is_identical_tree_state(tree1.get(child), tree2.get(child)):
                    return False
        
        # Compare non-binary tree structure (children array)
        if "children" in tree1 or "children" in tree2:
            # Check if one has children but not the other
            if "children" not in tree1 or "children" not in tree2:
                return False
            
            # Check if children counts differ
            if len(tree1["children"]) != len(tree2["children"]):
                return False
            
            # Compare each child recursively
            for i in range(len(tree1["children"])):
                if not self._is_identical_tree_state(tree1["children"][i], tree2["children"][i]):
                    return False
        
        # If we get here, the trees are identical
        return True
    async def connect_to_server(self, server_script_path: str):
        """Connect to the MCP server"""
        try:
            command = sys.executable
            server_params = StdioServerParameters(command=command, args=[server_script_path])
            stdio_transport = await self.exit_stack.enter_async_context(stdio_client(server_params))
            self.stdio, self.write = stdio_transport
            self.session = await self.exit_stack.enter_async_context(ClientSession(self.stdio, self.write))
            await self.session.initialize()
            response = await self.session.list_tools()
            tools = response.tools
            print("\nConnected to server with tools:", [tool.name for tool in tools])
            self.connected = True
            return True
        except Exception as e:
            print(f"Error connecting to server: {str(e)}")
            traceback.print_exc()
            self.connected = False
            return False

    async def send_code_snippet(self, code_snippet: str):
        """Send code snippet to server and process results"""
        if not self.connected or not self.session:
            print("ERROR: Not connected to server. Call connect_to_server first.")
            return None
        
        try:
            print("\nSending code snippet to server for analysis...")
            response = await self.session.call_tool("analyze_code", {"code_snippet": code_snippet})
            
            if not response or not response.content:
                print("\nERROR: No execution data received.")
                return None
            
            try:
                # Parse the response text as JSON
                response_text = response.content[0].text
                execution_data = json.loads(response_text)
            except json.JSONDecodeError:
                print("\nERROR: Failed to decode JSON response.")
                return None
            except Exception as e:
                print(f"\nERROR: Unexpected error parsing response: {str(e)}")
                return None

            # Clear all data structure stores at the beginning of each analysis
            # This ensures old data doesn't persist when a structure type isn't in the new code
            await self.redis_client.set("arrays", json.dumps([]))
            await self.redis_client.set("trees", json.dumps([]))
            await self.redis_client.set("graphs", json.dumps([]))
            
            # Clear visualization selections as well
            await self.redis_client.set("arrays_viz_selection", "")
            await self.redis_client.set("arrays_viz_type", "")
            await self.redis_client.set("arrays_viz_rationale", "")
            await self.redis_client.set("trees_viz_selection", "")
            await self.redis_client.set("trees_viz_type", "")
            await self.redis_client.set("trees_viz_rationale", "")
            await self.redis_client.set("graphs_viz_selection", "")
            await self.redis_client.set("graphs_viz_type", "")
            await self.redis_client.set("graphs_viz_rationale", "")

            # Store code information
            if "code" in execution_data:
                print("- Code: Source code information stored")
                await self.redis_client.set("code", json.dumps(execution_data["code"]))
            
            # Store each data structure type directly and select visualizations
            data_structures = execution_data.get("data_structures", {})
            
            # Process arrays
            array_events = data_structures.get("arrays", [])
            if array_events:
                # Filter array events before storing them
                filtered_array_events = self.filter_data_structure_events(array_events, "arrays")
                print(f"- Arrays: {len(array_events)} raw events filtered to {len(filtered_array_events)} meaningful events")
                
                if len(filtered_array_events) > 0:
                    await self.redis_client.set("arrays", json.dumps(filtered_array_events))
                    # Also store raw events for debugging if needed
                    await self.redis_client.set("arrays_raw", json.dumps(array_events))
                    
                    try:
                        await self.select_visualization_for_arrays(filtered_array_events)
                    except Exception as e:
                        print(f"Error selecting array visualization: {str(e)}")
                        traceback.print_exc()
                else:
                    print("- No meaningful array events detected")
            else:
                print("- No array events detected")
            
            # Process trees
            tree_events = data_structures.get("trees", [])
            if tree_events:
                # Filter tree events before storing them
                filtered_tree_events = self.filter_data_structure_events(tree_events, "trees")
                print(f"- Trees: {len(tree_events)} raw events filtered to {len(filtered_tree_events)} meaningful events")
                
                if len(filtered_tree_events) > 0:
                    await self.redis_client.set("trees", json.dumps(filtered_tree_events))
                    # Also store raw events for debugging if needed
                    await self.redis_client.set("trees_raw", json.dumps(tree_events))
                    
                    try:
                        await self.select_visualization_for_trees(filtered_tree_events)
                    except Exception as e:
                        print(f"Error selecting tree visualization: {str(e)}")
                        traceback.print_exc()
                else:
                    print("- No meaningful tree events detected")
            else:
                print("- No tree events detected")
            
            # Process graphs
            graph_events = data_structures.get("graphs", [])
            if graph_events:
                # Filter graph events before storing them
                filtered_graph_events = self.filter_data_structure_events(graph_events, "graphs")
                print(f"- Graphs: {len(graph_events)} raw events filtered to {len(filtered_graph_events)} meaningful events")
                
                if len(filtered_graph_events) > 0:
                    await self.redis_client.set("graphs", json.dumps(filtered_graph_events))
                    # Also store raw events for debugging if needed
                    await self.redis_client.set("graphs_raw", json.dumps(graph_events))
                    
                    try:
                        await self.select_visualization_for_graphs(filtered_graph_events)
                    except Exception as e:
                        print(f"Error selecting graph visualization: {str(e)}")
                        traceback.print_exc()
                else:
                    print("- No meaningful graph events detected")
            else:
                print("- No graph events detected")
            
            print("\nExecution data successfully filtered and stored in Redis.")
            return execution_data
            
        except Exception as e:
            print(f"\nError while sending code snippet: {str(e)}")
            traceback.print_exc()
            return None
        
    async def select_visualization_for_arrays(self, array_data):
        """Select the best visualization for array data"""
        try:
            # Create a prompt directly without using LangChain's PromptTemplate
            prompt = (
                "You are an expert in data structure visualization. Your task is to select the most appropriate "
                "visualization technique for the given array operations data.\n\n"
                f"Array Data:\n{json.dumps(array_data, indent=2)}\n\n"
                "Please examine this data carefully to determine:\n"
                "1. How many unique array variables are present\n"
                "2. What types of operations are performed (append, insert, indexed_assignment, etc.)\n"
                "3. Whether the operations focus on specific positions or affect the whole array\n\n"
                "Then select one of the following visualization options:\n\n"
                "1. TIMELINE_ARRAY: Shows array state changes over time with side-by-side comparisons.\n"
                "   Choose this when:\n"
                "   - Operations affect the whole array (sort, reverse, etc.)\n"
                "   - There's only one array being modified over time\n"
                "   - The user wants to see the progressive evolution of an array\n"
                "   - There are more than 3 operations on the same array\n\n"
                "2. ELEMENT_FOCUSED: Emphasizes individual element changes with animations and highlights.\n"
                "   Choose this when:\n"
                "   - Operations target specific indices (indexed_assignment)\n"
                "   - There are insert or delete operations at specific positions\n"
                "   - The pattern of accesses or changes is important to visualize\n"
                "   - Most changes affect only a few elements at a time\n\n"
                "3. ARRAY_COMPARISON: Side-by-side view of multiple arrays with relationship indicators.\n"
                "   Choose this when:\n"
                "   - Multiple different arrays appear in the data (not just different states of the same array)\n"
                "   - There are derived arrays (like one array created from another)\n"
                "   - Operations involve relationship between arrays (copying, transforming)\n"
                "   - You can see array names like 'original' and 'squared' or similar patterns\n\n"
                "Respond with a JSON object in this exact format - make sure to use double quotes and avoid escape sequences:\n"
                "{\n"
                "  \"selection\": \"1\",  // Just the number (1, 2, or 3) as a string\n"
                "  \"visualization_type\": \"TIMELINE_ARRAY\",  // The name in CAPS as shown above\n"
                "  \"rationale\": \"Brief explanation for why this visualization is best\"\n"
                "}\n"
            )
            
            # Send to Mistral AI
            response = self.mistral.chat(
                model="mistral-small",
                messages=[
                    ChatMessage(role="system", content="You are an expert in data structure visualization. Return only valid JSON with no escape sequences."),
                    ChatMessage(role="user", content=prompt)
                ]
            )
            
            # Extract response
            raw_response = response.choices[0].message.content.strip()
            print(f"\n🔍 Raw Mistral AI Response for Array Visualization:\n{raw_response}")
            
            # Parse the response using the helper method
            try:
                selection_data = self._parse_llm_json_response(raw_response)
                
                # Store in Redis
                await self.redis_client.set("arrays_viz_selection", str(selection_data["selection"]))
                await self.redis_client.set("arrays_viz_type", selection_data["visualization_type"])
                await self.redis_client.set("arrays_viz_rationale", selection_data["rationale"])
                
                print(f"\n✅ Selected visualization for arrays: {selection_data['visualization_type']}")
                return selection_data
            except Exception as e:
                print(f"\n❌ ERROR: Failed to parse array visualization selection: {str(e)}")
                default_selection = {
                    "selection": "1",
                    "visualization_type": "TIMELINE_ARRAY",
                    "rationale": "Default selection due to parsing error."
                }
                await self.redis_client.set("arrays_viz_selection", "1")
                await self.redis_client.set("arrays_viz_type", "TIMELINE_ARRAY")
                await self.redis_client.set("arrays_viz_rationale", default_selection["rationale"])
                return default_selection
        except Exception as e:
            print(f"Error in select_visualization_for_arrays: {str(e)}")
            traceback.print_exc()
            default_selection = {
                "selection": "1",
                "visualization_type": "TIMELINE_ARRAY",
                "rationale": "Default selection due to error."
            }
            await self.redis_client.set("arrays_viz_selection", "1")
            await self.redis_client.set("arrays_viz_type", "TIMELINE_ARRAY")
            await self.redis_client.set("arrays_viz_rationale", default_selection["rationale"])
            return default_selection

    async def select_visualization_for_trees(self, tree_data):
        """Select the best visualization for tree data"""
        try:
            # Create a prompt directly without using LangChain's PromptTemplate
            prompt = (
            "You are an expert in data structure visualization. Your task is to select the most appropriate "
            "visualization technique for the given tree operations data.\n\n"
            f"Tree Data:\n{json.dumps(tree_data, indent=2)}\n\n"
            "MANDATORY SELECTION RULES - YOU MUST FOLLOW THESE EXACTLY:\n"
            "1. EXAMINE THE STRUCTURE FIELDS IN THE JSON - Look at how children are represented\n"
            "2. IF ANY node has 'left' or 'right' properties → HIERARCHICAL_TREE (selection \"1\")\n"
            "3. IF ANY node has a 'children' array → RADIAL_TREE (selection \"2\")\n"
            "4. In case of conflict (some nodes have left/right, others have children), prioritize the ROOT node's structure\n\n"
            "STRICT DETECTION INSTRUCTIONS:\n"
            "- Look for the pattern {\"value\": X, \"left\": {...}, \"right\": {...}} → HIERARCHICAL_TREE\n"
            "- Look for the pattern {\"value\": X, \"children\": [...]} → RADIAL_TREE\n"
            "- DO NOT consider the number of nodes, tree depth, or node values in your decision\n"
            "- DO NOT use any other criteria to make your selection\n\n"
            "CORRECT VISUALIZATION CHOICES:\n"
            "1. HIERARCHICAL_TREE: Use for ALL trees with 'left' and 'right' properties.\n"
            "   - Example: {\"value\": 10, \"left\": {\"value\": 5}, \"right\": {\"value\": 15}}\n"
            "   - Binary trees MUST use hierarchical visualization\n\n"
            "2. RADIAL_TREE: Use for ALL trees with 'children' arrays.\n"
            "   - Example: {\"value\": 1, \"children\": [{\"value\": 2}, {\"value\": 3}]}\n"
            "   - Non-binary trees with children arrays MUST use radial visualization\n\n"
            "3. TREEMAP: Not applicable for this exercise\n\n"
            "VERIFICATION PROCESS:\n"
            "1. Search the entire JSON structure for \"left\" and \"right\" properties\n"
            "2. Search the entire JSON structure for \"children\" arrays\n"
            "3. Make selection based SOLELY on the structural pattern found\n\n"
            "Respond with a JSON object in this exact format:\n"
            "{\n"
            "  \"selection\": \"1\",  // Use \"1\" for HIERARCHICAL_TREE, \"2\" for RADIAL_TREE, \"3\" for TREEMAP\n"
            "  \"visualization_type\": \"HIERARCHICAL_TREE\",  // The name in CAPS matching your selection\n"
            "  \"rationale\": \"Brief explanation for why this visualization is best\"\n"
            "}\n"
        )
            
            # Send to Mistral AI
            response = self.mistral.chat(
                model="mistral-small",
                messages=[
                    ChatMessage(role="system", content="You are an expert in data structure visualization. Return only valid JSON with no escape sequences."),
                    ChatMessage(role="user", content=prompt)
                ]
            )
            
            # Extract response
            raw_response = response.choices[0].message.content.strip()
            print(f"\n🔍 Raw Mistral AI Response for Tree Visualization:\n{raw_response}")
            
            # Parse the response using the helper method
            try:
                selection_data = self._parse_llm_json_response(raw_response)
                
                # Store in Redis
                await self.redis_client.set("trees_viz_selection", str(selection_data["selection"]))
                await self.redis_client.set("trees_viz_type", selection_data["visualization_type"])
                await self.redis_client.set("trees_viz_rationale", selection_data["rationale"])
                
                print(f"\n✅ Selected visualization for trees: {selection_data['visualization_type']}")
                return selection_data
            except Exception as e:
                print(f"\n❌ ERROR: Failed to parse tree visualization selection: {str(e)}")
                default_selection = {
                    "selection": "1",
                    "visualization_type": "HIERARCHICAL_TREE",
                    "rationale": "Default selection due to parsing error."
                }
                await self.redis_client.set("trees_viz_selection", "1")
                await self.redis_client.set("trees_viz_type", "HIERARCHICAL_TREE")
                await self.redis_client.set("trees_viz_rationale", default_selection["rationale"])
                return default_selection
        except Exception as e:
            print(f"Error in select_visualization_for_trees: {str(e)}")
            traceback.print_exc()
            default_selection = {
                "selection": "1",
                "visualization_type": "HIERARCHICAL_TREE",
                "rationale": "Default selection due to error."
            }
            await self.redis_client.set("trees_viz_selection", "1")
            await self.redis_client.set("trees_viz_type", "HIERARCHICAL_TREE")
            await self.redis_client.set("trees_viz_rationale", default_selection["rationale"])
            return default_selection

    async def select_visualization_for_graphs(self, graph_data):
        """Select the best visualization for graph data"""
        try:
            # Create a prompt directly without using LangChain's PromptTemplate
            prompt = (
               "You are an expert in data structure visualization. Your task is to select the most appropriate visualization technique for the given graph operations data.\n\n"
                f"Graph Data:\n{json.dumps(graph_data, indent=2)}\n\n"
                "MANDATORY SELECTION RULES - YOU MUST FOLLOW THESE EXACTLY:\n"
                "1. COUNT THE TOTAL NUMBER OF DIRECTED CONNECTIONS in the graph - each item in any array counts as ONE directed connection\n"
                "2. COUNT THE TOTAL NUMBER OF NODES in the graph\n"
                "3. CALCULATE CONNECTION DENSITY using this formula: (Total DIRECTED Connections) / (Nodes × (Nodes-1))\n"
                "4. IF CONNECTION DENSITY > 0.25 → ADJACENCY_MATRIX (selection \"2\")\n"
                "5. IF ANY NODE HAS MORE THAN 3 OUTGOING CONNECTIONS → ADJACENCY_MATRIX (selection \"2\")\n"
                "6. OTHERWISE → FORCE_DIRECTED (selection \"1\")\n\n"
                "STRICT DETECTION INSTRUCTIONS:\n"
                "- For each node, count ONLY the outgoing connections (the length of its array)\n"
                "- Do NOT count incoming connections when applying rule #5\n"
                "- Sum the lengths of all arrays to get total directed connections\n"
                "- The connection density should be calculated using only the formula above\n\n"
                "CORRECT VISUALIZATION CHOICES:\n"
                "1. FORCE_DIRECTED: Use for graphs with lower connection density.\n"
                "   - Suitable for visualizing relationships with clear structure\n"
                "   - Better for graphs where nodes have 3 or fewer OUTGOING connections\n\n"
                "2. ADJACENCY_MATRIX: Use for graphs with higher connection density.\n"
                "   - Better for graphs where nodes have many outgoing connections\n"
                "   - Essential when the overall graph is densely connected (density > 0.25)\n\n"
                "VERIFICATION PROCESS:\n"
                "1. Explicitly count all nodes in the graph\n"
                "2. Sum the lengths of all adjacency lists to get total DIRECTED connections\n"
                "3. Calculate the density ratio using the formula above\n"
                "4. For each node, count ONLY its outgoing connections (array length)\n"
                "5. Apply the rules above with NO EXCEPTIONS\n\n"
                "Respond with a JSON object in this exact format - use double quotes and avoid escape sequences:\n"
                "{\n"
                "  \"selection\": \"1\",  // Use \"1\" for FORCE_DIRECTED, \"2\" for ADJACENCY_MATRIX\n"
                "  \"visualization_type\": \"FORCE_DIRECTED\",  // The name in CAPS matching your selection\n"
                "  \"rationale\": \"Brief explanation including the calculated density metric and maximum outgoing connections per node\"\n"
                "}\n"
                            )
            
            # Send to Mistral AI
            response = self.mistral.chat(
                model="mistral-small",
                messages=[
                    ChatMessage(role="system", content="You are an expert in data structure visualization. Return only valid JSON with no escape sequences."),
                    ChatMessage(role="user", content=prompt)
                ]
            )
            
            # Extract response
            raw_response = response.choices[0].message.content.strip()
            print(f"\n🔍 Raw Mistral AI Response for Graph Visualization:\n{raw_response}")
            
            # Parse the response using the helper method
            try:
                selection_data = self._parse_llm_json_response(raw_response)
                
                # Store in Redis
                await self.redis_client.set("graphs_viz_selection", str(selection_data["selection"]))
                await self.redis_client.set("graphs_viz_type", selection_data["visualization_type"])
                await self.redis_client.set("graphs_viz_rationale", selection_data["rationale"])
                
                print(f"\n✅ Selected visualization for graphs: {selection_data['visualization_type']}")
                return selection_data
            except Exception as e:
                print(f"\n❌ ERROR: Failed to parse graph visualization selection: {str(e)}")
                default_selection = {
                    "selection": "1",
                    "visualization_type": "FORCE_DIRECTED",
                    "rationale": "Default selection due to parsing error."
                }
                await self.redis_client.set("graphs_viz_selection", "1")
                await self.redis_client.set("graphs_viz_type", "FORCE_DIRECTED")
                await self.redis_client.set("graphs_viz_rationale", default_selection["rationale"])
                return default_selection
        except Exception as e:
            print(f"Error in select_visualization_for_graphs: {str(e)}")
            traceback.print_exc()
            default_selection = {
                "selection": "1",
                "visualization_type": "FORCE_DIRECTED",
                "rationale": "Default selection due to error."
            }
            await self.redis_client.set("graphs_viz_selection", "1")
            await self.redis_client.set("graphs_viz_type", "FORCE_DIRECTED")
            await self.redis_client.set("graphs_viz_rationale", default_selection["rationale"])
            return default_selection

    async def close(self):
        """Close the connection to the server"""
        try:
            await self.exit_stack.aclose()
            self.connected = False
            print("Connection to server closed.")
        except Exception as e:
            print(f"Error closing connection: {str(e)}")
            traceback.print_exc()

# Testing code - keep this for debugging but in production it would be
# replaced by Flask API calls
async def main():
    client = MCPClient()
    server_script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'mcp-server', 'server.py'))
    if await client.connect_to_server(server_script_path):
        code_snippet = """
# Array operations
elements = [5, 10, 15, 20, 25]
elements[2] = 99  # Update middle element
elements.append(30)  # Add to end
elements.insert(0, 1)  # Insert at beginning
elements.pop(3)  # Remove an element
elements[1] = elements[1] + elements[2]  # Combined operation

# Tree creation and operations
class TreeNode:
    def __init__(self, value):
        self.value = value
        self.left = None
        self.right = None

root = TreeNode(10)
root.left = TreeNode(5)
root.right = TreeNode(15)
root.left.left = TreeNode(3)
root.left.right = TreeNode(7)
root.right.left = TreeNode(12)

# Graph operations
graph = {
    'A': ['B', 'C'],
    'B': ['D'],
    'C': ['D', 'E'],
    'D': [],
    'E': ['A']
}

# Add a new edge
graph['D'].append('E')



"""
        await client.send_code_snippet(code_snippet)
        await client.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())  
    except RuntimeError as e:
        print(f"\n❌ Async RuntimeError: {e}. Retrying with a new event loop...")
        new_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(new_loop)
        new_loop.run_until_complete(main())