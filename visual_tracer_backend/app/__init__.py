# visual_tracer_backend/app/__init__.py

import os
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

def create_app(config_name=None):
    """
    Flask application factory.
    """
    # Load environment variables from .env file
    # This should be called as early as possible
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    if os.path.exists(env_path):
        load_dotenv(dotenv_path=env_path)
        print(f"Loaded .env file from: {env_path}")
    else:
        print(f"Warning: .env file not found at {env_path}. MISTRAL_API_KEY might not be set.")

    app = Flask(__name__)

    # Configuration
    # In a larger app, you might load from a config file or environment variables
    # For now, we'll set CORS directly.
    # The static_folder argument in Flask(__name__, static_folder='path/to/react/build')
    # will be handled in routes.py when defining the catch-all route for serving React.
    # If your React build output is outside this Flask app's directory,
    # you'd adjust the static_folder path here or in routes.py.
    # Given the frontend is separate, the Flask app primarily serves as an API.
    # However, to keep the simple_server.py functionality, static serving will be setup in routes.py.

    # Initialize CORS
    CORS(app, resources={r"/api/*": {"origins": "*"}}) # Allow all origins for API routes

    # --- Import and Register Blueprints/Routes ---
    # We will define routes directly in routes.py and import them here
    # to associate them with the app.
    # Alternatively, for larger apps, Flask Blueprints are used.
    # For simplicity now, we'll directly import and register.

    with app.app_context():
        # Import parts of our application
        from . import routes # Import routes
        # You could also initialize other extensions here if needed

        # Example: If you had a database
        # from . import db
        # db.init_app(app)

        # Placeholder for where you might initialize other services if they needed app context
        # For example, loading the Mistral client can be done here or in llm_handler.py
        # We'll initialize it in llm_handler.py as it's specific to that module's function.

    # Simple test route to ensure app is running (can be removed later)
    @app.route('/hello')
    def hello():
        return "Hello from the Visual Tracer Backend!"

    return app