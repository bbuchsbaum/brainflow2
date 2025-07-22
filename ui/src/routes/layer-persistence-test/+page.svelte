<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { coreApi } from '$lib/api';
	import { layerStore } from '$lib/stores/layerStore';
	import { getService } from '$lib/di/Container';
	import type { LayerService } from '$lib/services/LayerService';
	import type { VolumeService } from '$lib/services/VolumeService';
	import type { NotificationService } from '$lib/services/NotificationService';
	import { LayerPersistenceService } from '$lib/services/LayerPersistenceService';
	import type { ValidationService } from '$lib/validation/ValidationService';
	import type { LayerSpec } from '@brainflow/api';
	import VolumeView from '$lib/components/views/VolumeView.svelte';
	import LayerPanel from '$lib/components/panels/LayerPanel.svelte';
	import { getEventBus } from '$lib/events/EventBus';
	import { nanoid } from 'nanoid';

	// Services
	let layerService: LayerService | null = null;
	let volumeService: VolumeService | null = null;
	let notificationService: NotificationService | null = null;
	let persistenceService: LayerPersistenceService | null = null;
	let eventBus = getEventBus();

	// State
	let selectedLayerId = $state<string | null>(null);
	let savedConfigs = $state<string[]>([]);
	let configName = $state('');
	let autoSaveEnabled = $state(false);
	let autoSaveCleanup: (() => void) | null = null;
	let importFileInput: HTMLInputElement;

	// Test data
	const testVolumes = [
		{
			path: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii',
			name: 'MNI Brain T1'
		},
		{
			path: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/global_mask2.nii',
			name: 'Brain Mask'
		}
	];

	onMount(async () => {
		// Initialize services
		[layerService, volumeService, notificationService] = await Promise.all([
			getService<LayerService>('layerService'),
			getService<VolumeService>('volumeService'),
			getService<NotificationService>('notificationService')
		]);

		const validationService = await getService<ValidationService>('validationService');

		// Create persistence service
		persistenceService = new LayerPersistenceService({
			eventBus,
			validationService,
			notificationService,
			layerService
		});

		// Initialize GPU
		await coreApi.init_render_loop();

		// Load saved configurations list
		refreshConfigList();

		// Try to load default configuration if it exists
		if (savedConfigs.includes('default')) {
			try {
				await persistenceService.loadConfiguration();
				console.log('Loaded default configuration');
			} catch (err) {
				console.log('No default configuration to load');
			}
		}

		// Monitor layer changes
		const unsubscribe = layerStore.subscribe((state) => {
			if (state.layers.length > 0 && !selectedLayerId) {
				selectedLayerId = state.activeLayerId || state.layers[0].id;
			}
		});

		return () => {
			unsubscribe();
			if (autoSaveCleanup) {
				autoSaveCleanup();
			}
		};
	});

	onDestroy(() => {
		if (autoSaveCleanup) {
			autoSaveCleanup();
		}
	});

	function refreshConfigList() {
		if (persistenceService) {
			savedConfigs = persistenceService.listSavedConfigurations();
		}
	}

	async function loadTestVolume(volumeConfig: typeof testVolumes[0]) {
		if (!volumeService || !layerService) return;

		try {
			// Load volume
			const volumeId = await volumeService.loadVolume(volumeConfig.path);

			// Create layer with random colormap
			const colormaps = ['grayscale', 'hot', 'viridis', 'plasma', 'turbo'];
			const randomColormap = colormaps[Math.floor(Math.random() * colormaps.length)];

			const layerSpec: LayerSpec = {
				Volume: {
					id: `${volumeConfig.name}-${nanoid(5)}`,
					source_resource_id: volumeId,
					colormap: randomColormap,
					slice_axis: null,
					slice_index: null
				}
			};

			const layerId = await layerService.addLayer(layerSpec);

			// Set random opacity
			const randomOpacity = 0.5 + Math.random() * 0.5;
			await layerService.updateLayerOpacity(layerId, randomOpacity);

			selectedLayerId = layerId;
			notificationService?.success(`Loaded ${volumeConfig.name}`);
		} catch (err) {
			console.error('Failed to load volume:', err);
			notificationService?.error(`Failed to load ${volumeConfig.name}`);
		}
	}

	async function saveConfiguration() {
		if (!persistenceService) return;

		try {
			const name = configName.trim() || undefined;
			await persistenceService.saveConfiguration(name);
			refreshConfigList();
			configName = '';
		} catch (err) {
			console.error('Failed to save configuration:', err);
		}
	}

	async function loadConfiguration(name?: string) {
		if (!persistenceService) return;

		try {
			await persistenceService.loadConfiguration(name === 'default' ? undefined : name);
		} catch (err) {
			console.error('Failed to load configuration:', err);
		}
	}

	async function deleteConfiguration(name?: string) {
		if (!persistenceService || !confirm(`Delete configuration "${name || 'default'}"?`)) return;

		persistenceService.deleteConfiguration(name === 'default' ? undefined : name);
		refreshConfigList();
	}

	async function exportConfiguration() {
		if (!persistenceService) return;

		try {
			await persistenceService.exportConfiguration();
		} catch (err) {
			console.error('Failed to export configuration:', err);
		}
	}

	async function importConfiguration(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !persistenceService) return;

		try {
			await persistenceService.importConfiguration(file);
			refreshConfigList();
		} catch (err) {
			console.error('Failed to import configuration:', err);
		} finally {
			input.value = '';
		}
	}

	function toggleAutoSave() {
		if (!persistenceService) return;

		if (autoSaveEnabled) {
			if (autoSaveCleanup) {
				autoSaveCleanup();
				autoSaveCleanup = null;
			}
			autoSaveEnabled = false;
			notificationService?.info('Auto-save disabled');
		} else {
			autoSaveCleanup = persistenceService.enableAutoSave(10000); // Save every 10 seconds
			autoSaveEnabled = true;
			notificationService?.success('Auto-save enabled (10s interval)');
		}
	}

	async function clearAllLayers() {
		if (!layerService) return;

		const layers = $layerStore.layers;
		for (const layer of layers) {
			await layerService.removeLayer(layer.id);
		}
		selectedLayerId = null;
	}

	// Test persistence across view changes
	async function testViewPersistence() {
		// Save current state
		await saveConfiguration();

		// Clear layers
		await clearAllLayers();

		// Wait a bit
		await new Promise(resolve => setTimeout(resolve, 500));

		// Reload the saved state
		await loadConfiguration();

		notificationService?.success('View persistence test completed');
	}
</script>

<div class="persistence-test">
	<div class="test-header">
		<h1>Layer State Persistence Test</h1>
		<div class="auto-save-toggle">
			<label>
				<input type="checkbox" checked={autoSaveEnabled} onchange={toggleAutoSave} />
				Auto-save enabled
			</label>
		</div>
	</div>

	<div class="test-layout">
		<div class="sidebar">
			<div class="section">
				<h3>Load Test Volumes</h3>
				{#each testVolumes as volume}
					<button onclick={() => loadTestVolume(volume)}>
						Load {volume.name}
					</button>
				{/each}
			</div>

			<div class="section">
				<h3>Save Configuration</h3>
				<div class="save-controls">
					<input
						type="text"
						bind:value={configName}
						placeholder="Configuration name (optional)"
						onkeydown={(e) => e.key === 'Enter' && saveConfiguration()}
					/>
					<button onclick={saveConfiguration}>Save</button>
				</div>
			</div>

			<div class="section">
				<h3>Saved Configurations</h3>
				<div class="config-list">
					{#each savedConfigs as config}
						<div class="config-item">
							<span>{config}</span>
							<div class="config-actions">
								<button onclick={() => loadConfiguration(config)}>Load</button>
								<button onclick={() => deleteConfiguration(config)} class="delete">×</button>
							</div>
						</div>
					{/each}
					{#if savedConfigs.length === 0}
						<p class="empty-state">No saved configurations</p>
					{/if}
				</div>
			</div>

			<div class="section">
				<h3>Import/Export</h3>
				<button onclick={exportConfiguration}>Export to File</button>
				<button onclick={() => importFileInput.click()}>Import from File</button>
				<input
					bind:this={importFileInput}
					type="file"
					accept=".json"
					style="display: none"
					onchange={importConfiguration}
				/>
			</div>

			<div class="section">
				<h3>Test Actions</h3>
				<button onclick={clearAllLayers}>Clear All Layers</button>
				<button onclick={testViewPersistence}>Test View Persistence</button>
			</div>

			<div class="layer-panel-container">
				<LayerPanel />
			</div>
		</div>

		<div class="main-content">
			{#if selectedLayerId}
				<VolumeView componentState={{ layerId: selectedLayerId }} />
			{:else}
				<div class="empty-viewer">
					<p>Load a volume or restore a saved configuration to begin</p>
				</div>
			{/if}
		</div>
	</div>

	<div class="info-panel">
		<h3>Current State</h3>
		<div class="state-info">
			<p>Layers: {$layerStore.layers.length}</p>
			<p>Active Layer: {$layerStore.activeLayerId || 'None'}</p>
			<p>Auto-save: {autoSaveEnabled ? 'Enabled' : 'Disabled'}</p>
		</div>
	</div>
</div>

<style>
	.persistence-test {
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
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.test-header h1 {
		margin: 0;
		font-size: 1.5rem;
	}

	.auto-save-toggle label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}

	.test-layout {
		flex: 1;
		display: grid;
		grid-template-columns: 350px 1fr;
		gap: 1px;
		background: #333;
		overflow: hidden;
	}

	.sidebar {
		background: #1a1a1a;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.section {
		background: #222;
		padding: 1rem;
		border-radius: 4px;
	}

	.section h3 {
		margin: 0 0 0.5rem 0;
		font-size: 14px;
		color: #888;
		text-transform: uppercase;
	}

	.section button {
		width: 100%;
		padding: 0.5rem;
		margin-bottom: 0.5rem;
		background: #3b82f6;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 14px;
	}

	.section button:hover {
		background: #2563eb;
	}

	.section button:last-child {
		margin-bottom: 0;
	}

	.save-controls {
		display: flex;
		gap: 0.5rem;
	}

	.save-controls input {
		flex: 1;
		padding: 0.5rem;
		background: #333;
		border: 1px solid #444;
		border-radius: 4px;
		color: white;
		font-size: 14px;
	}

	.save-controls button {
		width: auto;
		padding: 0.5rem 1rem;
		margin: 0;
	}

	.config-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.config-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem;
		background: #333;
		border-radius: 4px;
		font-size: 14px;
	}

	.config-actions {
		display: flex;
		gap: 0.25rem;
	}

	.config-actions button {
		width: auto;
		padding: 0.25rem 0.5rem;
		margin: 0;
		font-size: 12px;
	}

	.config-actions button.delete {
		background: #dc2626;
		padding: 0.25rem 0.5rem;
		min-width: 24px;
	}

	.config-actions button.delete:hover {
		background: #b91c1c;
	}

	.empty-state {
		text-align: center;
		color: #666;
		font-size: 14px;
		margin: 1rem 0;
	}

	.layer-panel-container {
		flex: 1;
		overflow: hidden;
	}

	.main-content {
		background: #0a0a0a;
		overflow: hidden;
		position: relative;
	}

	.empty-viewer {
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #666;
		font-size: 18px;
	}

	.info-panel {
		padding: 1rem;
		background: #1a1a1a;
		border-top: 1px solid #333;
	}

	.info-panel h3 {
		margin: 0 0 0.5rem 0;
		font-size: 14px;
		color: #888;
	}

	.state-info {
		display: flex;
		gap: 2rem;
		font-size: 14px;
		color: #aaa;
	}

	.state-info p {
		margin: 0;
	}
</style>