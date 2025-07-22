// Debug script for raw RGBA issues
console.log('=== Raw RGBA Debug Script ===\n');

// Test function to debug the raw RGBA path
window.debugRawRGBA = async function() {
  console.log('1. Current settings:');
  console.log(`   - useRawRGBA: ${window.apiService?.useRawRGBA || false}`);
  console.log(`   - useBinaryIPC: ${window.apiService?.useBinaryIPC || false}`);
  
  console.log('\n2. Enabling raw RGBA mode...');
  window.setRawRGBA(true);
  
  console.log('\n3. Triggering a render...');
  // Move crosshair slightly to trigger render
  const viewState = window.useViewStateStore?.getState();
  if (viewState) {
    const current = viewState.viewState.crosshair;
    viewState.setCrosshair([
      current.world_mm[0] + 0.1,
      current.world_mm[1],
      current.world_mm[2]
    ], true);
  }
  
  console.log('\n4. Check console output above for:');
  console.log('   - 🔍 First 8 bytes (hex) - should show width/height as u32');
  console.log('   - 🔍 First 8 bytes (decimal) - dimensions in decimal');
  console.log('   - 🚀 Raw RGBA dimensions - extracted width/height');
  console.log('   - ❌ Any error messages about invalid dimensions or size mismatch');
  
  console.log('\n5. Expected first 8 bytes for raw RGBA:');
  console.log('   - Bytes 0-3: width as little-endian u32');
  console.log('   - Bytes 4-7: height as little-endian u32');
  console.log('   - Example: 512x512 image would be: 00 02 00 00 00 02 00 00');
  console.log('   - In decimal: 0, 2, 0, 0, 0, 2, 0, 0');
  
  console.log('\n6. If you see PNG signature instead:');
  console.log('   - PNG starts with: 89 50 4e 47 0d 0a 1a 0a');
  console.log('   - In decimal: 137, 80, 78, 71, 13, 10, 26, 10');
  console.log('   - This means backend is returning PNG despite raw RGBA request');
};

console.log('\n✨ Run window.debugRawRGBA() to debug the issue');

// Also provide a way to check backend logs
console.log('\n📋 Backend debugging:');
console.log('1. Check Rust console for:');
console.log('   - "🚀 RAW RGBA PATH: apply_and_render_view_state_raw called"');
console.log('   - "🚀 RAW RGBA: Skipping PNG encoding"');
console.log('   - "🚀 RAW RGBA: Returning X bytes"');
console.log('\n2. If you see PNG encoding messages instead, the backend is using wrong path');