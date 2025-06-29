<!--
  OrthogonalViewContainer Component - Migrated to new architecture
  Container for managing three orthogonal views with event-driven coordination
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getService } from '$lib/di/Container';
	import { getEventBus } from '$lib/events/EventBus';
	import type { LayerService } from '$lib/services/LayerService';
	import type { CrosshairService } from '$lib/services/CrosshairService';
	import type { NotificationService } from '$lib/services/NotificationService';
	import type { EventBus } from '$lib/events/EventBus';
	import { useLayerStore } from '$lib/stores/layerStoreClean';
	import { useCrosshairStore } from '$lib/stores/crosshairSlice.clean';
	import { ViewType } from '$lib/types/ViewType';
	import OrthogonalViewGPU from './OrthogonalViewGPU.svelte';

	// Props
	let {
		selectedLayerId = null
	}: {
		selectedLayerId?: string | null;
	} = $props();

	// Services
	let layerService: LayerService | null = null;
	let crosshairService: CrosshairService | null = null;
	let notificationService: NotificationService | null = null;
	let eventBus: EventBus = getEventBus();

	// State
	let gpuInitialized = $state(false);
	let initError = $state<string | null>(null);
	let viewports = $state({
		[ViewType.Axial]: { scale: 1.0, offset: [0, 0] as [number, number] },
		[ViewType.Coronal]: { scale: 1.0, offset: [0, 0] as [number, number] },
		[ViewType.Sagittal]: { scale: 1.0, offset: [0, 0] as [number, number] }
	});
	let syncViewScales = $state(true);

	// Store subscriptions
	let layerStoreState = $state(useLayerStore.getState());
	let crosshairStoreState = $state(useCrosshairStore.getState());

	// Initialize GPU context once for all views
	async function initializeGPUContext() {
		try {
			console.log('[OrthogonalViewContainer] Checking GPU context...');
			// GPU initialization is now handled by the render service
			// This component just needs to verify it's available
			
			// Check if we have at least one layer with GPU resources
			const hasGpuLayer = layerStoreState.layers.some(l => l.gpu);
			if (hasGpuLayer || layerStoreState.layers.length === 0) {
				gpuInitialized = true;
				console.log('[OrthogonalViewContainer] GPU context ready');
			} else {
				// Wait for GPU resources via events
				const unsubscribe = eventBus.on('layer.gpu.ready', () => {
					gpuInitialized = true;
					unsubscribe();
				});
			}
		} catch (err) {
			console.error('[OrthogonalViewContainer] Failed to initialize GPU context:', err);
			initError = `Failed to initialize GPU: ${err}`;
			notificationService?.error('GPU initialization failed', { error: err instanceof Error ? err : undefined });
		}
	}

	// Handle viewport changes from individual views
	function handleViewportChange(viewType: ViewType, viewport: { scale: number; offset: [number, number] }) {
		const oldViewport = viewports[viewType];
		viewports[viewType] = viewport;

		// Emit viewport change event
		eventBus.emit('viewcontainer.viewport.changed', { 
			viewType, 
			viewport,
			allViewports: viewports
		});

		// Handle scale synchronization if enabled
		if (syncViewScales && Math.abs(oldViewport.scale - viewport.scale) > 0.001) {
			synchronizeViewScales(viewport.scale);
		}
	}

	// Synchronize scales across all views
	function synchronizeViewScales(targetScale: number) {
		const needsUpdate = Object.values(ViewType).some(vt => {
			if (typeof vt === 'number') {
				return Math.abs(viewports[vt].scale - targetScale) > 0.001;
			}
			return false;
		});

		if (needsUpdate) {
			viewports = {
				[ViewType.Axial]: { ...viewports[ViewType.Axial], scale: targetScale },
				[ViewType.Coronal]: { ...viewports[ViewType.Coronal], scale: targetScale },
				[ViewType.Sagittal]: { ...viewports[ViewType.Sagittal], scale: targetScale }
			};

			// Emit scale sync event
			eventBus.emit('viewcontainer.scales.synchronized', { scale: targetScale });
		}
	}

	// Handle crosshair updates through service
	async function handleCrosshairClick(viewType: ViewType, worldCoord: [number, number, number]) {
		if (!crosshairService) return;

		try {
			// Update crosshair through service
			await crosshairService.setWorldCoordinate(worldCoord);
			
			// Emit crosshair update event
			eventBus.emit('viewcontainer.crosshair.clicked', { 
				viewType, 
				worldCoord 
			});
		} catch (err) {
			console.error('[OrthogonalViewContainer] Failed to update crosshair:', err);
			notificationService?.error('Failed to update crosshair position');
		}
	}

	// Subscribe to events
	let eventUnsubscribes: Array<() => void> = [];

	function subscribeToEvents() {
		// Listen for external viewport sync requests
		eventUnsubscribes.push(
			eventBus.on('viewcontainer.sync.viewports', ({ scale }) => {
				if (syncViewScales && scale !== undefined) {
					synchronizeViewScales(scale);
				}
			})
		);

		// Listen for sync mode changes
		eventUnsubscribes.push(
			eventBus.on('viewcontainer.sync.toggle', ({ enabled }) => {
				syncViewScales = enabled;
				if (enabled) {
					// Sync to the current maximum scale
					const maxScale = Math.max(
						viewports[ViewType.Axial].scale,
						viewports[ViewType.Coronal].scale,
						viewports[ViewType.Sagittal].scale
					);
					synchronizeViewScales(maxScale);
				}
			})
		);

		// Listen for GPU context changes
		eventUnsubscribes.push(
			eventBus.on('gpu.context.lost', () => {
				gpuInitialized = false;
				initError = 'GPU context lost. Please refresh the page.';
			})
		);

		eventUnsubscribes.push(
			eventBus.on('gpu.context.restored', () => {
				gpuInitialized = true;
				initError = null;
			})
		);
	}

	// Lifecycle
	onMount(async () => {
		console.log('[OrthogonalViewContainer] Mounting...');
		
		try {
			// Get services
			[layerService, crosshairService, notificationService] = await Promise.all([
				getService<LayerService>('layerService'),
				getService<CrosshairService>('crosshairService'),
				getService<NotificationService>('notificationService')
			]);

			// Subscribe to stores
			const unsubscribeLayerStore = useLayerStore.subscribe((state) => {
				layerStoreState = state;
			});

			const unsubscribeCrosshairStore = useCrosshairStore.subscribe((state) => {
				crosshairStoreState = state;
			});

			// Subscribe to events
			subscribeToEvents();

			// Initialize GPU context
			await initializeGPUContext();

			// Cleanup
			return () => {
				unsubscribeLayerStore();
				unsubscribeCrosshairStore();
				eventUnsubscribes.forEach(fn => fn());
			};
		} catch (err) {
			console.error('[OrthogonalViewContainer] Failed to initialize:', err);
			initError = `Failed to initialize: ${err}`;
		}
	});
</script>

<div class="orthogonal-view-container">
	{#if initError}
		<div class="init-error">
			<h3>GPU Initialization Error</h3>
			<p>{initError}</p>
		</div>
	{:else if !gpuInitialized}
		<div class="init-loading">
			<p>Initializing GPU context...</p>
		</div>
	{:else}
		<div class="view-grid">
			<div class="view-panel axial">
				<OrthogonalViewGPU
					layerId={selectedLayerId}
					viewType={ViewType.Axial}
					onViewportChange={handleViewportChange}
					onCrosshairClick={handleCrosshairClick}
				/>
			</div>
			
			<div class="view-panel coronal">
				<OrthogonalViewGPU
					layerId={selectedLayerId}
					viewType={ViewType.Coronal}
					onViewportChange={handleViewportChange}
					onCrosshairClick={handleCrosshairClick}
				/>
			</div>
			
			<div class="view-panel sagittal">
				<OrthogonalViewGPU
					layerId={selectedLayerId}
					viewType={ViewType.Sagittal}
					onViewportChange={handleViewportChange}
					onCrosshairClick={handleCrosshairClick}
				/>
			</div>
		</div>
		
		<div class="view-controls">
			<label>
				<input 
					type="checkbox" 
					bind:checked={syncViewScales}
					on:change={() => eventBus.emit('viewcontainer.sync.changed', { enabled: syncViewScales })}
				/>
				Synchronize view scales
			</label>
		</div>
	{/if}
</div>

<style>
	.orthogonal-view-container {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		background-color: #0a0a0a;
	}

	.init-error, .init-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: #fff;
		text-align: center;
		padding: 2rem;
	}

	.init-error {
		color: #ff6b6b;
	}

	.init-error h3 {
		margin-bottom: 1rem;
	}

	.view-grid {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		gap: 2px;
		padding: 2px;
		background-color: #333;
	}

	.view-panel {
		background-color: #000;
		position: relative;
		overflow: hidden;
		min-width: 256px;
		min-height: 256px;
	}

	.view-panel.axial {
		grid-column: 1;
		grid-row: 1;
	}

	.view-panel.coronal {
		grid-column: 2;
		grid-row: 1;
	}

	.view-panel.sagittal {
		grid-column: 1;
		grid-row: 2;
	}

	/* Fourth quadrant could be used for 3D view or controls */
	.view-controls {
		position: absolute;
		bottom: 1rem;
		right: 1rem;
		background-color: rgba(0, 0, 0, 0.8);
		padding: 0.5rem 1rem;
		border-radius: 4px;
		color: #fff;
		font-size: 14px;
		z-index: 100;
	}

	.view-controls label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		user-select: none;
	}

	.view-controls input[type="checkbox"] {
		cursor: pointer;
	}

	/* Responsive layout for smaller screens */
	@media (max-width: 768px) {
		.view-grid {
			grid-template-columns: 1fr;
			grid-template-rows: repeat(3, 1fr);
		}

		.view-panel.axial {
			grid-column: 1;
			grid-row: 1;
		}

		.view-panel.coronal {
			grid-column: 1;
			grid-row: 2;
		}

		.view-panel.sagittal {
			grid-column: 1;
			grid-row: 3;
		}
	}
</style>