<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	import { useLayerStore } from '$lib/stores/layerStore';
	import { useVolumeStore } from '$lib/stores/volumeStore';
	import { getGpuRenderManager } from '$lib/gpu/renderManager';
	import OrthogonalViewGPU from '$lib/components/OrthogonalViewGPU.svelte';
	import { getColormapId } from '$lib/utils/colormaps';
	import type { VolumeMeta, Vec3 } from '$lib/geometry/types';
	
	let volumeMeta: VolumeMeta | null = $state(null);
	let crosshairWorld: Vec3 = $state({ x: 0, y: 0, z: 0 });
	let volumeId = $state<string | null>(null);
	let isLoading = $state(true);
	
	// Window/Level controls
	let windowLevel = $state(0);
	let windowWidth = $state(1000);
	let dataMin = $state(0);
	let dataMax = $state(1000);
	
	// Opacity control
	let opacity = $state(1.0);
	
	// Colormap
	let selectedColormap = $state('grayscale');
	
	// Computed GPU layers
	let gpuLayers = $derived(volumeId ? [{
		volumeId: volumeId,
		colormapId: getColormapId(selectedColormap),
		opacity: opacity,
		window: { 
			level: windowLevel,
			width: windowWidth
		}
	}] : []);
	
	async function loadTestVolume() {
		try {
			isLoading = true;
			
			// Initialize render loop
			await coreApi.init_render_loop();
			const renderManager = getGpuRenderManager();
			await renderManager.initialize();
			
			// Load test volume
			const volumePath = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii';
			const handleInfo = await coreApi.load_file(volumePath);
			
			// Add to volume store
			useVolumeStore.getState().add(handleInfo);
			
			// Create layer
			const layerId = `window-test-${Date.now()}`;
			const layerSpec = {
				Volume: {
					id: layerId,
					source_resource_id: handleInfo.id,
					colormap: 'grayscale',
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
			
			if (layer && layer.gpu) {
				const gpu = layer.gpu;
				
				// Set up volume metadata
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
				
				// Set data range if available
				if (gpu.data_range) {
					dataMin = gpu.data_range.min;
					dataMax = gpu.data_range.max;
					windowLevel = (dataMin + dataMax) / 2;
					windowWidth = dataMax - dataMin;
				}
				
				volumeId = layerId;
			}
			
			isLoading = false;
		} catch (error) {
			console.error('Failed to load volume:', error);
			isLoading = false;
		}
	}
	
	function handleCrosshairChanged(event: CustomEvent<Vec3>) {
		crosshairWorld = event.detail;
	}
	
	// Auto window/level presets
	function applyPreset(preset: 'full' | 'bone' | 'soft' | 'lung') {
		switch (preset) {
			case 'full':
				windowLevel = (dataMin + dataMax) / 2;
				windowWidth = dataMax - dataMin;
				break;
			case 'bone':
				windowLevel = 300;
				windowWidth = 1500;
				break;
			case 'soft':
				windowLevel = 40;
				windowWidth = 400;
				break;
			case 'lung':
				windowLevel = -600;
				windowWidth = 1500;
				break;
		}
	}
	
	onMount(() => {
		loadTestVolume();
	});
</script>

<div class="window-level-test">
	<h1>Window/Level Controls Test</h1>
	
	<div class="controls-panel">
		<div class="control-group">
			<h3>Window/Level</h3>
			<div class="control">
				<label>
					Window Center: {windowLevel.toFixed(0)}
					<input 
						type="range" 
						bind:value={windowLevel}
						min={dataMin}
						max={dataMax}
						step="1"
					/>
				</label>
			</div>
			<div class="control">
				<label>
					Window Width: {windowWidth.toFixed(0)}
					<input 
						type="range" 
						bind:value={windowWidth}
						min="1"
						max={dataMax - dataMin}
						step="1"
					/>
				</label>
			</div>
			<div class="presets">
				<button onclick={() => applyPreset('full')}>Full Range</button>
				<button onclick={() => applyPreset('bone')}>Bone</button>
				<button onclick={() => applyPreset('soft')}>Soft Tissue</button>
				<button onclick={() => applyPreset('lung')}>Lung</button>
			</div>
		</div>
		
		<div class="control-group">
			<h3>Display</h3>
			<div class="control">
				<label>
					Opacity: {(opacity * 100).toFixed(0)}%
					<input 
						type="range" 
						bind:value={opacity}
						min="0"
						max="1"
						step="0.01"
					/>
				</label>
			</div>
			<div class="control">
				<label>
					Colormap:
					<select bind:value={selectedColormap}>
						<option value="grayscale">Grayscale</option>
						<option value="hot">Hot</option>
						<option value="viridis">Viridis</option>
						<option value="plasma">Plasma</option>
						<option value="turbo">Turbo</option>
					</select>
				</label>
			</div>
		</div>
		
		<div class="info">
			<h3>Data Info</h3>
			<p>Min: {dataMin.toFixed(2)}</p>
			<p>Max: {dataMax.toFixed(2)}</p>
			<p>Range: {(dataMax - dataMin).toFixed(2)}</p>
		</div>
	</div>
	
	{#if isLoading}
		<div class="loading">Loading test volume...</div>
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
	.window-level-test {
		display: grid;
		grid-template-columns: 300px 1fr;
		grid-template-rows: auto 1fr;
		gap: 20px;
		padding: 20px;
		height: 100vh;
		background: #f5f5f5;
	}
	
	h1 {
		grid-column: 1 / -1;
		margin: 0;
		color: #333;
	}
	
	.controls-panel {
		background: white;
		border-radius: 8px;
		padding: 20px;
		box-shadow: 0 2px 4px rgba(0,0,0,0.1);
		overflow-y: auto;
	}
	
	.control-group {
		margin-bottom: 30px;
	}
	
	.control-group h3 {
		margin: 0 0 15px 0;
		color: #555;
		font-size: 16px;
		border-bottom: 1px solid #eee;
		padding-bottom: 5px;
	}
	
	.control {
		margin-bottom: 15px;
	}
	
	.control label {
		display: block;
		font-size: 14px;
		color: #666;
		margin-bottom: 5px;
	}
	
	.control input[type="range"] {
		width: 100%;
		margin-top: 5px;
	}
	
	.control select {
		width: 100%;
		padding: 5px;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 14px;
	}
	
	.presets {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 5px;
		margin-top: 10px;
	}
	
	.presets button {
		padding: 5px 10px;
		background: #f0f0f0;
		border: 1px solid #ddd;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		transition: background 0.2s;
	}
	
	.presets button:hover {
		background: #e0e0e0;
	}
	
	.info {
		background: #f9f9f9;
		padding: 15px;
		border-radius: 4px;
		font-size: 14px;
	}
	
	.info h3 {
		margin: 0 0 10px 0;
		font-size: 14px;
		color: #666;
	}
	
	.info p {
		margin: 5px 0;
		font-family: monospace;
		color: #555;
	}
	
	.viewer-container {
		background: #000;
		border-radius: 8px;
		overflow: hidden;
		box-shadow: 0 2px 8px rgba(0,0,0,0.2);
	}
	
	.loading {
		grid-column: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 18px;
		color: #666;
	}
</style>