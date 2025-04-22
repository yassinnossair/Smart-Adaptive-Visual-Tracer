from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import asyncio
import sys
import os
import json
import traceback
import threading
from concurrent.futures import ThreadPoolExecutor

# Import your MCPClient class
from client import MCPClient
import redis.asyncio as redis

app = Flask(__name__, static_folder='frontend/build')
CORS(app, resources={r"/*": {"origins": "*"}})

# Add the path to your client.py
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Server script path
server_script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'mcp-server', 'server.py'))

# Create a thread pool for handling async operations
executor = ThreadPoolExecutor(max_workers=4)

# Helper function to run async code in a separate thread
def run_async_in_thread(coro):
    """Run an async coroutine in a separate thread with its own event loop"""
    def wrapper():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()
    
    return executor.submit(wrapper).result()

# API endpoint for submitting code
@app.route('/api/analyze', methods=['POST'])
def analyze_code():
    print("Received analyze request")
    
    # Get code from request
    data = request.json
    print("Request data:", data)
    
    if not data or 'code' not in data:
        print("No code provided in request")
        return jsonify({"error": "No code provided"}), 400
    
    code_snippet = data['code']
    print(f"Received code snippet of length: {len(code_snippet)}")
    
    try:
        # Define async function for processing
        async def process_code():
            # Create a fresh client instance for this request
            client = MCPClient()
            
            try:
                # Connect to server
                print("Connecting to MCP server...")
                connected = await client.connect_to_server(server_script_path)
                
                if not connected:
                    print("Failed to connect to MCP server")
                    return None
                
                # Send code to MCP server
                print("Sending code to MCP server")
                result = await client.send_code_snippet(code_snippet)
                return result
            finally:
                # Always close the client
                try:
                    await client.close()
                except Exception as e:
                    print(f"Error closing client: {e}")
        
        # Run the async function in a separate thread
        result = run_async_in_thread(process_code())
        
        if not result:
            print("MCP server returned no result")
            return jsonify({"error": "Failed to analyze code"}), 500
        
        print("Code analysis complete")
        return jsonify({"status": "success", "message": "Code analysis complete"}), 200
    except Exception as e:
        print(f"Error during analysis: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": f"Error analyzing code: {str(e)}"}), 500

# API endpoint to get raw data from Redis
@app.route('/api/data/<data_type>', methods=['GET'])
def get_data(data_type):
    """Get raw data from Redis"""
    try:
        # Define async function for getting data
        async def fetch_data():
            redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)
            try:
                return await redis_client.get(data_type)
            finally:
                await redis_client.close()
        
        # Run the async function in a separate thread
        data = run_async_in_thread(fetch_data())
        
        if data:
            return jsonify(json.loads(data)), 200
        return jsonify({"error": f"No data found for {data_type}"}), 404
    except Exception as e:
        print(f"Error retrieving data: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": f"Error retrieving data: {str(e)}"}), 500

# API endpoint to get visualization selection for specific data type
@app.route('/api/visualization/<data_type>', methods=['GET'])
def get_visualization_selection(data_type):
    """Get visualization selection for specific data type"""
    try:
        # Define async function for getting visualization data
        async def fetch_visualization():
            redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)
            try:
                selection = await redis_client.get(f"{data_type}_viz_selection")
                viz_type = await redis_client.get(f"{data_type}_viz_type")
                rationale = await redis_client.get(f"{data_type}_viz_rationale")
                return selection, viz_type, rationale
            finally:
                await redis_client.close()
        
        # Run the async function in a separate thread
        selection, viz_type, rationale = run_async_in_thread(fetch_visualization())
        
        if not selection:
            return jsonify({"error": f"No visualization selection for {data_type}"}), 404
        
        return jsonify({
            "selection": selection,
            "visualization_type": viz_type,
            "rationale": rationale
        }), 200
    except Exception as e:
        print(f"Error retrieving visualization selection: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": f"Error retrieving visualization selection: {str(e)}"}), 500

# API endpoint to get all execution data for dashboard
@app.route('/api/execution_data', methods=['GET'])
def get_all_execution_data():
    """Get all execution data for dashboard"""
    try:
        # Define async function for getting all data
        async def fetch_all_data():
            redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)
            try:
                # Get all the necessary data
                arrays_data = await redis_client.get("arrays")
                trees_data = await redis_client.get("trees")
                graphs_data = await redis_client.get("graphs")
                code_data = await redis_client.get("code")
                
                # Get visualization selections
                arrays_selection = await redis_client.get("arrays_viz_selection")
                arrays_type = await redis_client.get("arrays_viz_type")
                arrays_rationale = await redis_client.get("arrays_viz_rationale")
                
                trees_selection = await redis_client.get("trees_viz_selection")
                trees_type = await redis_client.get("trees_viz_type")
                trees_rationale = await redis_client.get("trees_viz_rationale")
                
                graphs_selection = await redis_client.get("graphs_viz_selection")
                graphs_type = await redis_client.get("graphs_viz_type")
                graphs_rationale = await redis_client.get("graphs_viz_rationale")
                
                return {
                    "arrays": {
                        "data": json.loads(arrays_data or "[]"),
                        "visualization": {
                            "selection": arrays_selection,
                            "type": arrays_type,
                            "rationale": arrays_rationale
                        }
                    },
                    "trees": {
                        "data": json.loads(trees_data or "[]"),
                        "visualization": {
                            "selection": trees_selection,
                            "type": trees_type,
                            "rationale": trees_rationale
                        }
                    },
                    "graphs": {
                        "data": json.loads(graphs_data or "[]"),
                        "visualization": {
                            "selection": graphs_selection,
                            "type": graphs_type,
                            "rationale": graphs_rationale
                        }
                    },
                    "code": json.loads(code_data or "{}")
                }
            finally:
                await redis_client.close()
        
        # Run the async function in a separate thread
        result = run_async_in_thread(fetch_all_data())
        return jsonify(result), 200
    except Exception as e:
        print(f"Error retrieving execution data: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": f"Error retrieving execution data: {str(e)}"}), 500

# Simple endpoint to test connection
@app.route('/test', methods=['GET'])
def test():
    return jsonify({"status": "ok"})

# Serve React frontend
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(app.static_folder + '/' + path):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    # Test redis connection
    def test_redis():
        async def _test():
            redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)
            try:
                await redis_client.ping()
                return True
            except Exception as e:
                print(f"Redis connection error: {e}")
                return False
            finally:
                await redis_client.close()
        
        return run_async_in_thread(_test())
    
    if test_redis():
        print("Successfully connected to Redis")
    else:
        print("Warning: Could not connect to Redis")
    
    print("Starting Flask server on port 8000...")
    app.run(debug=True, port=8000)