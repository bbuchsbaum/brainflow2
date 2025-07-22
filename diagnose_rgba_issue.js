// Final diagnostic script for raw RGBA issue
console.log('=== Raw RGBA Issue Diagnosis ===\n');

// Check if backend is returning the wrong format
window.diagnoseRGBAIssue = async function() {
  console.log('Starting diagnosis...\n');
  
  // Get current view state
  const viewState = window.useViewStateStore?.getState();
  if (!viewState || !viewState.viewState.layers?.length) {
    console.error('❌ No layers loaded. Please load a volume first.');
    return;
  }
  
  console.log('✅ Found layers:', viewState.viewState.layers.map(l => l.id));
  
  // Test 1: PNG mode (baseline)
  console.log('\n📊 Test 1: PNG Mode (baseline)');
  window.setRawRGBA(false);
  console.log('Settings: useRawRGBA = false');
  
  try {
    // Force a render
    const bitmap1 = await window.apiService.applyAndRenderViewStateCore(
      viewState.viewState, 
      'axial', 
      256, 
      256
    );
    console.log('✅ PNG mode succeeded');
    console.log('   Result:', bitmap1);
  } catch (error) {
    console.error('❌ PNG mode failed:', error.message);
  }
  
  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Test 2: Raw RGBA mode
  console.log('\n🚀 Test 2: Raw RGBA Mode');
  window.setRawRGBA(true);
  console.log('Settings: useRawRGBA = true');
  
  try {
    // Force a render
    const bitmap2 = await window.apiService.applyAndRenderViewStateCore(
      viewState.viewState, 
      'axial', 
      256, 
      256
    );
    console.log('✅ Raw RGBA mode succeeded');
    console.log('   Result:', bitmap2);
  } catch (error) {
    console.error('❌ Raw RGBA mode failed:', error.message);
    console.error('   Full error:', error);
  }
  
  // Reset to PNG mode
  window.setRawRGBA(false);
  
  console.log('\n📋 Summary:');
  console.log('Check the console output above for:');
  console.log('1. "First 8 bytes" debug output');
  console.log('2. Any PNG signature detection');
  console.log('3. Dimension validation errors');
  console.log('\nAlso check backend console for:');
  console.log('1. "RAW RGBA PATH" vs "BINARY IPC PATH" messages');
  console.log('2. "Returning X bytes of raw pixel data" messages');
};

// Quick status check
window.rgbaStatus = function() {
  console.log('Current RGBA settings:');
  console.log('- useRawRGBA:', window.apiService?.useRawRGBA);
  console.log('- useBinaryIPC:', window.apiService?.useBinaryIPC);
  console.log('- debugBrighten:', window.apiService?.debugBrighten);
  
  const viewState = window.useViewStateStore?.getState();
  const layerCount = viewState?.viewState?.layers?.length || 0;
  console.log('- Loaded layers:', layerCount);
  
  if (layerCount === 0) {
    console.log('\n⚠️ No layers loaded. Load a volume first!');
  }
};

// Install error monitor
let errorCount = 0;
const originalError = console.error;
console.error = function(...args) {
  originalError.apply(console, args);
  
  const message = args[0]?.toString() || '';
  if (message.includes('PNG') || message.includes('createImageBitmap')) {
    errorCount++;
    console.warn(`🚨 Image error #${errorCount} detected at ${new Date().toLocaleTimeString()}`);
    console.warn(`   Current mode: useRawRGBA = ${window.apiService?.useRawRGBA}`);
  }
};

console.log('\n📌 Usage:');
console.log('1. Load a volume if not already loaded');
console.log('2. Run: window.diagnoseRGBAIssue()');
console.log('3. Check console output from both tests');
console.log('4. Run: window.rgbaStatus() for current settings');

// Run initial status check
window.rgbaStatus();