# visual_tracer_backend/app/routes.py

import os
import json
import traceback
from flask import current_app, jsonify, request, send_from_directory

# Import the application instance created in __init__.py
# We will register routes on this instance.
# This assumes 'app' is the name of the Flask instance in __init__.py
# from . import app # This line is problematic. Routes are typically defined using app context.

# Instead, we'll get 'app' from current_app or pass it if using Blueprints.
# For simplicity without Blueprints yet, we'll assume 'app' is accessible
# when these routes are imported by __init__.py.
# The @current_app.route decorator will work.

# Import our new backend modules
from . import tracer
from . import data_processor
from . import llm_handler

# --- In-memory store for the last analysis result ---
# This replaces Redis for simplicity in this refactored version.
# It will hold the comprehensive data that the GET endpoints serve.
_last_analysis_results = {
    "code": None,
    "arrays": {"data": [], "visualization": None},
    "trees": {"data": [], "visualization": None},
    "graphs": {"data": [], "visualization": None},
    "error": None # To store any processing error from /analyze
}

# Helper to reset the in-memory store
def _reset_last_analysis():
    global _last_analysis_results
    _last_analysis_results = {
        "code": None,
        "arrays": {"data": [], "visualization": None},
        "trees": {"data": [], "visualization": None},
        "graphs": {"data": [], "visualization": None},
        "error": None
    }

@current_app.route('/api/analyze', methods=['POST'])
def analyze_code_route():
    global _last_analysis_results
    _reset_last_analysis() # Clear previous results on a new analysis

    print("Received analyze request")
    
    data = request.json
    print(f"Request data: {str(data)[:200]}") # Log snippet of data
    
    if not data or 'code' not in data:
        print("No code provided in request")
        _last_analysis_results["error"] = "No code provided"
        return jsonify({"error": "No code provided"}), 400
    
    code_snippet = data['code']
    print(f"Received code snippet of length: {len(code_snippet)}")
    
    try:
        # 1. Perform code tracing
        print("Starting code tracing...")
        raw_trace_json_str = tracer.perform_code_analysis(code_snippet)
        raw_trace_data = json.loads(raw_trace_json_str)
        print("Code tracing complete.")

        if "error" in raw_trace_data and raw_trace_data["error"]:
            print(f"Error during tracing: {raw_trace_data['error']}")
            _last_analysis_results["error"] = f"Tracer error: {raw_trace_data['error'].get('message', 'Unknown tracer error')}"
            # Still store what we have, like the code itself
            _last_analysis_results["code"] = raw_trace_data.get("code", {"source": code_snippet, "lines": code_snippet.split('\n')})
            return jsonify({"error": _last_analysis_results["error"]}), 500

        _last_analysis_results["code"] = raw_trace_data.get("code")
        all_ds_events = raw_trace_data.get("data_structures", {})

        # 2. Process Arrays
        raw_array_events = all_ds_events.get("arrays", [])
        if raw_array_events:
            print(f"Filtering {len(raw_array_events)} raw array events...")
            filtered_arrays = data_processor.filter_data_structure_events(raw_array_events, "arrays")
            _last_analysis_results["arrays"]["data"] = filtered_arrays
            print(f"Filtered to {len(filtered_arrays)} array events.")
            if filtered_arrays:
                print("Getting LLM suggestion for arrays...")
                array_viz_suggestion = llm_handler.get_visualization_for_arrays(filtered_arrays)
                _last_analysis_results["arrays"]["visualization"] = array_viz_suggestion
                print(f"Array viz suggestion: {array_viz_suggestion.get('visualization_type')}")
        else:
            print("No raw array events found.")
            _last_analysis_results["arrays"]["data"] = []


        # 3. Process Trees
        raw_tree_events = all_ds_events.get("trees", [])
        if raw_tree_events:
            print(f"Filtering {len(raw_tree_events)} raw tree events...")
            filtered_trees = data_processor.filter_data_structure_events(raw_tree_events, "trees")
            _last_analysis_results["trees"]["data"] = filtered_trees
            print(f"Filtered to {len(filtered_trees)} tree events.")
            if filtered_trees:
                print("Getting LLM suggestion for trees...")
                tree_viz_suggestion = llm_handler.get_visualization_for_trees(filtered_trees)
                _last_analysis_results["trees"]["visualization"] = tree_viz_suggestion
                print(f"Tree viz suggestion: {tree_viz_suggestion.get('visualization_type')}")
        else:
            print("No raw tree events found.")
            _last_analysis_results["trees"]["data"] = []

        # 4. Process Graphs
        raw_graph_events = all_ds_events.get("graphs", [])
        if raw_graph_events:
            print(f"Filtering {len(raw_graph_events)} raw graph events...")
            filtered_graphs = data_processor.filter_data_structure_events(raw_graph_events, "graphs")
            _last_analysis_results["graphs"]["data"] = filtered_graphs
            print(f"Filtered to {len(filtered_graphs)} graph events.")
            if filtered_graphs:
                print("Getting LLM suggestion for graphs...")
                graph_viz_suggestion = llm_handler.get_visualization_for_graphs(filtered_graphs)
                _last_analysis_results["graphs"]["visualization"] = graph_viz_suggestion
                print(f"Graph viz suggestion: {graph_viz_suggestion.get('visualization_type')}")
        else:
            print("No raw graph events found.")
            _last_analysis_results["graphs"]["data"] = []
            
        print("Code analysis and LLM processing complete.")
        return jsonify({"status": "success", "message": "Code analysis complete"}), 200

    except Exception as e:
        print(f"Error during analysis route: {str(e)}")
        traceback.print_exc()
        _last_analysis_results["error"] = f"Error analyzing code: {str(e)}"
        return jsonify({"error": _last_analysis_results["error"]}), 500

@current_app.route('/api/data/<data_type>', methods=['GET'])
def get_data_route(data_type):
    global _last_analysis_results
    print(f"Request for /api/data/{data_type}")

    if _last_analysis_results["error"]:
         # If there was an error during the last analysis, reflect that.
         # Or, decide if you want to return empty data or a more specific error.
        return jsonify({"error": f"Previous analysis failed: {_last_analysis_results['error']}"}), 500

    if data_type in ["arrays", "trees", "graphs"]:
        data_to_return = _last_analysis_results.get(data_type, {}).get("data", [])
        if data_to_return is not None: # Check for None explicitly, empty list is valid
            print(f"Returning {len(data_to_return)} items for {data_type}")
            return jsonify(data_to_return), 200
        else: # Should not happen if _reset_last_analysis is used correctly
            print(f"No data found for {data_type}, returning empty list.")
            return jsonify([]), 200 # Return empty list if data is None
            
    elif data_type == "code":
        code_info = _last_analysis_results.get("code")
        if code_info:
            print("Returning code information.")
            return jsonify(code_info), 200
        else:
            print("No code information found.")
            return jsonify({"error": "No code data found from last analysis"}), 404
            
    print(f"Invalid data_type requested: {data_type}")
    return jsonify({"error": f"No data found for {data_type} or invalid type"}), 404

@current_app.route('/api/visualization/<data_type>', methods=['GET'])
def get_visualization_selection_route(data_type):
    global _last_analysis_results
    print(f"Request for /api/visualization/{data_type}")

    if _last_analysis_results["error"]:
        return jsonify({"error": f"Previous analysis failed: {_last_analysis_results['error']}"}), 500

    if data_type in ["arrays", "trees", "graphs"]:
        viz_info = _last_analysis_results.get(data_type, {}).get("visualization")
        if viz_info:
            print(f"Returning visualization info for {data_type}: {viz_info.get('visualization_type')}")
            # Ensure the structure matches what the frontend expects
            # Original client returned: {"selection": ..., "visualization_type": ..., "rationale": ...}
            return jsonify({
                "selection": viz_info.get("selection", "1"), # Default selection if missing
                "visualization_type": viz_info.get("visualization_type", "DefaultViz"),
                "rationale": viz_info.get("rationale", "No rationale available.")
            }), 200
    
    print(f"No visualization selection found for {data_type}")
    return jsonify({"error": f"No visualization selection for {data_type}"}), 404

@current_app.route('/api/execution_data', methods=['GET'])
def get_all_execution_data_route():
    global _last_analysis_results
    print("Request for /api/execution_data")

    if _last_analysis_results["error"] and not _last_analysis_results["code"]: # If total failure
        return jsonify({"error": f"Previous analysis failed: {_last_analysis_results['error']}"}), 500

    # Construct the response to match the frontend's expectation
    # based on the original simple_server.py's output for this route.
    response_data = {
        "arrays": {
            "data": _last_analysis_results["arrays"]["data"],
            "visualization": _last_analysis_results["arrays"]["visualization"] or {
                "selection": "1", "type": "TIMELINE_ARRAY", "rationale": "Default or N/A"
            }
        },
        "trees": {
            "data": _last_analysis_results["trees"]["data"],
            "visualization": _last_analysis_results["trees"]["visualization"] or {
                "selection": "1", "type": "HIERARCHICAL_TREE", "rationale": "Default or N/A"
            }
        },
        "graphs": {
            "data": _last_analysis_results["graphs"]["data"],
            "visualization": _last_analysis_results["graphs"]["visualization"] or {
                "selection": "1", "type": "FORCE_DIRECTED", "rationale": "Default or N/A"
            }
        },
        "code": _last_analysis_results["code"] or {}
    }
    # Ensure visualization sub-objects have the expected keys even if null from LLM
    for key in ["arrays", "trees", "graphs"]:
        if not response_data[key]["visualization"].get("selection"):
            response_data[key]["visualization"]["selection"] = "1" # Default
        if not response_data[key]["visualization"].get("type"): # 'type' was used in original, map from 'visualization_type'
            response_data[key]["visualization"]["type"] = response_data[key]["visualization"].get("visualization_type", "DefaultVizType")
        if not response_data[key]["visualization"].get("rationale"):
            response_data[key]["visualization"]["rationale"] = "N/A"


    print("Returning all execution data.")
    return jsonify(response_data), 200

@current_app.route('/test', methods=['GET'])
def test_route():
    print("Test route hit")
    return jsonify({"status": "ok from new backend"})

# --- Static file serving for React Frontend ---
# This needs to point to your React app's build directory.
# Assuming 'run.py' is in 'visual_tracer_backend/' and frontend is in 'visual_tracer_backend/../frontend/'
# So, the relative path from 'visual_tracer_backend/' is '../frontend/build'.
# We use an absolute path for robustness.
_static_folder_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'frontend', 'build'))
print(f"Attempting to serve static files from: {_static_folder_path}")


@current_app.route('/', defaults={'path': ''})
@current_app.route('/<path:path>')
def serve_react_app(path):
    if path != "" and os.path.exists(os.path.join(_static_folder_path, path)):
        # print(f"Serving static file: {path}")
        return send_from_directory(_static_folder_path, path)
    else:
        # print(f"Serving index.html for path: {path}")
        if os.path.exists(os.path.join(_static_folder_path, 'index.html')):
            return send_from_directory(_static_folder_path, 'index.html')
        else:
            return jsonify({"error": "React frontend not found. Ensure it's built and path is correct."}), 404
