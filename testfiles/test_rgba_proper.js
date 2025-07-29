// Proper RGBA test that finds the correct store
console.log('=== Proper Raw RGBA Test ===\n');

// First, let's find and expose the store properly
function setupStoreAccess() {
  // Check if already set up
  if (window.viewStateStore) return true;
  
  // Try to find the store
  if (window.__viewStateStore) {
    window.viewStateStore = window.__viewStateStore;
    console.log('✅ Found viewStateStore via __viewStateStore');
    return true;
  }
  
  console.error('❌ Could not find viewStateStore');
  return false;
}

// Test function
window.testRGBA = async function() {
  console.log('Starting RGBA test...\n');
  
  // Setup store access
  if (!setupStoreAccess()) {
    console.error('Cannot proceed without store access');
    return;
  }
  
  // Get current state
  const getState = () => window.viewStateStore.getState();
  const state = getState();
  
  console.log('Current state check:');
  console.log('- Has viewState:', !!state.viewState);
  console.log('- Layers:', state.viewState?.layers?.length || 0);
  
  if (!state.viewState?.layers?.length) {
    console.error('❌ No layers loaded. Please load a volume first.');
    return;
  }
  
  console.log('✅ Found layers:', state.viewState.layers.map(l => l.id));
  
  // Test 1: PNG mode
  console.log('\n📊 Test 1: PNG Mode');
  window.setRawRGBA(false);
  console.log('- Set useRawRGBA = false');
  
  // Trigger render by moving crosshair
  const currentCrosshair = state.viewState.crosshair.world_mm;
  if (state.setCrosshair) {
    await state.setCrosshair([
      currentCrosshair[0] + 1,
      currentCrosshair[1],
      currentCrosshair[2]
    ], true);
  } else {
    console.warn('setCrosshair method not found, trying alternative...');
    // Try to find the action
    for (const key in state) {
      if (key.toLowerCase().includes('crosshair') && typeof state[key] === 'function') {
        console.log(`Found method: ${key}`);
      }
    }
  }
  
  await new Promise(r => setTimeout(r, 1000));
  console.log('✅ PNG test complete - check if image is visible');
  
  // Test 2: Raw RGBA mode
  console.log('\n🚀 Test 2: Raw RGBA Mode');
  window.setRawRGBA(true);
  console.log('- Set useRawRGBA = true');
  
  // Trigger another render
  const newState = getState();
  const newCrosshair = newState.viewState.crosshair.world_mm;
  if (newState.setCrosshair) {
    await newState.setCrosshair([
      newCrosshair[0] - 1,
      newCrosshair[1],
      newCrosshair[2]
    ], true);
  }
  
  await new Promise(r => setTimeout(r, 1000));
  console.log('✅ Raw RGBA test complete - check if image disappeared');
  
  // Reset to PNG
  window.setRawRGBA(false);
  console.log('\n✅ Reset to PNG mode');
  
  console.log('\nCheck console output for:');
  console.log('- "First 8 bytes" debug messages');
  console.log('- PNG signature detection');
  console.log('- Any error messages');
};

// Alternative: Direct API test
window.testRGBADirect = async function() {
  console.log('Testing raw RGBA via direct API call...\n');
  
  if (!window.apiService) {
    console.error('❌ apiService not available');
    return;
  }
  
  // Get current view state
  const state = window.viewStateStore?.getState();
  if (!state?.viewState) {
    console.error('❌ No viewState available');
    return;
  }
  
  console.log('Current layers:', state.viewState.layers?.length || 0);
  
  // Test PNG mode
  console.log('\n1. Testing PNG mode...');
  window.setRawRGBA(false);
  
  try {
    const result1 = await window.apiService.applyAndRenderViewStateCore(
      state.viewState,
      'axial',
      256,
      256
    );
    console.log('✅ PNG mode succeeded:', result1);
  } catch (err) {
    console.error('❌ PNG mode failed:', err.message);
  }
  
  // Test raw RGBA mode
  console.log('\n2. Testing raw RGBA mode...');
  window.setRawRGBA(true);
  
  try {
    const result2 = await window.apiService.applyAndRenderViewStateCore(
      state.viewState,
      'axial',
      256,
      256
    );
    console.log('✅ Raw RGBA mode succeeded:', result2);
  } catch (err) {
    console.error('❌ Raw RGBA mode failed:', err.message);
    console.error('Full error:', err);
  }
  
  // Reset
  window.setRawRGBA(false);
};

// Log current state
console.log('Current settings:');
console.log('- useRawRGBA:', window.apiService?.useRawRGBA);
console.log('- useBinaryIPC:', window.apiService?.useBinaryIPC);

console.log('\nAvailable commands:');
console.log('- window.testRGBA() - Test with store actions');
console.log('- window.testRGBADirect() - Test with direct API calls');

// Try to set up store access automatically
setupStoreAccess();