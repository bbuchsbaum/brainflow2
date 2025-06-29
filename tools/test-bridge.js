#!/usr/bin/env node

/**
 * Test the Tauri API bridge commands directly
 * This script simulates Tauri invoke calls for testing
 */

const fs = require('fs');
const path = require('path');

// Mock Tauri invoke for testing
const mockResults = {
    'plugin:api-bridge|supports_webgpu': true,
    'plugin:api-bridge|fs_list_directory': {
        nodes: [
            { id: '/test/file1.nii', name: 'file1.nii', parent_idx: null, icon_id: 1, is_dir: false },
            { id: '/test/subdir', name: 'subdir', parent_idx: null, icon_id: 2, is_dir: true }
        ]
    },
    'plugin:api-bridge|load_file': {
        id: 'volume-test-123',
        name: 'test.nii.gz',
        dims: [256, 256, 128],
        dtype: 'float32'
    }
};

async function invoke(command, args) {
    console.log(`\n📞 Calling: ${command}`);
    console.log('   Args:', JSON.stringify(args, null, 2));
    
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const result = mockResults[command];
    if (result) {
        console.log('✅ Result:', JSON.stringify(result, null, 2));
        return result;
    } else {
        const error = new Error(`Command ${command} not mocked`);
        console.log('❌ Error:', error.message);
        throw error;
    }
}

// Test commands
async function runTests() {
    console.log('🧪 Testing Tauri API Bridge Commands\n');
    
    try {
        // Test 1: WebGPU support
        await invoke('plugin:api-bridge|supports_webgpu', {});
        
        // Test 2: List directory
        await invoke('plugin:api-bridge|fs_list_directory', {
            dir: '/test-data'
        });
        
        // Test 3: Load file
        await invoke('plugin:api-bridge|load_file', {
            path: '/test-data/unit/toy_t1w.nii.gz'
        });
        
        // Test 4: World to voxel (will fail - not mocked)
        await invoke('plugin:api-bridge|world_to_voxel', {
            volumeId: 'volume-test-123',
            worldCoord: [10, 20, 30]
        });
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
    }
    
    console.log('\n✨ Test run complete!');
}

// Interactive mode
if (process.argv.includes('--interactive')) {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    console.log('🎮 Interactive Mode - Enter commands in format: command_name {args}');
    console.log('   Example: load_file {"path": "/test.nii"}');
    console.log('   Type "exit" to quit\n');
    
    function prompt() {
        rl.question('> ', async (input) => {
            if (input === 'exit') {
                rl.close();
                return;
            }
            
            try {
                const [cmd, ...argsParts] = input.split(' ');
                const args = argsParts.length > 0 ? JSON.parse(argsParts.join(' ')) : {};
                await invoke(`plugin:api-bridge|${cmd}`, args);
            } catch (error) {
                console.error('Error:', error.message);
            }
            
            prompt();
        });
    }
    
    prompt();
} else {
    runTests();
}