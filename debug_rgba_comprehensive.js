// Comprehensive RGBA debugging script
console.log('=== Comprehensive Raw RGBA Debugging ===\n');

// Helper to convert bytes to hex string
function bytesToHex(bytes, count = 8) {
  return Array.from(bytes.slice(0, count))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
}

// Helper to decode little-endian u32
function readU32LE(bytes, offset) {
  return bytes[offset] | 
         (bytes[offset + 1] << 8) | 
         (bytes[offset + 2] << 16) | 
         (bytes[offset + 3] << 24);
}

// Override apiService to intercept raw data
if (window.apiService) {
  const originalInvoke = window.apiService.transport.invoke;
  
  window.apiService.transport.invoke = async function(cmd, args) {
    console.log(`🔍 Intercepting command: ${cmd}`);
    
    const result = await originalInvoke.call(this, cmd, args);
    
    if (cmd === 'apply_and_render_view_state_raw' || 
        cmd === 'apply_and_render_view_state_binary') {
      console.log(`📦 Command ${cmd} returned:`, {
        type: Object.prototype.toString.call(result),
        isArrayBuffer: result instanceof ArrayBuffer,
        isUint8Array: result instanceof Uint8Array,
        length: result?.length || result?.byteLength || 'unknown'
      });
      
      // If it's raw data, analyze it
      if (result instanceof Uint8Array || result instanceof ArrayBuffer) {
        const bytes = result instanceof Uint8Array ? result : new Uint8Array(result);
        console.log(`\n📊 Data Analysis:`);
        console.log(`  Total size: ${bytes.length} bytes`);
        console.log(`  First 16 bytes (hex): ${bytesToHex(bytes, 16)}`);
        console.log(`  First 8 bytes (decimal): ${Array.from(bytes.slice(0, 8)).join(', ')}`);
        
        // Check if PNG
        const isPNG = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
        if (isPNG) {
          console.log(`  ✅ This is PNG data!`);
          if (cmd === 'apply_and_render_view_state_raw') {
            console.log(`  ⚠️ WARNING: Raw RGBA command returned PNG data!`);
          }
        } else {
          console.log(`  ❌ This is NOT PNG data`);
          
          // Try to decode as raw RGBA
          if (bytes.length >= 8) {
            const width = readU32LE(bytes, 0);
            const height = readU32LE(bytes, 4);
            console.log(`  Interpreted as raw RGBA:`);
            console.log(`    Width: ${width}`);
            console.log(`    Height: ${height}`);
            console.log(`    Expected data size: ${width * height * 4} bytes`);
            console.log(`    Actual data size: ${bytes.length - 8} bytes`);
            console.log(`    Size match: ${(bytes.length - 8) === (width * height * 4) ? '✅' : '❌'}`);
          }
        }
      }
    }
    
    return result;
  };
  
  console.log('✅ Interceptor installed on apiService.transport.invoke');
}

// Test function
window.debugRGBAComprehensive = async function() {
  console.log('\n=== Starting comprehensive RGBA test ===\n');
  
  // 1. Check current settings
  console.log('1. Current settings:');
  console.log(`   useRawRGBA: ${window.apiService?.useRawRGBA}`);
  console.log(`   useBinaryIPC: ${window.apiService?.useBinaryIPC}`);
  
  // 2. Test PNG mode first
  console.log('\n2. Testing PNG mode (baseline)...');
  window.setRawRGBA(false);
  
  // Trigger render
  const viewState = window.useViewStateStore?.getState();
  if (viewState) {
    const current = viewState.viewState.crosshair;
    await viewState.setCrosshair([
      current.world_mm[0] + 0.1,
      current.world_mm[1],
      current.world_mm[2]
    ], true);
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 3. Test raw RGBA mode
  console.log('\n3. Testing raw RGBA mode...');
  window.setRawRGBA(true);
  
  // Trigger render
  if (viewState) {
    const current = viewState.viewState.crosshair;
    await viewState.setCrosshair([
      current.world_mm[0] - 0.1,
      current.world_mm[1],
      current.world_mm[2]
    ], true);
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n=== Test complete ===');
  console.log('Check the output above for:');
  console.log('1. Which commands were called');
  console.log('2. What data format was returned');
  console.log('3. Any dimension mismatches');
};

// Install global error handler
window.addEventListener('error', (e) => {
  if (e.message.includes('PNG') || e.message.includes('createImageBitmap')) {
    console.error(`🚨 Image decode error:`, e.message);
    console.error(`   useRawRGBA: ${window.apiService?.useRawRGBA}`);
  }
});

console.log('\nUsage:');
console.log('1. Run: window.debugRGBAComprehensive()');
console.log('2. Watch console output for detailed analysis');
console.log('3. Check backend console for matching log messages');