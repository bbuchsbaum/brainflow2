#!/bin/bash

echo "=== Brainflow Plugin Verify Debug Script ==="
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Current directory: $(pwd)"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "❌ node_modules not found. Running pnpm install..."
    pnpm install
fi

# Rebuild
echo "🔨 Building CLI..."
pnpm run build

# Test with debug mode
echo ""
echo "🧪 Testing CLI with debug mode enabled..."
echo "Command: DEBUG=1 node ./dist/cli.js test-manifest.json"
echo ""

# Create a test manifest if it doesn't exist
if [ ! -f "test-manifest.json" ]; then
    echo "Creating test manifest..."
    cat > test-manifest.json << 'EOF'
{
  "id": "test-plugin",
  "name": "Test Plugin",
  "version": "1.0.0",
  "description": "A test plugin",
  "author": "Test Author",
  "email": "test@example.com",
  "entrypoint": "./index.js",
  "permissions": []
}
EOF
fi

# Run with debug
DEBUG=1 node ./dist/cli.js test-manifest.json 2>&1

echo ""
echo "=== End of debug output ==="