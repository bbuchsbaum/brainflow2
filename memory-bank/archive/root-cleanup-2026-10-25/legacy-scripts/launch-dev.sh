#!/bin/bash
set -e

echo "🚀 Launching Brainflow in development mode..."
echo

# Run pre-launch checks
./pre-launch-check.sh || exit 1

echo
echo "📦 Ensuring packages are up to date..."

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    pnpm install
fi

# Build API package if needed
if [ ! -d "packages/api/dist" ]; then
    echo "Building API package..."
    cd packages/api && pnpm run build && cd ../..
fi

echo
echo "🎯 Starting Tauri development server..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# Set some helpful environment variables
export RUST_LOG=info,brainflow=debug,render_loop=trace
export RUST_BACKTRACE=1

# Launch with better error handling
cargo tauri dev || {
    echo
    echo "❌ Launch failed!"
    echo
    echo "Common fixes:"
    echo "1. Run: ./build-all.sh"
    echo "2. Check the error messages above"
    echo "3. Ensure all dependencies are installed"
    echo "4. Check GPU drivers are up to date"
    exit 1
}