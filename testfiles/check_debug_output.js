// Script to help check the debug output
console.log('=== Checking Debug Output ===\n');

console.log('When you set raw RGBA mode and move the crosshair, you should see:');
console.log('1. "🔍 First 8 bytes" debug output');
console.log('2. "🔍 isRawRGBAFormat flag" - this should be true');
console.log('3. "🔍 useRawRGBA setting" - this should be true');
console.log('\nWhat do the first 8 bytes show?');
console.log('- If "89 50 4e 47 0d 0a 1a 0a" - this is PNG (wrong!)');
console.log('- If something like "00 02 00 00 00 02 00 00" - this is raw RGBA dimensions');
console.log('\nPlease check your console output above and look for these debug messages.');

// Quick check of what the backend might be returning
window.analyzeLastError = function() {
  console.log('\n=== Analyzing the Issue ===\n');
  
  console.log('The error at line 317 (createImageBitmap) means:');
  console.log('1. useRawRGBA = true (we want raw RGBA)');
  console.log('2. isRawRGBAFormat = true (we expect raw RGBA)');
  console.log('3. But the dimension validation failed (line 246-249 or 258-262)');
  console.log('4. So the code fell through to PNG decoding (line 314)');
  console.log('5. But the data is NOT PNG format, so createImageBitmap fails');
  
  console.log('\nThis suggests the backend is returning:');
  console.log('- Either corrupted raw RGBA data');
  console.log('- Or PNG data when we expect raw RGBA');
  console.log('- Or the dimensions in the header are invalid');
  
  console.log('\nCheck the backend console for:');
  console.log('- "🚀 RAW RGBA PATH: apply_and_render_view_state_raw called"');
  console.log('- "🚀 RAW RGBA: Skipping PNG encoding"');
  console.log('- "🚀 RAW RGBA: Returning X bytes of raw pixel data"');
};

window.analyzeLastError();