<script lang="ts">
	import { onMount } from 'svelte';
	import LayerPanel from '$lib/components/panels/LayerPanel.svelte';
	import { layerStore } from '$lib/stores/layerStore';
	import { useVolumeStore } from '$lib/stores/volumeStore';
	import { coreApi } from '$lib/api';
	import { getService } from '$lib/di/Container';
	import type { VolumeService } from '$lib/services/VolumeService';
	import type { LayerService } from '$lib/services/LayerService';
	import type { VolumeHandleInfo, LayerSpec } from '@brainflow/api';

	// Mock data for demo
	const mockVolume1: VolumeHandleInfo = {
		handle: 'volume-1',
		dims: [256, 256, 128],
		voxel_size: [1.0, 1.0, 2.0],
		data_range: [0, 4095],
		dtype: 'int16'
	};

	const mockVolume2: VolumeHandleInfo = {
		handle: 'volume-2',
		dims: [128, 128, 64],
		voxel_size: [2.0, 2.0, 3.0],
		data_range: [-1000, 3000],
		dtype: 'float32'
	};

	let gpuInitialized = $state(false);

	onMount(async () => {
		// Clear stores
		layerStore.clear();
		// volumeStore doesn't have a clear method, would need to remove volumes individually

		try {
			// Initialize GPU
			await coreApi.init_render_loop();
			gpuInitialized = true;

			// Add mock volumes
			// Note: volumeStore uses addVolume method with VolumeMetadata
			const volumeMetadata1 = {
				id: mockVolume1.handle,
				path: 'mock://volume1.nii',
				name: 'Brain MRI T1',
				dimensions: mockVolume1.dims as [number, number, number],
				voxelSize: mockVolume1.voxel_size as [number, number, number],
				dataType: mockVolume1.dtype,
				origin: [0, 0, 0] as [number, number, number],
				spacing: mockVolume1.voxel_size as [number, number, number],
				loadedAt: Date.now()
			};
			
			const volumeMetadata2 = {
				id: mockVolume2.handle,
				path: 'mock://volume2.nii',
				name: 'Segmentation Overlay',
				dimensions: mockVolume2.dims as [number, number, number],
				voxelSize: mockVolume2.voxel_size as [number, number, number],
				dataType: mockVolume2.dtype,
				origin: [0, 0, 0] as [number, number, number],
				spacing: mockVolume2.voxel_size as [number, number, number],
				loadedAt: Date.now()
			};
			
			// Get services
			const volumeService = await getService<VolumeService>('volumeService');
			const layerService = await getService<LayerService>('layerService');

			// Add volumes via service (normally done when loading files)
			// For demo, we'll add directly to store since we don't have real files
			// In production, volumes are added via VolumeService when loading files
			// TODO: Create mock file loading in VolumeService for demos
			useVolumeStore.getState().addVolume(volumeMetadata1);
			useVolumeStore.getState().addVolume(volumeMetadata2);

			// Add mock layers via service
			const layer1Spec: LayerSpec = {
				Volume: {
					id: 'layer-1',
					source_resource_id: mockVolume1.handle,
					colormap: 'grayscale',
					slice_axis: null,
					slice_index: null
				}
			};

			const layer2Spec: LayerSpec = {
				Volume: {
					id: 'layer-2',
					source_resource_id: mockVolume2.handle,
					colormap: 'hot',
					slice_axis: null,
					slice_index: null
				}
			};

			// For demo purposes, create mock layer entries
			// In real app, this would be done via layerService.addLayer()
			layerStore.addLayer({
				id: 'layer-1',
				spec: layer1Spec,
				gpu: {
					atlas_index: 0,
					texture_format: mockVolume1.dtype === 'float32' ? 'R32Float' : 'R16Sint',
					dimensions: mockVolume1.dims as [number, number, number],
					texture_coords: { u: [0, 1], v: [0, 1] },
					voxel_to_world: new Float32Array(16),
					world_to_voxel: new Float32Array(16)
				},
				isLoadingGpu: false,
				visible: true,
				opacity: 1.0,
				colormap: 'grayscale',
				windowLevel: { window: 2500, level: 1750 }
			});

			layerStore.addLayer({
				id: 'layer-2',
				spec: layer2Spec,
				gpu: {
					atlas_index: 1,
					texture_format: mockVolume2.dtype === 'float32' ? 'R32Float' : 'R16Sint',
					dimensions: mockVolume2.dims as [number, number, number],
					texture_coords: { u: [0, 1], v: [0, 1] },
					voxel_to_world: new Float32Array(16),
					world_to_voxel: new Float32Array(16)
				},
				isLoadingGpu: false,
				visible: true,
				opacity: 0.7,
				colormap: 'hot',
				windowLevel: { window: 2500, level: 750 }
			});
		} catch (err) {
			console.error('Failed to initialize demo:', err);
		}
	});
</script>

<div class="demo-page">
	<div class="demo-header">
		<h1>Layer Panel Demo</h1>
		<p>This demo showcases the layer selection and control panel with:</p>
		<ul>
			<li>Unified layer list and controls in one panel</li>
			<li>Visual colormap selection with previews</li>
			<li>Dual-handle sliders for intensity and threshold ranges</li>
			<li>Clear visual feedback for active layer</li>
			<li>Inline visibility and removal controls</li>
		</ul>
		{#if !gpuInitialized}
			<p class="warning">Note: GPU not initialized in demo mode. Some features may not work.</p>
		{/if}
	</div>

	<div class="demo-container">
		<div class="panel-wrapper">
			<LayerPanel />
		</div>

		<div class="preview-area">
			<h2>Preview Area</h2>
			<p>In the actual application, this would show the volume viewer.</p>
			<div class="preview-placeholder">
				<p>Layer changes would be reflected here</p>
			</div>
		</div>
	</div>
</div>

<style>
	.demo-page {
		padding: 2rem;
		max-width: 1400px;
		margin: 0 auto;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.demo-header {
		margin-bottom: 2rem;
	}

	.demo-header h1 {
		color: #333;
		margin-bottom: 1rem;
	}

	.demo-header p {
		color: #666;
		margin-bottom: 0.5rem;
	}

	.demo-header ul {
		color: #666;
		margin-left: 2rem;
		margin-top: 1rem;
	}

	.demo-header li {
		margin-bottom: 0.5rem;
	}

	.warning {
		color: #ff9800;
		font-style: italic;
		margin-top: 1rem;
	}

	.demo-container {
		display: flex;
		gap: 2rem;
		height: 70vh;
	}

	.panel-wrapper {
		width: 350px;
		flex-shrink: 0;
		border: 1px solid #e0e0e0;
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.preview-area {
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	.preview-area h2 {
		color: #333;
		margin-bottom: 1rem;
	}

	.preview-placeholder {
		flex: 1;
		background: #f5f5f5;
		border: 2px dashed #ddd;
		border-radius: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #999;
		font-size: 1.125rem;
	}

	/* Global styles for the demo */
	:global(:root) {
		--background: #ffffff;
		--foreground: #09090b;
		--card: #ffffff;
		--card-foreground: #09090b;
		--popover: #ffffff;
		--popover-foreground: #09090b;
		--primary: #2563eb;
		--primary-foreground: #f8fafc;
		--secondary: #f1f5f9;
		--secondary-foreground: #0f172a;
		--muted: #f1f5f9;
		--muted-foreground: #64748b;
		--accent: #f1f5f9;
		--accent-foreground: #0f172a;
		--destructive: #ef4444;
		--destructive-foreground: #f8fafc;
		--border: #e2e8f0;
		--input: #e2e8f0;
		--ring: #2563eb;
	}
</style>
