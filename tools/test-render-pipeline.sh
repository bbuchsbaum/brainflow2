#!/bin/bash
# Test the rendering pipeline without Tauri

set -e

echo "🧪 Testing Render Pipeline"
echo "========================="

# Change to project root
cd "$(dirname "$0")/.."

# Run render pipeline unit tests
echo ""
echo "📋 Running render pipeline integration tests..."
cargo test -p render_loop render_pipeline_integration_test -- --nocapture

# Run performance benchmarks if requested
if [ "$1" = "--bench" ]; then
    echo ""
    echo "⚡ Running performance benchmarks..."
    cargo test -p render_loop performance_benchmark_test -- --nocapture --test-threads=1
fi

# Build and run the test render binary
echo ""
echo "🎨 Building test render tool..."
cargo build -p render_loop --bin test_render --release

# Create output directory
mkdir -p test-output

# Test different patterns
echo ""
echo "🖼️  Rendering test patterns..."

patterns=("gradient" "sphere" "checkerboard" "cube" "noise")
colormaps=("0" "1" "2" "3")

for pattern in "${patterns[@]}"; do
    echo "  - Rendering $pattern pattern..."
    ./target/release/test_render \
        --pattern "$pattern" \
        --colormap 0 \
        --output test-output \
        --width 256 \
        --height 256
done

# Test different colormaps with sphere
echo ""
echo "🌈 Testing colormaps..."
for i in "${!colormaps[@]}"; do
    colormap="${colormaps[$i]}"
    names=("grayscale" "hot" "cool" "rainbow")
    echo "  - Rendering sphere with ${names[$i]} colormap..."
    ./target/release/test_render \
        --pattern sphere \
        --colormap "$colormap" \
        --output test-output \
        --width 256 \
        --height 256
    # Rename output files to include colormap name
    mv test-output/sphere_axial.png "test-output/sphere_axial_${names[$i]}.png" 2>/dev/null || true
    mv test-output/sphere_coronal.png "test-output/sphere_coronal_${names[$i]}.png" 2>/dev/null || true
    mv test-output/sphere_sagittal.png "test-output/sphere_sagittal_${names[$i]}.png" 2>/dev/null || true
done

# Performance test
if [ "$1" = "--perf" ] || [ "$2" = "--perf" ]; then
    echo ""
    echo "⏱️  Running performance test..."
    ./target/release/test_render \
        --pattern gradient \
        --frames 100 \
        --output test-output \
        --width 512 \
        --height 512
fi

echo ""
echo "✅ Render pipeline tests complete!"
echo "📁 Output images saved to: test-output/"
echo ""
echo "Optional flags:"
echo "  --bench  Run performance benchmark tests"
echo "  --perf   Run frame timing performance test"