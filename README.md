# Smart Adaptive Visual Tracer

This project is part of a bachelor thesis focused on enhancing program debugging and understanding through an innovative visual tracing system. The system incorporates rule-based options and leverages large language models (LLMs) to dynamically adapt to user interactions and specific needs. It provides intuitive visual feedback through animations of various data structures, such as arrays, trees, and graphs, making the debugging process more engaging and informative.

## Project Overview

The Smart Adaptive Visual Tracer system analyzes Python code execution in real-time, tracks changes in fundamental data structures (arrays, trees, graphs), and selects appropriate visualization techniques to enhance program comprehension and debugging. By integrating deterministic code tracing via the Model Context Protocol (MCP) with the analytical capabilities of Mistral AI for visualization selection, the system offers customized tracing options adaptable to different programming scenarios, proving particularly effective for understanding complex software environments.

## System Architecture

The project consists of three main components that work together, leveraging the Model Context Protocol (MCP) for standardized communication between the core analysis engine and the application backend:

### 1. MCP Server (server.py)
Role: This component acts as a dedicated, specialized MCP Server. Its sole responsibility is to perform the complex and potentially high-risk task of executing submitted Python code snippets within a controlled tracing environment.

Functionality:
- Receives Python code snippets via the MCP call_tool mechanism
- Utilizes Python's sys.settrace function to intercept execution events (line execution, function calls, returns).
- Identifies and tracks the state changes of fundamental data structures (lists identified as arrays, specific object patterns identified as trees, dictionary patterns identified as graphs) during the code's execution.
- Records a detailed history of operations (creation, modification, access) performed on these tracked data structures.
- Serializes the captured trace data, including data structure states and operation details, into a structured JSON format.
- Returns this structured JSON trace data as the result of the analyze_code tool invocation via the MCP protocol

MCP Interaction: Exposes a single MCP tool named analyze_code. It listens for incoming MCP client connections (via stdio) and responds to call_tool requests for analyze_code

### 2. MCP Client & Flask Server
Role: This component acts as the central MCP Host application. It orchestrates the overall workflow, manages communication with both the MCP Server and the frontend, and integrates the LLM for downstream analysis

Functionality:
- Flask Server (simple_server.py): Provides RESTful API endpoints for the React frontend to submit code and retrieve analysis results and visualization recommendations.
- MCP Client Logic (client.py)
   - Instantiates and manages the connection to the MCP Server using the MCP Python SDK (ClientSession, StdioServerParameters). This establishes the standardized communication channel defined by MCP. 
   - Programmatic Tool Invocation: Upon receiving a request from the Flask API, this component programmatically invokes the analyze_code tool on the MCP Server. It explicitly calls session.call_tool("analyze_code", {"code_snippet":...}). The decision to call this specific tool is driven by the application logic, not by an LLM
   - Receives the structured JSON trace data from the MCP Server via the MCP response.
   - Performs initial filtering and processing on the raw trace data to prepare it for visualization and LLM analysis.
   - LLM Integration (Downstream): Sends the processed trace data for each structure type (arrays, trees, graphs) to the Mistral AI LLM. The LLM's task here is not tool selection, but rather analyzing the trace data to determine the most effective visualization technique (e.g., Timeline Array vs. Element Focused).
   - Stores the processed trace data and the LLM's visualization recommendations in Redis for efficient retrieval by the Flask API endpoints.
   - Redis acts as an in-memory data store for caching processed trace data and LLM visualization recommendations, facilitating fast retrieval by the Flask API for the frontend

MCP Interaction: Acts as the MCP Host containing the MCP Client logic. It initiates the connection to the MCP Server and explicitly calls the analyze_code tool based on application requirements

### 3. React Frontend
Role: Provides the user interface for code input, interaction, and visualization.

Functionality:
- A code input interface for submitting snippets
- Communicates with the Flask backend via REST API calls to submit code (/api/analyze) and fetch processed data and visualization recommendations (/api/execution_data, /api/visualization/...).
- Renders interactive visualizations of arrays, trees, and graphs based on the data received and the visualization type recommended by the LLM.
- Uses D3.js to create detailed, animated visualizations (e.g., Timeline Array, Element Focused, Hierarchical Tree, Radial Tree, Force-Directed Graph, Adjacency Matrix).
- Provides playback controls (play, pause, step) to allow users to step through the execution trace and observe data structure changes over time.
- Displays contextual information about operations being performed at each step.
- Three specialized visualizers with multiple visualization types:
  - **ArrayVisualizer**: Timeline array, element-focused, and array comparison views
  - **TreeVisualizer**: Hierarchical and radial tree visualizations
  - **GraphVisualizer**: Force-directed and adjacency matrix representations

The frontend uses D3.js to create detailed, interactive visualizations that adapt to the specific data structures being analyzed.

## Model Context Protocol (MCP) Implementation Approach
This project utilizes the Model Context Protocol (MCP) , an open standard developed by Anthropic , but employs a specific implementation pattern tailored to the system's requirements and constraints. Understanding this pattern is crucial for appreciating the system's architecture and design choices

MCP's Role in this System:
In this project, MCP serves exclusively as a standardized communication protocol  between the Flask application (acting as the MCP Host/Client) and the dedicated Python code tracing engine (acting as the MCP Server). It defines the rules and message formats (JSON-RPC 2.0)  for how the Flask backend reliably requests code analysis from the tracing server and receives the structured results. We leverage the official MCP Python SDK  to ensure compliance with the protocol standard

Contrast with Dynamic LLM-Driven Tool Selection:
A common and powerful pattern for MCP involves using the LLM itself to dynamically select which tool(s) to call based on user input or conversation context. In that pattern:   
- User provides input to the Host application.
- The Host sends the input to the LLM.
- The LLM analyzes the input, consults available MCP tool descriptions (via list_tools), and decides which tool(s) to invoke and with what parameters.
- The Host instructs its MCP Client to execute the LLM's chosen tool call(s) via the MCP protocol.
- Results are returned to the Host and potentially back to the LLM for synthesizing a final response.

This project intentionally deviates from the dynamic pattern. Here:
- The Flask Host receives a specific request (analyze code).
- The Host's application logic determines that the only relevant tool is analyze_code.
- The Host programmatically instructs its MCP Client to call analyze_code on the MCP Server.
- The trace data result is returned via MCP to the Host.
- Only then is the LLM involved, analyzing the result of the tool call (the trace data) for the distinct purpose of selecting a visualization type.

Justification for Programmatic Invocation:
Choosing programmatic invocation over dynamic LLM selection for the analyze_code tool was a deliberate design decision based on several factors critical to this thesis project:

- Enhanced Safety and Control: The core function of the MCP Server involves executing arbitrary Python code provided by the user/client via sys.settrace and exec(). This is an inherently high-risk operation. Allowing an LLM to dynamically decide when to trigger this execution and what code to pass introduces significant security vulnerabilities, such as prompt injection attacks leading to malicious code execution. Programmatic invocation ensures that the Flask Host maintains full control over when the analyze_code tool is called and exactly what code snippet is passed, drastically reducing the attack surface and aligning with MCP's security principle of treating executable tools with caution.   

- Task Specificity: The system's goal regarding MCP interaction is singular and unambiguous: obtain execution trace data for a given code snippet. The analyze_code tool is the only tool required for this specific, well-defined task. Implementing dynamic LLM-based selection would add unnecessary complexity without providing functional benefits, as the choice of tool is predetermined by the application's workflow.

- Reliability and Predictability: Ensuring an LLM reliably identifies the correct code snippet (especially within a larger context) and correctly formats parameters for a complex tracing tool can be challenging. Programmatic control guarantees that the intended code is analyzed and parameters are handled precisely, leading to more predictable and reliable tracing results.

- Clear Separation of Concerns: This architecture creates a clean separation:
MCP Server: Handles the specialized, high-risk task of code execution and tracing.
Flask Host/MCP Client: Manages the application workflow, controls the invocation of the specific tracing tool via the standardized MCP interface, and prepares data.
LLM: Focuses on a distinct, higher-level task – analyzing the structured trace data to make an informed decision about visualization, leveraging its strengths in pattern recognition and analysis without being exposed to the risks of direct code execution control.

- Focus on Core Thesis Contribution: This approach allows the thesis to focus on the novel aspects of adaptive visualization and LLM-driven analysis of trace results, while still correctly utilizing MCP for its primary benefit: standardizing the communication channel to a specialized backend service. It demonstrates a practical understanding and application of the MCP standard for interoperability without requiring the implementation of complex (and in this case, risky and unnecessary) agentic tool-selection logic.

In summary, while MCP enables powerful dynamic agentic behavior, this project leverages it strategically for its core strength – standardized communication – within a controlled, programmatic workflow that prioritizes safety, reliability, and architectural clarity for the specific task of visual code tracing.

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

   The server should start and the terminal will hang indicating it's ready to receive connections.

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