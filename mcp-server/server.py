from mcp.server.fastmcp import FastMCP
import sys
import time
import json
import traceback
import linecache
import inspect
import ast
import copy
import re

mcp = FastMCP("smart_visual_tracer")

# Global variables for tracking
ignored_variables = {
    # Special Python variables
    '__builtins__', '__name__', '__file__', '__doc__', '__package__',
    # Common variable names that are likely not data structures we care about
    'i', 'j', 'k', 'x', 'y', 'z', 'temp', 'tmp', 'count', 'index', 'key', 'value',
    'len', 'sum', 'max', 'min', 'enumerate', 'zip', 'map', 'filter', 'range',
    'args', 'kwargs', 'self', 'cls'
}

# Global state tracking
original_code = ""
code_lines = []
data_structure_events = {
    "arrays": [],
    "trees": [],
    "graphs": []
}
previous_states = {}
operation_history = {}

# Data structure detection and processing
class DataStructureTracker:
    
    @staticmethod
    def is_tree_node(obj):
        """Check if an object is likely a tree node"""
        # Check for common tree node attributes
        has_value = hasattr(obj, "value") or hasattr(obj, "val") or hasattr(obj, "data")
        
        # Check for common tree structures
        has_children = hasattr(obj, "children") and isinstance(getattr(obj, "children"), list)
        is_binary = (hasattr(obj, "left") or hasattr(obj, "right"))
        
        return has_value and (has_children or is_binary)
    
    @staticmethod
    def is_graph(obj):
        """Check if an object is likely a graph (adjacency list or matrix)"""
        if not isinstance(obj, dict):
            return False
            
        # Empty dict is not a graph
        if not obj:
            return False
            
        # Check for adjacency list pattern (keys with list values)
        has_list_values = any(isinstance(v, list) for v in obj.values())
        if not has_list_values:
            return False
            
        # Check if values in lists are valid node identifiers
        for key, value in obj.items():
            if isinstance(value, list):
                if not all(isinstance(item, (str, int, float, bool)) for item in value):
                    return False
        
        return True
    
    @staticmethod
    def get_operation_type(line_content, var_name):
        """Detect the operation being performed on a variable"""
        line = line_content.strip()
        
        # Array creation operations
        if re.search(rf"{var_name}\s*=\s*\[", line):
            if "for" in line and "in" in line:
                return "list_comprehension"
            return "create"
        
        if re.search(rf"{var_name}\s*=\s*list\(", line):
            return "create"
            
        # Array modification operations
        if re.search(rf"{var_name}\[\s*\d+\s*\]\s*=", line):
            return "indexed_assignment"
            
        if re.search(rf"{var_name}\.append\(", line):
            return "append"
            
        if re.search(rf"{var_name}\.extend\(", line):
            return "extend"
            
        if re.search(rf"{var_name}\.insert\(", line):
            return "insert"
            
        if re.search(rf"{var_name}\.remove\(", line):
            return "remove"
            
        if re.search(rf"{var_name}\.pop\(", line) or re.search(rf"{var_name}\.pop\(\)", line):
            return "pop"
            
        if re.search(rf"{var_name}\.sort\(", line):
            return "sort"
            
        if re.search(rf"{var_name}\.reverse\(", line):
            return "reverse"
        
        # Graph operations
        if re.search(rf"{var_name}\s*=\s*\{{", line):
            return "create"
            
        if re.search(rf"{var_name}\[\s*['\"]?\w+['\"]?\s*\]\s*=", line):
            return "add_vertex"
            
        if re.search(rf"{var_name}\[\s*['\"]?\w+['\"]?\s*\]\.append\(", line):
            return "add_edge"
        
        # Tree operations
        if "TreeNode" in line and re.search(rf"{var_name}\s*=", line):
            return "create"
            
        if re.search(rf"{var_name}\.children\.append\(", line):
            return "add_child"
            
        if re.search(rf"{var_name}\.left\s*=", line) or re.search(rf"{var_name}\.right\s*=", line):
            return "add_child"
            
        if re.search(rf"{var_name}\.value\s*=", line) or re.search(rf"{var_name}\.val\s*=", line):
            return "update_value"
        
        # Default (observation)
        return "update"
    
    @staticmethod
    def serialize_tree(node):
        """Convert a tree node to a serializable format"""
        if node is None:
            return None
            
        result = {}
        
        # Extract the value (try common attribute names)
        if hasattr(node, "value"):
            result["value"] = node.value
        elif hasattr(node, "val"):
            result["value"] = node.val
        elif hasattr(node, "data"):
            result["value"] = node.data
        else:
            result["value"] = str(node)
        
        # Handle children for non-binary trees
        if hasattr(node, "children") and isinstance(node.children, list):
            result["children"] = [
                DataStructureTracker.serialize_tree(child) for child in node.children
            ]
        
        # Handle binary trees
        if hasattr(node, "left") or hasattr(node, "right"):
            if hasattr(node, "left") and node.left is not None:
                result["left"] = DataStructureTracker.serialize_tree(node.left)
            if hasattr(node, "right") and node.right is not None:
                result["right"] = DataStructureTracker.serialize_tree(node.right)
        
        return result
    
    @staticmethod
    def serialize_graph(graph):
        """Convert a graph to a serializable format"""
        if not isinstance(graph, dict):
            return str(graph)
            
        # Convert to adjacency list format
        result = {}
        for key, value in graph.items():
            key_str = str(key)
            if isinstance(value, list):
                result[key_str] = [str(item) for item in value]
            else:
                result[key_str] = [str(value)]
        
        return result
    
    @staticmethod
    def record_data_structure_event(ds_type, name, value, operation, lineno, line_content):
        """Record a data structure event for visualization"""
        global data_structure_events, previous_states, operation_history
        
        # Skip variables we want to ignore
        if name in ignored_variables or name.startswith('_'):
            return
        
        # Determine operation type if not provided
        if not operation and line_content:
            operation = DataStructureTracker.get_operation_type(line_content, name)
        
        # Serialize the value based on data structure type
        if ds_type == "arrays":
            if not isinstance(value, list):
                return
            serialized_value = list(value)
        elif ds_type == "trees":
            if not DataStructureTracker.is_tree_node(value):
                return
            serialized_value = DataStructureTracker.serialize_tree(value)
        elif ds_type == "graphs":
            if not DataStructureTracker.is_graph(value):
                return
            serialized_value = DataStructureTracker.serialize_graph(value)
        else:
            return
        
        # Create a state key for tracking changes
        state_key = f"{ds_type}_{name}"
        try:
            current_state = json.dumps(serialized_value, sort_keys=True)
            
            # Skip if the state hasn't changed and it's not a significant operation
            if (state_key in previous_states and 
                previous_states[state_key] == current_state and
                operation in ("update", "observation")):
                return
            
            # Update the state
            previous_states[state_key] = current_state
            
            # Get operation history for this structure
            if state_key not in operation_history:
                operation_history[state_key] = []
            
            # Add to operation history
            operation_details = None
            if line_content:
                operation_details = {"code": line_content.strip()}
            
            # Create the event data
            event_data = {
                "name": name,
                "operation": operation,
                "content": serialized_value,
                "timestamp": time.time(),
                "location": f"line {lineno}",
                "operation_details": operation_details
            }
            
            # Record the event
            data_structure_events[ds_type].append(event_data)
            operation_history[state_key].append(event_data)
            
        except Exception as e:
            # Silently fail if we can't serialize
            pass

# Function to scan variables in frame for data structures
def scan_frame_for_data_structures(frame, lineno, line_content, event_type="line"):
    """Scan a frame for data structures and record changes"""
    if not frame or not frame.f_locals:
        return
    
    # For each variable in the frame
    for name, value in frame.f_locals.items():
        # Skip internal variables
        if name.startswith('__') and name.endswith('__'):
            continue
        
        # Check for arrays/lists
        if isinstance(value, list):
            # Determine operation based on line content if available
            operation = "update" if event_type == "line" else event_type
            DataStructureTracker.record_data_structure_event(
                "arrays", name, value, operation, lineno, line_content
            )
        
        # Check for trees
        elif DataStructureTracker.is_tree_node(value):
            operation = "update" if event_type == "line" else event_type
            DataStructureTracker.record_data_structure_event(
                "trees", name, value, operation, lineno, line_content
            )
        
        # Check for graphs
        elif DataStructureTracker.is_graph(value):
            operation = "update" if event_type == "line" else event_type
            DataStructureTracker.record_data_structure_event(
                "graphs", name, value, operation, lineno, line_content
            )

# Main tracing function
def trace_data_structures(frame, event, arg):
    """Trace function that focuses on data structure changes"""
    try:
        # Get basic frame info
        func_name = frame.f_code.co_name
        filename = frame.f_code.co_filename
        lineno = frame.f_lineno
        
        # Skip internal/library code
        if (func_name.startswith('_') or 
            'site-packages' in filename or 
            '/lib/' in filename or
            (filename.startswith('<') and filename != '<string>') or
            func_name == 'trace_data_structures'):
            return trace_data_structures
        
        # Get line content if possible
        line_content = ""
        try:
            if filename == '<string>':
                if 0 <= lineno - 1 < len(code_lines):
                    line_content = code_lines[lineno - 1]
            else:
                line_content = linecache.getline(filename, lineno)
            line_content = line_content.strip()
        except:
            pass
        
        # Process based on event type
        if event == 'line':
            # Scan for data structures in this frame
            scan_frame_for_data_structures(frame, lineno, line_content, "line")
            
        elif event == 'call':
            # Check if we're entering a function with data structures as arguments
            scan_frame_for_data_structures(frame, lineno, line_content, "call")
            
        elif event == 'return':
            # Check if we're returning a data structure
            if isinstance(arg, list):
                DataStructureTracker.record_data_structure_event(
                    "arrays", "return_value", arg, "return", lineno, line_content
                )
            elif DataStructureTracker.is_tree_node(arg):
                DataStructureTracker.record_data_structure_event(
                    "trees", "return_value", arg, "return", lineno, line_content
                )
            elif DataStructureTracker.is_graph(arg):
                DataStructureTracker.record_data_structure_event(
                    "graphs", "return_value", arg, "return", lineno, line_content
                )
            
            # Final scan of local variables before function exits
            scan_frame_for_data_structures(frame, lineno, line_content, "exit")
        
    except Exception as e:
        # Ensure we never crash the traced program
        pass
    
    # Continue tracing
    return trace_data_structures

@mcp.tool()
async def analyze_code(code_snippet: str) -> str:
    """Analyze code with data structure tracing"""
    global data_structure_events, previous_states, operation_history, original_code, code_lines
    
    # Reset tracking state
    data_structure_events = {
        "arrays": [],
        "trees": [],
        "graphs": []
    }
    previous_states = {}
    operation_history = {}
    
    # Store original code
    original_code = code_snippet
    code_lines = code_snippet.strip().split('\n')
    
    try:
        # Configure line caching
        linecache.clearcache()
        
        # Set up tracing
        sys.settrace(trace_data_structures)
        
        # Execute the code
        try:
            # Create a clean execution environment
            exec_globals = {'__name__': '__main__'}
            
            # Execute the code
            exec(code_snippet, exec_globals)
            
            # Scan globals for final data structure states
            for name, value in exec_globals.items():
                if name.startswith('__') or callable(value) or name in ignored_variables:
                    continue
                
                if isinstance(value, list):
                    DataStructureTracker.record_data_structure_event(
                        "arrays", name, value, "final_state", len(code_lines), "global scope"
                    )
                elif DataStructureTracker.is_tree_node(value):
                    DataStructureTracker.record_data_structure_event(
                        "trees", name, value, "final_state", len(code_lines), "global scope"
                    )
                elif DataStructureTracker.is_graph(value):
                    DataStructureTracker.record_data_structure_event(
                        "graphs", name, value, "final_state", len(code_lines), "global scope"
                    )
                    
        except Exception as e:
            # Record execution error but continue
            print(f"Error executing code: {str(e)}")
            traceback.print_exc()
        finally:
            # Always disable tracing
            sys.settrace(None)
        
        # Create the final result structure
        result = {
            "code": {
                "source": original_code,
                "lines": code_lines
            },
            "data_structures": data_structure_events
        }
        
        # Format the JSON with indentation for better readability
        return json.dumps(result, default=str, indent=2)
        
    except Exception as e:
        # Handle server errors
        error_data = {
            "code": {
                "source": code_snippet,
                "lines": code_snippet.split('\n')
            },
            "data_structures": {
                "arrays": [],
                "trees": [],
                "graphs": []
            },
            "error": {
                "message": str(e),
                "traceback": traceback.format_exc()
            }
        }
        
        return json.dumps(error_data, default=str, indent=2)

if __name__ == "__main__":
    mcp.run(transport="stdio")