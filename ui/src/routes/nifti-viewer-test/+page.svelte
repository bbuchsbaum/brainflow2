<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	import type { VolumeHandleInfo, LayerSpec } from '@brainflow/api';
	import { layerStore } from '$lib/stores/layerStore';
	import ViewerWithStatusBar from '$lib/components/ViewerWithStatusBar.svelte';
	import { getService } from '$lib/di/Container';
	import type { NotificationService } from '$lib/services/NotificationService';

	// Get services
	let notificationService: NotificationService;
	onMount(async () => {
		notificationService = await getService<NotificationService>('notificationService');
	});

	// State
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let volumeHandle = $state<string | null>(null);
	let volumeInfo = $state<VolumeHandleInfo | null>(null);
	let gpuResourcesAllocated = $state(false);
	let testPath = $state('/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz');

	// Derived state for viewer
	const viewerLayers = $derived.by(() => {
		const layers = layerStore.getLayers();
		// Extract just the LayerSpec objects for the viewer
		return layers.map((entry) => entry.spec);
	});

	async function loadNiftiFile() {
		isLoading = true;
		error = null;

		try {
			// Step 1: Initialize render loop if needed
			console.log('Initializing render loop...');
			await coreApi.init_render_loop();

			// Step 2: Load the file
			console.log('Loading file:', testPath);
			volumeInfo = await coreApi.load_file(testPath);
			volumeHandle = volumeInfo.handle;
			console.log('Volume loaded:', volumeInfo);

			// Step 3: Request GPU resources for the volume
			console.log('Requesting GPU resources...');
			const gpuInfo = await coreApi.request_layer_gpu_resources(volumeHandle);
			console.log('GPU resources allocated:', gpuInfo);
			gpuResourcesAllocated = true;

			// Step 4: Create layer spec
			const layerSpec: LayerSpec = {
				name: `Volume ${volumeHandle}`,
				volume_id: volumeHandle,
				colormap: 'grayscale',
				opacity: 1.0,
				visible: true,
				min: 0,
				max: 255,
				window: null,
				level: null
			};

			// Step 5: Add to layer store
			console.log('Adding layer to store...');
			layerStore.addLayer({
				id: volumeHandle,
				handle: volumeHandle,
				spec: layerSpec,
				volumeInfo
			});

			notificationService.success('NIfTI file loaded successfully!');
		} catch (err) {
			console.error('Failed to load file:', err);
			error = err instanceof Error ? err.message : String(err);
			notificationService.error(`Failed to load file: ${error}`);
		} finally {
			isLoading = false;
		}
	}

	async function clearVolume() {
		if (volumeHandle && gpuResourcesAllocated) {
			try {
				console.log('Releasing GPU resources...');
				await coreApi.release_layer_gpu_resources(volumeHandle);
				layerStore.removeLayer(volumeHandle);

				volumeHandle = null;
				volumeInfo = null;
				gpuResourcesAllocated = false;

				notificationService.info('Volume cleared');
			} catch (err) {
				console.error('Failed to clear volume:', err);
				notificationService.error('Failed to clear volume');
			}
		}
	}

	// Clean up on unmount
	onMount(() => {
		return () => {
			if (volumeHandle && gpuResourcesAllocated) {
				clearVolume();
			}
		};
	});
</script>

<div class="viewer-test">
	<div class="controls">
		<h2>NIfTI Viewer Test</h2>

		<div class="control-group">
			<label for="file-path">File Path:</label>
			<input
				id="file-path"
				type="text"
				bind:value={testPath}
				disabled={isLoading}
				class="file-input"
			/>
		</div>

		<div class="button-group">
			<button onclick={loadNiftiFile} disabled={isLoading || !!volumeHandle} class="load-button">
				{isLoading ? 'Loading...' : 'Load NIfTI File'}
			</button>

			<button onclick={clearVolume} disabled={!volumeHandle || isLoading} class="clear-button">
				Clear Volume
			</button>
		</div>

		{#if error}
			<div class="error-message">{error}</div>
		{/if}

		{#if volumeInfo}
			<div class="info">
				<h3>Volume Info:</h3>
				<ul>
					<li>Dimensions: {volumeInfo.dims.join(' × ')}</li>
					<li>Voxel size: {volumeInfo.voxel_size.map((v) => v.toFixed(2)).join(' × ')} mm</li>
					<li>Data type: {volumeInfo.dtype}</li>
					<li>GPU resources: {gpuResourcesAllocated ? '✓ Allocated' : '✗ Not allocated'}</li>
				</ul>
			</div>
		{/if}
	</div>

	<div class="viewer-container">
		{#if viewerLayers.length > 0}
			<ViewerWithStatusBar layers={viewerLayers} />
		{:else}
			<div class="placeholder">
				<p>Load a NIfTI file to view it here</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.viewer-test {
		display: flex;
		height: 100vh;
		gap: 1rem;
		padding: 1rem;
		background-color: #f5f5f5;
	}

	.controls {
		width: 300px;
		background: white;
		padding: 1.5rem;
		border-radius: 8px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		overflow-y: auto;
	}

	.controls h2 {
		margin-top: 0;
		margin-bottom: 1rem;
		color: #333;
	}

	.control-group {
		margin-bottom: 1rem;
	}

	.control-group label {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 500;
		color: #555;
	}

	.file-input {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 14px;
	}

	.file-input:disabled {
		background-color: #f0f0f0;
		cursor: not-allowed;
	}

	.button-group {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	button {
		flex: 1;
		padding: 0.75rem 1rem;
		border: none;
		border-radius: 4px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.load-button {
		background-color: #4caf50;
		color: white;
	}

	.load-button:hover:not(:disabled) {
		background-color: #45a049;
	}

	.load-button:disabled {
		background-color: #cccccc;
		cursor: not-allowed;
	}

	.clear-button {
		background-color: #f44336;
		color: white;
	}

	.clear-button:hover:not(:disabled) {
		background-color: #da190b;
	}

	.clear-button:disabled {
		background-color: #cccccc;
		cursor: not-allowed;
	}

	.error-message {
		padding: 0.75rem;
		background-color: #ffebee;
		color: #c62828;
		border-radius: 4px;
		margin-bottom: 1rem;
		font-size: 14px;
	}

	.info {
		background-color: #e3f2fd;
		padding: 1rem;
		border-radius: 4px;
		font-size: 14px;
	}

	.info h3 {
		margin-top: 0;
		margin-bottom: 0.5rem;
		color: #1976d2;
	}

	.info ul {
		margin: 0;
		padding-left: 1.5rem;
	}

	.info li {
		margin-bottom: 0.25rem;
		color: #424242;
	}

	.viewer-container {
		flex: 1;
		background: white;
		border-radius: 8px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		overflow: hidden;
		position: relative;
	}

	.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: #999;
		font-size: 18px;
	}
</style>
