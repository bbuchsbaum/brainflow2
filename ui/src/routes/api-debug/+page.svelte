<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	
	let logs = $state<string[]>([]);
	
	function log(msg: string) {
		logs = [...logs, `${new Date().toLocaleTimeString()}: ${msg}`];
		console.log(msg);
	}
	
	async function testDirectInvoke() {
		log('Testing direct Tauri invoke...');
		
		try {
			// Test 1: Direct invoke without wrapper
			log('Test 1: Calling load_file directly...');
			const volume = await invoke('plugin:api-bridge|load_file', { 
				path: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz' 
			});
			log(`✓ load_file succeeded: ${JSON.stringify(volume)}`);
			
			// Test 2: Create a minimal layer spec
			log('\nTest 2: Creating layer spec...');
			const layerSpec = {
				"Volume": {
					id: 'test-layer',
					source_resource_id: (volume as any).id,
					colormap: 'viridis',
					slice_axis: 'Axial',
					slice_index: "Middle"
				}
			};
			log(`Layer spec: ${JSON.stringify(layerSpec, null, 2)}`);
			
			// Test 3: Try to invoke request_layer_gpu_resources
			log('\nTest 3: Calling request_layer_gpu_resources...');
			try {
				const gpuInfo = await invoke('plugin:api-bridge|request_layer_gpu_resources', { 
					layer_spec: layerSpec 
				});
				log(`✓ GPU resources allocated: ${JSON.stringify(gpuInfo)}`);
			} catch (err) {
				log(`❌ request_layer_gpu_resources failed: ${err}`);
				log(`Error type: ${typeof err}`);
				log(`Error details: ${JSON.stringify(err, null, 2)}`);
			}
			
		} catch (err) {
			log(`❌ Error: ${err}`);
		}
	}
	
	async function listCommands() {
		log('\nChecking available commands...');
		
		// Test if we can call init_render_loop
		try {
			await invoke('plugin:api-bridge|init_render_loop', {});
			log('✓ init_render_loop is available');
		} catch (err) {
			log('❌ init_render_loop failed');
		}
		
		// Test if we can call supports_webgpu
		try {
			const supported = await invoke('plugin:api-bridge|supports_webgpu', {});
			log(`✓ supports_webgpu is available: ${supported}`);
		} catch (err) {
			log('❌ supports_webgpu failed');
		}
	}
	
	onMount(() => {
		listCommands();
		testDirectInvoke();
	});
</script>

<div style="padding: 2rem; font-family: monospace;">
	<h1>API Debug Test</h1>
	
	<div style="background: #f0f0f0; padding: 1rem; border-radius: 4px; max-height: 80vh; overflow-y: auto;">
		{#each logs as line}
			<div style="padding: 2px 0; white-space: pre-wrap;">{line}</div>
		{/each}
	</div>
</div>