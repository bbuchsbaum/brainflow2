<!--
  StatusBar Component - Migrated to new architecture
  Application-wide status display with clean separation of concerns
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getService } from '$lib/di/Container';
	import { getEventBus } from '$lib/events/EventBus';
	import type { CrosshairService } from '$lib/services/CrosshairService';
	import type { LayerService } from '$lib/services/LayerService';
	import type { EventBus } from '$lib/events/EventBus';
	import { useCrosshairStore } from '$lib/stores/crosshairSlice.clean';
	import { useLayerStore } from '$lib/stores/layerStoreClean';
	import { statusStore } from '$lib/stores/statusStore';
	import { coreApi } from '$lib/api';

	// Services
	let crosshairService: CrosshairService | null = null;
	let layerService: LayerService | null = null;
	let eventBus: EventBus = getEventBus();

	// State
	let crosshairCoord = $state<[number, number, number] | null>(null);
	let mouseWorldCoord = $state<[number, number, number] | null>(null);
	let fieldOfView = $state({
		anteriorPosterior: { min: -100, max: 100 },
		leftRight: { min: -100, max: 100 },
		inferiorSuperior: { min: -50, max: 50 }
	});
	let layerIntensities = $state<Array<{ id: string; value: number | null }>>([]);
	let isSampling = $state(false);

	// Store subscriptions
	let crosshairStoreState = $state(useCrosshairStore.getState());
	let layerStoreState = $state(useLayerStore.getState());

	// Derived values
	$effect(() => {
		crosshairCoord = crosshairStoreState.worldCoord;
	});

	// Subscribe to mouse coordinates from status store
	$effect(() => {
		const unsubscribe = statusStore.subscribe((state) => {
			mouseWorldCoord = state.mouseWorldCoord;
		});
		return unsubscribe;
	});

	// Update FOV when layers change
	$effect(() => {
		const layerWithGpu = layerStoreState.layers.find(l => l.gpu);
		if (layerWithGpu?.gpu) {
			updateFieldOfView(layerWithGpu.gpu);
		}
	});

	// Sample intensities when crosshair changes
	$effect(() => {
		if (crosshairCoord && !isSampling) {
			sampleIntensitiesAtCrosshair(crosshairCoord);
		}
	});

	// Update field of view from GPU info
	function updateFieldOfView(gpuInfo: any) {
		if (!gpuInfo.dim || !gpuInfo.origin || !gpuInfo.spacing) return;

		const dims = gpuInfo.dim;
		const origin = gpuInfo.origin;
		const spacing = gpuInfo.spacing;
		
		// Calculate bounds
		const xMin = Math.min(origin[0], origin[0] + (dims[0] - 1) * spacing[0]);
		const xMax = Math.max(origin[0], origin[0] + (dims[0] - 1) * spacing[0]);
		
		const yMin = Math.min(origin[1], origin[1] + (dims[1] - 1) * spacing[1]);
		const yMax = Math.max(origin[1], origin[1] + (dims[1] - 1) * spacing[1]);
		
		const zMin = Math.min(origin[2], origin[2] + (dims[2] - 1) * spacing[2]);
		const zMax = Math.max(origin[2], origin[2] + (dims[2] - 1) * spacing[2]);
		
		fieldOfView = {
			leftRight: { min: xMin, max: xMax },
			anteriorPosterior: { min: yMin, max: yMax },
			inferiorSuperior: { min: zMin, max: zMax }
		};

		eventBus.emit('statusbar.fov.updated', { fieldOfView });
	}

	// Sample intensities at crosshair position
	async function sampleIntensitiesAtCrosshair(coords: [number, number, number]) {
		if (isSampling) return;
		
		isSampling = true;
		try {
			const layers = layerStoreState.layers.filter(l => 
				l.spec && 'Volume' in l.spec && l.gpu
			);

			const results = await Promise.all(
				layers.map(async (layer) => {
					if (!('Volume' in layer.spec)) return null;
					
					try {
						const value = await coreApi.sample_world_coordinate(
							layer.spec.Volume.source_resource_id,
							coords
						);
						return { id: layer.id, value };
					} catch (err) {
						console.error(`Failed to sample layer ${layer.id}:`, err);
						return { id: layer.id, value: null };
					}
				})
			);

			layerIntensities = results.filter(r => r !== null) as Array<{ id: string; value: number | null }>;
			eventBus.emit('statusbar.intensities.updated', { intensities: layerIntensities });
		} finally {
			isSampling = false;
		}
	}

	// Format functions
	function formatCoord(value: number): string {
		return value.toFixed(1);
	}
	
	function formatCoordTriple(coords: [number, number, number] | null): string {
		if (!coords) return '—, —, —';
		return `${formatCoord(coords[0])}, ${formatCoord(coords[1])}, ${formatCoord(coords[2])}`;
	}
	
	function formatRange(min: number, max: number): string {
		return `[${formatCoord(min)}, ${formatCoord(max)}]`;
	}

	// Subscribe to events
	let eventUnsubscribes: Array<() => void> = [];

	function subscribeToEvents() {
		// Listen for external coordinate updates
		eventUnsubscribes.push(
			eventBus.on('mouse.worldcoord', ({ coord }) => {
				if (coord) {
					statusStore.setMouseWorldCoord(coord);
				}
			})
		);

		// Listen for layer changes that might affect FOV
		eventUnsubscribes.push(
			eventBus.on('layer.gpu.updated', ({ layerId }) => {
				const layer = layerStoreState.layers.find(l => l.id === layerId);
				if (layer?.gpu) {
					updateFieldOfView(layer.gpu);
				}
			})
		);
	}

	// Lifecycle
	onMount(async () => {
		try {
			// Get services
			[crosshairService, layerService] = await Promise.all([
				getService<CrosshairService>('crosshairService'),
				getService<LayerService>('layerService')
			]);

			// Subscribe to stores
			const unsubscribeCrosshair = useCrosshairStore.subscribe((state) => {
				crosshairStoreState = state;
			});

			const unsubscribeLayer = useLayerStore.subscribe((state) => {
				layerStoreState = state;
			});

			// Subscribe to events
			subscribeToEvents();

			// Cleanup
			return () => {
				unsubscribeCrosshair();
				unsubscribeLayer();
				eventUnsubscribes.forEach(fn => fn());
			};
		} catch (err) {
			console.error('[StatusBar] Failed to initialize:', err);
		}
	});
</script>

<div class="status-bar" role="status" aria-label="Application status">
	<div class="status-section">
		<span class="status-label">Crosshair:</span>
		<span class="status-value coordinate">{formatCoordTriple(crosshairCoord)}</span>
	</div>
	
	<div class="status-divider" role="separator"></div>
	
	<div class="status-section">
		<span class="status-label">Mouse:</span>
		<span class="status-value coordinate">{formatCoordTriple(mouseWorldCoord)}</span>
	</div>
	
	<div class="status-divider" role="separator"></div>
	
	<div class="status-section fov-section">
		<span class="status-label">FOV:</span>
		<div class="fov-group">
			<span class="fov-item">
				<abbr class="fov-label" title="Left/Right">L/R:</abbr>
				<span class="fov-value">{formatRange(fieldOfView.leftRight.min, fieldOfView.leftRight.max)}</span>
			</span>
			<span class="fov-item">
				<abbr class="fov-label" title="Anterior/Posterior">A/P:</abbr>
				<span class="fov-value">{formatRange(fieldOfView.anteriorPosterior.min, fieldOfView.anteriorPosterior.max)}</span>
			</span>
			<span class="fov-item">
				<abbr class="fov-label" title="Inferior/Superior">I/S:</abbr>
				<span class="fov-value">{formatRange(fieldOfView.inferiorSuperior.min, fieldOfView.inferiorSuperior.max)}</span>
			</span>
		</div>
	</div>
	
	<div class="status-divider" role="separator"></div>
	
	<div class="status-section intensity-section">
		<span class="status-label">Intensity:</span>
		{#if isSampling}
			<span class="status-value sampling">Sampling...</span>
		{:else if layerIntensities.length === 0}
			<span class="status-value">—</span>
		{:else}
			<div class="intensity-group">
				{#each layerIntensities as layer}
					<span class="intensity-item">
						<span class="layer-id">{layer.id}:</span>
						<span class="intensity-value">{layer.value !== null ? layer.value.toFixed(1) : '—'}</span>
					</span>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.status-bar {
		display: flex;
		align-items: center;
		height: 28px;
		background-color: var(--color-surface-200, #f5f5f5);
		border-top: 1px solid var(--color-surface-300, #e0e0e0);
		padding: 0 12px;
		font-size: 12px;
		font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace;
		color: var(--color-text-secondary, #666);
		user-select: none;
		overflow: hidden;
	}
	
	.status-section {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	
	.status-label {
		color: var(--color-text-tertiary, #999);
		font-weight: 500;
	}
	
	.status-value {
		color: var(--color-text-primary, #333);
	}
	
	.status-value.sampling {
		color: var(--color-info, #4dabf7);
		font-style: italic;
	}
	
	.coordinate {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
	}
	
	.status-divider {
		width: 1px;
		height: 16px;
		background-color: var(--color-surface-400, #ccc);
		margin: 0 12px;
		flex-shrink: 0;
	}
	
	.fov-section {
		flex: 1;
		min-width: 0;
	}
	
	.fov-group {
		display: flex;
		gap: 16px;
		margin-left: 4px;
		overflow: hidden;
	}
	
	.fov-item {
		display: flex;
		gap: 4px;
		align-items: center;
		flex-shrink: 0;
	}
	
	.fov-label {
		color: var(--color-text-tertiary, #999);
		font-weight: 600;
		font-size: 11px;
		text-decoration: none;
		cursor: help;
	}
	
	.fov-value {
		color: var(--color-text-primary, #333);
		font-variant-numeric: tabular-nums;
		font-size: 11px;
	}
	
	.intensity-section {
		flex: 0 0 auto;
		max-width: 40%;
		overflow: hidden;
	}
	
	.intensity-group {
		display: flex;
		gap: 12px;
		margin-left: 4px;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}
	
	.intensity-group::-webkit-scrollbar {
		display: none;
	}
	
	.intensity-item {
		display: flex;
		gap: 4px;
		align-items: center;
		flex-shrink: 0;
	}
	
	.layer-id {
		color: var(--color-text-tertiary, #999);
		font-weight: 600;
		font-size: 11px;
		max-width: 60px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	
	.intensity-value {
		color: var(--color-text-primary, #333);
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}
	
	/* Dark mode adjustments */
	:global(.dark) .status-bar {
		background-color: var(--color-surface-900, #1a1a1a);
		border-top-color: var(--color-surface-700, #333);
	}
	
	:global(.dark) .status-divider {
		background-color: var(--color-surface-600, #444);
	}
	
	:global(.dark) .status-label,
	:global(.dark) .fov-label,
	:global(.dark) .layer-id {
		color: var(--color-text-tertiary, #888);
	}
	
	:global(.dark) .status-value,
	:global(.dark) .fov-value,
	:global(.dark) .intensity-value {
		color: var(--color-text-primary, #e0e0e0);
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.fov-section {
			display: none;
		}
		
		.intensity-section {
			max-width: 60%;
		}
	}
	
	@media (max-width: 480px) {
		.status-bar {
			font-size: 11px;
			padding: 0 8px;
		}
		
		.status-divider {
			margin: 0 8px;
		}
		
		.intensity-section {
			display: none;
		}
	}
</style>