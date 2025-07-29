// Test script to compare PNG and raw RGBA modes
console.log('=== Testing Both Rendering Modes ===\n');

// Test function
window.testRenderingModes = async function() {
  console.log('1. Testing PNG mode (should work)...');
  window.setRawRGBA(false);
  
  // Trigger render
  const viewState = window.useViewStateStore?.getState();
  if (viewState) {
    const current = viewState.viewState.crosshair;
    viewState.setCrosshair([
      current.world_mm[0] + 0.1,
      current.world_mm[1],
      current.world_mm[2]
    ], true);
  }
  
  console.log('✅ PNG mode enabled - check if brain image appears');
  
  // Wait 2 seconds then try raw RGBA
  setTimeout(() => {
    console.log('\n2. Testing raw RGBA mode...');
    window.setRawRGBA(true);
    
    // Trigger another render
    if (viewState) {
      const current = viewState.viewState.crosshair;
      viewState.setCrosshair([
        current.world_mm[0] - 0.1,
        current.world_mm[1],
        current.world_mm[2]
      ], true);
    }
    
    console.log('🔍 Raw RGBA mode enabled - check console for:');
    console.log('   - First 8 bytes output');
    console.log('   - Any dimension validation errors');
    console.log('   - Whether image appears or stays black');
  }, 2000);
};

console.log('The default is now PNG mode (useRawRGBA = false)');
console.log('This should fix the black screen on load\n');

console.log('Run window.testRenderingModes() to test both modes');
console.log('Or manually test:');
console.log('  window.setRawRGBA(false) - Use PNG (should work)');
console.log('  window.setRawRGBA(true)  - Use raw RGBA (debugging)');