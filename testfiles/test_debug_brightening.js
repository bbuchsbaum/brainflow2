// Quick test to enable debug brightening
// This will artificially brighten the raw RGBA data by 10x

console.log('=== Testing Debug Brightening ===');

// Enable raw RGBA with debug brightening
window.setRawRGBA(true);
window.setDebugBrighten(true);

console.log('✅ Raw RGBA enabled with debug brightening (10x multiplier)');
console.log('📝 Move the crosshair to trigger a render');
console.log('🔍 If you see a bright (possibly oversaturated) image, it confirms the pixels are just very dark');
console.log('🔍 If it\'s still black, then the issue is deeper than just dark pixels');

// After 5 seconds, disable brightening
setTimeout(() => {
  window.setDebugBrighten(false);
  console.log('✅ Debug brightening disabled - back to normal');
}, 5000);