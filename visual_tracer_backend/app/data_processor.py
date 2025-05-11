import json
import copy


def _is_identical_tree_state(tree1, tree2):
    """
    Compare two tree structures (represented as dicts) to determine if they are functionally identical.
    This method performs a deep comparison of tree nodes.
    This is a direct adaptation of the helper method from the original client.py.

    Args:
        tree1: First tree structure (dict or None).
        tree2: Second tree structure (dict or None).

    Returns:
        bool: True if trees are identical, False if they differ.
    """
    # Handle None cases
    if tree1 is None and tree2 is None:
        return True
    if tree1 is None or tree2 is None:
        return False

    # Ensure both are dictionaries if not None
    if not isinstance(tree1, dict) or not isinstance(tree2, dict):
        # This case should ideally not happen if data is well-formed,
        # but good to be defensive. If one is dict and other is not, they are different.
        return False

    # Compare node values
    # Check common value keys, assuming 'value' is the primary one.
    # The original client.py checked for 'value' in tree1 and tree2.
    # We should ensure the keys exist before comparing.
    tree1_value = tree1.get("value")
    tree2_value = tree2.get("value")

    if tree1_value != tree2_value: # Handles if one is None and other is not, or different values
        return False

    # Compare binary tree structure (left/right children)
    for child_key in ["left", "right"]:
        tree1_has_child = child_key in tree1
        tree2_has_child = child_key in tree2

        if tree1_has_child != tree2_has_child: # One has the child, the other doesn't
            return False
        
        if tree1_has_child: # Both have it (or had it, could be None)
            if not _is_identical_tree_state(tree1.get(child_key), tree2.get(child_key)):
                return False

    # Compare non-binary tree structure (children array)
    tree1_has_children_attr = "children" in tree1
    tree2_has_children_attr = "children" in tree2

    if tree1_has_children_attr != tree2_has_children_attr:
        return False

    if tree1_has_children_attr: # Both have the 'children' attribute
        children1 = tree1.get("children")
        children2 = tree2.get("children")

        # Ensure they are both lists if they exist
        if not isinstance(children1, list) or not isinstance(children2, list):
            if children1 == children2: # e.g. both are None or some other identical non-list
                pass
            else:
                return False # One is a list, the other isn't, or different non-lists

        if isinstance(children1, list) and isinstance(children2, list):
            if len(children1) != len(children2):
                return False
            
            # Compare each child recursively
            for i in range(len(children1)):
                if not _is_identical_tree_state(children1[i], children2[i]):
                    return False
    
    # If all checks pass, the trees are considered identical
    return True


def filter_data_structure_events(events: list, structure_type: str) -> list:
    """
    Filter data structure events to retain only meaningful visualization-ready data.
    This is a direct adaptation of the method from the original client.py.

    Args:
        events (list): List of data structure events from the tracer.
        structure_type (str): The type of data structure ('arrays', 'trees', or 'graphs').

    Returns:
        list: Filtered list of events suitable for visualization.
    """
    if not events:
        return []

    # --- Pass 1: Identify Important Variables ---
    important_variables = set()
    # Define names often used locally in recursion/loops that we *might* want to keep for trees
    potentially_recursive_local_names = {"node", "current", "temp_node", "child"}

    for event in events:
        name = event.get("name", "")
        operation = event.get("operation", "")

        is_potentially_important = any([
            operation in ["create", "final_state", "create_array", "create_graph", "assign_node"], # Added tracer ops
            operation.startswith("add_"), # Covers add_child, add_edge etc.
            operation in ["append", "insert", "pop", "remove", "extend", "sort", "reverse", # Array ops
                          "update_node_edges", "set_left_child", "set_right_child", # Graph/Tree ops
                          "update_node_value"], 
            (
                "serialized" not in name.lower() and # General heuristics
                not name.startswith("obj") and
                not name.startswith("v") and
                # Original blacklist from client.py, tree locals handled separately
                name not in ["node", "result", "return_value", "event_data", "current", "temp_node", "child"]
            )
        ])

        if is_potentially_important:
            important_variables.add(name)

    # Add special cases for top-level structures
    if structure_type == "trees":
        important_variables.add("root") 
    elif structure_type == "graphs":
        important_variables.add("graph")

    # print(f"[Filter Debug - {structure_type}] Initial important variables: {important_variables}")

    # --- Pass 2: Filter Events with Context ---
    filtered_events = []
    last_kept_tree_state_content = None 
    
    # These dictionaries will store state per variable name for arrays and graphs
    # They are reset for each call to filter_data_structure_events
    previous_content_json_by_var = {} 
    array_length_history_by_var = {}
    last_operation_by_var = {}
    
    # For graph state hashing, reset per call
    # In the original client, this was self._seen_states, an instance variable.
    # Here, it needs to be local to the function call to ensure it's fresh.
    seen_graph_state_hashes = set()

    for event in events:
        name = event.get("name", "")
        operation = event.get("operation", "")
        content = event.get("content") # This is the serialized data structure

        # --- Initial Skip Logic (from original client) ---
        op_details = event.get("operation_details")
        if op_details and isinstance(op_details, dict):
            code_detail = op_details.get("code", "")
            if operation in ["call", "exit"] and "@staticmethod" in code_detail:
                continue
        
        is_important_var = name in important_variables
        is_potentially_tree_local = False
        if structure_type == "trees" and name in potentially_recursive_local_names:
            # Check if content looks like a tree node (serialized format)
            if content and isinstance(content, dict) and 'value' in content:
                is_potentially_tree_local = True
        
        if not is_important_var and not is_potentially_tree_local:
            continue
        # --- End Initial Skip Logic ---

        # --- Tree Handling ---
        if structure_type == "trees" and content and (is_important_var or is_potentially_tree_local):
            is_meaningful_change = True 
            if last_kept_tree_state_content is not None:
                try:
                    if _is_identical_tree_state(last_kept_tree_state_content, content):
                        # Critical operations for trees (even if content is same as last *kept* state)
                        critical_tree_ops = {"create", "final_state", "assign_node", "set_left_child", "set_right_child", "add_child_to_list"}
                        if not operation.startswith("add_") and operation not in critical_tree_ops:
                            is_meaningful_change = False
                except Exception as e:
                    # print(f"Error comparing tree states: {e}. Assuming change.")
                    is_meaningful_change = True 

            if is_meaningful_change:
                try:
                    last_kept_tree_state_content = copy.deepcopy(content)
                    filtered_events.append(event)
                except Exception as e:
                    # print(f"Error deepcopying tree state: {e}. Skipping event.")
                    pass # Skip if deepcopy fails

        # --- Array Handling ---
        elif structure_type == "arrays" and content and isinstance(content, list):
            if not is_important_var:
                continue

            is_meaningful_change = False # Default to false, prove it's meaningful
            current_length = len(content)

            if name not in array_length_history_by_var:
                array_length_history_by_var[name] = []

            # Define critical array operations that always signify a meaningful step
            critical_array_ops = {"create_array", "list_comprehension", "final_state", "append", "insert", "pop", "remove", "extend", "sort", "reverse"}
            
            if operation in critical_array_ops:
                is_meaningful_change = True
            elif array_length_history_by_var[name] and current_length != array_length_history_by_var[name][-1]:
                is_meaningful_change = True # Length changed
            elif name in last_operation_by_var and last_operation_by_var[name] != operation:
                is_meaningful_change = True # Operation type changed for this var
            elif name in previous_content_json_by_var:
                current_content_json = json.dumps(content, sort_keys=True)
                if current_content_json != previous_content_json_by_var[name]:
                    is_meaningful_change = True # Content changed
            else: # First time seeing this variable's content
                is_meaningful_change = True


            if is_meaningful_change:
                previous_content_json_by_var[name] = json.dumps(content, sort_keys=True)
                array_length_history_by_var[name].append(current_length)
                last_operation_by_var[name] = operation
                filtered_events.append(event)

        # --- Graph Handling ---
        elif structure_type == "graphs" and content and isinstance(content, dict):
            if not is_important_var:
                continue

            is_meaningful_change = True
            try:
                # Hash the full content for more accurate duplicate detection
                state_hash = hash(json.dumps(content, sort_keys=True))

                if state_hash in seen_graph_state_hashes:
                    critical_graph_ops = {"create_graph", "final_state", "add_edge", "update_node_edges"}
                    if operation not in critical_graph_ops and not operation.startswith("add_"):
                         is_meaningful_change = False
                
                if is_meaningful_change:
                    seen_graph_state_hashes.add(state_hash)

            except Exception as e:
                # print(f"Hashing failed for graph state: {e}. Keeping event.")
                pass # Keep event if hashing fails

            if is_meaningful_change:
                # Original client.py had logic to simplify operation_details code for graphs.
                # This can be replicated if needed, but for now, focusing on core filtering.
                # if op_details and isinstance(op_details, dict) and "code" in op_details:
                #     code = op_details["code"]
                #     if any([...]): # conditions from original client
                #         event["operation_details"]["code"] = f"{operation} operation"
                filtered_events.append(event)
        
        # --- Fallback for other potential types (if any) ---
        elif content and is_important_var: # If not array/tree/graph but has content and is important
            # For unknown types, if it's an important variable, we might want to keep its events.
            # The original client just appended it.
            filtered_events.append(event)


    # Final sort by timestamp
    filtered_events.sort(key=lambda e: e.get("timestamp", 0))

    # print(f"[Filter Debug - {structure_type}] Filtered {len(events)} raw events down to {len(filtered_events)} events")
    return filtered_events



