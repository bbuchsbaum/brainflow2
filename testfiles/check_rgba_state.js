// Quick diagnostic script
console.log('=== Checking Raw RGBA State ===\n');

// Check current state
console.log('1. Current apiService settings:');
console.log('   useRawRGBA:', window.apiService?.useRawRGBA);
console.log('   useBinaryIPC:', window.apiService?.useBinaryIPC);
console.log('   debugBrighten:', window.apiService?.debugBrighten);

console.log('\n2. The error "Data is not a valid PNG file!" means:');
console.log('   - We received data that is NOT PNG format');
console.log('   - But the code fell through to PNG decoding path');
console.log('   - This happens when raw RGBA validation fails');

console.log('\n3. Since useRawRGBA defaults to true, on page load:');
console.log('   - It tries to use raw RGBA path');
console.log('   - Something goes wrong with raw RGBA');
console.log('   - Falls back to PNG decoding');
console.log('   - But data isn\'t PNG, so it fails');

console.log('\n4. To fix temporarily and see if PNG path works:');
console.log('   window.setRawRGBA(false)  // Disable raw RGBA');
console.log('   Then trigger a render by moving crosshair');

console.log('\n5. To debug what\'s wrong with raw RGBA:');
console.log('   window.setRawRGBA(true)   // Re-enable');
console.log('   window.debugRawRGBA()     // Run debug function');
console.log('   Check the "First 8 bytes" output');