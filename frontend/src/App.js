import React, { useState } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Container, Row, Col, Nav, Tab, Card } from 'react-bootstrap';
import CodeInput from './components/CodeInput';
import ArrayVisualizer from './components/ArrayVisualizer';
import TreeVisualizer from './components/TreeVisualizer';
import GraphVisualizer from './components/GraphVisualizer';
import './App.css';

function App() {
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [activeTab, setActiveTab] = useState("arrays");

  const handleAnalysisComplete = () => {
    setAnalysisComplete(true);
  };

  return (
    <div className="app-container">
      <Container fluid>
        <div className="header">
          <h1>Smart Adaptive Visual Tracer</h1>
          <p className="subtitle">Visualize and understand data structures in your code</p>
        </div>
        
        <Row className="main-content">
          {/* Left Column - Code Input */}
          <Col md={5} lg={4} className="code-input-column">
            <Card className="code-input-card h-100">
              <Card.Body>
                <CodeInput onAnalysisComplete={handleAnalysisComplete} />
              </Card.Body>
            </Card>
          </Col>
          
          {/* Right Column - Visualizations */}
          <Col md={7} lg={8} className="visualization-column">
            {analysisComplete ? (
              <Tab.Container 
                activeKey={activeTab} 
                onSelect={(key) => setActiveTab(key)}
                defaultActiveKey="arrays"
              >
                <Row>
                  <Col sm={12}>
                    <Nav variant="pills" className="visualization-tabs">
                      <Nav.Item>
                        <Nav.Link eventKey="arrays">Arrays</Nav.Link>
                      </Nav.Item>
                      <Nav.Item>
                        <Nav.Link eventKey="trees">Trees</Nav.Link>
                      </Nav.Item>
                      <Nav.Item>
                        <Nav.Link eventKey="graphs">Graphs</Nav.Link>
                      </Nav.Item>
                    </Nav>
                  </Col>
                  <Col sm={12}>
                    <Card className="visualization-card">
                      <Card.Body>
                        <Tab.Content>
                          <Tab.Pane eventKey="arrays">
                            <h3 className="visualization-title">Array Visualization</h3>
                            <ArrayVisualizer />
                          </Tab.Pane>
                          <Tab.Pane eventKey="trees">
                            <h3 className="visualization-title">Tree Visualization</h3>
                            <TreeVisualizer />
                          </Tab.Pane>
                          <Tab.Pane eventKey="graphs">
                            <h3 className="visualization-title">Graph Visualization</h3>
                            <GraphVisualizer />
                          </Tab.Pane>
                        </Tab.Content>
                      </Card.Body>
                    </Card>
                  </Col>
                </Row>
              </Tab.Container>
            ) : (
              <Card className="visualization-placeholder-card h-100">
                <Card.Body className="d-flex align-items-center justify-content-center">
                  <div className="text-center text-muted">
                    <h4>No Visualization Available</h4>
                    <p>Submit your code to visualize data structures</p>
                  </div>
                </Card.Body>
              </Card>
            )}
          </Col>
        </Row>

        <footer className="app-footer">
          <p>Smart Adaptive Visual Tracer &copy; {new Date().getFullYear()}</p>
        </footer>
      </Container>
    </div>
  );
}

export default App;