# visual_tracer_backend/app/tracer.py

import sys
import time
import json
import traceback
import linecache
# inspect and ast are not directly used by the core logic of server.py,
# but re and copy are.
import re
import copy

# This set can remain as a module-level constant as it's read-only during tracing.
IGNORED_VARIABLES = {
    # Special Python variables
    '__builtins__', '__name__', '__file__', '__doc__', '__package__',
    # Common variable names that are likely not data structures we care about
    'i', 'j', 'k', 'x', 'y', 'z', 'temp', 'tmp', 'count', 'index', 'key', 'value',
    'len', 'sum', 'max', 'min', 'enumerate', 'zip', 'map', 'filter', 'range',
    'args', 'kwargs', 'self', 'cls'
}

class DataStructureTracker:
    """
    Contains static methods for detecting, serializing, and recording
    data structure states and operations.
    This class is a direct adaptation of the one in the original server.py.
    """

    _data_structure_events = {}
    _previous_states = {}
    _operation_history = {}
    _code_lines_for_trace = [] # To be set by the main analysis function

    @staticmethod
    def initialize_tracker_state():
        """Initializes or resets the state for a new tracing session."""
        DataStructureTracker._data_structure_events = {
            "arrays": [],
            "trees": [],
            "graphs": []
        }
        DataStructureTracker._previous_states = {}
        DataStructureTracker._operation_history = {}
        DataStructureTracker._code_lines_for_trace = []

    @staticmethod
    def set_code_lines(code_lines):
        DataStructureTracker._code_lines_for_trace = code_lines

    @staticmethod
    def get_tracked_events():
        return DataStructureTracker._data_structure_events

    @staticmethod
    def is_tree_node(obj):
        """Check if an object is likely a tree node."""
        has_value = hasattr(obj, "value") or hasattr(obj, "val") or hasattr(obj, "data")
        has_children_list = hasattr(obj, "children") and isinstance(getattr(obj, "children"), list)
        is_binary = hasattr(obj, "left") or hasattr(obj, "right")
        return has_value and (has_children_list or is_binary)

    @staticmethod
    def is_graph(obj):
        """Check if an object is likely a graph (adjacency list)."""
        if not isinstance(obj, dict) or not obj: # Must be a non-empty dict
            return False
        
        # Check for adjacency list pattern (at least one value must be a list)
        if not any(isinstance(v, list) for v in obj.values()):
            return False
            
        # Further check: if values are lists, their items should be simple types (node identifiers)
        for _, value_list in obj.items():
            if isinstance(value_list, list):
                if not all(isinstance(item, (str, int, float, bool, type(None))) for item in value_list): # Allow None as a valid node/neighbor
                    return False
        return True

    @staticmethod
    def get_operation_type(line_content, var_name):
        """Detect the operation being performed on a variable based on line content."""
        line = line_content.strip()
        
        # Array creation
        if re.search(rf"\b{var_name}\b\s*=\s*\[", line) or \
           re.search(rf"\b{var_name}\b\s*=\s*list\(", line):
            return "create_array" if "for" not in line and "in" not in line else "list_comprehension"
        
        # Array modifications
        if re.search(rf"\b{var_name}\b\[.+\]\s*=", line): return "indexed_assignment"
        if re.search(rf"\b{var_name}\b\.append\(", line): return "append"
        if re.search(rf"\b{var_name}\b\.extend\(", line): return "extend"
        if re.search(rf"\b{var_name}\b\.insert\(", line): return "insert"
        if re.search(rf"\b{var_name}\b\.remove\(", line): return "remove"
        if re.search(rf"\b{var_name}\b\.pop\(", line): return "pop" # Handles with or without index
        if re.search(rf"\b{var_name}\b\.sort\(", line): return "sort"
        if re.search(rf"\b{var_name}\b\.reverse\(", line): return "reverse"
        
        # Graph creation/modification (assuming dict for adjacency list)
        if re.search(rf"\b{var_name}\b\s*=\s*\{{", line): return "create_graph"
        # Assignment to a graph's key (could be adding a node or updating an edge list)
        if isinstance(eval(var_name, sys._getframe(1).f_globals, sys._getframe(1).f_locals) if var_name in sys._getframe(1).f_locals else None, dict) and \
           re.search(rf"\b{var_name}\b\[.+\]\s*=", line):
             return "update_node_edges" # More generic for graph dict assignments
        # Appending to an edge list
        if isinstance(eval(var_name, sys._getframe(1).f_globals, sys._getframe(1).f_locals) if var_name in sys._getframe(1).f_locals else None, dict) and \
           re.search(rf"\b{var_name}\b\[.+\]\.append\(", line):
            return "add_edge"

        # Tree node creation
        # This is a bit tricky as 'TreeNode' might be user-defined.
        # We rely on is_tree_node for identification, operation type is harder from regex alone.
        # The original server.py used "TreeNode" string, which is brittle.
        # Let's assume if it's a tree node and an assignment, it's creation or modification.
        if re.search(rf"\b{var_name}\b\s*=", line): # General assignment
            # Further checks can be done if 'value' is a TreeNode instance
            return "assign_node" # Could be root creation or re-assigning a variable to a node

        # Tree attribute modifications
        if re.search(rf"\b{var_name}\b\.(value|val|data)\s*=", line): return "update_node_value"
        if re.search(rf"\b{var_name}\b\.left\s*=", line): return "set_left_child"
        if re.search(rf"\b{var_name}\b\.right\s*=", line): return "set_right_child"
        if re.search(rf"\b{var_name}\b\.children\.append\(", line): return "add_child_to_list"
        if re.search(rf"\b{var_name}\b\.children\[.+\]\s*=", line): return "update_child_in_list"

        return "update" # Default for other operations or direct modifications

    @staticmethod
    def serialize_tree(node):
        """Convert a tree node to a serializable format."""
        if node is None:
            return None
            
        result = {}
        
        if hasattr(node, "value"): result["value"] = node.value
        elif hasattr(node, "val"): result["value"] = node.val
        elif hasattr(node, "data"): result["value"] = node.data
        else: result["value"] = str(node) # Fallback
        
        # Handle both binary and n-ary children
        children_list = []
        if hasattr(node, "children") and isinstance(node.children, list):
            children_list.extend([DataStructureTracker.serialize_tree(child) for child in node.children])
        
        # For binary trees, add left/right if they exist, even if children list is also present
        # Some tree implementations might use both (e.g. a general tree node that can also have specific left/right)
        left_child = None
        right_child = None
        if hasattr(node, "left"):
            left_child = DataStructureTracker.serialize_tree(node.left)
            if left_child: result["left"] = left_child
        if hasattr(node, "right"):
            right_child = DataStructureTracker.serialize_tree(node.right)
            if right_child: result["right"] = right_child

        # If children_list was populated from a .children attribute, use it.
        # This handles cases where a node might have .left, .right AND a .children list (less common but possible)
        # The D3 visualizer will need to be robust to these structures.
        if children_list:
             result["children"] = children_list
        elif "left" not in result and "right" not in result and not children_list: # Ensure children key exists if no left/right
             result["children"] = []


        return result

    @staticmethod
    def serialize_graph(graph):
        """Convert a graph (adjacency list dict) to a serializable format."""
        if not isinstance(graph, dict):
            return str(graph) # Fallback for non-dict graphs
            
        result = {}
        for key, value in graph.items():
            key_str = str(key) # Ensure keys are strings
            if isinstance(value, list):
                result[key_str] = [str(item) for item in value] # Ensure items in adjacency list are strings
            else: # Handle cases where a value might not be a list (e.g. node with no outgoing edges but represented differently)
                result[key_str] = [str(value)] 
        return result

    @staticmethod
    def record_data_structure_event(ds_type, name, value, operation_hint, lineno, line_content):
        """Record a data structure event if it has changed or is significant."""
        if name in IGNORED_VARIABLES or name.startswith('_'):
            return

        operation = operation_hint
        if not operation and line_content: # Infer operation if not explicitly provided
            operation = DataStructureTracker.get_operation_type(line_content, name)
        
        serialized_value = None
        if ds_type == "arrays":
            if not isinstance(value, list): return
            serialized_value = list(value) # Shallow copy
        elif ds_type == "trees":
            if not DataStructureTracker.is_tree_node(value): return
            serialized_value = DataStructureTracker.serialize_tree(value)
        elif ds_type == "graphs":
            if not DataStructureTracker.is_graph(value): return
            serialized_value = DataStructureTracker.serialize_graph(value)
        else:
            return # Unknown data structure type

        if serialized_value is None: return

        state_key = f"{ds_type}_{name}"
        try:
            current_state_json = json.dumps(serialized_value, sort_keys=True, default=str)
            
            # Record if:
            # 1. State is new
            # 2. State content has changed
            # 3. Operation is significant (e.g., 'create', 'append', not just generic 'update' on same content)
            significant_operations = {"create_array", "list_comprehension", "append", "extend", "insert", "remove", "pop", "sort", "reverse", 
                                      "create_graph", "add_edge", "update_node_edges",
                                      "assign_node", "set_left_child", "set_right_child", "add_child_to_list", "update_child_in_list",
                                      "update_node_value", "final_state", "call", "return"}

            if state_key not in DataStructureTracker._previous_states or \
               DataStructureTracker._previous_states[state_key] != current_state_json or \
               operation in significant_operations:
                
                DataStructureTracker._previous_states[state_key] = current_state_json
                
                operation_details_obj = {"code": line_content.strip()} if line_content else None
                
                event_data = {
                    "name": name,
                    "operation": operation,
                    "content": serialized_value,
                    "timestamp": time.time(), # Using actual time
                    "location": f"line {lineno}",
                    "operation_details": operation_details_obj
                }
                
                DataStructureTracker._data_structure_events[ds_type].append(event_data)
                
                # Optional: operation_history can be maintained if needed for complex analysis,
                # but the primary output is data_structure_events.
                # if state_key not in DataStructureTracker._operation_history:
                #     DataStructureTracker._operation_history[state_key] = []
                # DataStructureTracker._operation_history[state_key].append(event_data)

        except TypeError as te: # Handles non-serializable content within structures
            print(f"Tracer: TypeError serializing {name} ({ds_type}): {te}. Value: {str(value)[:100]}")
        except Exception as e:
            print(f"Tracer: Error recording event for {name} ({ds_type}): {e}")


# --- Trace Function and Helpers ---
# These will be defined *inside* perform_code_analysis to access its scoped state variables.

def perform_code_analysis(code_snippet: str) -> str:
    """
    Analyzes the given Python code snippet using sys.settrace to track data structures.
    This is the main entry point for tracing, replacing the MCP tool.
    """
    # Initialize/reset state for this specific analysis run
    DataStructureTracker.initialize_tracker_state()
    DataStructureTracker.set_code_lines(code_snippet.strip().split('\n'))

    # --- Nested Trace Function ---
    # This function is defined inside perform_code_analysis to have access to 
    # its scope, particularly the tracker's state which is now managed by the class.
    def trace_data_structures_internal(frame, event, arg):
        try:
            func_name = frame.f_code.co_name
            filename = frame.f_code.co_filename
            lineno = frame.f_lineno
            
            # Filter out internal/library calls
            if (func_name.startswith('_') or 
                'site-packages' in filename or 
                '/lib/' in filename or
                (filename.startswith('<') and filename != '<string>') or # Allow tracing within <string> (exec'd code)
                func_name == 'trace_data_structures_internal' or # Avoid self-tracing
                DataStructureTracker.__module__ in filename): # Avoid tracing this module
                return trace_data_structures_internal

            line_content_str = ""
            try:
                if filename == '<string>': # Code executed by exec
                    if 0 <= lineno - 1 < len(DataStructureTracker._code_lines_for_trace):
                        line_content_str = DataStructureTracker._code_lines_for_trace[lineno - 1]
                else: # Code from a file
                    line_content_str = linecache.getline(filename, lineno)
                line_content_str = line_content_str.strip()
            except Exception:
                pass # Ignore errors fetching line content

            # Helper to scan current frame
            def scan_current_frame(event_operation_hint):
                if frame and frame.f_locals:
                    for name, value in list(frame.f_locals.items()): # Iterate over a copy
                        if name.startswith('__') and name.endswith('__'): continue
                        
                        if isinstance(value, list):
                            DataStructureTracker.record_data_structure_event("arrays", name, value, event_operation_hint, lineno, line_content_str)
                        elif DataStructureTracker.is_tree_node(value):
                            DataStructureTracker.record_data_structure_event("trees", name, value, event_operation_hint, lineno, line_content_str)
                        elif DataStructureTracker.is_graph(value):
                            DataStructureTracker.record_data_structure_event("graphs", name, value, event_operation_hint, lineno, line_content_str)
            
            if event == 'line':
                scan_current_frame("line_execution") # More descriptive hint
            elif event == 'call':
                scan_current_frame("function_call_args")
            elif event == 'return':
                if isinstance(arg, list):
                    DataStructureTracker.record_data_structure_event("arrays", f"{func_name}_return", arg, "return_value", lineno, line_content_str)
                elif DataStructureTracker.is_tree_node(arg):
                    DataStructureTracker.record_data_structure_event("trees", f"{func_name}_return", arg, "return_value", lineno, line_content_str)
                elif DataStructureTracker.is_graph(arg):
                    DataStructureTracker.record_data_structure_event("graphs", f"{func_name}_return", arg, "return_value", lineno, line_content_str)
                scan_current_frame("function_return_locals") # Scan locals before function truly exits
        
        except Exception as e_trace:
            # print(f"Tracer: Error in trace_data_structures_internal: {e_trace}")
            # Avoid crashing the traced program due to tracer errors
            pass
        return trace_data_structures_internal
    # --- End of Nested Trace Function ---

    # Prepare for execution
    linecache.clearcache() # Clear linecache before new exec
    # Add the current code snippet to linecache for <string>
    # This makes linecache.getline('<string>', lineno) work during exec
    linecache.cache['<string>'] = (
        len(code_snippet), 
        None, 
        DataStructureTracker._code_lines_for_trace, 
        '<string>'
    )

    exec_globals = {'__name__': '__main__'} # Clean global scope for exec

    # Set trace and execute
    original_trace_func = sys.gettrace()
    sys.settrace(trace_data_structures_internal)
    
    try:
        exec(code_snippet, exec_globals)
    except Exception as e_exec:
        print(f"Tracer: Error executing user code: {e_exec}")
        traceback.print_exc() # Log the traceback for debugging
        # We can choose to include this error in the returned JSON if needed
    finally:
        sys.settrace(original_trace_func) # Restore original trace function (or None)

    # After execution, capture final states of global variables from exec_globals
    final_lineno = len(DataStructureTracker._code_lines_for_trace)
    for name, value in exec_globals.items():
        if name.startswith('__') or callable(value) or name in IGNORED_VARIABLES:
            continue
        
        if isinstance(value, list):
            DataStructureTracker.record_data_structure_event("arrays", name, value, "final_state", final_lineno, "global_scope_end")
        elif DataStructureTracker.is_tree_node(value):
            DataStructureTracker.record_data_structure_event("trees", name, value, "final_state", final_lineno, "global_scope_end")
        elif DataStructureTracker.is_graph(value):
            DataStructureTracker.record_data_structure_event("graphs", name, value, "final_state", final_lineno, "global_scope_end")

    # Compile results
    result = {
        "code": {
            "source": code_snippet, # Original code snippet
            "lines": DataStructureTracker._code_lines_for_trace
        },
        "data_structures": DataStructureTracker.get_tracked_events()
        # "error": execution_error_info # Optionally include execution error details
    }
    
    try:
        return json.dumps(result, default=str, indent=2)
    except Exception as e_json:
        print(f"Tracer: Error serializing final result to JSON: {e_json}")
        # Fallback error JSON
        return json.dumps({
            "code": {"source": code_snippet, "lines": DataStructureTracker._code_lines_for_trace},
            "data_structures": {"arrays": [], "trees": [], "graphs": []},
            "error": {"message": "Failed to serialize results", "details": str(e_json)}
        }, default=str, indent=2)

if __name__ == '__main__':
    # Example usage for testing this module directly
    sample_code = """
my_array = [1, 2, 3]
my_array.append(4)
my_array[0] = 100

class TreeNode:
    def __init__(self, value):
        self.value = value
        self.left = None
        self.right = None

root = TreeNode(10)
root.left = TreeNode(5)
root.left.value = 50

my_graph = {'A': ['B'], 'B': []}
my_graph['A'].append('C')
my_graph['C'] = []
    """
    print("Running direct trace analysis...")
    analysis_json = perform_code_analysis(sample_code)
    print("\nAnalysis Result JSON:")
    print(analysis_json)

    # Test with a slightly more complex tree
    tree_code = """
class TreeNode:
    def __init__(self, value):
        self.value = value
        self.children = []

    def add_child(self, child_node):
        self.children.append(child_node)

root = TreeNode("Root")
c1 = TreeNode("C1")
c2 = TreeNode("C2")
root.add_child(c1)
root.add_child(c2)
c1.add_child(TreeNode("C1.1"))
c2.value = "C2_MODIFIED"
"""
    print("\nRunning tree analysis...")
    tree_analysis_json = perform_code_analysis(tree_code)
    print("\nTree Analysis Result JSON:")
    print(tree_analysis_json)
