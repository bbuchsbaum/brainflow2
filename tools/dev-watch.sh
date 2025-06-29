#!/bin/bash

# Development watch script for fast iteration
# Watches for changes in Rust code and automatically runs tests

echo "🔍 Brainflow Development Watch Script"
echo "====================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if cargo-watch is installed
if ! command -v cargo-watch &> /dev/null; then
    echo -e "${YELLOW}cargo-watch not found. Installing...${NC}"
    cargo install cargo-watch
fi

# Function to run tests
run_tests() {
    echo -e "\n${YELLOW}Running API bridge tests...${NC}"
    cd core/api_bridge
    cargo test --quiet 2>&1 | while IFS= read -r line; do
        if [[ $line == *"FAILED"* ]]; then
            echo -e "${RED}$line${NC}"
        elif [[ $line == *"passed"* ]]; then
            echo -e "${GREEN}$line${NC}"
        else
            echo "$line"
        fi
    done
    cd ../..
}

# Function to check compilation
check_compilation() {
    echo -e "\n${YELLOW}Checking compilation...${NC}"
    cargo check -p api_bridge 2>&1 | while IFS= read -r line; do
        if [[ $line == *"error"* ]]; then
            echo -e "${RED}$line${NC}"
        elif [[ $line == *"warning"* ]]; then
            echo -e "${YELLOW}$line${NC}"
        else
            echo "$line"
        fi
    done
}

# Main watch loop
echo "Watching for changes in:"
echo "  - core/api_bridge/src/"
echo "  - core/bridge_types/src/"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Initial run
check_compilation
run_tests

# Watch for changes
cargo-watch -w core/api_bridge/src -w core/bridge_types/src -s 'bash -c "
    clear
    echo \"🔄 Changes detected, recompiling...\"
    echo \"\"
    
    # Check compilation
    if cargo check -p api_bridge 2>&1 | grep -q \"error\"; then
        echo \"❌ Compilation failed!\"
        cargo check -p api_bridge
    else
        echo \"✅ Compilation successful!\"
        
        # Run tests
        echo \"\"
        echo \"🧪 Running tests...\"
        cd core/api_bridge
        if cargo test --quiet; then
            echo \"✅ All tests passed!\"
        else
            echo \"❌ Some tests failed!\"
            cargo test
        fi
        cd ../..
    fi
    
    echo \"\"
    echo \"⏳ Waiting for changes...\"
"'