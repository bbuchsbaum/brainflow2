<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	import { useLayerStore } from '$lib/stores/layerStore';
	import { crosshairSlice } from '$lib/stores/crosshairSlice';
	import OrthogonalViewContainer from '$lib/components/views/OrthogonalViewContainer.svelte';
	import type { VolumeHandleInfo } from '@brainflow/api';

	let selectedLayerId = $state<string | null>(null);
	let loadedVolume = $state<VolumeHandleInfo | null>(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	async function loadDemoVolume() {
		try {
			isLoading = true;
			error = null;

			// Load test volume - update this path to match your actual test file
			// Using the 64x64x25 brain mask
			const testPath = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/global_mask2.nii';
			console.log('[Demo] Loading volume from path:', testPath);
			const volumeInfo = await coreApi.load_file(testPath);
			console.log('[Demo] Volume loaded:', volumeInfo);
			loadedVolume = volumeInfo;

			// Create layer spec
			const layerId = `demo-layer-${Date.now()}`;
			const layerSpec = {
				"Volume": {
					id: layerId,
					source_resource_id: volumeInfo.id,
					colormap: 'gray', // Changed to grayscale for binary mask
					slice_axis: 'Axial' as const,
					slice_index: 'Middle' as const
				}
			};

			// Add to layer store
			await useLayerStore.getState().addLayer(layerSpec);
			
			// Request GPU resources for the layer
			await useLayerStore.getState().requestGpuResources(layerId);
			
			// Set as selected layer
			selectedLayerId = layerId;

			// Don't manually set crosshair - let layerStore handle it when GPU resources are loaded
			// The layerStore will calculate the proper center from the voxel_to_world transform
			console.log('Demo page: Letting layerStore initialize crosshair from volume metadata');

		} catch (err) {
			error = `Failed to load volume: ${err}`;
		} finally {
			isLoading = false;
		}
	}

	// Subscribe to crosshair changes
	let currentCrosshair = $state(crosshairSlice.getState());
	
	onMount(() => {
		const unsubscribe = crosshairSlice.subscribe((state) => {
			currentCrosshair = state;
		});

		return unsubscribe;
	});
</script>

<div class="demo-page">
	<header>
		<h1>Orthogonal View Demo</h1>
		<div class="controls">
			<button onclick={loadDemoVolume} disabled={isLoading}>
				{isLoading ? 'Loading...' : 'Load Demo Volume'}
			</button>
			
			{#if loadedVolume}
				<div class="volume-info">
					<span>Volume: {loadedVolume.dims[0]}×{loadedVolume.dims[1]}×{loadedVolume.dims[2]}</span>
					<span>Dtype: {loadedVolume.dtype}</span>
				</div>
			{/if}
			
			{#if currentCrosshair.crosshairWorldCoord}
				<div class="crosshair-info">
					Crosshair: [{currentCrosshair.crosshairWorldCoord[0]}, {currentCrosshair.crosshairWorldCoord[1]}, {currentCrosshair.crosshairWorldCoord[2]}]
				</div>
			{/if}
		</div>
	</header>

	{#if error}
		<div class="error-message">
			{error}
		</div>
	{/if}

	<main>
		<OrthogonalViewContainer selectedLayerId={selectedLayerId} />
	</main>
</div>

<style>
	.demo-page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background-color: #0a0a0a;
		color: #fff;
	}

	header {
		padding: 1rem;
		background-color: #1a1a1a;
		border-bottom: 1px solid #333;
	}

	h1 {
		margin: 0 0 1rem 0;
		font-size: 1.5rem;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	button {
		padding: 0.5rem 1rem;
		background-color: #4dabf7;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 14px;
		transition: background-color 0.2s;
	}

	button:hover:not(:disabled) {
		background-color: #339af0;
	}

	button:disabled {
		background-color: #495057;
		cursor: not-allowed;
	}

	.volume-info, .crosshair-info {
		display: flex;
		gap: 1rem;
		font-size: 14px;
		color: #aaa;
	}

	.error-message {
		padding: 1rem;
		background-color: #c92a2a;
		color: white;
		text-align: center;
	}

	main {
		flex: 1;
		overflow: hidden;
	}
</style>