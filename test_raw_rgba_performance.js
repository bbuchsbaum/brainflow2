// Test script to compare PNG vs Raw RGBA performance
// Run this in the browser console after launching the app with: cargo tauri dev

async function testRenderingPerformance() {
  console.log('=== Raw RGBA Performance Test ===');
  
  // Get the API service
  const apiService = window.apiService || window.getApiService?.();
  if (!apiService) {
    console.error('Could not find apiService. Make sure the app is loaded.');
    return;
  }
  
  // Helper to time a render
  async function timeRender(description) {
    const startTime = performance.now();
    
    // Trigger a render by changing the crosshair position slightly
    const stores = window.stores;
    if (!stores || !stores.viewStateStore) {
      console.error('Could not find viewStateStore');
      return null;
    }
    
    // Get current state
    const state = stores.viewStateStore.getState();
    const currentCrosshair = state.crosshair;
    
    // Move crosshair slightly to trigger render
    stores.viewStateStore.getState().setCrosshair({
      x: currentCrosshair.x + 0.1,
      y: currentCrosshair.y,
      z: currentCrosshair.z
    });
    
    // Wait a bit for render to complete
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    console.log(`${description}: ${duration.toFixed(2)}ms`);
    return duration;
  }
  
  // Test configuration
  const numTests = 5;
  const results = {
    png: [],
    rawRGBA: []
  };
  
  console.log(`\nRunning ${numTests} tests for each mode...\n`);
  
  // Test PNG mode
  console.log('--- Testing PNG Mode ---');
  window.setRawRGBA(false);
  window.setBinaryIPC(true); // Still use binary IPC, just not raw RGBA
  
  // Warm up
  await timeRender('PNG Warmup');
  
  // Actual tests
  for (let i = 0; i < numTests; i++) {
    const time = await timeRender(`PNG Test ${i + 1}`);
    if (time !== null) results.png.push(time);
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between tests
  }
  
  console.log('\n--- Testing Raw RGBA Mode ---');
  window.setRawRGBA(true);
  
  // Warm up
  await timeRender('Raw RGBA Warmup');
  
  // Actual tests
  for (let i = 0; i < numTests; i++) {
    const time = await timeRender(`Raw RGBA Test ${i + 1}`);
    if (time !== null) results.rawRGBA.push(time);
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between tests
  }
  
  // Calculate statistics
  function getStats(times) {
    if (times.length === 0) return { avg: 0, min: 0, max: 0 };
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    return { avg, min, max };
  }
  
  const pngStats = getStats(results.png);
  const rawStats = getStats(results.rawRGBA);
  
  console.log('\n=== RESULTS ===');
  console.log('\nPNG Mode:');
  console.log(`  Average: ${pngStats.avg.toFixed(2)}ms`);
  console.log(`  Min: ${pngStats.min.toFixed(2)}ms`);
  console.log(`  Max: ${pngStats.max.toFixed(2)}ms`);
  
  console.log('\nRaw RGBA Mode:');
  console.log(`  Average: ${rawStats.avg.toFixed(2)}ms`);
  console.log(`  Min: ${rawStats.min.toFixed(2)}ms`);
  console.log(`  Max: ${rawStats.max.toFixed(2)}ms`);
  
  const improvement = ((pngStats.avg - rawStats.avg) / pngStats.avg * 100).toFixed(1);
  console.log(`\n🚀 Performance Improvement: ${improvement}%`);
  console.log(`🚀 Time Saved Per Frame: ${(pngStats.avg - rawStats.avg).toFixed(2)}ms`);
  
  // Restore to optimal settings
  window.setRawRGBA(true);
  console.log('\n✅ Raw RGBA mode re-enabled for optimal performance');
}

// Also create a simple toggle function
window.toggleRawRGBA = function() {
  const currentState = window.useRawRGBA ?? true;
  const newState = !currentState;
  window.setRawRGBA(newState);
  console.log(`Raw RGBA is now ${newState ? 'ENABLED' : 'DISABLED'}`);
  window.useRawRGBA = newState;
};

console.log('Performance test loaded!');
console.log('Run testRenderingPerformance() to compare PNG vs Raw RGBA');
console.log('Run toggleRawRGBA() to switch between modes');