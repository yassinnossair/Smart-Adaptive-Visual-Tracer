import React, { useState, useEffect } from 'react';
import { Form, Button, Alert, Spinner, Row, Col } from 'react-bootstrap';
import axios from 'axios';
import './CodeInput.css';

function CodeInput({ onAnalysisComplete }) {
  const initialCode = `# Example with array, tree, and graph data structures

# Array operations
elements = [5, 10, 15, 20, 25]
elements[2] = 99  # Update middle element
elements.append(30)  # Add to end
elements.insert(0, 1)  # Insert at beginning
elements.pop(3)  # Remove an element
elements[1] = elements[1] + elements[2]  # Combined operation

# Tree creation and operations
class TreeNode:
    def __init__(self, value):
        self.value = value
        self.left = None
        self.right = None

root = TreeNode(10)
root.left = TreeNode(5)
root.right = TreeNode(15)
root.left.left = TreeNode(3)
root.left.right = TreeNode(7)
root.right.left = TreeNode(12)

# Graph operations
graph = {
    'A': ['B', 'C'],
    'B': ['D'],
    'C': ['D', 'E'],
    'D': [],
    'E': ['A']
}

# Add a new edge
graph['D'].append('E')
`;

  const [code, setCode] = useState(initialCode);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Handle input changes
  const handleCodeChange = (e) => {
    setCode(e.target.value);
    // Clear any previous messages when code is changed
    setError(null);
    setSuccessMessage(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      console.log("Sending code to API:", code);
      const response = await axios.post('http://localhost:8000/api/analyze', { 
        code 
      });
      
      console.log("API response:", response.data);
      if (response.data.status === 'success') {
        setSuccessMessage("Code analysis complete!");
        onAnalysisComplete();
        // Store the successful code in localStorage for persistence
        localStorage.setItem('lastAnalyzedCode', code);
      }
    } catch (error) {
      console.error("API error:", error);
      if (error.response) {
        console.error("Error response data:", error.response.data);
        console.error("Error response status:", error.response.status);
      } else if (error.request) {
        console.error("Error request:", error.request);
      } else {
        console.error("Error message:", error.message);
      }
      setError(error.response?.data?.error || 'Error analyzing code: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Reset to example code
  const handleReset = () => {
    setCode(initialCode);
    setError(null);
    setSuccessMessage(null);
  };

  // Load previously analyzed code on component mount
  useEffect(() => {
    const savedCode = localStorage.getItem('lastAnalyzedCode');
    if (savedCode) {
      setCode(savedCode);
    }
  }, []);

  return (
    <div className="code-input-wrapper">
      <Form onSubmit={handleSubmit}>
        <Form.Group className="mb-3">
          <Form.Label className="code-input-label">
            Enter Python Code with Arrays, Trees, and Graphs
          </Form.Label>
          <Form.Control
            as="textarea"
            rows={25}
            value={code}
            onChange={handleCodeChange}
            className="code-editor"
            placeholder="Enter your Python code here..."
          />
          <Form.Text className="code-help-text">
            Your code should contain array, tree, or graph data structures for visualization.
          </Form.Text>
        </Form.Group>
        
        {error && (
          <Alert variant="danger" className="error-alert">
            <Alert.Heading>Analysis Error</Alert.Heading>
            <p>{error}</p>
          </Alert>
        )}
        
        {successMessage && (
          <Alert variant="success" className="success-alert">
            <Alert.Heading>Success!</Alert.Heading>
            <p>{successMessage}</p>
          </Alert>
        )}
        
        <Row className="mt-4">
          <Col className="d-flex justify-content-between">
            <Button 
              variant="outline-secondary" 
              onClick={handleReset}
              disabled={isLoading}
              className="reset-button"
            >
              Reset to Example
            </Button>
            
            <Button 
              variant="primary" 
              type="submit" 
              disabled={isLoading}
              className="analyze-button"
            >
              {isLoading ? (
                <>
                  <Spinner
                    as="span"
                    animation="border"
                    size="sm"
                    role="status"
                    aria-hidden="true"
                    className="me-2"
                  />
                  Analyzing...
                </>
              ) : (
                <>Analyze Code</>
              )}
            </Button>
          </Col>
        </Row>
      </Form>
    </div>
  );
}

export default CodeInput;