#!/bin/bash

# Setup test data for brainflow2 development

echo "🧪 Setting up test data for Brainflow2"
echo "======================================"
echo ""

# Check if test-data directory exists
if [ ! -d "test-data" ]; then
    echo "❌ Error: test-data directory not found!"
    echo "Please run this script from the brainflow2 root directory"
    exit 1
fi

# Check for the test NIfTI file
TEST_FILE="test-data/unit/toy_t1w.nii.gz"
if [ -f "$TEST_FILE" ]; then
    echo "✅ Test NIfTI file found: $TEST_FILE"
    echo "   Size: $(ls -lh "$TEST_FILE" | awk '{print $5}')"
else
    echo "⚠️  Test NIfTI file not found: $TEST_FILE"
    echo ""
    echo "You can create a test file using the Python script:"
    echo "  python create_toy_nifti.py"
fi

echo ""
echo "📁 Test data structure:"
tree test-data -L 3 2>/dev/null || ls -la test-data/

echo ""
echo "🔍 Available test files:"
find test-data -name "*.nii" -o -name "*.nii.gz" -o -name "*.gii" -o -name "*.gii.gz" | while read -r file; do
    echo "   - $file ($(ls -lh "$file" | awk '{print $5}'))"
done

echo ""
echo "📝 Quick test commands:"
echo ""
echo "1. Test with cargo (Rust):"
echo "   cd core/api_bridge && cargo test"
echo ""
echo "2. Test with UI (TypeScript):"
echo "   cd ui && pnpm test:unit"
echo ""
echo "3. Test with Tauri dev:"
echo "   cargo tauri dev"
echo "   # Then in browser console:"
echo "   await window.__TAURI__.core.invoke('plugin:api-bridge|load_file', {path: '$(pwd)/$TEST_FILE'})"
echo ""
echo "4. Use the test scripts:"
echo "   ./tools/test-bridge.js"
echo "   ./tools/dev-watch.sh"
echo "   ./tools/test-command.sh load_file"
echo ""
echo "✨ Test data setup complete!"