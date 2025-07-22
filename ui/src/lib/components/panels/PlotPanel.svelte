<!--
  PlotPanel Component
  Generic container for plot providers with flexible rendering
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getService } from '$lib/di/Container';
	import { getEventBus } from '$lib/events/EventBus';
	import { plotStore, getPlotPanel } from '$lib/stores/plotStore';
	import type { PlotService } from '$lib/services/PlotService';
	import type {
		PlotProvider,
		PlotPanelState,
		PlotConfig,
		PlotInteraction
	} from '$lib/plotting/PlotProvider';
	import { Download, RefreshCw, Trash2 } from 'lucide-svelte';

	// Props
	let { panelId, className = '' }: { panelId: string; className?: string } = $props();

	// Services
	let plotService: PlotService | null = null;
	let eventBus = getEventBus();

	// State
	let panelState = $state<PlotPanelState | undefined>(undefined);
	let providerComponent = $state<any>(null);
	let plotContainer: HTMLDivElement;
	let isExporting = $state(false);

	// Derived
	let isLoading = $derived(panelState?.isLoading ?? false);
	let hasError = $derived(!!panelState?.error);
	let errorMessage = $derived(panelState?.error?.message ?? '');
	let hasData = $derived((panelState?.series.length ?? 0) > 0);

	// Lifecycle
	onMount(async () => {
		plotService = await getService<PlotService>('plotService');

		// Get initial panel state
		panelState = getPlotPanel(panelId);

		// Subscribe to panel events
		const unsubscribes = [
			// Component creation
			eventBus.on('plot.panel.create', async ({ panelId: id, component }) => {
				if (id === panelId && component) {
					await mountComponent(component);
				}
			}),

			// Data updates
			eventBus.on('plot.updated', ({ panelId: id, series }) => {
				if (id === panelId) {
					plotStore.updatePanelSeries(panelId, series);
				}
			}),

			// Loading state
			eventBus.on('plot.loading', ({ panelId: id, isLoading }) => {
				if (id === panelId) {
					plotStore.setPanelLoading(panelId, isLoading);
				}
			}),

			// Error state
			eventBus.on('plot.error', ({ panelId: id, error }) => {
				if (id === panelId) {
					plotStore.setPanelError(panelId, error);
				}
			}),

			// Export events
			eventBus.on('plot.export.start', ({ panelId: id }) => {
				if (id === panelId) {
					isExporting = true;
				}
			}),

			eventBus.on('plot.export.complete', ({ panelId: id }) => {
				if (id === panelId) {
					isExporting = false;
				}
			})
		];

		// Set as active panel
		plotStore.setActivePanel(panelId);

		return () => {
			unsubscribes.forEach((fn) => fn());

			// Clean up component
			if (providerComponent?.destroy) {
				providerComponent.destroy();
			}

			// Remove from store
			plotStore.removePanel(panelId);
		};
	});

	// Reactive update for panel state
	$effect(() => {
		panelState = getPlotPanel(panelId);
	});

	// Mount provider component
	async function mountComponent(ComponentClass: any) {
		if (!plotContainer || !panelState) return;

		try {
			// Clean up existing component
			if (providerComponent?.destroy) {
				providerComponent.destroy();
			}

			// Create new component instance
			providerComponent = new ComponentClass({
				target: plotContainer,
				props: {
					series: panelState.series,
					config: panelState.config,
					onInteraction: handleInteraction
				}
			});
		} catch (error) {
			console.error('Failed to mount plot component:', error);
			plotStore.setPanelError(panelId, error as Error);
		}
	}

	// Handle plot interactions
	function handleInteraction(interaction: PlotInteraction) {
		eventBus.emit('plot.interaction', {
			panelId,
			...interaction
		});
	}

	// Export functions
	async function exportPlot(format: 'png' | 'svg' | 'csv' | 'json') {
		if (!plotService) return;

		try {
			isExporting = true;
			await plotService.exportPlot(panelId, format);
		} catch (error) {
			console.error('Export failed:', error);
		} finally {
			isExporting = false;
		}
	}

	// Panel actions
	function refreshPlot() {
		eventBus.emit('plot.refresh', { panelId });
	}

	function clearPlot() {
		if (panelState) {
			plotStore.updatePanelSeries(panelId, []);
		}
	}

	function closePlot() {
		eventBus.emit('panel.close', { panelId });
	}

	// Focus handling
	function handleFocus() {
		plotStore.setActivePanel(panelId);
	}

	// Config updates
	$effect(() => {
		if (providerComponent && panelState?.config) {
			// Update component config
			providerComponent.$set({ config: panelState.config });
		}
	});

	// Series updates
	$effect(() => {
		if (providerComponent && panelState?.series) {
			// Update component data
			providerComponent.$set({ series: panelState.series });
		}
	});
</script>

<div
	class="plot-panel {className}"
	class:loading={isLoading}
	class:error={hasError}
	onclick={handleFocus}
	onfocusin={handleFocus}
	role="region"
	aria-label="Plot panel"
	tabindex="-1"
>

	<!-- Content -->
	<div class="plot-content">
		{#if isLoading}
			<div class="plot-loading">
				<div class="loading-spinner" />
				<p>Loading plot data...</p>
			</div>
		{:else if hasError}
			<div class="plot-error">
				<svg
					style="margin-bottom: 0.5rem; height: 3rem; width: 3rem; color: var(--color-error);"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				<p style="font-size: var(--font-size-sm); color: var(--color-text-primary);">Failed to load plot</p>
				<p style="margin-top: var(--spacing-1); font-size: var(--font-size-xs); color: var(--color-text-secondary);">{errorMessage}</p>
				<button
					style="margin-top: var(--spacing-2); font-size: var(--font-size-sm); color: var(--color-primary-500); background: none; border: none; cursor: pointer;"
					onclick={refreshPlot}
				>
					Try again
				</button>
			</div>
		{:else if !hasData}
			<div class="plot-empty compact">
				<p style="font-size: var(--font-size-sm); color: var(--color-text-secondary);">
					No plots generated yet
				</p>
				<p style="font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-top: var(--spacing-1);">
					Click on a voxel to generate time series
				</p>
			</div>
		{:else}
			<!-- Plot container for provider component -->
			<div bind:this={plotContainer} class="plot-container" class:exporting={isExporting} />
		{/if}
	</div>

	<!-- Status bar -->
	{#if panelState?.series.length > 1}
		<div class="plot-status">
			<span style="font-size: var(--font-size-xs); color: var(--color-text-secondary);">
				{panelState.series.length} series
			</span>
		</div>
	{/if}
</div>

<style>
	.plot-panel {
		display: flex;
		height: 100%;
		flex-direction: column;
		background-color: var(--color-panel-background);
	}

	.plot-panel:focus {
		outline: none;
	}

	.plot-panel.loading {
		opacity: 0.75;
	}

	.plot-panel.error {
		border-color: var(--color-error);
	}

	/* Use styles from PanelHeader component */
	.panel-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--radius-base);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.panel-action:hover {
		background-color: var(--color-hover);
		color: var(--color-text-primary);
	}

	.panel-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.plot-content {
		position: relative;
		flex: 1;
		overflow: hidden;
	}

	.plot-container {
		height: 100%;
		width: 100%;
	}

	.plot-container.exporting {
		pointer-events: none;
		opacity: 0.5;
	}

	.plot-loading,
	.plot-error,
	.plot-empty {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		text-align: center;
	}

	.plot-empty.compact {
		padding: 1rem;
	}

	.loading-spinner {
		margin-bottom: var(--spacing-4);
		height: 2rem;
		width: 2rem;
		border: 1px solid var(--color-border);
		border-top-color: var(--color-primary-500);
		border-radius: var(--radius-full);
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.plot-status {
		border-top: 1px solid var(--color-border);
		padding: var(--spacing-1) var(--spacing-4);
		background-color: var(--color-panel-header);
	}
</style>
