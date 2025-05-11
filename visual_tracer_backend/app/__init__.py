import os
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

def create_app(config_name=None):
    """
    Flask application factory.
    """
    # Load environment variables from .env file
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    if os.path.exists(env_path):
        load_dotenv(dotenv_path=env_path)
        print(f"Loaded .env file from: {env_path}")
    else:
        print(f"Warning: .env file not found at {env_path}. MISTRAL_API_KEY might not be set.")

    app = Flask(__name__)

    # Initialize CORS
    CORS(app, resources={r"/api/*": {"origins": "*"}}) # Allow all origins for API routes

    with app.app_context():
        # Import parts of our application
        from . import routes # Import routes
        

    return app