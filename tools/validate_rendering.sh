#!/bin/bash
# Manual validation script for rendering pipeline
# Run this to test if volumes are displaying correctly

echo "=== Brainflow2 Rendering Pipeline Validation ==="
echo ""
echo "This script will help validate that the rendering pipeline is working correctly."
echo ""

# Check if we're in the right directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: Please run this script from the brainflow2 root directory"
    exit 1
fi

# Build the project
echo "1. Building the project..."
cargo build -p api_bridge --release

# Run the integration tests
echo ""
echo "2. Running render validation tests..."
cargo test -p api_bridge render_validation_integration -- --nocapture

# Check if test data exists
echo ""
echo "3. Checking test data..."
if [ -f "test-data/unit/toy_t1w.nii.gz" ]; then
    echo "✓ Test data found: test-data/unit/toy_t1w.nii.gz"
else
    echo "✗ Test data not found. Please ensure test-data/unit/toy_t1w.nii.gz exists"
fi

echo ""
echo "4. To fully validate rendering:"
echo "   a) Run: cargo tauri dev"
echo "   b) Load test-data/unit/toy_t1w.nii.gz"
echo "   c) Check that all three views (Axial, Coronal, Sagittal) display correctly"
echo "   d) Test colormap switching"
echo "   e) Test opacity controls"
echo ""
echo "5. Check the logs for:"
echo "   - 'Successfully uploaded slice to GPU' messages"
echo "   - 'Texture coordinates' values"
echo "   - 'Frame rendered successfully' messages"
echo "   - 'First 4 pixels' values (should not all be [0,0,0,0])"
echo ""
echo "=== Validation Complete ==="