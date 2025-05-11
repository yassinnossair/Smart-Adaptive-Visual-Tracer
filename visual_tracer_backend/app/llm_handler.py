# visual_tracer_backend/app/llm_handler.py

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
    # In a real app, you might raise an exception or have a fallback.
    # For now, this print statement will indicate a setup issue.
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

        # This prompt is an exact copy from client.py's select_visualization_for_arrays
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
        # --- Prompt from original client.py ---
        # This prompt is an exact copy from client.py's select_visualization_for_trees
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
    Selects the best visualization for graph data using Mistral AI.
    Uses the exact prompt and logic from the original client.py.
    """
    if not mistral_client:
        print("LLM Handler: Mistral client not initialized. Returning default graph visualization.")
        return {
            "selection": "1", "visualization_type": "FORCE_DIRECTED",
            "rationale": "Default: Mistral client not available."
        }

    try:
        # --- Prompt from original client.py ---
        # This prompt is an exact copy from client.py's select_visualization_for_graphs
        prompt = (
            "You are an expert in data structure visualization. Your task is to select the most appropriate visualization technique for the given graph operations data.\n\n"
            f"Graph Data:\n{json.dumps(graph_data, indent=2)}\n\n" # Ensure graph_data is serializable
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
        # --- End of prompt ---

        print(f"LLM Handler (Graphs): Sending prompt to Mistral:\n{prompt[:500]}...") # Log snippet

        response = mistral_client.chat(
            model="mistral-small", # Or your preferred model
            messages=[
                ChatMessage(role="system", content="You are an expert in data structure visualization. Return only valid JSON with no escape sequences."),
                ChatMessage(role="user", content=prompt)
            ]
        )
        
        raw_response_content = response.choices[0].message.content.strip()
        print(f"LLM Handler (Graphs): Raw Mistral AI Response:\n{raw_response_content}")
        
        selection_data = _parse_llm_json_response(raw_response_content)
        print(f"LLM Handler (Graphs): Parsed selection: {selection_data}")
        return selection_data

    except Exception as e:
        print(f"LLM Handler (Graphs): Error selecting visualization: {e}")
        traceback.print_exc()
        return {
            "selection": "1", "visualization_type": "FORCE_DIRECTED",
            "rationale": f"Default selection due to error: {str(e)}"
        }

if __name__ == '__main__':
    # This block is for testing the llm_handler.py module directly.
    # You'll need to have your MISTRAL_API_KEY in the .env file in the
    # visual_tracer_backend directory for this to work.

    print("Testing LLM Handler directly...")

    # Sample filtered data (replace with actual filtered data for more realistic tests)
    sample_array_data_single_no_change = [
        {"name": "arr1", "content": [1, 2, 3], "operation": "create_array"},
        {"name": "arr1", "content": [1, 2, 3], "operation": "update"}
    ]
    sample_array_data_single_change = [
        {"name": "arr1", "content": [1, 2], "operation": "create_array"},
        {"name": "arr1", "content": [1, 2, 3, 4], "operation": "append"}
    ]
    sample_array_data_multiple = [
        {"name": "arr1", "content": [1, 2], "operation": "create_array"},
        {"name": "arr2", "content": [10, 20], "operation": "create_array"}
    ]

    sample_tree_data_binary = [
        {"name": "root", "content": {"value": "A", "left": {"value": "B"}, "right": {"value": "C"}}}
    ]
    sample_tree_data_nary = [
        {"name": "root", "content": {"value": "X", "children": [{"value": "Y"}, {"value": "Z"}]}}
    ]

    sample_graph_data_sparse = [ # Density = 2 / (3*2) = 0.33 -> Should be ADJACENCY by density
                                  # Max outgoing = 1 -> Not ADJACENCY by outgoing
                                  # So, this might be tricky for the LLM if rules conflict or are interpreted strictly
        {"name": "g", "content": {"A": ["B"], "B": ["C"], "C": []}}
    ]
    sample_graph_data_dense = [ # Density = 6 / (4*3) = 0.5 -> ADJACENCY
        {"name": "g", "content": {"A": ["B", "C", "D"], "B": ["A", "C"], "C": ["D"], "D": []}}
    ]
    sample_graph_data_high_outgoing = [ # Max outgoing for A is 4 -> ADJACENCY
        {"name": "g", "content": {"A": ["B", "C", "D", "E"], "B": [], "C": [], "D": [], "E": []}}
    ]


    if mistral_client:
        print("\n--- Testing Array Visualization Selection ---")
        print("Test 1: Single array, no length change")
        array_viz1 = get_visualization_for_arrays(sample_array_data_single_no_change)
        print(f"Result 1: {array_viz1}")

        print("\nTest 2: Single array, length changes")
        array_viz2 = get_visualization_for_arrays(sample_array_data_single_change)
        print(f"Result 2: {array_viz2}")

        print("\nTest 3: Multiple arrays")
        array_viz3 = get_visualization_for_arrays(sample_array_data_multiple)
        print(f"Result 3: {array_viz3}")

        print("\n--- Testing Tree Visualization Selection ---")
        print("Test 4: Binary tree structure")
        tree_viz1 = get_visualization_for_trees(sample_tree_data_binary)
        print(f"Result 4: {tree_viz1}")

        print("\nTest 5: N-ary tree structure (children array)")
        tree_viz2 = get_visualization_for_trees(sample_tree_data_nary)
        print(f"Result 5: {tree_viz2}")

        print("\n--- Testing Graph Visualization Selection ---")
        print("Test 6: Sparse graph (but density rule might trigger matrix)")
        graph_viz1 = get_visualization_for_graphs(sample_graph_data_sparse)
        print(f"Result 6: {graph_viz1}")
        
        print("\nTest 7: Dense graph")
        graph_viz2 = get_visualization_for_graphs(sample_graph_data_dense)
        print(f"Result 7: {graph_viz2}")

        print("\nTest 8: High outgoing connections")
        graph_viz3 = get_visualization_for_graphs(sample_graph_data_high_outgoing)
        print(f"Result 8: {graph_viz3}")
    else:
        print("LLM Handler: Mistral client failed to initialize. Skipping direct tests.")

