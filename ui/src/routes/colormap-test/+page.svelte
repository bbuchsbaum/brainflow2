<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	import { useLayerStore } from '$lib/stores/layerStore';
	import { useVolumeStore } from '$lib/stores/volumeStore';
	import OrthogonalViewGPU from '$lib/components/OrthogonalViewGPU.svelte';
	import { getColormapId, COLORMAP_OPTIONS, getColormapName } from '$lib/utils/colormaps';
	import type { VolumeMeta, Vec3 } from '$lib/geometry/types';
	
	let selectedColormap = $state('grayscale');
	let volumeMeta: VolumeMeta | null = $state(null);
	let crosshairWorld: Vec3 = $state({ x: 0, y: 0, z: 0 });
	let volumeId = $state<string | null>(null);
	let isLoading = $state(true);
	let errorMessage = $state<string | null>(null);
	
	// Computed GPU layers based on selected colormap
	let gpuLayers = $derived(volumeId ? [{
		volumeId: volumeId,
		colormapId: getColormapId(selectedColormap),
		opacity: 1.0,
		window: { level: 0.5, width: 1.0 }
	}] : []);
	
	async function loadTestVolume() {
		try {
			isLoading = true;
			errorMessage = null;
			
			// Initialize render loop
			await coreApi.init_render_loop();
			
			// Load test volume
			const volumePath = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii';
			const handleInfo = await coreApi.load_file(volumePath);
			
			// Add to volume store
			useVolumeStore.getState().add(handleInfo);
			
			// Create layer
			const layerId = `colormap-test-${Date.now()}`;
			const layerSpec = {
				Volume: {
					id: layerId,
					source_resource_id: handleInfo.id,
					colormap: selectedColormap,
					slice_axis: null,
					slice_index: null
				}
			};
			
			// Add layer and request GPU resources
			useLayerStore.getState().addLayer(layerSpec);
			await useLayerStore.getState().requestGpuResources(layerId);
			
			// Get volume metadata
			const layer = useLayerStore.getState().layers.find(l => 
				l.spec && 'Volume' in l.spec && l.spec.Volume.id === layerId
			);
			
			if (layer && layer.gpu && 'dim' in layer.gpu) {
				const gpu = layer.gpu;
				volumeMeta = {
					dims: { x: gpu.dim[0], y: gpu.dim[1], z: gpu.dim[2] },
					spacing: { x: gpu.spacing[0], y: gpu.spacing[1], z: gpu.spacing[2] },
					origin: { x: gpu.origin[0], y: gpu.origin[1], z: gpu.origin[2] }
				};
				
				// Initialize crosshair at center
				crosshairWorld = {
					x: volumeMeta.origin.x + (volumeMeta.dims.x * volumeMeta.spacing.x) / 2,
					y: volumeMeta.origin.y + (volumeMeta.dims.y * volumeMeta.spacing.y) / 2,
					z: volumeMeta.origin.z + (volumeMeta.dims.z * volumeMeta.spacing.z) / 2
				};
				
				volumeId = layerId;
			}
			
			isLoading = false;
		} catch (error) {
			console.error('Failed to load volume:', error);
			errorMessage = `Error: ${error}`;
			isLoading = false;
		}
	}
	
	function handleCrosshairChanged(event: CustomEvent<Vec3>) {
		crosshairWorld = event.detail;
	}
	
	onMount(() => {
		loadTestVolume();
	});
</script>

<div class="colormap-test">
	<h1>Colormap Mapping Test</h1>
	
	<div class="controls">
		<label>
			Select Colormap:
			<select bind:value={selectedColormap}>
				{#each COLORMAP_OPTIONS as option}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		</label>
		
		<div class="info">
			<strong>Selected:</strong> {selectedColormap}
			<strong>ID:</strong> {getColormapId(selectedColormap)}
			<strong>Name from ID:</strong> {getColormapName(getColormapId(selectedColormap))}
		</div>
	</div>
	
	{#if isLoading}
		<div class="loading">Loading test volume...</div>
	{:else if errorMessage}
		<div class="error">{errorMessage}</div>
	{:else if volumeMeta}
		<div class="viewer-container">
			<OrthogonalViewGPU
				{volumeMeta}
				{crosshairWorld}
				showCrosshair={true}
				layers={gpuLayers}
				on:crosshairChanged={handleCrosshairChanged}
			/>
		</div>
	{/if}
</div>

<style>
	.colormap-test {
		padding: 20px;
		max-width: 1200px;
		margin: 0 auto;
	}
	
	.controls {
		margin-bottom: 20px;
		padding: 15px;
		background: #f5f5f5;
		border-radius: 5px;
	}
	
	.controls label {
		display: block;
		margin-bottom: 10px;
	}
	
	.controls select {
		margin-left: 10px;
		padding: 5px;
		font-size: 14px;
	}
	
	.info {
		margin-top: 10px;
		font-family: monospace;
		font-size: 14px;
	}
	
	.info strong {
		margin-right: 5px;
		margin-left: 10px;
	}
	
	.info strong:first-child {
		margin-left: 0;
	}
	
	.viewer-container {
		height: 600px;
		border: 1px solid #ddd;
		border-radius: 5px;
		overflow: hidden;
		background: #000;
	}
	
	.loading, .error {
		padding: 20px;
		text-align: center;
		font-size: 16px;
	}
	
	.error {
		color: #d32f2f;
		background: #ffebee;
		border-radius: 5px;
	}
	
	h1 {
		margin-bottom: 20px;
		color: #333;
	}
</style>