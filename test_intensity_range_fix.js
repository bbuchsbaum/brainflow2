// Test script to verify intensity range fix
const { invoke } = window.__TAURI__.core;

async function testIntensityRangeFix() {
    console.log("=== Testing Intensity Range Fix ===");
    
    try {
        // 1. Load a test file
        console.log("1. Loading test file...");
        const loadResult = await invoke('plugin:api-bridge|load_file', {
            path: './test-data/MNI152_T1_1mm.nii.gz'
        });
        console.log("Load result:", loadResult);
        
        // 2. Initialize render loop
        console.log("\n2. Initializing render loop...");
        await invoke('plugin:api-bridge|init_render_loop');
        
        // 3. Create offscreen render target
        console.log("\n3. Creating offscreen render target...");
        await invoke('plugin:api-bridge|create_offscreen_render_target', {
            width: 512,
            height: 512
        });
        
        // 4. Create view state that triggers on-demand allocation
        console.log("\n4. Testing on-demand allocation with apply_and_render_view_state...");
        const viewState = {
            views: {
                axial: {
                    origin_mm: [-90, -126, -72],
                    u_mm: [1, 0, 0],
                    v_mm: [0, 1, 0]
                },
                sagittal: {
                    origin_mm: [-90, -126, -72],
                    u_mm: [0, 1, 0],
                    v_mm: [0, 0, 1]
                },
                coronal: {
                    origin_mm: [-90, -126, -72],
                    u_mm: [1, 0, 0],
                    v_mm: [0, 0, 1]
                }
            },
            crosshair: {
                world_mm: [0, 0, 0],
                visible: true
            },
            layers: [{
                id: `layer-${loadResult.id}`,
                volumeId: loadResult.id,
                visible: true,
                opacity: 1.0,
                colormap: "grayscale",
                intensity: [0, 1], // This will be overridden by actual data range
                threshold: [0, 1],
                blendMode: "normal"
            }],
            requestedView: {
                type: "axial",
                origin_mm: [-90, -126, 0, 1],
                u_mm: [180, 0, 0, 0],
                v_mm: [0, 216, 0, 0],
                width: 512,
                height: 512
            }
        };
        
        console.log("Calling apply_and_render_view_state...");
        console.log("Note: Watch the Rust console for debug output about data_range");
        
        const imageData = await invoke('plugin:api-bridge|apply_and_render_view_state', {
            viewStateJson: JSON.stringify(viewState)
        });
        
        console.log("\n5. Success! Image rendered with size:", imageData.length, "bytes");
        console.log("Check the Rust console output above for:");
        console.log("  - 'On-demand allocation computed data range: (X, Y)'");
        console.log("  - 'Successfully registered volume ... with data range (X, Y)'");
        console.log("  - 'DEBUG: Copying volume metadata ... data_range: (X, Y)'");
        console.log("\nIf the data_range shows actual values (not just 0, 1), the fix is working!");
        
        // Also test the regular allocation path
        console.log("\n6. Testing regular allocation with request_layer_gpu_resources...");
        const layerSpec = {
            type: "volume",
            id: `layer2-${loadResult.id}`,
            sourceResourceId: loadResult.id,
            colormap: "grayscale",
            opacity: 1.0,
            visible: true
        };
        
        const gpuInfo = await invoke('plugin:api-bridge|request_layer_gpu_resources', {
            layerSpec: layerSpec
        });
        
        console.log("GPU info data_range:", gpuInfo.dataRange);
        console.log("\n=== Test Complete ===");
        
    } catch (error) {
        console.error("Test failed:", error);
    }
}

// Run the test when the page loads
if (window.__TAURI__) {
    testIntensityRangeFix();
} else {
    console.error("This test must be run in the Tauri environment");
}