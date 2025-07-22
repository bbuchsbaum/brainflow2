<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	import { layerStore } from '$lib/stores/layerStore';
	import VolumeView from '$lib/components/views/VolumeView.svelte';
	import { getService } from '$lib/di/Container';
	import type { LayerService } from '$lib/services/LayerService';
	import type { LayerSpec } from '@brainflow/api';
	import { nanoid } from 'nanoid';

	let layerService: LayerService | null = null;
	let selectedLayerId = $state<string | null>(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	onMount(async () => {
		layerService = await getService<LayerService>('layerService');
		await coreApi.init_render_loop();
	});

	async function loadTwoVolumes() {
		if (!layerService) return;
		
		isLoading = true;
		error = null;

		try {
			// Load first volume (brain T1)
			console.log('Loading first volume...');
			const volume1 = await coreApi.load_file(
				'/Users/bbuchsbaum/code/brainflow2/test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii'
			);
			
			const layer1Spec: LayerSpec = {
				Volume: {
					id: `t1-${nanoid(5)}`,
					source_resource_id: volume1.id,
					colormap: 'grayscale',
					slice_axis: null,
					slice_index: null
				}
			};
			
			const layer1Id = await layerService.addLayer(layer1Spec);
			selectedLayerId = layer1Id;
			
			// Wait a bit for GPU resources
			await new Promise(resolve => setTimeout(resolve, 500));
			
			// Load second volume (mask) with transparency
			console.log('Loading second volume...');
			const volume2 = await coreApi.load_file(
				'/Users/bbuchsbaum/code/brainflow2/test-data/unit/global_mask2.nii'
			);
			
			const layer2Spec: LayerSpec = {
				Volume: {
					id: `mask-${nanoid(5)}`,
					source_resource_id: volume2.id,
					colormap: 'hot',
					slice_axis: null,
					slice_index: null
				}
			};
			
			const layer2Id = await layerService.addLayer(layer2Spec);
			
			// Set mask to 50% opacity
			await layerService.updateLayerOpacity(layer2Id, 0.5);
			
			console.log('Both volumes loaded successfully');
		} catch (err) {
			console.error('Failed to load volumes:', err);
			error = `Failed to load: ${err}`;
		} finally {
			isLoading = false;
		}
	}

	// Monitor layer state
	$effect(() => {
		console.log('Layer state updated:', {
			count: $layerStore.layers.length,
			layers: $layerStore.layers.map(l => ({
				id: l.id,
				visible: l.visible,
				opacity: l.opacity,
				colormap: l.colormap,
				hasGpu: !!l.gpu
			}))
		});
	});
</script>

<div class="test-page">
	<header>
		<h1>Simple Multi-Volume Test</h1>
		<button onclick={loadTwoVolumes} disabled={isLoading}>
			{isLoading ? 'Loading...' : 'Load Two Volumes'}
		</button>
		<span>Layers: {$layerStore.layers.length}</span>
	</header>

	{#if error}
		<div class="error">{error}</div>
	{/if}

	<main>
		{#if selectedLayerId}
			<VolumeView componentState={{ layerId: selectedLayerId }} />
		{:else}
			<div class="empty">Click "Load Two Volumes" to test multi-layer rendering</div>
		{/if}
	</main>

	<div class="layer-info">
		{#each $layerStore.layers as layer}
			<div>
				{layer.id}: {layer.colormap} @ {(layer.opacity * 100).toFixed(0)}% 
				{layer.gpu ? '(GPU ready)' : '(loading...)'}
			</div>
		{/each}
	</div>
</div>

<style>
	.test-page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #111;
		color: white;
	}

	header {
		padding: 1rem;
		background: #222;
		display: flex;
		align-items: center;
		gap: 1rem;
		border-bottom: 1px solid #444;
	}

	h1 {
		margin: 0;
		font-size: 1.25rem;
	}

	button {
		padding: 0.5rem 1rem;
		background: #3b82f6;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}

	button:disabled {
		background: #666;
		cursor: not-allowed;
	}

	.error {
		padding: 1rem;
		background: #dc2626;
		color: white;
	}

	main {
		flex: 1;
		overflow: hidden;
	}

	.empty {
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #666;
	}

	.layer-info {
		padding: 1rem;
		background: #1a1a1a;
		border-top: 1px solid #444;
		font-size: 14px;
		font-family: monospace;
	}
</style>