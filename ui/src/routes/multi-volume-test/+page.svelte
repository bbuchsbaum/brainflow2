<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	import { layerStore } from '$lib/stores/layerStore';
	import { getService } from '$lib/di/Container';
	import type { LayerService } from '$lib/services/LayerService';
	import type { VolumeService } from '$lib/services/VolumeService';
	import type { NotificationService } from '$lib/services/NotificationService';
	import type { LayerSpec } from '@brainflow/api';
	import VolumeView from '$lib/components/views/VolumeView.svelte';
	import LayerPanel from '$lib/components/panels/LayerPanel.svelte';
	import { nanoid } from 'nanoid';

	// Services
	let layerService: LayerService | null = null;
	let volumeService: VolumeService | null = null;
	let notificationService: NotificationService | null = null;

	// State
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let selectedLayerId = $state<string | null>(null);
	let loadedCount = $state(0);

	// Test volumes with different characteristics
	const testVolumes = [
		{
			path: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii',
			name: 'MNI Brain T1',
			colormap: 'grayscale',
			opacity: 1.0
		},
		{
			path: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/global_mask2.nii',
			name: 'Brain Mask',
			colormap: 'hot',
			opacity: 0.5
		},
		{
			path: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz',
			name: 'Toy T1',
			colormap: 'viridis',
			opacity: 0.7
		}
	];

	// Initialize services
	onMount(async () => {
		try {
			[layerService, volumeService, notificationService] = await Promise.all([
				getService<LayerService>('layerService'),
				getService<VolumeService>('volumeService'),
				getService<NotificationService>('notificationService')
			]);

			// Initialize GPU
			await coreApi.init_render_loop();
		} catch (err) {
			console.error('Failed to initialize:', err);
			error = 'Failed to initialize services';
		}
	});

	// Load a single volume
	async function loadVolume(volumeConfig: typeof testVolumes[0]) {
		if (!volumeService || !layerService) {
			error = 'Services not initialized';
			return;
		}

		try {
			console.log(`Loading volume: ${volumeConfig.name}`);
			
			// Load volume
			const volumeId = await volumeService.loadVolume(volumeConfig.path);
			console.log(`Volume loaded with ID: ${volumeId}`);

			// Create layer
			const layerSpec: LayerSpec = {
				Volume: {
					id: `layer-${nanoid(5)}`,
					source_resource_id: volumeId,
					colormap: volumeConfig.colormap,
					slice_axis: null,
					slice_index: null
				}
			};

			const layerId = await layerService.addLayer(layerSpec);
			console.log(`Layer created with ID: ${layerId}`);

			// Update layer properties
			await layerService.updateLayerOpacity(layerId, volumeConfig.opacity);
			
			// Select the first layer
			if (!selectedLayerId) {
				selectedLayerId = layerId;
			}

			loadedCount++;
			notificationService?.success(`Loaded ${volumeConfig.name}`);
		} catch (err) {
			console.error(`Failed to load ${volumeConfig.name}:`, err);
			notificationService?.error(`Failed to load ${volumeConfig.name}`, {
				error: err instanceof Error ? err : undefined
			});
			throw err;
		}
	}

	// Load all test volumes
	async function loadAllVolumes() {
		isLoading = true;
		error = null;
		loadedCount = 0;

		try {
			// Load volumes sequentially to avoid overwhelming the GPU
			for (const volume of testVolumes) {
				await loadVolume(volume);
			}

			console.log('All volumes loaded successfully');
		} catch (err) {
			error = `Failed to load volumes: ${err}`;
		} finally {
			isLoading = false;
		}
	}

	// Clear all layers
	async function clearAllLayers() {
		if (!layerService) return;

		const layers = $layerStore.layers;
		for (const layer of layers) {
			await layerService.removeLayer(layer.id);
		}
		
		selectedLayerId = null;
		loadedCount = 0;
		notificationService?.info('All layers cleared');
	}

	// Test layer operations
	async function testLayerOperations() {
		if (!layerService || $layerStore.layers.length < 2) {
			error = 'Need at least 2 layers loaded';
			return;
		}

		try {
			console.log('Testing layer operations...');
			
			// Test toggling visibility
			const firstLayer = $layerStore.layers[0];
			await layerService.toggleLayerVisibility(firstLayer.id);
			await new Promise(resolve => setTimeout(resolve, 500));
			await layerService.toggleLayerVisibility(firstLayer.id);
			
			// Test opacity changes
			const secondLayer = $layerStore.layers[1];
			for (let opacity of [0.3, 0.6, 0.9, 0.5]) {
				await layerService.updateLayerOpacity(secondLayer.id, opacity);
				await new Promise(resolve => setTimeout(resolve, 300));
			}
			
			// Test colormap changes
			const colormaps = ['grayscale', 'hot', 'viridis', 'plasma', 'turbo'];
			for (const colormap of colormaps) {
				await layerService.updateLayerColormap(firstLayer.id, colormap);
				await new Promise(resolve => setTimeout(resolve, 300));
			}
			
			notificationService?.success('Layer operations test completed');
		} catch (err) {
			error = `Test failed: ${err}`;
			notificationService?.error('Layer operations test failed');
		}
	}

	// Test performance with rapid updates
	async function testPerformance() {
		if (!layerService || $layerStore.layers.length === 0) {
			error = 'Need at least 1 layer loaded';
			return;
		}

		try {
			console.log('Testing performance with rapid updates...');
			const startTime = performance.now();
			const updates = 50;
			
			const layer = $layerStore.layers[0];
			
			for (let i = 0; i < updates; i++) {
				const opacity = Math.sin(i * 0.1) * 0.5 + 0.5;
				await layerService.updateLayerOpacity(layer.id, opacity);
			}
			
			const endTime = performance.now();
			const avgTime = (endTime - startTime) / updates;
			
			notificationService?.success(`Performance test completed: ${avgTime.toFixed(2)}ms per update`);
		} catch (err) {
			error = `Performance test failed: ${err}`;
		}
	}
</script>

<div class="multi-volume-test">
	<div class="test-header">
		<h1>Multi-Volume Rendering Test</h1>
		<div class="test-info">
			<span>Loaded Volumes: {loadedCount}/{testVolumes.length}</span>
			<span>Active Layers: {$layerStore.layers.length}</span>
			<span>GPU Layers: {$layerStore.layers.filter(l => l.gpu).length}</span>
		</div>
	</div>

	<div class="test-controls">
		<button onclick={loadAllVolumes} disabled={isLoading}>
			{isLoading ? 'Loading...' : 'Load All Volumes'}
		</button>
		<button onclick={clearAllLayers} disabled={isLoading || $layerStore.layers.length === 0}>
			Clear All
		</button>
		<button onclick={testLayerOperations} disabled={isLoading || $layerStore.layers.length < 2}>
			Test Layer Operations
		</button>
		<button onclick={testPerformance} disabled={isLoading || $layerStore.layers.length === 0}>
			Test Performance
		</button>
	</div>

	{#if error}
		<div class="error-message">
			{error}
		</div>
	{/if}

	<div class="test-content">
		<div class="layer-panel-container">
			<LayerPanel />
		</div>
		
		<div class="viewer-container">
			{#if selectedLayerId}
				<VolumeView componentState={{ layerId: selectedLayerId }} />
			{:else}
				<div class="empty-state">
					<p>Load volumes to begin testing</p>
				</div>
			{/if}
		</div>
	</div>

	<div class="test-log">
		<h3>Layer State Monitor</h3>
		<div class="layer-state">
			{#each $layerStore.layers as layer}
				<div class="layer-info" class:active={layer.id === selectedLayerId}>
					<strong>{layer.spec.Volume?.id ?? 'Unknown'}</strong>
					<span>Visible: {layer.visible}</span>
					<span>Opacity: {(layer.opacity * 100).toFixed(0)}%</span>
					<span>Colormap: {layer.colormap}</span>
					<span>GPU: {layer.gpu ? '✓' : '✗'}</span>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.multi-volume-test {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0a0a0a;
		color: #fff;
	}

	.test-header {
		padding: 1rem;
		background: #1a1a1a;
		border-bottom: 1px solid #333;
	}

	.test-header h1 {
		margin: 0 0 0.5rem 0;
		font-size: 1.5rem;
	}

	.test-info {
		display: flex;
		gap: 2rem;
		font-size: 14px;
		color: #888;
	}

	.test-info span {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.test-controls {
		padding: 1rem;
		background: #222;
		border-bottom: 1px solid #333;
		display: flex;
		gap: 1rem;
	}

	.test-controls button {
		padding: 0.5rem 1rem;
		background: #3b82f6;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 14px;
		transition: background 0.2s;
	}

	.test-controls button:hover:not(:disabled) {
		background: #2563eb;
	}

	.test-controls button:disabled {
		background: #4b5563;
		cursor: not-allowed;
	}

	.error-message {
		padding: 1rem;
		background: #dc2626;
		color: white;
		text-align: center;
	}

	.test-content {
		flex: 1;
		display: grid;
		grid-template-columns: 300px 1fr;
		gap: 1px;
		background: #333;
		overflow: hidden;
	}

	.layer-panel-container {
		background: #1a1a1a;
		overflow-y: auto;
	}

	.viewer-container {
		background: #0a0a0a;
		overflow: hidden;
	}

	.empty-state {
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #666;
		font-size: 18px;
	}

	.test-log {
		padding: 1rem;
		background: #1a1a1a;
		border-top: 1px solid #333;
		max-height: 200px;
		overflow-y: auto;
	}

	.test-log h3 {
		margin: 0 0 0.5rem 0;
		font-size: 14px;
		color: #888;
	}

	.layer-state {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.layer-info {
		display: flex;
		gap: 1rem;
		padding: 0.5rem;
		background: #222;
		border-radius: 4px;
		font-size: 12px;
		align-items: center;
	}

	.layer-info.active {
		background: #2563eb;
	}

	.layer-info strong {
		flex: 1;
	}

	.layer-info span {
		color: #888;
	}

	.layer-info.active span {
		color: #ccc;
	}
</style>