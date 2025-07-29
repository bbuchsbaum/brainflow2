// Test script for raw RGBA fix
// This verifies that the color space conversion fix resolves the black image issue

console.log('=== Testing Raw RGBA Fix ===\n');

console.log('1. Enable raw RGBA mode:');
console.log('   window.setRawRGBA(true);\n');

console.log('2. The fix changes ImageBitmap creation from:');
console.log('   ❌ createImageBitmap(imageData, { premultiplyAlpha: "none", colorSpaceConversion: "none" })');
console.log('   ✅ createImageBitmap(imageData) // Uses browser defaults\n');

console.log('3. Why this fixes the issue:');
console.log('   - WebGPU renders in linear RGB color space (Rgba8Unorm)');
console.log('   - Browser expects sRGB when colorSpaceConversion is disabled');
console.log('   - Linear values look very dark when interpreted as sRGB');
console.log('   - Default browser handling properly converts linear→sRGB\n');

console.log('4. Backend also adds alpha channel verification');
console.log('   - Checks for pixels with alpha=0 (fully transparent)');
console.log('   - Warns if any pixels have low alpha values\n');

console.log('To test:');
console.log('1. Run in browser console: window.setRawRGBA(true)');
console.log('2. Load a volume');
console.log('3. Move crosshair to trigger renders');
console.log('4. Images should display correctly (not black)');
console.log('5. Check console for alpha channel warnings');
console.log('6. Compare with PNG mode: window.setRawRGBA(false)\n');

console.log('Expected results:');
console.log('✅ Images display with correct brightness');
console.log('✅ No "mostly black pixels" warnings');
console.log('✅ Identical appearance to PNG mode');
console.log('✅ Better performance (no PNG encoding)');

// Quick test function
window.testRawRGBA = async function() {
  console.log('\n🧪 Running raw RGBA test...');
  
  // Enable raw RGBA
  window.setRawRGBA(true);
  console.log('✅ Raw RGBA enabled');
  
  // Trigger a render by slightly moving crosshair
  const viewState = window.useViewStateStore?.getState();
  if (viewState) {
    const currentCrosshair = viewState.viewState.crosshair;
    viewState.setCrosshair([
      currentCrosshair.world_mm[0] + 0.1,
      currentCrosshair.world_mm[1],
      currentCrosshair.world_mm[2]
    ], true);
    console.log('✅ Triggered render by moving crosshair');
  }
  
  console.log('📝 Check the slice views - they should show the brain image correctly');
  console.log('📝 If still black, check browser console for error messages');
};

console.log('\n💡 Run window.testRawRGBA() to quickly test the fix');