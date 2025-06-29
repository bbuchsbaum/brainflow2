// Quick test script to check if Tauri API is working
// Run this in the browser console when the app is open

async function testTauriAPI() {
    console.log('=== Tauri API Test ===');
    
    // Check for legacy global (should be undefined in v2)
    console.log('window.__TAURI__:', window.__TAURI__);
    
    try {
        // Try to import the Tauri API
        const { invoke } = await import('@tauri-apps/api/core');
        console.log('✅ Successfully imported @tauri-apps/api/core');
        
        // Test a simple API call
        try {
            const result = await invoke('plugin:api_bridge|fs_list_directory', { 
                pathStr: '/Users/bbuchsbaum/code/brainflow2/test-data' 
            });
            console.log('✅ API call successful!');
            console.log('Directory listing result:', result);
        } catch (e) {
            console.error('❌ API call failed:', e);
        }
        
    } catch (e) {
        console.error('❌ Failed to import Tauri API:', e);
    }
}

// Run the test
testTauriAPI();