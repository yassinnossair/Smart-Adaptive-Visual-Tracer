# Smart Adaptive Visual Tracer

This system enhances program debugging and understanding through an innovative visual tracing system that incorporates rule-based options and leverages large language models (LLMs). It dynamically adapts to the user's interactions and specific needs, providing intuitive visual feedback through animations of various data structures, such as arrays, trees, and graphs.

## Components

1. **MCP Server**: Analyzes code and tracks data structure changes
2. **MCP Client**: Processes data and determines optimal visualization types using Mistral AI
3. **Frontend**: React-based UI that provides interactive visualizations with D3.js

## Setup

See the README files in each component's directory for specific setup instructions.

## Requirements

- Python 3.9+
- Node.js 16+
- Redis server
- Mistral AI API key