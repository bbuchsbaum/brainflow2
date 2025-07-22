<script lang="ts">
	import { onMount } from 'svelte';
	import { getService } from '$lib/di/Container';
	import type { VolumeService } from '$lib/services/VolumeService';
	import type { LayerService } from '$lib/services/LayerService';
	import type { LayerSpec } from '$lib/api';
	import { nanoid } from 'nanoid';
	
	let volumeService: VolumeService | null = null;
	let layerService: LayerService | null = null;
	let testPath = $state('/Users/bbuchsbaum/Downloads/test.nii');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);
	
	onMount(async () => {
		volumeService = await getService<VolumeService>('volumeService');
		layerService = await getService<LayerService>('layerService');
	});
	
	async function testLoadFile() {
		if (!volumeService || !layerService) {
			error = 'Services not initialized';
			return;
		}
		
		loading = true;
		error = null;
		success = null;
		
		try {
			console.log('🔥 Direct test: Loading file:', testPath);
			
			// Load volume
			const volumeHandle = await volumeService.loadVolume(testPath);
			console.log('✅ Volume loaded:', volumeHandle);
			
			if (!volumeHandle || !volumeHandle.id) {
				throw new Error('Invalid volume handle returned');
			}
			
			// Create layer
			const layerId = `layer-${nanoid(8)}`;
			const layerSpec: LayerSpec = {
				Volume: {
					id: layerId,
					source_resource_id: volumeHandle.id,
					colormap: 'grayscale',
					slice_axis: null,
					slice_index: null
				}
			};
			
			console.log('📦 Creating layer:', layerSpec);
			await layerService.addLayer(layerSpec);
			
			success = `Successfully loaded ${testPath}`;
			console.log('🎉 Success!');
		} catch (err) {
			console.error('💥 Error:', err);
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}
</script>

<div class="test-container">
	<h1>Direct File Loading Test</h1>
	
	<div class="controls">
		<label>
			File Path:
			<input type="text" bind:value={testPath} />
		</label>
		
		<button onclick={testLoadFile} disabled={loading || !testPath}>
			{loading ? 'Loading...' : 'Load File'}
		</button>
	</div>
	
	{#if error}
		<div class="error">Error: {error}</div>
	{/if}
	
	{#if success}
		<div class="success">{success}</div>
	{/if}
	
	<div class="info">
		<h2>Debug Info</h2>
		<p>Volume Service: {volumeService ? 'Loaded' : 'Not loaded'}</p>
		<p>Layer Service: {layerService ? 'Loaded' : 'Not loaded'}</p>
	</div>
</div>

<style>
	.test-container {
		padding: 2rem;
		max-width: 800px;
		margin: 0 auto;
	}
	
	.controls {
		display: flex;
		gap: 1rem;
		align-items: flex-end;
		margin: 2rem 0;
	}
	
	label {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
	}
	
	input {
		padding: 0.5rem;
		font-size: 1rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}
	
	button {
		padding: 0.5rem 1rem;
		font-size: 1rem;
		background: #3b82f6;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}
	
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	
	.error {
		padding: 1rem;
		background: #fee;
		color: #c00;
		border: 1px solid #fcc;
		border-radius: 4px;
		margin: 1rem 0;
	}
	
	.success {
		padding: 1rem;
		background: #efe;
		color: #060;
		border: 1px solid #cfc;
		border-radius: 4px;
		margin: 1rem 0;
	}
	
	.info {
		margin-top: 2rem;
		padding: 1rem;
		background: #f5f5f5;
		border-radius: 4px;
	}
	
	.info h2 {
		margin-top: 0;
	}
</style>