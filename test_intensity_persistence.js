// Test script to check if intensity values persist
// Run with: node test_intensity_persistence.js

const { execSync } = require('child_process');

console.log('Starting intensity persistence test...\n');

console.log('1. First, check the console logs for:');
console.log('   - "[StoreSyncService] ❌ CRITICAL: About to overwrite existing layer"');
console.log('   - "[StoreSyncService] ⚠️ DUPLICATE layer.added event"');
console.log('   - "[viewStateStore] Stack trace for 20-80% update"');
console.log('');

console.log('2. Load a volume file and observe the initial intensity values');
console.log('3. Change the intensity slider and watch for:');
console.log('   - "[LayerPanel] handleRenderUpdate" logs');
console.log('   - "[StoreSyncService] Marked layer as dirty" logs');
console.log('   - Backend logs showing new intensity values');
console.log('');

console.log('4. Move the crosshair or interact with other controls');
console.log('5. Check if intensity values snap back to 20-80% (1969.6-7878.4)');
console.log('');

console.log('Key things to look for:');
console.log('- Duplicate layer.added events');
console.log('- ViewState being overwritten');
console.log('- Dirty flag not being respected');
console.log('- Feedback loops in ViewState subscription');

console.log('\nPress Ctrl+C to exit when done testing.');