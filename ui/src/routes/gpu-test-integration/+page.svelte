<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	import { useLayerStore } from '$lib/stores/layerStore';
	import { useVolumeStore } from '$lib/stores/volumeStore';
	import VolumeView from '$lib/components/views/VolumeView.svelte';
	
	let testStatus = $state('');
	let volumeLoaded = $state(false);
	
	async function runTest() {
		testStatus = 'Starting GPU integration test...';
		
		try {
			// Step 1: Initialize render loop
			testStatus += '\n1. Initializing render loop...';
			await coreApi.init_render_loop();
			testStatus += ' ✓';
			
			// Step 2: Load test volume
			testStatus += '\n2. Loading test volume...';
			const volumePath = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii';
			const handleInfo = await coreApi.load_file(volumePath);
			testStatus += ` ✓ (ID: ${handleInfo.id})`;
			
			// Step 3: Add to volume store
			testStatus += '\n3. Adding to volume store...';
			useVolumeStore.getState().add(handleInfo);
			testStatus += ' ✓';
			
			// Step 4: Create layer spec
			testStatus += '\n4. Creating layer spec...';
			const layerId = `test-layer-${Date.now()}`;
			const layerSpec = {
				Volume: {
					id: layerId,
					source_resource_id: handleInfo.id,
					colormap: 'grayscale',
					slice_axis: null,
					slice_index: null
				}
			};
			testStatus += ' ✓';
			
			// Step 5: Add layer and request GPU resources
			testStatus += '\n5. Adding layer and requesting GPU resources...';
			useLayerStore.getState().addLayer(layerSpec);
			await useLayerStore.getState().requestGpuResources(layerId);
			testStatus += ' ✓';
			
			// Step 6: Verify GPU resources loaded
			testStatus += '\n6. Verifying GPU resources...';
			const layer = useLayerStore.getState().layers.find(l => 
				l.spec && 'Volume' in l.spec && l.spec.Volume.id === layerId
			);
			
			if (layer && layer.gpu) {
				testStatus += ` ✓ (Dims: ${layer.gpu.dim.join('x')})`;
				volumeLoaded = true;
			} else {
				testStatus += ' ✗ (GPU resources not found)';
			}
			
			testStatus += '\n\nGPU integration test completed!';
			
		} catch (error) {
			testStatus += `\n\n❌ Error: ${error}`;
			console.error('GPU test error:', error);
		}
	}
	
	onMount(() => {
		// Run test automatically on mount
		runTest();
	});
</script>

<div class="test-page">
	<h1>GPU Rendering Integration Test</h1>
	
	<div class="test-status">
		<pre>{testStatus}</pre>
	</div>
	
	{#if volumeLoaded}
		<div class="volume-view-container">
			<h2>GPU-Rendered Volume View</h2>
			<VolumeView />
		</div>
	{/if}
</div>

<style>
	.test-page {
		padding: 20px;
		max-width: 1200px;
		margin: 0 auto;
	}
	
	.test-status {
		background: #f0f0f0;
		padding: 15px;
		border-radius: 5px;
		margin-bottom: 20px;
		font-family: monospace;
	}
	
	.volume-view-container {
		margin-top: 20px;
		height: 600px;
		border: 1px solid #ccc;
		border-radius: 5px;
		overflow: hidden;
	}
	
	h1 {
		color: #333;
		margin-bottom: 20px;
	}
	
	h2 {
		color: #555;
		margin-bottom: 10px;
	}
	
	pre {
		margin: 0;
		white-space: pre-wrap;
	}
</style>