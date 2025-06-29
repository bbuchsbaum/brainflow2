#!/bin/bash

# E2E test runner for Brainflow2

echo "🧪 Running Brainflow2 E2E tests..."

# Parse command line arguments
ARGS=""
DEBUG=false
UI=false
UPDATE_SNAPSHOTS=false

for arg in "$@"; do
    case $arg in
        --debug)
            DEBUG=true
            ARGS="$ARGS --debug"
            shift
            ;;
        --ui)
            UI=true
            shift
            ;;
        --update-snapshots)
            UPDATE_SNAPSHOTS=true
            shift
            ;;
        *)
            ARGS="$ARGS $arg"
            ;;
    esac
done

# Set environment variables
export NODE_ENV=test
export PWDEBUG=$([[ "$DEBUG" == "true" ]] && echo "1" || echo "0")

# Clear previous test results
echo "🧹 Clearing previous test results..."
rm -rf test-results/*
rm -rf test-reports/*

# Make sure the app can be built
echo "🔨 Building Tauri app..."
cd ..
cargo build --release
if [ $? -ne 0 ]; then
    echo "❌ Failed to build Tauri app"
    exit 1
fi
cd e2e

# Run tests based on options
if [ "$UI" == "true" ]; then
    echo "🖥️  Running tests with UI..."
    npx playwright test --ui
elif [ "$UPDATE_SNAPSHOTS" == "true" ]; then
    echo "📸 Updating visual snapshots..."
    npx playwright test --update-snapshots
else
    echo "🏃 Running tests..."
    npx playwright test $ARGS
fi

# Show results
if [ -f "test-results/results.json" ]; then
    echo ""
    echo "📊 Test Results:"
    cat test-results/results.json | jq '.stats'
fi

# Generate report if tests completed
if [ -d "test-results" ] && [ "$(ls -A test-results)" ]; then
    echo ""
    echo "📝 Generating HTML report..."
    npx playwright show-report
fi