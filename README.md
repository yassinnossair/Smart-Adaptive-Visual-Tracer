# Smart Adaptive Visual Tracer

This project is part of a bachelor thesis focused on enhancing program debugging and understanding through an innovative visual tracing system. The system incorporates rule-based options and leverages large language models (LLMs) to dynamically adapt to user interactions and specific needs. It provides intuitive visual feedback through animations of various data structures, such as arrays, trees, and graphs, making the debugging process more engaging and informative.

## Project Overview

The Smart Adaptive Visual Tracing system analyzes code execution in real-time, tracks changes in data structures, and visualizes them in the most appropriate format to enhance understanding. By integrating rule-based logic with Mistral AI's capabilities, the system offers customized tracing options that cater to different programming scenarios, making it particularly effective for complex software environments.

## System Architecture

The project consists of three main components that work together:

### 1. MCP Server
The MCP server (Model Context Protocol) is responsible for:
- Analyzing submitted code snippets
- Tracking changes in arrays, trees, and graphs during execution
- Identifying when data structures are created, modified, or accessed
- Generating execution data with detailed context
- Providing a powerful tracing system for code analysis

The server uses Python's introspection capabilities to monitor code execution and capture data structure transformations.

### 2. MCP Client & Flask Server
The MCP client connects to the MCP server and handles:
- Sending code snippets to the server for analysis
- Processing and filtering the resulting execution data
- Using Mistral AI to determine the most effective visualization type for each data structure
- Storing processed data in Redis for efficient access
- Providing a Flask server with RESTful API endpoints for the frontend

The client makes intelligent decisions about how to visualize different data structures based on their characteristics, complexity, and change patterns.

### 3. React Frontend
The frontend provides:
- A code input interface for submitting snippets
- Interactive visualizations of arrays, trees, and graphs
- Animation controls for stepping through code execution
- Contextual information about operations being performed
- Three specialized visualizers with multiple visualization types:
  - **ArrayVisualizer**: Timeline array, element-focused, and array comparison views
  - **TreeVisualizer**: Hierarchical and radial tree visualizations
  - **GraphVisualizer**: Force-directed and adjacency matrix representations

The frontend uses D3.js to create detailed, interactive visualizations that adapt to the specific data structures being analyzed.

## Requirements

- **Python**: 3.13.2 (recommended)
- **Node.js**: v22.14.0 (recommended)
- **Redis**: Latest version
- **Mistral AI**: API key required
- **Modern web browser**: Chrome, Firefox, or Edge recommended

## Detailed Setup Instructions

Follow these step-by-step instructions to set up and run the project:

### Step 1: MCP Server Setup

1. Open a terminal and navigate to the MCP server directory:
   ```bash
   cd mcp-server
   ```

2. Create a virtual environment:
   - On macOS/Linux:
     ```bash
     python -m venv .venv
     source .venv/bin/activate
     ```
   - On Windows:
     ```bash
     python -m venv .venv
     .\.venv\Scripts\activate
     ```

3. Install required dependencies:
   ```bash
   pip install --no-cache-dir mcp
   pip install "mcp[cli]"
   ```

   > **Note**: The `mcp[cli]` package installs additional command-line interface utilities for MCP. It includes debugging, logging, and management tools that help you interact with the MCP server efficiently. This is useful for running, testing, and managing MCP tools without writing extra code.

4. Start the MCP server:
   ```bash
   python server.py
   ```

   The server should start and display a message indicating it's ready to receive connections.

### Step 2: MCP Client & Flask Server Setup

1. Open a new terminal window and navigate to the MCP client directory:
   ```bash
   cd mcp-client
   ```

2. Create a virtual environment:
   - On macOS/Linux:
     ```bash
     python -m venv .venv
     source .venv/bin/activate
     ```
   - On Windows:
     ```bash
     python -m venv .venv
     .\.venv\Scripts\activate
     ```

3. Install required dependencies:
   ```bash
   pip install --no-cache-dir mcp
   pip install --no-cache-dir python-dotenv
   pip install "mistralai==0.0.8"
   pip install redis
   pip install flask flask-cors python-dotenv
   ```

   > **Dependencies explained**:
   > - `mcp`: Provides the Model Context Protocol client functionality
   > - `python-dotenv`: Enables loading environment variables from a .env file
   > - `mistralai`: The Mistral AI client for determining optimal visualization types
   > - `redis`: Client for the Redis in-memory database used to store execution data
   > - `flask` and `flask-cors`: For creating the API server that connects to the frontend

4. Create a `.env` file with your Mistral AI API key:
   ```bash
   echo "MISTRAL_API_KEY=your_api_key_here" > .env
   ```
   
   **⚠️ Important**: Replace `your_api_key_here` with your actual Mistral AI API key. This step is crucial for the visualization selection to work properly.

5. Install and start Redis (if not already running):
   - On macOS (using Homebrew):
     ```bash
     brew install redis
     brew services start redis
     ```
   - On Windows:
     - Download the Redis installer from https://github.com/microsoftarchive/redis/releases
     - Or use Windows Subsystem for Linux (WSL) to run Redis
     - Or use Docker: `docker run -p 6379:6379 -d redis`

6. Optional: Test the data processing by running:
   ```bash
   python client.py
   ```
   
   This will process the example code snippets in the `main()` function of client.py. You can modify this function to test different code snippets.

7. To inspect the processed data in Redis:
   ```bash
   redis-cli
   ```
   
   Then at the Redis prompt:
   ```
   GET arrays
   GET trees
   GET graphs
   ```

8. Start the Flask server:
   ```bash
   python simple_server.py
   ```
   
   The server should start on port 8000 and be ready to handle requests from the frontend.

### Step 3: Frontend Setup

1. Open a new terminal window and navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

   The frontend should open automatically in your default browser at http://localhost:3000.

## System Usage

Once all components are running:

1. Enter your Python code in the code input panel
2. Click "Analyze Code" to submit it for processing
3. Navigate between the Arrays, Trees, and Graphs tabs to see different visualizations
4. Use the playback controls to step through the execution
5. Hover over elements for additional information
6. Observe the operation details to understand what code caused each change

## Troubleshooting

### MCP Server Issues
- Ensure you're using Python 3.13.2 or compatible version
- Check that the MCP package is installed correctly
- Verify the server is running before starting the client

### MCP Client Issues
- Ensure your Mistral API key is correct in the .env file
- Verify Redis is running with `redis-cli ping` (should return "PONG")
- Check for error messages in the client terminal

### Frontend Issues
- Make sure all dependencies are installed with `npm install`
- Verify the Flask server is running on port 8000
- Check the browser console for any error messages

## Project Components in Detail

### MCP Server (server.py)
The server uses Python's `sys.settrace` to hook into code execution and track data structures in real-time. It includes:
- DataStructureTracker class for detecting and serializing different data structures
- Filtering mechanisms to focus on relevant variables
- Change detection to identify significant updates
- JSON formatting for cross-component communication

### MCP Client (client.py)
The client processes execution data and uses Mistral AI to make intelligent visualization decisions:
- Connects to MCP server to send code and receive execution data
- Filters and reconstructs data structure states for clear visualization
- Uses Mistral AI to select the best visualization type based on data characteristics
- Stores processed data in Redis for efficient access by the Flask server

### Flask Server (simple_server.py)
Provides RESTful API endpoints for the frontend:
- `/api/analyze` - Submits code to the MCP server
- `/api/data/<data_type>` - Retrieves processed data from Redis
- `/api/visualization/<data_type>` - Gets visualization selections
- `/api/execution_data` - Retrieves all execution data for the dashboard

### React Frontend
Organized into specialized visualizers:
- **ArrayVisualizer**: Shows array operations with timeline, element-focused, or comparison views
- **TreeVisualizer**: Displays tree structures with hierarchical or radial layouts
- **GraphVisualizer**: Represents graphs using force-directed or adjacency matrix approaches

Each visualizer includes:
- Interactive D3.js visualizations
- Animation controls for stepping through execution
- Color-coding to highlight changes
- Tooltips with detailed information
- Operation context showing the code responsible for each change

## License

This project is part of a bachelor thesis and is available for educational purposes.

## Acknowledgments

This project uses several open-source libraries and tools:
- MCP (Model Context Protocol) for code analysis
- D3.js for data visualization
- React for frontend development
- Flask for API development
- Redis for data storage
- Mistral AI for intelligent visualization selection