<!--
  GPU Enhanced Slice Viewer Example
  Demonstrates best practices for using the new GPU Resource Service
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getService } from '$lib/di/Container';
	import { getEventBus } from '$lib/events/EventBus';
	import type { GpuResourceService, RenderTarget } from '$lib/services/GpuResourceService';
	import type { LayerService } from '$lib/services/LayerService';
	import type { NotificationService } from '$lib/services/NotificationService';
	import type { SliceIndex, LayerSpec } from '@brainflow/api';

	// Props
	export let layerId: string;
	export let sliceAxis: 'axial' | 'coronal' | 'sagittal' = 'axial';
	export let sliceIndex: number = 0;
	export let width: number = 512;
	export let height: number = 512;

	// Services
	let gpuResourceService: GpuResourceService | null = null;
	let layerService: LayerService | null = null;
	let notificationService: NotificationService | null = null;
	let eventBus = getEventBus();

	// State
	let canvas: HTMLCanvasElement;
	let isInitialized = false;
	let isRecovering = false;
	let renderStats = {
		fps: 0,
		frameTime: 0,
		cacheHitRate: 0
	};
	let memoryStats = {
		used: 0,
		available: 0,
		pressure: 'low' as 'low' | 'medium' | 'high'
	};

	// Lifecycle
	onMount(async () => {
		try {
			// Get services
			[gpuResourceService, layerService, notificationService] = await Promise.all([
				getService<GpuResourceService>('gpuResourceService'),
				getService<LayerService>('layerService'),
				getService<NotificationService>('notificationService')
			]);

			// Initialize GPU
			await gpuResourceService.initialize();
			isInitialized = true;

			// Set up event listeners
			const unsubscribes = [
				// GPU context events
				eventBus.on('gpu.context.lost', handleContextLoss),
				eventBus.on('gpu.context.restored', handleContextRestored),

				// Memory pressure events
				eventBus.on('gpu.memory.pressure', handleMemoryPressure),

				// Render complete events
				eventBus.on('gpu.render.complete', handleRenderComplete),

				// Layer update events
				eventBus.on('layer.updated', handleLayerUpdate),
				eventBus.on('layer.gpu.resources.changed', scheduleRender)
			];

			// Start render loop
			startRenderLoop();

			// Initial render
			scheduleRender();

			return () => {
				stopRenderLoop();
				unsubscribes.forEach((fn) => fn());
			};
		} catch (error) {
			console.error('Failed to initialize GPU viewer:', error);
			notificationService?.error('Failed to initialize GPU viewer', { error });
		}
	});

	// GPU Event Handlers
	function handleContextLoss() {
		isRecovering = true;
		notificationService?.warning('GPU context lost, recovering...');
	}

	function handleContextRestored() {
		isRecovering = false;
		notificationService?.success('GPU context restored');
		scheduleRender();
	}

	function handleMemoryPressure({ pressure }: { pressure: 'low' | 'medium' | 'high' }) {
		memoryStats.pressure = pressure;

		if (pressure === 'high') {
			// Reduce quality or skip non-critical renders
			notificationService?.warning('High GPU memory usage detected');
		}
	}

	function handleRenderComplete({ duration }: { duration: number }) {
		// Update render stats
		updateRenderStats(duration);
	}

	function handleLayerUpdate({ layerId: updatedLayerId }: { layerId: string }) {
		if (updatedLayerId === layerId) {
			scheduleRender();
		}
	}

	// Rendering
	function scheduleRender() {
		if (!gpuResourceService || !isInitialized || isRecovering) return;

		const request = {
			layerId,
			sliceIndex: { axis: sliceAxis, index: sliceIndex } as SliceIndex,
			width,
			height,
			timestamp: Date.now()
		};

		gpuResourceService.scheduleRender(request);
	}

	// Performance monitoring
	let renderLoopId: number | null = null;

	function startRenderLoop() {
		function update() {
			if (gpuResourceService) {
				// Update stats
				renderStats = gpuResourceService.getRenderStats();
				memoryStats = gpuResourceService.getMemoryStats();
			}

			renderLoopId = requestAnimationFrame(update);
		}

		update();
	}

	function stopRenderLoop() {
		if (renderLoopId !== null) {
			cancelAnimationFrame(renderLoopId);
			renderLoopId = null;
		}
	}

	function updateRenderStats(frameTime: number) {
		// Additional custom stats tracking if needed
	}

	// Reactive updates
	$effect(() => {
		if (sliceIndex !== undefined && gpuResourceService && isInitialized) {
			scheduleRender();
		}
	});

	$effect(() => {
		if ((width || height) && gpuResourceService && isInitialized) {
			// Handle resize
			scheduleRender();
		}
	});

	// Format helpers
	function formatMemory(bytes: number): string {
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	function formatPressure(pressure: string): string {
		const colors = {
			low: 'text-green-500',
			medium: 'text-yellow-500',
			high: 'text-red-500'
		};
		return colors[pressure as keyof typeof colors] || 'text-gray-500';
	}
</script>

<div class="gpu-slice-viewer relative" class:recovering={isRecovering}>
	<!-- Canvas -->
	<canvas
		bind:this={canvas}
		{width}
		{height}
		class="slice-canvas"
		class:opacity-50={isRecovering}
	/>

	<!-- Recovery overlay -->
	{#if isRecovering}
		<div class="absolute inset-0 flex items-center justify-center bg-black/50">
			<div class="text-lg text-white">
				<svg class="mr-2 inline h-8 w-8 animate-spin" viewBox="0 0 24 24">
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="4"
						fill="none"
					/>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
					/>
				</svg>
				Recovering GPU context...
			</div>
		</div>
	{/if}

	<!-- Performance overlay -->
	<div class="absolute top-2 right-2 rounded bg-black/50 p-2 text-xs text-white">
		<div>FPS: {renderStats.fps.toFixed(1)}</div>
		<div>Frame: {renderStats.frameTime.toFixed(1)}ms</div>
		<div>Cache: {(renderStats.cacheHitRate * 100).toFixed(0)}%</div>
	</div>

	<!-- Memory indicator -->
	<div class="absolute right-2 bottom-2 rounded bg-black/50 p-2 text-xs text-white">
		<div>
			GPU: {formatMemory(memoryStats.used)} / {formatMemory(
				memoryStats.used + memoryStats.available
			)}
		</div>
		<div class={formatPressure(memoryStats.pressure)}>
			Pressure: {memoryStats.pressure}
		</div>
	</div>

	<!-- Slice info -->
	<div class="absolute top-2 left-2 rounded bg-black/50 p-2 text-xs text-white">
		<div>{sliceAxis} slice {sliceIndex}</div>
	</div>
</div>

<style>
	.gpu-slice-viewer {
		@apply relative overflow-hidden bg-gray-900;
	}

	.slice-canvas {
		@apply block h-full w-full;
		image-rendering: pixelated;
	}

	.gpu-slice-viewer.recovering {
		@apply cursor-wait;
	}
</style>
