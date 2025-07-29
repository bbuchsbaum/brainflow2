// Simple RGBA test using available apiService
console.log('=== Simple Raw RGBA Test ===\n');

// Test the raw RGBA command
window.testRawRGBA = async function() {
  if (!window.apiService) {
    console.error('❌ apiService not available');
    return;
  }
  
  console.log('Testing raw RGBA command...\n');
  
  // Create minimal test state
  const testState = {
    views: {
      axial: { origin_mm: [0,0,0], u_mm: [1,0,0], v_mm: [0,1,0] },
      sagittal: { origin_mm: [0,0,0], u_mm: [0,1,0], v_mm: [0,0,1] },
      coronal: { origin_mm: [0,0,0], u_mm: [1,0,0], v_mm: [0,0,1] }
    },
    crosshair: { world_mm: [0,0,0], visible: true },
    layers: [] // Empty layers - should give us a black image
  };
  
  // Test 1: Try raw RGBA command directly via transport
  console.log('1. Testing raw RGBA command via transport...');
  try {
    const result = await window.apiService.transport.invoke(
      'apply_and_render_view_state_raw',
      { viewStateJson: JSON.stringify(testState) }
    );
    
    console.log('✅ Raw RGBA command succeeded!');
    console.log('Result type:', Object.prototype.toString.call(result));
    console.log('Is Uint8Array:', result instanceof Uint8Array);
    console.log('Length:', result?.length || 'N/A');
    
    if (result instanceof Uint8Array && result.length >= 8) {
      console.log('\nAnalyzing data:');
      console.log('First 16 bytes (hex):', 
        Array.from(result.slice(0, 16))
          .map(b => b.toString(16).padStart(2, '0'))
          .join(' ')
      );
      
      // Check if PNG
      if (result[0] === 0x89 && result[1] === 0x50) {
        console.log('⚠️ WARNING: Data is PNG format (should be raw RGBA!)');
      } else {
        // Try to read dimensions
        const width = result[0] | (result[1] << 8) | (result[2] << 16) | (result[3] << 24);
        const height = result[4] | (result[5] << 8) | (result[6] << 16) | (result[7] << 24);
        console.log(`Dimensions: ${width}x${height}`);
        console.log(`Expected data: ${width * height * 4} bytes`);
        console.log(`Actual data: ${result.length - 8} bytes`);
      }
    }
  } catch (err) {
    console.error('❌ Raw RGBA command failed:', err.message);
    console.error('Full error:', err);
  }
  
  // Test 2: Compare with PNG command
  console.log('\n2. Testing PNG command for comparison...');
  try {
    const result = await window.apiService.transport.invoke(
      'apply_and_render_view_state_binary',
      { viewStateJson: JSON.stringify(testState) }
    );
    
    console.log('✅ PNG command succeeded!');
    console.log('Result type:', Object.prototype.toString.call(result));
    console.log('Length:', result?.length || 'N/A');
    
    if (result instanceof Uint8Array && result.length >= 8) {
      console.log('First 8 bytes (hex):', 
        Array.from(result.slice(0, 8))
          .map(b => b.toString(16).padStart(2, '0'))
          .join(' ')
      );
      
      if (result[0] === 0x89 && result[1] === 0x50) {
        console.log('✅ Data is PNG format (expected)');
      }
    }
  } catch (err) {
    console.error('❌ PNG command failed:', err.message);
  }
};

// Also test the actual rendering with current view state
window.testRenderingModes = async function() {
  if (!window.apiService) {
    console.error('❌ apiService not available');
    return;
  }
  
  // Find the view state
  const state = window.__viewStateStore?.getState?.();
  if (!state?.viewState?.layers?.length) {
    console.error('❌ No layers loaded. Load a volume first.');
    return;
  }
  
  console.log('Testing with actual view state...\n');
  console.log('Layers:', state.viewState.layers.map(l => l.id));
  
  // Test PNG mode
  console.log('\n1. PNG Mode:');
  window.setRawRGBA(false);
  
  try {
    const bitmap = await window.apiService.applyAndRenderViewStateCore(
      state.viewState,
      'axial',
      256,
      256
    );
    console.log('✅ PNG rendering succeeded:', bitmap);
  } catch (err) {
    console.error('❌ PNG rendering failed:', err.message);
  }
  
  // Test raw RGBA mode
  console.log('\n2. Raw RGBA Mode:');
  window.setRawRGBA(true);
  
  try {
    const bitmap = await window.apiService.applyAndRenderViewStateCore(
      state.viewState,
      'axial',
      256,
      256
    );
    console.log('✅ Raw RGBA rendering succeeded:', bitmap);
  } catch (err) {
    console.error('❌ Raw RGBA rendering failed:', err.message);
    console.error('Error details:', err);
  }
  
  // Reset
  window.setRawRGBA(false);
};

console.log('Commands available:');
console.log('- window.testRawRGBA() - Test raw commands directly');
console.log('- window.testRenderingModes() - Test with actual view state');
console.log('\nCurrent settings:');
console.log('- useRawRGBA:', window.apiService?.useRawRGBA);
console.log('- apiService available:', !!window.apiService);