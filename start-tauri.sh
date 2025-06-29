#!/bin/bash

# Start Tauri in development mode asynchronously

echo "🚀 Starting Tauri app in background..."

# Kill any existing instances
pkill -f "cargo.*tauri.*dev" 2>/dev/null || true
pkill -f "target/debug/brainflow" 2>/dev/null || true

# Start Tauri in background
cd /Users/bbuchsbaum/code/brainflow2
nohup cargo tauri dev > tauri.log 2>&1 &
TAURI_PID=$!

echo "✅ Tauri started with PID: $TAURI_PID"
echo "📋 Logs are being written to: tauri.log"
echo ""
echo "To monitor logs: tail -f tauri.log"
echo "To stop: kill $TAURI_PID"

# Wait a bit for the server to start
sleep 5

# Check if it's running
if ps -p $TAURI_PID > /dev/null; then
    echo "✅ Tauri is running!"
    echo ""
    echo "The app should open automatically. If not, check http://localhost:5173"
else
    echo "❌ Tauri failed to start. Check tauri.log for errors."
fi