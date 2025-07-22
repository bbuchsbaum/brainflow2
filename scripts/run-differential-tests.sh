#!/bin/bash
# Script to run CPU/GPU differential tests locally

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
TEST_FILTER=""
VERBOSE=false
SAVE_IMAGES=false
BENCHMARK=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--filter)
            TEST_FILTER="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -i|--save-images)
            SAVE_IMAGES=true
            shift
            ;;
        -b|--benchmark)
            BENCHMARK=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -f, --filter PATTERN    Filter tests by pattern"
            echo "  -v, --verbose          Enable verbose output"
            echo "  -i, --save-images      Save debug images on failure"
            echo "  -b, --benchmark        Run performance benchmarks"
            echo "  -h, --help            Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo -e "${GREEN}=== CPU/GPU Differential Testing ===${NC}"
echo ""

# Set environment variables
if [ "$VERBOSE" = true ]; then
    export RUST_BACKTRACE=1
    export NEURO_DEBUG_DIFF=1
fi

if [ "$SAVE_IMAGES" = true ]; then
    export NEURO_SAVE_DEBUG_IMAGES=1
    mkdir -p debug_images
fi

# Build the test crates
echo -e "${YELLOW}Building test crates...${NC}"
cargo build --package neuro-types --release
cargo build --package neuro-cpu --release
cargo build --package neuro-integration-tests --release

# Run unit tests first
echo -e "${YELLOW}Running unit tests...${NC}"
cargo test --package neuro-types --release --quiet
cargo test --package neuro-cpu --release --quiet

# Run differential tests
echo -e "${YELLOW}Running differential tests...${NC}"
if [ -n "$TEST_FILTER" ]; then
    echo "Filter: $TEST_FILTER"
    cargo test --package neuro-integration-tests --release -- "$TEST_FILTER"
else
    cargo test --package neuro-integration-tests --release
fi

# Run benchmarks if requested
if [ "$BENCHMARK" = true ]; then
    echo -e "${YELLOW}Running performance benchmarks...${NC}"
    cargo bench --package neuro-integration-tests --bench performance_comparison
    
    # Show benchmark summary
    echo -e "${GREEN}Benchmark results saved to: target/criterion${NC}"
fi

echo ""
echo -e "${GREEN}Differential testing complete!${NC}"

# Check if debug images were saved
if [ "$SAVE_IMAGES" = true ] && [ -d debug_images ] && [ "$(ls -A debug_images)" ]; then
    echo -e "${YELLOW}Debug images saved to: debug_images/${NC}"
fi