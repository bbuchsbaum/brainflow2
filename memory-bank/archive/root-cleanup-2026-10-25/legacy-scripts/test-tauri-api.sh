#!/bin/bash

# Automated Tauri API testing script
# This script launches the app and runs tests automatically

echo "🚀 Starting Tauri API automated test..."

# Kill any existing instances
pkill -f "cargo.*tauri.*dev" 2>/dev/null || true
pkill -f "brainflow" 2>/dev/null || true

# Start the Tauri app in the background
echo "📦 Building and launching Tauri app..."
cd /Users/bbuchsbaum/code/brainflow2
cargo tauri dev &
TAURI_PID=$!

# Wait for the app to start (UI server on port 5173)
echo "⏳ Waiting for app to start..."
for i in {1..30}; do
    if curl -s http://localhost:5173 > /dev/null; then
        echo "✅ App is running!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Timeout waiting for app to start"
        kill $TAURI_PID 2>/dev/null
        exit 1
    fi
    sleep 1
done

# Give it a moment to fully initialize
sleep 2

# Open the test page in the default browser
echo "🧪 Opening test page..."
open "http://localhost:5173/api-test"

# Wait for user to check results or timeout after 30 seconds
echo "⏱️  Tests are running in the browser. Check the page for results."
echo "Press Ctrl+C to stop the app when done."

# Keep the script running
wait $TAURI_PID