// Final diagnostic to understand the raw RGBA issue
console.log('=== Raw RGBA Diagnostic ===\n');

// Check what debug output you should see
console.log('When you move the crosshair with raw RGBA enabled, you should see:');
console.log('1. "🔍 First 8 bytes (hex):" - THIS IS THE KEY!');
console.log('2. "🔍 First 8 bytes (decimal):"');
console.log('3. "🔍 isRawRGBAFormat flag: true"');
console.log('4. "🔍 useRawRGBA setting: true"');
console.log('\nPlease share what the "First 8 bytes" show!');

// Test to capture the data
window.captureRawData = function() {
  console.log('\nInstalling data capture hook...');
  
  if (!window.apiService) {
    console.error('apiService not found');
    return;
  }
  
  // Hook into transport to capture raw data
  const originalInvoke = window.apiService.transport.invoke;
  
  window.apiService.transport.invoke = async function(cmd, args) {
    if (cmd === 'apply_and_render_view_state_raw') {
      console.log('📦 Capturing raw RGBA response...');
    }
    
    const result = await originalInvoke.call(this, cmd, args);
    
    if (cmd === 'apply_and_render_view_state_raw' && result instanceof Uint8Array) {
      console.log('\n📊 RAW DATA CAPTURED:');
      console.log('Total size:', result.length, 'bytes');
      console.log('First 16 bytes (hex):', Array.from(result.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      console.log('First 8 bytes (decimal):', Array.from(result.slice(0, 8)).join(', '));
      
      // Try to interpret as raw RGBA
      const width = result[0] | (result[1] << 8) | (result[2] << 16) | (result[3] << 24);
      const height = result[4] | (result[5] << 8) | (result[6] << 16) | (result[7] << 24);
      console.log('\nInterpreted as raw RGBA:');
      console.log('Width:', width);
      console.log('Height:', height);
      console.log('Expected data size:', width * height * 4);
      console.log('Actual data size:', result.length - 8);
      console.log('Match:', (result.length - 8) === (width * height * 4) ? '✅' : '❌');
      
      // Check if it's PNG
      if (result[0] === 0x89 && result[1] === 0x50) {
        console.log('\n⚠️ WARNING: This is PNG data, not raw RGBA!');
      }
      
      // Store for inspection
      window.lastRawData = result;
      console.log('\n✅ Data stored in window.lastRawData for inspection');
    }
    
    return result;
  };
  
  console.log('✅ Hook installed. Now:');
  console.log('1. Make sure raw RGBA is enabled: window.setRawRGBA(true)');
  console.log('2. Move the crosshair to trigger a render');
  console.log('3. Check the captured data output above');
  
  // Auto-remove hook after 30 seconds
  setTimeout(() => {
    window.apiService.transport.invoke = originalInvoke;
    console.log('✅ Hook removed');
  }, 30000);
};

// Quick test
window.quickTest = function() {
  console.log('\nRunning quick test...');
  
  // Enable raw RGBA
  window.setRawRGBA(true);
  console.log('✅ Raw RGBA enabled');
  
  // Install capture
  window.captureRawData();
  
  console.log('\n👉 Now move the crosshair to trigger a render');
  console.log('Watch for the captured data output!');
};

console.log('\n📌 Commands:');
console.log('- window.quickTest() - Run the test');
console.log('- window.captureRawData() - Just install the capture hook');
console.log('\n⚠️ Make sure a volume is loaded first!');