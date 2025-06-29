// Paste this in the browser console when the Tauri app is open

console.log('=== Testing Tauri API ===');

// Test 1: Check if window.__TAURI__ exists (should be undefined in v2)
console.log('window.__TAURI__:', window.__TAURI__);

// Test 2: Try to import and use the API
(async () => {
    try {
        // Import the Tauri API module
        const { invoke } = await import('@tauri-apps/api/core');
        console.log('✅ Successfully imported Tauri API');
        
        // Test 3: Try a simple API call
        console.log('Testing fs_list_directory...');
        const result = await invoke('plugin:api_bridge|fs_list_directory', {
            path_str: '/tmp'
        });
        console.log('✅ API call successful!');
        console.log('Result:', result);
        
        // Test 4: Try loading a file
        console.log('Testing load_file...');
        const fileResult = await invoke('plugin:api_bridge|load_file', {
            path_str: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz'
        });
        console.log('✅ File loaded!');
        console.log('File info:', fileResult);
        
    } catch (error) {
        console.error('❌ Error:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            type: error.constructor.name
        });
    }
})();