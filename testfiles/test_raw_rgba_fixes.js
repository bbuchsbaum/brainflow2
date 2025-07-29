// Test script for raw RGBA fixes
// Run in browser console after `cargo tauri dev`

console.log('=== Raw RGBA Fix Test Suite ===');

// Test 1: Verify controls exist
console.log('\n1. Testing control functions:');
console.log('   window.setRawRGBA:', typeof window.setRawRGBA);
console.log('   window.setBinaryIPC:', typeof window.setBinaryIPC);
console.log('   window.setDebugBrighten:', typeof window.setDebugBrighten);

// Test 2: Enable raw RGBA with premultiplyAlpha fix
console.log('\n2. Testing raw RGBA with premultiplyAlpha fix...');
window.setRawRGBA(true);
window.setDebugBrighten(false);
console.log('   ✅ Raw RGBA enabled (with premultiplyAlpha: none)');
console.log('   📝 Move crosshair to trigger render');
console.log('   🔍 Look for: "Successfully created ImageBitmap from raw RGBA data (premultiplyAlpha: none)"');

// Test 3: Test with debug brightening
window.testBrightening = async function() {
  console.log('\n3. Testing with debug brightening...');
  window.setDebugBrighten(true);
  console.log('   🔆 Debug brightening enabled');
  console.log('   📝 Move crosshair to trigger render');
  console.log('   🔍 Look for: "DEBUG: Artificially brightening raw RGBA data"');
  
  // Wait a bit then disable
  setTimeout(() => {
    window.setDebugBrighten(false);
    console.log('   ✅ Debug brightening disabled');
  }, 5000);
};

// Test 4: Compare all modes
window.compareAllModes = async function() {
  console.log('\n=== Comparing All Rendering Modes ===');
  
  const modes = [
    { name: 'PNG (baseline)', rawRGBA: false, brighten: false },
    { name: 'Raw RGBA (fixed)', rawRGBA: true, brighten: false },
    { name: 'Raw RGBA (brightened)', rawRGBA: true, brighten: true }
  ];
  
  for (const mode of modes) {
    console.log(`\n--- Testing: ${mode.name} ---`);
    window.setRawRGBA(mode.rawRGBA);
    window.setDebugBrighten(mode.brighten);
    
    // Force a render by dispatching event
    window.dispatchEvent(new CustomEvent('test-render'));
    
    // Wait for render
    await new Promise(r => setTimeout(r, 1000));
    
    console.log(`✅ ${mode.name} complete - check visual output`);
  }
  
  // Reset to optimal settings
  window.setRawRGBA(true);
  window.setDebugBrighten(false);
  console.log('\n✅ Reset to optimal settings (raw RGBA enabled, brightening off)');
};

// Test 5: Quick diagnostic
window.diagnoseRawRGBA = function() {
  console.log('\n=== Raw RGBA Diagnostic ===');
  console.log('Current settings:');
  const apiService = window.apiService || window.getApiService?.();
  if (apiService) {
    console.log('  - Binary IPC:', apiService.useBinaryIPC ? 'enabled' : 'disabled');
    console.log('  - Raw RGBA:', apiService.useRawRGBA ? 'enabled' : 'disabled');
    console.log('  - Debug Brighten:', apiService.debugBrighten ? 'enabled' : 'disabled');
  }
  
  console.log('\nExpected behavior:');
  console.log('  - With raw RGBA enabled: Should see normal images (not black)');
  console.log('  - With debug brightening: Images should be artificially bright');
  console.log('  - With PNG mode: Images should look identical to fixed raw RGBA');
  
  console.log('\nIf still seeing black images:');
  console.log('  1. Check console for error messages');
  console.log('  2. Try window.testBrightening() to see if pixels are just very dark');
  console.log('  3. Check intensity window settings in backend logs');
};

console.log('\n✅ Test suite loaded!');
console.log('Available commands:');
console.log('  - window.testBrightening() - Test with artificial brightening');
console.log('  - window.compareAllModes() - Compare PNG vs raw RGBA modes');
console.log('  - window.diagnoseRawRGBA() - Show current settings and tips');
console.log('\n📝 Move the crosshair now to test the raw RGBA fix!');