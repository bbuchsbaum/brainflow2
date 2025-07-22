// Quick inline test - just paste this into console
console.log('=== Quick Raw RGBA Test ===\n');

// Quick test function
window.quickRGBATest = async function() {
  console.log('Testing both modes...\n');
  
  // Check if we have layers
  const viewState = window.useViewStateStore?.getState();
  if (!viewState || !viewState.viewState.layers?.length) {
    console.error('❌ No layers loaded. Please load a volume first.');
    return;
  }
  
  // Test PNG mode
  console.log('1. Testing PNG mode...');
  window.setRawRGBA(false);
  
  // Move crosshair to trigger render
  const current = viewState.viewState.crosshair;
  await viewState.setCrosshair([
    current.world_mm[0] + 1,
    current.world_mm[1],
    current.world_mm[2]
  ], true);
  
  await new Promise(r => setTimeout(r, 500));
  console.log('✅ PNG mode done - check if image is visible');
  
  // Test raw RGBA mode
  console.log('\n2. Testing raw RGBA mode...');
  window.setRawRGBA(true);
  
  // Move crosshair again
  await viewState.setCrosshair([
    current.world_mm[0] - 1,
    current.world_mm[1],
    current.world_mm[2]
  ], true);
  
  await new Promise(r => setTimeout(r, 500));
  console.log('✅ Raw RGBA mode done - check if image disappeared');
  
  // Reset to PNG
  window.setRawRGBA(false);
  console.log('\n✅ Reset to PNG mode');
  
  console.log('\nCheck console for:');
  console.log('- "First 8 bytes" debug output');
  console.log('- PNG signature warnings');
  console.log('- Any dimension errors');
};

// Also add inline diagnostic
window.checkRGBAData = function() {
  // Override fetch temporarily to intercept
  const oldInvoke = window.apiService.transport.invoke;
  let capturedData = null;
  
  window.apiService.transport.invoke = async function(cmd, args) {
    console.log(`🔍 Calling: ${cmd}`);
    const result = await oldInvoke.call(this, cmd, args);
    
    if (cmd.includes('apply_and_render_view_state')) {
      capturedData = result;
      console.log(`📦 Captured data from ${cmd}:`, {
        type: Object.prototype.toString.call(result),
        length: result?.length,
        isUint8Array: result instanceof Uint8Array
      });
      
      if (result instanceof Uint8Array) {
        console.log('First 16 bytes:', Array.from(result.slice(0, 16)));
        console.log('As hex:', Array.from(result.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        
        // Check if PNG
        if (result[0] === 0x89 && result[1] === 0x50) {
          console.log('✅ This is PNG data');
        } else {
          console.log('❌ This is NOT PNG data');
          // Try to read as raw RGBA
          const width = result[0] | (result[1] << 8) | (result[2] << 16) | (result[3] << 24);
          const height = result[4] | (result[5] << 8) | (result[6] << 16) | (result[7] << 24);
          console.log(`Dimensions if raw RGBA: ${width}x${height}`);
        }
      }
    }
    
    return result;
  };
  
  // Restore after 5 seconds
  setTimeout(() => {
    window.apiService.transport.invoke = oldInvoke;
    console.log('✅ Restored original invoke');
  }, 5000);
  
  console.log('✅ Data interceptor installed for 5 seconds');
  console.log('Move the crosshair to trigger a render');
};

console.log('Functions available:');
console.log('- window.quickRGBATest() - Test both modes');
console.log('- window.checkRGBAData() - Intercept and analyze data');
console.log('\nCurrent settings:');
console.log('- useRawRGBA:', window.apiService?.useRawRGBA);
console.log('- Layers loaded:', window.useViewStateStore?.getState()?.viewState?.layers?.length || 0);