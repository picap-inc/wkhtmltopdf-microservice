#!/bin/bash

# Set up virtual display for wkhtmltopdf
export DISPLAY=:99
Xvfb :99 -screen 0 1024x768x24 -ac > /dev/null 2>&1 &
XVFB_PID=$!

# Wait a moment for Xvfb to start
sleep 2

# Function to handle shutdown
shutdown_handler() {
    echo "Shutting down..."
    kill $NODE_PID 2>/dev/null
    kill $XVFB_PID 2>/dev/null
    wait $NODE_PID 2>/dev/null
    wait $XVFB_PID 2>/dev/null
    echo "Service stopped"
    exit 0
}

# Set up signal handlers
trap shutdown_handler SIGTERM SIGINT

# Start the Node.js application
npm start &
NODE_PID=$!

# Wait for the Node.js process
wait $NODE_PID 