#!/bin/bash

# Setup script for Brainflow2 E2E tests

echo "🚀 Setting up Brainflow2 E2E testing environment..."

# Check if we're in the e2e directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the e2e directory"
    exit 1
fi

# Install dependencies
echo "📦 Installing E2E test dependencies..."
npm install

# Install Playwright browsers
echo "🌐 Installing Playwright browsers..."
npx playwright install

# Create directories
echo "📁 Creating test directories..."
mkdir -p screenshots
mkdir -p test-results
mkdir -p test-reports

# Check if test data exists
if [ ! -d "../test-data/unit/toy_t1w.nii.gz" ]; then
    echo "⚠️  Warning: Test data not found at ../test-data/unit/toy_t1w.nii.gz"
    echo "   Make sure test volumes are available before running tests"
fi

# Make the script executable
chmod +x run-e2e.sh

echo "✅ E2E setup complete!"
echo ""
echo "To run tests:"
echo "  ./run-e2e.sh          # Run all tests"
echo "  ./run-e2e.sh --ui     # Run with interactive UI"
echo "  ./run-e2e.sh --debug  # Run in debug mode"