// Test using what's actually available in the console
console.log('=== Testing with Available Functions ===\n');

// Check what's available
console.log('Available functions:');
console.log('- window.setBinaryIPC:', typeof window.setBinaryIPC);
console.log('- window.setRawRGBA:', typeof window.setRawRGBA);
console.log('- window.setDebugBrighten:', typeof window.setDebugBrighten);

// Try to get apiService through the module system
async function findApiService() {
  // Method 1: Try to get it through React DevTools
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    console.log('Found React DevTools hook');
    const renderers = window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers;
    console.log('Renderers:', renderers);
  }
  
  // Method 2: Check if it's in any service instances
  console.log('\nScanning for service instances...');
  const foundServices = {};
  
  // Look through all window properties
  for (const key in window) {
    if (key.toLowerCase().includes('service') || 
        key.toLowerCase().includes('api') ||
        key.includes('__')) {
      const value = window[key];
      if (value && typeof value === 'object') {
        console.log(`Found: window.${key}`);
        foundServices[key] = value;
      }
    }
  }
  
  return foundServices;
}

// Test the modes
window.testModes = async function() {
  console.log('\n=== Testing Rendering Modes ===\n');
  
  // Current settings
  console.log('Testing with available functions...');
  
  // Test 1: Ensure PNG mode
  console.log('\n1. Setting PNG mode:');
  window.setRawRGBA(false);
  console.log('✅ Called setRawRGBA(false)');
  
  // Wait and observe
  console.log('Move the crosshair to trigger a render...');
  console.log('Check console for debug output');
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Test 2: Try raw RGBA mode
  console.log('\n2. Setting raw RGBA mode:');
  window.setRawRGBA(true);
  console.log('✅ Called setRawRGBA(true)');
  
  console.log('Move the crosshair again...');
  console.log('Check if image disappears');
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Reset
  console.log('\n3. Resetting to PNG mode:');
  window.setRawRGBA(false);
  console.log('✅ Reset complete');
};

// Monitor console errors
let errorLog = [];
const originalError = console.error;
console.error = function(...args) {
  originalError.apply(console, args);
  const msg = args[0]?.toString() || '';
  if (msg.includes('PNG') || msg.includes('createImageBitmap') || msg.includes('RGBA')) {
    errorLog.push({
      time: new Date().toLocaleTimeString(),
      message: msg,
      args: args
    });
  }
};

// Helper to show error log
window.showErrors = function() {
  console.log('\n=== Error Log ===');
  errorLog.forEach((err, i) => {
    console.log(`\n${i + 1}. [${err.time}]`);
    console.log('Message:', err.message);
  });
  if (errorLog.length === 0) {
    console.log('No PNG/RGBA errors logged yet');
  }
};

// Try to access the actual module
window.debugModules = async function() {
  console.log('\n=== Debugging Module Access ===\n');
  
  // Check for module systems
  if (window.require) {
    console.log('Found require function');
  }
  
  if (window.System) {
    console.log('Found System loader');
  }
  
  if (window.__modules__) {
    console.log('Found __modules__');
  }
  
  // Try dynamic import
  try {
    console.log('Attempting dynamic import...');
    // This won't work in console but shows the concept
    // const module = await import('/src/services/apiService.js');
    // console.log('Module:', module);
  } catch (err) {
    console.log('Dynamic import not available in console');
  }
  
  // Check loaded scripts
  const scripts = Array.from(document.scripts);
  const srcScripts = scripts.filter(s => s.src);
  console.log(`\nFound ${srcScripts.length} scripts with src`);
  
  const apiScript = srcScripts.find(s => s.src.includes('apiService'));
  if (apiScript) {
    console.log('Found apiService script:', apiScript.src);
  }
};

console.log('\n✅ Setup complete!');
console.log('\nAvailable commands:');
console.log('- window.testModes() - Test PNG vs raw RGBA modes');
console.log('- window.showErrors() - Show captured errors');
console.log('- window.debugModules() - Try to find modules');
console.log('\n🎯 Start with: window.testModes()');

// Run initial scan
findApiService().then(services => {
  console.log('\nFound services:', Object.keys(services));
});

// Also check the view state store
if (window.__viewStateStore) {
  console.log('\n✅ Found __viewStateStore');
  const state = window.__viewStateStore.getState();
  console.log('- Layers loaded:', state.viewState?.layers?.length || 0);
}