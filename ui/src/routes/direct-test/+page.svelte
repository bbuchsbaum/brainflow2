<script lang="ts">
	import { onMount } from 'svelte';
	
	let logs = $state<string[]>([]);
	
	function log(msg: string) {
		logs = [...logs, msg];
		console.log(msg);
	}
	
	async function runDirectTest() {
		log('=== Direct Tauri Test ===');
		
		// Check if Tauri internals are available
		const tauriInternals = (window as any).__TAURI_INTERNALS__;
		if (!tauriInternals) {
			log('❌ Tauri internals not available on window');
			log('Window properties: ' + Object.keys(window).filter(k => k.includes('TAURI')).join(', '));
			return;
		}
		log('✓ Tauri internals found');
		
		// Import invoke from @tauri-apps/api/core
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			log('✓ invoke imported successfully');
			// Test 1: Simple command
			log('Testing supports_webgpu...');
			const supported = await invoke('plugin:api-bridge|supports_webgpu');
			log(`✓ WebGPU supported: ${supported}`);
			
			// Test 2: Load file
			log('Loading file...');
			const volume = await invoke('plugin:api-bridge|load_file', {
				path: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz'
			});
			log(`✓ File loaded: ${JSON.stringify(volume)}`);
			
			// Test 3: GPU resources
			log('Testing GPU resources...');
			const spec = {
				"Volume": {
					id: "direct-test",
					source_resource_id: volume.id,
					colormap: "viridis",
					slice_axis: "Axial",
					slice_index: "Middle"
				}
			};
			
			const gpuInfo = await invoke('plugin:api-bridge|request_layer_gpu_resources', {
				layer_spec: spec
			});
			log(`✅ GPU resources allocated!`);
			log(`GPU Info: ${JSON.stringify(gpuInfo, null, 2)}`);
			
		} catch (err) {
			log(`❌ Error: ${err}`);
			console.error('Full error:', err);
		}
	}
	
	onMount(() => {
		// Try immediately and after a delay
		runDirectTest();
		setTimeout(runDirectTest, 1000);
	});
</script>

<div style="padding: 1rem; font-family: monospace;">
	<h1>Direct Tauri Test</h1>
	<div style="background: #f0f0f0; padding: 1rem; border-radius: 4px; max-height: 80vh; overflow-y: auto;">
		{#each logs as line}
			<div>{line}</div>
		{/each}
	</div>
</div>