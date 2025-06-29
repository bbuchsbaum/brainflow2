<!--
  VolumeView Component - Migrated to new architecture
  Three-panel orthogonal view with clean separation of concerns
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getService } from '$lib/di/Container';
	import { getEventBus } from '$lib/events/EventBus';
	import type { ComponentContainer } from 'golden-layout';
	import type { LayerService } from '$lib/services/LayerService';
	import type { VolumeService } from '$lib/services/VolumeService';
	import type { NotificationService } from '$lib/services/NotificationService';
	import type { EventBus } from '$lib/events/EventBus';
	import { useLayerStore } from '$lib/stores/layerStoreClean';
	import { statusStore } from '$lib/stores/statusStore';
	import OrthogonalViewGPU from './OrthogonalViewGPU.svelte';
	import { ViewType } from '$lib/types/ViewType';
	import type { LayerSpec } from '$lib/api';
	import { nanoid } from 'nanoid';

	// Props
	let { 
		glContainer, 
		initialState,
		componentState
	}: { 
		glContainer?: ComponentContainer; 
		initialState?: { layerId?: string | null };
		componentState?: { layerId?: string | null };
	} = $props();

	// Services
	let layerService: LayerService | null = null;
	let volumeService: VolumeService | null = null;
	let notificationService: NotificationService | null = null;
	let eventBus: EventBus = getEventBus();

	// State
	let layerId = $state(componentState?.layerId ?? initialState?.layerId ?? null);
	let containerElement = $state<HTMLDivElement>();
	let isDragOver = $state(false);
	let isLoading = $state(false);
	let error = $state<Error | null>(null);

	// Store subscriptions
	let layerStoreState = $state(useLayerStore.getState());

	// Derived values
	let activeLayer = $derived(
		layerId ? layerStoreState.layers.find(l => l.id === layerId) : null
	);

	let hasLayers = $derived(layerStoreState.layers.length > 0);
	let layerGpu = $derived(activeLayer?.gpu || null);

	// Auto-select first layer if none selected
	$effect(() => {
		if (!layerId && hasLayers) {
			const firstLayer = layerStoreState.layers[0];
			if (firstLayer) {
				selectLayer(firstLayer.id);
			}
		}
	});

	// Select a layer
	function selectLayer(id: string) {
		layerId = id;
		eventBus.emit('volumeview.layer.selected', { layerId: id });
		
		// Update GoldenLayout state
		if (glContainer) {
			glContainer.setState({ layerId: id });
			const layer = layerStoreState.layers.find(l => l.id === id);
			if (layer && 'Volume' in layer.spec) {
				glContainer.setTitle(`Volume View - ${layer.spec.Volume.id}`);
			}
		}
	}

	// Handle viewport changes from child views
	function handleViewportChange(viewType: ViewType, viewport: { scale: number; offset: [number, number] }) {
		eventBus.emit('volumeview.viewport.changed', { viewType, viewport });
	}

	// Handle drag and drop
	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
		
		if (!event.dataTransfer) return;
		
		const fileData = event.dataTransfer.getData('application/x-brainflow-file');
		const fallbackData = event.dataTransfer.getData('text/plain');
		const dataToUse = fileData || fallbackData;
		
		if (dataToUse && volumeService && layerService) {
			try {
				isLoading = true;
				const { path, name } = JSON.parse(dataToUse);
				
				// Load volume through service
				const volumeId = await volumeService.loadVolume(path);
				
				// Create layer through service
				const layerSpec: LayerSpec = {
					Volume: {
						id: `layer-${nanoid(5)}`,
						source_resource_id: volumeId,
						colormap: 'grayscale',
						slice_axis: null,
						slice_index: null
					}
				};
				
				const newLayerId = await layerService.addLayer(layerSpec);
				selectLayer(newLayerId);
				
				notificationService?.success(`Loaded ${name}`);
			} catch (err) {
				console.error('Failed to load dropped file:', err);
				error = err instanceof Error ? err : new Error('Failed to load file');
				notificationService?.error('Failed to load file', {
					error: err instanceof Error ? err : undefined
				});
			} finally {
				isLoading = false;
			}
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
		isDragOver = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
	}

	// Subscribe to events
	let eventUnsubscribes: Array<() => void> = [];

	function subscribeToEvents() {
		// Listen for layer additions
		eventUnsubscribes.push(
			eventBus.on('layer.added', ({ layerId: newLayerId }) => {
				if (!layerId) {
					selectLayer(newLayerId);
				}
			})
		);

		// Listen for layer removal
		eventUnsubscribes.push(
			eventBus.on('layer.removed', ({ layerId: removedId }) => {
				if (layerId === removedId) {
					// Select another layer or clear
					const remainingLayers = layerStoreState.layers.map(l => l.id);
					if (remainingLayers.length > 0) {
						selectLayer(remainingLayers[0]);
					} else {
						layerId = null;
						if (glContainer) {
							glContainer.setTitle('Volume View');
						}
					}
				}
			})
		);

		// Listen for external layer selection
		eventUnsubscribes.push(
			eventBus.on('layer.selected', ({ layerId: selectedId }) => {
				if (selectedId !== layerId) {
					selectLayer(selectedId);
				}
			})
		);
	}

	// Lifecycle
	onMount(async () => {
		try {
			// Get services
			[layerService, volumeService, notificationService] = await Promise.all([
				getService<LayerService>('layerService'),
				getService<VolumeService>('volumeService'),
				getService<NotificationService>('notificationService')
			]);

			// Subscribe to stores
			const unsubscribeLayerStore = useLayerStore.subscribe((state) => {
				layerStoreState = state;
			});

			// StatusStore uses singleton pattern, no subscription needed

			// Subscribe to events
			subscribeToEvents();

			// GoldenLayout integration
			if (glContainer) {
				const handleStateChanged = () => {
					const newState = glContainer.getState() as { layerId?: string | null };
					if (newState?.layerId !== layerId) {
						layerId = newState?.layerId ?? null;
					}
				};
				
				glContainer.on('stateChanged', handleStateChanged);
				
				// Provide method for external updates
				(glContainer as any).updateLayerId = (newLayerId: string) => {
					selectLayer(newLayerId);
				};
				
				eventUnsubscribes.push(() => {
					glContainer.off('stateChanged', handleStateChanged);
				});
			}

			// Cleanup
			return () => {
				unsubscribeLayerStore();
				eventUnsubscribes.forEach(fn => fn());
			};
		} catch (err) {
			console.error('[VolumeView] Failed to initialize:', err);
			error = err instanceof Error ? err : new Error('Failed to initialize');
		}
	});
</script>

<div 
	class="volume-view-container"
	class:drag-over={isDragOver}
	bind:this={containerElement}
	ondragover={handleDragOver}
	ondragenter={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	role="region"
	aria-label="Volume viewer"
>
	{#if error}
		<div class="message-container error">
			<p>Error: {error.message}</p>
		</div>
	{:else if isLoading}
		<div class="message-container loading">
			<p>Loading volume...</p>
		</div>
	{:else if !layerId}
		<div class="message-container empty">
			<p>No volume loaded</p>
			<p class="hint">Double-click a file or drag it here</p>
		</div>
	{:else if !layerGpu}
		<div class="message-container loading">
			<p>Preparing GPU resources...</p>
		</div>
	{:else}
		<div class="orthogonal-views">
			<!-- Axial View -->
			<div class="view-panel axial">
				<OrthogonalViewGPU
					{layerId}
					viewType={ViewType.Axial}
					onViewportChange={handleViewportChange}
				/>
			</div>
			
			<!-- Coronal View -->
			<div class="view-panel coronal">
				<OrthogonalViewGPU
					{layerId}
					viewType={ViewType.Coronal}
					onViewportChange={handleViewportChange}
				/>
			</div>
			
			<!-- Sagittal View -->
			<div class="view-panel sagittal">
				<OrthogonalViewGPU
					{layerId}
					viewType={ViewType.Sagittal}
					onViewportChange={handleViewportChange}
				/>
			</div>
		</div>
	{/if}
</div>

<style>
	.volume-view-container {
		position: relative;
		width: 100%;
		height: 100%;
		background-color: var(--color-surface-900, #111);
		overflow: hidden;
		transition: all 0.2s ease;
	}

	.volume-view-container.drag-over {
		background-color: var(--color-surface-800, #222);
		box-shadow: inset 0 0 0 3px var(--color-primary, #3b82f6);
	}

	.message-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 16px;
		user-select: none;
	}

	.message-container.empty {
		color: var(--color-text-tertiary, #666);
	}

	.message-container.loading {
		color: var(--color-info, #4dabf7);
	}

	.message-container.error {
		color: var(--color-error, #ff6b6b);
	}

	.message-container .hint {
		font-size: 14px;
		color: var(--color-text-quaternary, #555);
		margin-top: 10px;
	}

	.orthogonal-views {
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		gap: 2px;
		background-color: var(--color-surface-700, #333);
		padding: 2px;
	}

	.view-panel {
		background-color: var(--color-surface-900, #111);
		overflow: hidden;
		position: relative;
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

	/* Fourth quadrant could be used for 3D view */
	.view-panel.three-d {
		grid-column: 2;
		grid-row: 2;
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.orthogonal-views {
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