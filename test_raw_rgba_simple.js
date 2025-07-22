// Simple test to verify raw RGBA mode is working
// Run in browser console after `cargo tauri dev`

console.log('=== Raw RGBA Quick Test ===');

// Test 1: Check if the functions are available
console.log('\n1. Checking if control functions exist:');
console.log('   window.setRawRGBA:', typeof window.setRawRGBA);
console.log('   window.setBinaryIPC:', typeof window.setBinaryIPC);

// Test 2: Enable raw RGBA mode
console.log('\n2. Enabling raw RGBA mode...');
window.setRawRGBA(true);
window.setBinaryIPC(true);
console.log('   ✅ Raw RGBA enabled');

// Test 3: Watch console for mode indicators
console.log('\n3. Next render should show:');
console.log('   - "🚀 [ApiService] RAW RGBA PATH"');
console.log('   - "🚀 [ApiService] This avoids PNG encoding entirely!"');
console.log('   - "🚀 [ApiService] Confirmed: Data is raw RGBA format"');

console.log('\n4. Trigger a render by moving the crosshair or adjusting any slider');
console.log('   Then check the console output above for the indicators');

// Test 4: Create comparison function
window.compareRenderModes = async function() {
  console.log('\n=== Comparing Render Modes ===');
  
  // First, render with PNG
  console.log('\n--- PNG Mode ---');
  window.setRawRGBA(false);
  // Force a small state change to trigger render
  const event = new CustomEvent('test-render');
  window.dispatchEvent(event);
  await new Promise(r => setTimeout(r, 500));
  
  // Then render with raw RGBA
  console.log('\n--- Raw RGBA Mode ---');
  window.setRawRGBA(true);
  window.dispatchEvent(event);
  await new Promise(r => setTimeout(r, 500));
  
  console.log('\n✅ Check the console output above to see the difference');
  console.log('   PNG mode should show PNG encoding logs');
  console.log('   Raw RGBA mode should show "Confirmed: Data is raw RGBA format"');
};

console.log('\n5. Run compareRenderModes() to see both modes in action');

// Test 5: Performance indicator
window.showRenderTiming = function() {
  console.log('\n=== Render Timing ===');
  console.log('Look for these timing logs in the console:');
  console.log('- "⏱️ PNG encoding took Xms"');
  console.log('- "⏱️ TOTAL apply_and_render_view_state time: Xms"');
  console.log('\nWith raw RGBA enabled, you should NOT see PNG encoding time');
};

console.log('\n✅ Test script loaded!');
console.log('Commands available:');
console.log('  - window.setRawRGBA(true/false) - Toggle raw RGBA mode');
console.log('  - window.compareRenderModes() - Compare both modes');
console.log('  - window.showRenderTiming() - Show timing info');