// Debug script to monitor render loops
// Run this in the browser console to see which components are rendering excessively

(function() {
  if (!window.__RENDER_COUNTS) {
    console.log('No render counts available. Make sure the app is running in development mode.');
    return;
  }
  
  const counts = window.__RENDER_COUNTS;
  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([_, count]) => count > 10);
  
  console.log('=== Components with excessive renders ===');
  sorted.forEach(([component, count]) => {
    console.log(`${component}: ${count} renders`);
  });
  
  // Monitor for new excessive renders
  const checkInterval = setInterval(() => {
    const newExcessive = Array.from(counts.entries())
      .filter(([_, count]) => count > 100)
      .sort((a, b) => b[1] - a[1]);
    
    if (newExcessive.length > 0) {
      console.warn('!!! RENDER LOOP DETECTED !!!');
      newExcessive.forEach(([component, count]) => {
        console.warn(`${component}: ${count} renders`);
      });
      clearInterval(checkInterval);
    }
  }, 1000);
  
  console.log('Monitoring for render loops... (will stop after detecting loops > 100)');
})();