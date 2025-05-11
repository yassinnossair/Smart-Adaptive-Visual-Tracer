import os
from app import create_app # Import the application factory

# Create an application instance using the factory
# The create_app function in app/__init__.py handles loading .env
# so MISTRAL_API_KEY should be available to the app context.
app = create_app()

if __name__ == '__main__':
    # Get host and port from environment variables or use defaults
    # This allows for more flexibility, e.g., when deploying.
    host = os.environ.get('FLASK_RUN_HOST', '127.0.0.1') # Default to localhost
    port = int(os.environ.get('FLASK_RUN_PORT', 8000))   # Default to port 8000
    
    # Debug mode can also be controlled by an environment variable
    # FLASK_DEBUG=1 (for True) or 0 (for False)
    # Flask's app.run() automatically picks up FLASK_DEBUG if set.
    # If not set, debug=True is a good default for development.
    debug_mode = os.environ.get('FLASK_DEBUG', '1') == '1'

    print(f"Starting Visual Tracer Backend on http://{host}:{port}/")
    print(f"Debug mode: {'on' if debug_mode else 'off'}")
    
    # Run the Flask development server
    # use_reloader=False can be helpful if you experience issues with
    # the reloader causing multiple initializations, especially with sys.settrace.
    # However, for typical development, the reloader is useful.
    # Let's keep it default (True) unless issues arise.
    app.run(host=host, port=port, debug=debug_mode)

