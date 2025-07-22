<!--
  Plotting Infrastructure Example
  Demonstrates how to use the abstract plotting system
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getService } from '$lib/di/Container';
	import { getEventBus } from '$lib/events/EventBus';
	import type { PlotService } from '$lib/services/PlotService';
	import type { LayerService } from '$lib/services/LayerService';
	import { PlotActionConnector, PlotMappingBuilder } from '$lib/plotting/PlotActionConnector';
	import { createTimeSeriesPlotProvider } from '$lib/plotting/providers/TimeSeriesPlotProvider';
	import PlotPanel from '$lib/components/panels/PlotPanel.svelte';
	import { usePlotStore } from '$lib/stores/plotStore';

	// Services
	let plotService: PlotService | null = null;
	let layerService: LayerService | null = null;
	let plotConnector: PlotActionConnector | null = null;
	let eventBus = getEventBus();

	// State
	let plotStore = usePlotStore();
	let activePanels = $state<string[]>([]);
	let isInitialized = $state(false);

	// Derived
	let panels = $derived(Array.from($plotStore.panels.values()));

	onMount(async () => {
		try {
			// Get services
			[plotService, layerService] = await Promise.all([
				getService<PlotService>('plotService'),
				getService<LayerService>('layerService')
			]);

			// Register plot providers
			await registerProviders();

			// Set up action mappings
			setupActionMappings();

			// Subscribe to panel events
			const unsubscribe = eventBus.on('plot.panel.create', ({ panelId }) => {
				activePanels = [...activePanels, panelId];
			});

			isInitialized = true;

			return () => {
				unsubscribe();
				plotConnector?.dispose();
			};
		} catch (error) {
			console.error('Failed to initialize plotting example:', error);
		}
	});

	async function registerProviders() {
		if (!plotService) return;

		// Register time series provider
		plotService.registerProvider({
			id: 'timeseries',
			name: 'Time Series Plot',
			description: 'Display time series data from voxels or ROIs',
			factory: createTimeSeriesPlotProvider,
			config: {
				xAxis: { label: 'Time (TR)' },
				yAxis: { label: 'Signal' },
				showGrid: true,
				animation: false
			}
		});

		// Register histogram provider (example)
		plotService.registerProvider({
			id: 'histogram',
			name: 'Histogram',
			description: 'Display value distribution',
			factory: (eventBus, config) => {
				// Would import actual histogram provider
				return createTimeSeriesPlotProvider(eventBus, config);
			}
		});
	}

	function setupActionMappings() {
		if (!plotService) return;

		// Create action connector with custom mappings
		const mappings = new PlotMappingBuilder()
			// Standard voxel click → time series
			.onVoxelClick('timeseries')

			// ROI selection → time series
			.onRoiSelection('timeseries')

			// Custom: Shift+click → histogram
			.onEvent(
				'viewer.voxel.clicked',
				'histogram',
				(data) => ({
					sourceData: {
						layerId: data.layerId,
						volumeId: data.volumeId,
						centerCoord: data.worldCoord,
						radius: 5 // 5mm radius
					}
				}),
				(data) => data.modifiers?.shift === true
			)

			// Layer stats request
			.onEvent('layer.stats.requested', 'histogram', (data) => ({
				sourceData: {
					layerId: data.layerId,
					volumeId: data.volumeId
				}
			}))
			.build();

		plotConnector = new PlotActionConnector({
			eventBus,
			plotService,
			mappings
		});
	}

	// Demo functions
	function simulateVoxelClick() {
		eventBus.emit('viewer.voxel.clicked', {
			layerId: 'demo-layer',
			volumeId: 'demo-volume',
			worldCoord: [10, 20, 30],
			voxelCoord: [50, 60, 70],
			value: 1234.5,
			modifiers: { shift: false }
		});
	}

	function simulateShiftClick() {
		eventBus.emit('viewer.voxel.clicked', {
			layerId: 'demo-layer',
			volumeId: 'demo-volume',
			worldCoord: [10, 20, 30],
			voxelCoord: [50, 60, 70],
			value: 1234.5,
			modifiers: { shift: true }
		});
	}

	function simulateRoiSelection() {
		eventBus.emit('annotation.roi.selected', {
			layerId: 'demo-layer',
			volumeId: 'demo-volume',
			roiId: 'roi-001',
			name: 'Left Hippocampus',
			voxelCount: 1250
		});
	}

	function requestLayerStats() {
		eventBus.emit('layer.stats.requested', {
			layerId: 'demo-layer',
			volumeId: 'demo-volume'
		});
	}

	function closeAllPanels() {
		activePanels.forEach((panelId) => {
			eventBus.emit('panel.close', { panelId });
		});
		activePanels = [];
	}
</script>

<div class="plotting-example p-6">
	<h2 class="mb-6 text-2xl font-bold">Plotting Infrastructure Example</h2>

	{#if !isInitialized}
		<div class="text-gray-600">Initializing plotting system...</div>
	{:else}
		<!-- Controls -->
		<div class="controls mb-6 space-y-4">
			<div class="flex flex-wrap gap-2">
				<button class="btn btn-primary" on:click={simulateVoxelClick}>
					Simulate Voxel Click
				</button>

				<button class="btn btn-secondary" on:click={simulateShiftClick}>
					Simulate Shift+Click (Histogram)
				</button>

				<button class="btn btn-secondary" on:click={simulateRoiSelection}>
					Simulate ROI Selection
				</button>

				<button class="btn btn-secondary" on:click={requestLayerStats}>
					Request Layer Stats
				</button>

				<button
					class="btn btn-danger"
					on:click={closeAllPanels}
					disabled={activePanels.length === 0}
				>
					Close All Panels
				</button>
			</div>

			<!-- Info -->
			<div class="info rounded bg-blue-50 p-4 dark:bg-blue-900/20">
				<h3 class="mb-2 font-semibold">How it works:</h3>
				<ul class="list-inside list-disc space-y-1 text-sm">
					<li>Click buttons to simulate user actions</li>
					<li>PlotActionConnector maps actions to plot requests</li>
					<li>PlotService finds appropriate provider</li>
					<li>Provider creates plot component</li>
					<li>PlotPanel renders the component</li>
				</ul>
			</div>

			<!-- Active Panels -->
			{#if activePanels.length > 0}
				<div class="active-panels">
					<h3 class="mb-2 font-semibold">Active Plot Panels ({activePanels.length}):</h3>
					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						{#each activePanels as panelId}
							<div class="panel-wrapper h-96">
								<PlotPanel {panelId} className="h-full" />
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Code Example -->
		<div class="code-example mt-8">
			<h3 class="mb-2 font-semibold">Example Code:</h3>
			<pre class="overflow-x-auto rounded bg-gray-100 p-4 text-sm dark:bg-gray-800">
{`// Register a plot provider
plotService.registerProvider({
  id: 'timeseries',
  name: 'Time Series Plot',
  factory: createTimeSeriesPlotProvider
});

// Set up action mappings
const mappings = new PlotMappingBuilder()
  .onVoxelClick('timeseries')
  .onRoiSelection('timeseries')
  .onEvent('custom.event', 'custom-plot')
  .build();

// Create connector
const connector = new PlotActionConnector({
  eventBus,
  plotService,
  mappings
});

// Use PlotPanel component
<PlotPanel panelId={panelId} />`}</pre>
		</div>
	{/if}
</div>

<style>
	.plotting-example {
		@apply mx-auto max-w-6xl;
	}

	.btn {
		@apply rounded px-4 py-2 font-medium transition-colors;
		@apply disabled:cursor-not-allowed disabled:opacity-50;
	}

	.btn-primary {
		@apply bg-blue-600 text-white hover:bg-blue-700;
	}

	.btn-secondary {
		@apply bg-gray-600 text-white hover:bg-gray-700;
	}

	.btn-danger {
		@apply bg-red-600 text-white hover:bg-red-700;
	}

	.panel-wrapper {
		@apply overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700;
	}
</style>
