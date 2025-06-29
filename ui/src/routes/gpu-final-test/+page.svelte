<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	
	let logs = $state<string[]>([]);
	let success = $state(false);
	let errorMsg = $state<string | null>(null);
	
	function log(msg: string) {
		const time = new Date().toLocaleTimeString();
		logs = [...logs, `[${time}] ${msg}`];
		console.log(`[${time}] ${msg}`);
	}
	
	async function runFullTest() {
		log('Starting full GPU test...');
		
		try {
			// Test 1: Check Tauri is available
			log('Checking Tauri availability...');
			if (!(window as any).__TAURI__) {
				throw new Error('Tauri not available');
			}
			log('✓ Tauri is available');
			
			// Test 2: Test supports_webgpu
			log('Testing supports_webgpu command...');
			const supported = await invoke('plugin:api-bridge|supports_webgpu');
			log(`✓ WebGPU supported: ${supported}`);
			
			// Test 3: Load file
			log('Loading test volume...');
			const volume = await invoke('plugin:api-bridge|load_file', {
				path: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz'
			});
			log(`✓ Volume loaded: ${JSON.stringify(volume)}`);
			
			// Test 4: Build layer spec
			const layerSpec = {
				"Volume": {
					id: "test-" + Date.now(),
					source_resource_id: (volume as any).id,
					colormap: "viridis",
					slice_axis: "Axial",
					slice_index: "Middle"
				}
			};
			log('Layer spec created:');
			log(JSON.stringify(layerSpec, null, 2));
			
			// Test 5: Call request_layer_gpu_resources
			log('Calling request_layer_gpu_resources...');
			const startTime = performance.now();
			
			const gpuInfo = await invoke('plugin:api-bridge|request_layer_gpu_resources', {
				layer_spec: layerSpec
			});
			
			const elapsed = (performance.now() - startTime).toFixed(2);
			log(`✅ SUCCESS! GPU resources allocated in ${elapsed}ms`);
			log('GPU Info:');
			log(JSON.stringify(gpuInfo, null, 2));
			
		} catch (err) {
			log(`❌ ERROR: ${err}`);
			log(`Error type: ${typeof err}`);
			log(`Error details: ${JSON.stringify(err, null, 2)}`);
		}
	}
</script>

<div style="padding: 1rem;">
	<h1>GPU Final Test</h1>
	<button onclick={runFullTest}>Run Full Test</button>
	
	<div style="margin-top: 1rem; background: #f5f5f5; padding: 1rem; border-radius: 4px; font-family: monospace; font-size: 0.9rem; max-height: 70vh; overflow-y: auto;">
		{#each logs as line}
			<div>{line}</div>
		{/each}
	</div>
</div>