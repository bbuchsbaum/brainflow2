// Test if raw RGBA command is accessible
console.log('=== Testing Raw RGBA Command Accessibility ===\n');

// Direct test of the command
window.testRawRGBACommand = async function() {
  console.log('Testing direct invocation of apply_and_render_view_state_raw...\n');
  
  try {
    // Create a minimal valid ViewState
    const testViewState = {
      views: {
        axial: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0] },
        sagittal: { origin_mm: [0, 0, 0], u_mm: [0, 1, 0], v_mm: [0, 0, 1] },
        coronal: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 0, 1] }
      },
      crosshair: { world_mm: [0, 0, 0], visible: true },
      layers: [] // Empty layers - should return black image
    };
    
    // Try to invoke the raw command directly
    console.log('Invoking plugin:api-bridge|apply_and_render_view_state_raw...');
    const result = await window.__TAURI__.invoke(
      'plugin:api-bridge|apply_and_render_view_state_raw',
      { viewStateJson: JSON.stringify(testViewState) }
    );
    
    console.log('✅ Command succeeded!');
    console.log('Result type:', Object.prototype.toString.call(result));
    console.log('Result:', result);
    
    if (result instanceof Uint8Array || result instanceof ArrayBuffer) {
      const bytes = result instanceof Uint8Array ? result : new Uint8Array(result);
      console.log('\nData analysis:');
      console.log('- Total size:', bytes.length, 'bytes');
      console.log('- First 8 bytes (hex):', Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      console.log('- First 8 bytes (decimal):', Array.from(bytes.slice(0, 8)).join(', '));
      
      // Check if PNG
      if (bytes[0] === 0x89 && bytes[1] === 0x50) {
        console.log('- Format: PNG (unexpected for raw RGBA!)');
      } else {
        console.log('- Format: Not PNG (expected for raw RGBA)');
        if (bytes.length >= 8) {
          const width = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
          const height = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
          console.log('- Dimensions: ' + width + 'x' + height);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Command failed:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    
    if (error.message?.includes('not found') || error.message?.includes('unknown')) {
      console.error('\n⚠️ The command might not be registered properly!');
      console.error('Check:');
      console.error('1. Is the command in build.rs COMMANDS array?');
      console.error('2. Is it in the generate_handler! macro?');
      console.error('3. Are permissions set in default.toml?');
    }
  }
};

// Also test the transport layer
window.testTransportRawRGBA = async function() {
  console.log('\nTesting via apiService transport layer...\n');
  
  if (!window.apiService) {
    console.error('❌ apiService not available');
    return;
  }
  
  try {
    const testViewState = {
      views: {
        axial: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0] },
        sagittal: { origin_mm: [0, 0, 0], u_mm: [0, 1, 0], v_mm: [0, 0, 1] },
        coronal: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 0, 1] }
      },
      crosshair: { world_mm: [0, 0, 0], visible: true },
      layers: []
    };
    
    console.log('Invoking via transport.invoke...');
    const result = await window.apiService.transport.invoke(
      'apply_and_render_view_state_raw',
      { viewStateJson: JSON.stringify(testViewState) }
    );
    
    console.log('✅ Transport succeeded!');
    console.log('Result type:', Object.prototype.toString.call(result));
    console.log('Is Uint8Array:', result instanceof Uint8Array);
    console.log('Length:', result?.length || 'N/A');
    
  } catch (error) {
    console.error('❌ Transport failed:', error);
  }
};

console.log('Run tests:');
console.log('1. window.testRawRGBACommand() - Direct Tauri invocation');
console.log('2. window.testTransportRawRGBA() - Via transport layer');