<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	import { layerStore } from '$lib/stores/layerStore';
	import { useVolumeStore, volumeStoreSelectors } from '$lib/stores/volumeStore';
	import { crosshairSlice } from '$lib/stores/crosshairSlice';
	import { zustandToReadable } from '$lib/stores/zustandBridge';
	import { diagnosticLogger } from '$lib/utils/diagnosticLogger';
	import { getService } from '$lib/di/Container';
	import type { VolumeService } from '$lib/services/VolumeService';
	import type { LayerService } from '$lib/services/LayerService';
	import type { CrosshairService } from '$lib/services/CrosshairService';

	// Create reactive stores
	const volumeStoreReadable = zustandToReadable(useVolumeStore);
	const crosshairStoreReadable = zustandToReadable(crosshairSlice);

	interface DiagnosticCheck {
		name: string;
		status: 'pending' | 'success' | 'error';
		message: string;
		details?: any;
	}

	let checks = $state<DiagnosticCheck[]>([
		{ name: 'Tauri API Available', status: 'pending', message: 'Checking...' },
		{ name: 'GPU Initialization', status: 'pending', message: 'Checking...' },
		{ name: 'Test Volume Load', status: 'pending', message: 'Checking...' },
		{ name: 'GPU Resource Allocation', status: 'pending', message: 'Checking...' },
		{ name: 'Store Integration', status: 'pending', message: 'Checking...' },
		{ name: 'Crosshair System', status: 'pending', message: 'Checking...' }
	]);

	let testHandle: string | null = null;
	let gpuAllocated = false;

	async function updateCheck(
		name: string,
		status: 'success' | 'error',
		message: string,
		details?: any
	) {
		const index = checks.findIndex((c) => c.name === name);
		if (index !== -1) {
			checks[index] = { name, status, message, details };
		}
	}

	async function runDiagnostics() {
		diagnosticLogger.reset();

		// Check 1: Tauri API
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			await invoke('plugin:api-bridge|fs_list_directory', { path_str: '/tmp' });
			await updateCheck('Tauri API Available', 'success', 'API is working correctly');
		} catch (err) {
			await updateCheck('Tauri API Available', 'error', `Failed: ${err}`);
			return; // Can't continue without API
		}

		// Check 2: GPU Initialization
		try {
			await diagnosticLogger.checkpoint('GPU Init', async () => {
				await coreApi.init_render_loop();
			});
			await updateCheck('GPU Initialization', 'success', 'GPU render loop initialized');
		} catch (err) {
			await updateCheck('GPU Initialization', 'error', `Failed: ${err}`);
			return; // Can't continue without GPU
		}

		// Check 3: Test Volume Load
		try {
			const testPath = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz';
			const volumeInfo = await diagnosticLogger.checkpoint('Load Test Volume', async () => {
				return await coreApi.load_file(testPath);
			});

			testHandle = volumeInfo.handle;
			await updateCheck('Test Volume Load', 'success', 'Volume loaded successfully', {
				handle: volumeInfo.handle,
				dims: volumeInfo.dims,
				dtype: volumeInfo.dtype
			});
		} catch (err) {
			await updateCheck('Test Volume Load', 'error', `Failed: ${err}`);
			return;
		}

		// Check 4: GPU Resource Allocation
		if (testHandle) {
			try {
				const gpuInfo = await diagnosticLogger.checkpoint('GPU Resource Allocation', async () => {
					return await coreApi.request_layer_gpu_resources(testHandle!);
				});

				gpuAllocated = true;
				await updateCheck('GPU Resource Allocation', 'success', 'GPU resources allocated', gpuInfo);
			} catch (err) {
				await updateCheck('GPU Resource Allocation', 'error', `Failed: ${err}`);
			}
		}

		// Check 5: Store Integration
		if (testHandle) {
			try {
				// Get services
				const volumeService = await getService<VolumeService>('volumeService');
				const layerService = await getService<LayerService>('layerService');

				// Test volume service - the load_file already added to VolumeService
				const volumeMetadata = volumeService.getVolumeMetadata(testHandle);
				if (!volumeMetadata) throw new Error('Volume not found in service');

				// Test layer creation via service
				const layerSpec = {
					Volume: {
						id: `test-layer-${Date.now()}`,
						source_resource_id: testHandle,
						colormap: 'grayscale' as const,
						slice_axis: null,
						slice_index: null
					}
				};

				await layerService.addLayer(layerSpec);

				// Check stores via reactive subscriptions
				const volumeState = $volumeStoreReadable;
				const allVolumes = volumeStoreSelectors.allVolumes(volumeState);
				const layers = layerStore.layers;

				if (layers.length === 0) throw new Error('Layer not found in store');

				await updateCheck('Store Integration', 'success', 'Stores working correctly', {
					volumesCount: allVolumes.length,
					layersCount: layers.length
				});
			} catch (err) {
				await updateCheck('Store Integration', 'error', `Failed: ${err}`);
			}
		}

		// Check 6: Crosshair System
		try {
			// Use the crosshair service
			const crosshairService = await getService<CrosshairService>('crosshairService');
			
			// Set crosshair position
			await crosshairService.setWorldCoordinate([10, 10, 10]);
			
			// Check via reactive store
			const crosshairState = $crosshairStoreReadable;

			if (crosshairState.worldCoord[0] !== 10 || crosshairState.worldCoord[1] !== 10 || crosshairState.worldCoord[2] !== 10) {
				throw new Error('Crosshair not set correctly');
			}

			await updateCheck('Crosshair System', 'success', 'Crosshair system working', {
				position: crosshairState.worldCoord
			});
		} catch (err) {
			await updateCheck('Crosshair System', 'error', `Failed: ${err}`);
		}

		// Get diagnostic report
		diagnosticLogger.getDiagnosticReport();
	}

	async function cleanup() {
		if (testHandle && gpuAllocated) {
			try {
				const layerService = await getService<LayerService>('layerService');
				const volumeService = await getService<VolumeService>('volumeService');
				
				// Find and remove layers using this volume
				const layers = layerStore.layers.filter(layer => 
					layer.spec.Volume && layer.spec.Volume.source_resource_id === testHandle
				);
				
				for (const layer of layers) {
					await layerService.removeLayer(layer.id);
				}
				
				// Remove volume
				await volumeService.unloadVolume(testHandle);
			} catch (err) {
				console.error('Cleanup failed:', err);
			}
		}
	}

	onMount(() => {
		runDiagnostics();

		return () => {
			cleanup();
		};
	});

	let allPassed = $derived(checks.every((c) => c.status === 'success'));
	let anyFailed = $derived(checks.some((c) => c.status === 'error'));
</script>

<div class="diagnostic-page">
	<h1>Brainflow Diagnostic Check</h1>

	<div class="summary">
		{#if allPassed}
			<div class="summary-success">✓ All systems operational - Ready to load NIfTI files!</div>
		{:else if anyFailed}
			<div class="summary-error">✗ Some checks failed - Please review the issues below</div>
		{:else}
			<div class="summary-pending">⟳ Running diagnostics...</div>
		{/if}
	</div>

	<div class="checks">
		{#each checks as check}
			<div
				class="check-item"
				class:success={check.status === 'success'}
				class:error={check.status === 'error'}
			>
				<div class="check-header">
					<span class="check-icon">
						{#if check.status === 'pending'}
							⟳
						{:else if check.status === 'success'}
							✓
						{:else}
							✗
						{/if}
					</span>
					<span class="check-name">{check.name}</span>
				</div>
				<div class="check-message">{check.message}</div>
				{#if check.details}
					<details class="check-details">
						<summary>Details</summary>
						<pre>{JSON.stringify(check.details, null, 2)}</pre>
					</details>
				{/if}
			</div>
		{/each}
	</div>

	<div class="actions">
		<button onclick={runDiagnostics}>Run Diagnostics Again</button>
		<button onclick={() => (window.location.href = '/')} class="primary" disabled={!allPassed}>
			Go to Main App
		</button>
	</div>

	<div class="logs">
		<h3>Console Output</h3>
		<p class="hint">
			Press F12 to open Developer Tools and check the Console tab for detailed logs
		</p>
	</div>
</div>

<style>
	.diagnostic-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	h1 {
		color: #333;
		margin-bottom: 2rem;
	}

	.summary {
		margin-bottom: 2rem;
		padding: 1rem;
		border-radius: 8px;
		font-weight: 500;
		text-align: center;
	}

	.summary-success {
		background-color: #e8f5e9;
		color: #2e7d32;
		border: 1px solid #4caf50;
	}

	.summary-error {
		background-color: #ffebee;
		color: #c62828;
		border: 1px solid #f44336;
	}

	.summary-pending {
		background-color: #fff3e0;
		color: #e65100;
		border: 1px solid #ff9800;
	}

	.checks {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.check-item {
		background: white;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1rem;
		transition: all 0.3s ease;
	}

	.check-item.success {
		border-color: #4caf50;
		background-color: #f1f8f4;
	}

	.check-item.error {
		border-color: #f44336;
		background-color: #fef1f1;
	}

	.check-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.check-icon {
		font-size: 1.25rem;
		width: 1.5rem;
		text-align: center;
	}

	.check-item.success .check-icon {
		color: #4caf50;
	}

	.check-item.error .check-icon {
		color: #f44336;
	}

	.check-name {
		font-weight: 500;
		color: #333;
	}

	.check-message {
		margin-left: 2.25rem;
		color: #666;
		font-size: 0.875rem;
	}

	.check-details {
		margin-left: 2.25rem;
		margin-top: 0.5rem;
	}

	.check-details summary {
		cursor: pointer;
		color: #1976d2;
		font-size: 0.875rem;
	}

	.check-details pre {
		margin-top: 0.5rem;
		padding: 0.5rem;
		background-color: #f5f5f5;
		border-radius: 4px;
		font-size: 0.75rem;
		overflow-x: auto;
	}

	.actions {
		display: flex;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	button {
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 4px;
		font-size: 1rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		background-color: #e0e0e0;
		color: #333;
	}

	button:hover:not(:disabled) {
		background-color: #d0d0d0;
	}

	button.primary {
		background-color: #2196f3;
		color: white;
	}

	button.primary:hover:not(:disabled) {
		background-color: #1976d2;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.logs {
		background-color: #f5f5f5;
		padding: 1rem;
		border-radius: 8px;
	}

	.logs h3 {
		margin-top: 0;
		color: #333;
	}

	.hint {
		color: #666;
		font-size: 0.875rem;
	}
</style>
