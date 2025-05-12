import os
import json
import re
import traceback
from mistralai.client import MistralClient
from mistralai.models.chat_completion import ChatMessage

# Initialize the Mistral Client
# The API key is loaded from .env by the app factory in __init__.py
# We can access it here via os.getenv
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")
if not MISTRAL_API_KEY:
    print("CRITICAL ERROR: Mistral API key is not set in environment for llm_handler.py. Ensure .env is loaded.")
    mistral_client = None
else:
    try:
        mistral_client = MistralClient(api_key=MISTRAL_API_KEY)
        print(f"LLM Handler: MistralClient initialized successfully. Key: {MISTRAL_API_KEY[:5]}...")
    except Exception as e:
        print(f"LLM Handler: Error initializing MistralClient: {e}")
        mistral_client = None


def _parse_llm_json_response(raw_response: str) -> dict:
    """
    Utility function to robustly parse JSON from LLM responses.
    Handles common issues like escape sequences and extracts data even from malformed JSON.
    This is a direct adaptation of the method from the original client.py.
    """
    try:
        # First, try direct JSON parsing
        selection_data = json.loads(raw_response)
        return selection_data
    except json.JSONDecodeError:
        try:
            # Try to extract just the JSON part if it's embedded
            json_match = re.search(r'\{.*\}', raw_response, re.DOTALL)
            if not json_match:
                # Sometimes the LLM might return JSON without ```json ... ```
                # If it's a simple case, this might still work if the raw_response is almost JSON
                pass # Fall through to next attempt
            else:
                raw_response = json_match.group(0) # Use the extracted part

            # Try to clean up the JSON string before parsing
            # Replace problematic escape sequences like \_ if they are not valid JSON escapes
            cleaned_response = raw_response.replace('\\_', '_')
            # Handle other common non-standard escapes if necessary, be cautious not to break valid ones
            # Example: re.sub(r'\\([^"\\/bfnrtu])', r'\1', cleaned_response)
            
            selection_data = json.loads(cleaned_response)
            return selection_data
        except json.JSONDecodeError:
            # Last resort: manual parsing with regex if structured but malformed
            # This part from original client.py is highly specific and might be brittle.
            # It's kept for fidelity but robust JSON from LLM is preferred.
            try:
                selection_match = re.search(r'"selection":\s*["\']?(\d+)["\']?', raw_response)
                viz_type_match = re.search(r'"visualization_type":\s*["\']([A-Z_]+)["\']', raw_response)
                rationale_match = re.search(r'"rationale":\s*["\']([^"\']+)["\']', raw_response) # Simpler rationale regex

                if not (selection_match and viz_type_match):
                    # If essential parts are missing, this fallback won't work
                    raise ValueError("Could not extract required fields (selection, visualization_type) using regex.")

                rationale = "No rationale provided by LLM or regex failed to capture it."
                if rationale_match:
                    rationale = rationale_match.group(1).strip()
                
                return {
                    "selection": selection_match.group(1),
                    "visualization_type": viz_type_match.group(1),
                    "rationale": rationale
                }
            except Exception as e_regex:
                print(f"LLM Handler: All JSON parsing attempts failed. Regex fallback also failed: {e_regex}")
                print(f"LLM Handler: Failing raw response was: {raw_response}")
                raise ValueError(f"Failed to parse LLM JSON response after multiple attempts: {raw_response}") from e_regex


def get_visualization_for_arrays(array_data: list) -> dict:
    """
    Selects the best visualization for array data using Mistral AI.
    Uses the exact prompt and logic from the original client.py.
    """
    if not mistral_client:
        print("LLM Handler: Mistral client not initialized. Returning default array visualization.")
        return {
            "selection": "1", "visualization_type": "TIMELINE_ARRAY",
            "rationale": "Default: Mistral client not available."
        }

    try:
        # --- Prompt logic from original client.py ---
        unique_array_names = set()
        for event in array_data:
            name = event.get("name", "")
            content = event.get("content")
            if (isinstance(content, list) and
                "serialized" not in name.lower() and
                not name.startswith("obj") and
                name not in ["node", "result", "return_value", "event_data"]): # Filter from original
                unique_array_names.add(name)

        unique_name_count = len(unique_array_names)
        array_lengths = []
        if unique_name_count == 1:
            array_name = list(unique_array_names)[0]
            for event in array_data:
                if event.get("name") == array_name and isinstance(event.get("content"), list):
                    array_lengths.append(len(event.get("content", [])))
        length_changes = len(set(array_lengths)) > 1 if array_lengths else False

        
        prompt = (
            f"EXACT NUMBER OF ARRAYS: {unique_name_count}\n"
            f"LENGTHS CHANGE: {'Yes' if length_changes else 'No'}\n\n"
            "MANDATORY DECISION LOGIC:\n\n"
            f"IF NUMBER OF ARRAYS = {unique_name_count} > 1:\n"
            "  RETURN: ARRAY_COMPARISON (selection \"3\")\n\n"
            f"IF NUMBER OF ARRAYS = {unique_name_count} = 1 AND LENGTHS CHANGE = {'Yes' if length_changes else 'No'} = Yes:\n"
            "  RETURN: TIMELINE_ARRAY (selection \"1\")\n\n"
            f"IF NUMBER OF ARRAYS = {unique_name_count} = 1 AND LENGTHS CHANGE = {'Yes' if length_changes else 'No'} = No:\n"
            "  RETURN: ELEMENT_FOCUSED (selection \"2\")\n\n"
            f"FOR THIS DATA WITH {unique_name_count} ARRAY(S), YOU MUST RETURN:\n"
            f"{{\n"
            f"  \"selection\": \"{3 if unique_name_count > 1 else 1 if length_changes else 2}\",\n"
            f"  \"visualization_type\": \"{('ARRAY_COMPARISON' if unique_name_count > 1 else 'TIMELINE_ARRAY' if length_changes else 'ELEMENT_FOCUSED')}\",\n"
            f"  \"rationale\": \"{'Multiple arrays detected - using array comparison' if unique_name_count > 1 else 'Single array with changing length - using timeline view' if length_changes else 'Single array with constant length - using element focused view'}\"\n"
            f"}}\n"
        )
        # --- End of prompt logic ---

        print(f"LLM Handler (Arrays): Sending prompt to Mistral:\n{prompt[:500]}...") # Log snippet
        
        response = mistral_client.chat(
            model="mistral-small", # Or your preferred model
            messages=[
                ChatMessage(role="system", content="You are an expert in data structure visualization. Return only valid JSON with no escape sequences."),
                ChatMessage(role="user", content=prompt)
            ]
        )
        
        raw_response_content = response.choices[0].message.content.strip()
        print(f"LLM Handler (Arrays): Raw Mistral AI Response:\n{raw_response_content}")
        
        selection_data = _parse_llm_json_response(raw_response_content)
        print(f"LLM Handler (Arrays): Parsed selection: {selection_data}")
        return selection_data

    except Exception as e:
        print(f"LLM Handler (Arrays): Error selecting visualization: {e}")
        traceback.print_exc()
        return {
            "selection": "1", "visualization_type": "TIMELINE_ARRAY",
            "rationale": f"Default selection due to error: {str(e)}"
        }


def get_visualization_for_trees(tree_data: list) -> dict:
    """
    Selects the best visualization for tree data using Mistral AI.
    Uses the exact prompt and logic from the original client.py.
    """
    if not mistral_client:
        print("LLM Handler: Mistral client not initialized. Returning default tree visualization.")
        return {
            "selection": "1", "visualization_type": "HIERARCHICAL_TREE",
            "rationale": "Default: Mistral client not available."
        }

    try:

        prompt = (
            "You are an expert in data structure visualization. Your task is to select the most appropriate "
            "visualization technique for the given tree operations data.\n\n"
            f"Tree Data:\n{json.dumps(tree_data, indent=2)}\n\n" # Ensure tree_data is serializable
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
        # --- End of prompt ---
        
        print(f"LLM Handler (Trees): Sending prompt to Mistral:\n{prompt[:500]}...") # Log snippet

        response = mistral_client.chat(
            model="mistral-small", # Or your preferred model
            messages=[
                ChatMessage(role="system", content="You are an expert in data structure visualization. Return only valid JSON with no escape sequences."),
                ChatMessage(role="user", content=prompt)
            ]
        )
        
        raw_response_content = response.choices[0].message.content.strip()
        print(f"LLM Handler (Trees): Raw Mistral AI Response:\n{raw_response_content}")
        
        selection_data = _parse_llm_json_response(raw_response_content)
        print(f"LLM Handler (Trees): Parsed selection: {selection_data}")
        return selection_data

    except Exception as e:
        print(f"LLM Handler (Trees): Error selecting visualization: {e}")
        traceback.print_exc()
        return {
            "selection": "1", "visualization_type": "HIERARCHICAL_TREE",
            "rationale": f"Default selection due to error: {str(e)}"
        }


def get_visualization_for_graphs(graph_data: list) -> dict:
    """
    Selects the best visualization for graph data.
    Calculates metrics in Python and provides them to Mistral AI for a deterministic decision.
    """
    if not mistral_client:
        print("LLM Handler: Mistral client not initialized. Returning default graph visualization.")
        return {
            "selection": "1", "visualization_type": "FORCE_DIRECTED",
            "rationale": "Default: Mistral client not available."
        }

    try:
        # --- Calculate graph metrics from the LATEST graph state ---
        num_nodes = 0
        total_directed_connections = 0
        max_outgoing_connections = 0
        connection_density = 0.0

        # Use the content of the last event in graph_data, assuming it's the most complete/recent state
        # If graph_data is empty, or last event has no content, metrics will remain 0.
        latest_graph_content = None
        if graph_data and len(graph_data) > 0:
            # Iterate backwards to find the last event with graph content
            for event in reversed(graph_data):
                if event.get("content") and isinstance(event.get("content"), dict):
                    latest_graph_content = event.get("content")
                    break
        
        if latest_graph_content:
            # 1. Count nodes
            # A node exists if it's a key or if it appears in any adjacency list.
            nodes_set = set(latest_graph_content.keys())
            for adj_list in latest_graph_content.values():
                if isinstance(adj_list, list):
                    for target_node in adj_list:
                        nodes_set.add(str(target_node)) # Ensure nodes are strings for consistency
            num_nodes = len(nodes_set)

            # 2. Count total directed connections & max outgoing connections
            current_max_outgoing = 0
            for source_node, adj_list in latest_graph_content.items():
                if isinstance(adj_list, list):
                    num_outgoing = len(adj_list)
                    total_directed_connections += num_outgoing
                    if num_outgoing > current_max_outgoing:
                        current_max_outgoing = num_outgoing
            max_outgoing_connections = current_max_outgoing
            
            # 3. Calculate connection density
            if num_nodes > 1: # Density is undefined for 0 or 1 node.
                # For directed graph, max possible edges = N * (N-1)
                max_possible_connections = num_nodes * (num_nodes - 1)
                if max_possible_connections > 0:
                    connection_density = total_directed_connections / max_possible_connections
                else: # Handles num_nodes = 1 case specifically where denominator is 0
                    connection_density = 0.0 # Or 1.0 if self-loops considered and present
            elif num_nodes == 1 and total_directed_connections > 0 : # Single node with self-loop
                connection_density = 1.0 
            else: # 0 nodes, or 1 node with no self-loop
                connection_density = 0.0

        # --- Determine visualization type and rationale based on calculated metrics ---
        viz_type = "FORCE_DIRECTED"
        selection = "1"
        
        # Rule 4: IF CONNECTION DENSITY > 0.25 → ADJACENCY_MATRIX
        if connection_density > 0.25:
            viz_type = "ADJACENCY_MATRIX"
            selection = "2"
        # Rule 5: IF ANY NODE HAS MORE THAN 3 OUTGOING CONNECTIONS → ADJACENCY_MATRIX
        # This rule overrides the previous one if it leads to Adjacency Matrix
        if max_outgoing_connections > 3:
            viz_type = "ADJACENCY_MATRIX"
            selection = "2"
            
        rationale = (
            f"Calculated metrics: Nodes: {num_nodes}, Total Directed Connections: {total_directed_connections}, "
            f"Connection Density: {connection_density:.3f}, Max Outgoing Connections: {max_outgoing_connections}. "
            f"Based on these metrics, {viz_type} was selected."
        )
        if viz_type == "ADJACENCY_MATRIX":
            if connection_density > 0.25 and max_outgoing_connections > 3:
                 rationale = (f"Connection density ({connection_density:.3f}) is > 0.25 AND "
                              f"max outgoing connections ({max_outgoing_connections}) is > 3. ADJACENCY_MATRIX selected.")
            elif connection_density > 0.25:
                rationale = f"Connection density ({connection_density:.3f}) is > 0.25. ADJACENCY_MATRIX selected."
            elif max_outgoing_connections > 3:
                 rationale = f"Max outgoing connections ({max_outgoing_connections}) is > 3. ADJACENCY_MATRIX selected."
        else: # FORCE_DIRECTED
            rationale = (f"Connection density ({connection_density:.3f}) is not > 0.25 AND "
                         f"max outgoing connections ({max_outgoing_connections}) is not > 3. FORCE_DIRECTED selected.")


        # --- Construct the prompt for LLM, providing calculated values ---
        # The LLM is now just confirming the decision based on given numbers and outputting the JSON.
        # We also tell the LLM the decision we made in Python code.
        prompt = (
            f"CALCULATED NUMBER OF NODES: {num_nodes}\n"
            f"CALCULATED TOTAL DIRECTED CONNECTIONS: {total_directed_connections}\n"
            f"CALCULATED CONNECTION DENSITY: {connection_density:.3f}\n" # Use a reasonable precision
            f"CALCULATED MAXIMUM OUTGOING CONNECTIONS FOR ANY NODE: {max_outgoing_connections}\n\n"
            "MANDATORY SELECTION RULES - YOU MUST FOLLOW THESE EXACTLY:\n"
            "1. IF CALCULATED CONNECTION DENSITY > 0.25 → ADJACENCY_MATRIX (selection \"2\")\n"
            "2. IF CALCULATED MAXIMUM OUTGOING CONNECTIONS FOR ANY NODE > 3 → ADJACENCY_MATRIX (selection \"2\")\n"
            "3. OTHERWISE → FORCE_DIRECTED (selection \"1\")\n\n"
            "Based on the above CALCULATED values and the MANDATORY SELECTION RULES, the chosen visualization is "
            f"{viz_type} (selection \"{selection}\").\n\n"
            "YOU MUST RETURN THE FOLLOWING JSON OBJECT EXACTLY AS SPECIFIED, REFLECTING THIS DECISION:\n"
            "{\n"
            f"  \"selection\": \"{selection}\",\n"
            f"  \"visualization_type\": \"{viz_type}\",\n"
            f"  \"rationale\": \"{rationale}\"\n"
            "}\n"
        )

        print(f"LLM Handler (Graphs): Sending prompt to Mistral:\n{prompt[:600]}...")

        response = mistral_client.chat(
            model="mistral-small", 
            messages=[
                ChatMessage(role="system", content="You are an expert in data structure visualization. Return only valid JSON with no escape sequences, exactly as instructed."),
                ChatMessage(role="user", content=prompt)
            ]
        )
        
        raw_response_content = response.choices[0].message.content.strip()
        print(f"LLM Handler (Graphs): Raw Mistral AI Response:\n{raw_response_content}")
        
        # Attempt to parse the response. If it's malformed but the Python logic is sound,
        # we can potentially fall back to the Python-determined values.
        try:
            selection_data = _parse_llm_json_response(raw_response_content)
            # Verify LLM output against Python calculation for safety, though it should match.
            if selection_data.get("visualization_type") != viz_type or \
               selection_data.get("selection") != selection:
                print(f"LLM Handler (Graphs): Warning - LLM output differs from Python pre-calculation. LLM: {selection_data}, Python: {{'selection': '{selection}', 'visualization_type': '{viz_type}'}}. Using Python's determination.")
                selection_data = {
                    "selection": selection,
                    "visualization_type": viz_type,
                    "rationale": rationale + " (Decision confirmed by Python pre-calculation due to LLM output discrepancy)."
                }
        except ValueError:
             print(f"LLM Handler (Graphs): LLM response parsing failed. Falling back to Python pre-calculated decision.")
             selection_data = {
                "selection": selection,
                "visualization_type": viz_type,
                "rationale": rationale + " (Decision made by Python pre-calculation due to LLM response parsing failure)."
            }

        print(f"LLM Handler (Graphs): Final selection: {selection_data}")
        return selection_data

    except Exception as e:
        print(f"LLM Handler (Graphs): Error selecting visualization: {e}")
        traceback.print_exc()
        return {
            "selection": "1", "visualization_type": "FORCE_DIRECTED", # Fallback default
            "rationale": f"Default selection due to error: {str(e)}"
        }



