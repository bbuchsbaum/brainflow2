<!--
  OrthogonalViewGPU Component - Migrated to new architecture
  GPU-accelerated orthogonal view with clean separation of concerns
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
	import { ViewType, getViewTypeName } from '$lib/types/ViewType';
	import type { VolumeLayerGpuInfo } from '$lib/api';
	import { coreApi } from '$lib/api';
	import { debounce } from '$lib/utils/debounce';

	// Props
	let {
		layerId,
		viewType,
		onViewportChange
	}: {
		layerId: string | null;
		viewType: ViewType;
		onViewportChange?: (viewType: ViewType, viewport: { scale: number; offset: [number, number] }) => void;
	} = $props();

	// Services
	let layerService: LayerService | null = null;
	let crosshairService: CrosshairService | null = null;
	let notificationService: NotificationService | null = null;
	let eventBus: EventBus = getEventBus();

	// State - View Management
	let canvasElement = $state<HTMLCanvasElement>();
	let containerSize = $state({ width: 512, height: 512 });
	let viewScale = $state(1.0);
	let viewOffset = $state([0, 0] as [number, number]);
	let viewCenter = $state<[number, number, number] | null>(null);

	// State - GPU
	let gpuInitialized = $state(false);
	let renderTargetCreated = $state(false);
	let isRenderLoopRunning = $state(false);
	let layerAdded = $state(false);

	// State - Interaction
	let isDragging = $state(false);
	let lastPointerPos = $state<[number, number] | null>(null);

	// State - Slice control
	let slicePosition = $state(0);
	let sliceMin = $state(-100);
	let sliceMax = $state(100);
	let sliceStep = $state(1);

	// Store subscriptions
	let layerStoreState = $state(useLayerStore.getState());
	let crosshairStoreState = $state(useCrosshairStore.getState());

	// Derived values
	let layer = $derived(
		layerId ? layerStoreState.layers.get(layerId) : null
	);

	let layerGpu = $derived(layer?.gpuInfo || null);
	let crosshairPos = $derived(crosshairStoreState.worldCoord);

	// Canvas resize observer
	let resizeObserver: ResizeObserver | null = null;

	// Initialize GPU rendering
	async function initializeGPU() {
		try {
			if (!gpuInitialized) {
				console.log('[OrthogonalViewGPU] Initializing GPU render loop...');
				await coreApi.init_render_loop();
				gpuInitialized = true;
				eventBus.emit('gpu.initialized', { viewType });
			}

			if (!renderTargetCreated && containerSize.width > 0 && containerSize.height > 0) {
				renderTargetCreated = true;
				eventBus.emit('gpu.rendertarget.created', { viewType, size: containerSize });
			}
		} catch (err) {
			console.error('[OrthogonalViewGPU] Failed to initialize GPU:', err);
			notificationService?.error('GPU initialization failed', {
				message: err instanceof Error ? err.message : 'Unknown error'
			});
			eventBus.emit('gpu.error', { viewType, error: err });
		}
	}

	// Calculate volume bounds
	function getVolumeBounds(gpu: VolumeLayerGpuInfo) {
		const dims = gpu.dim;
		const spacing = gpu.spacing;
		const origin = gpu.origin;

		return {
			x: {
				min: Math.min(origin[0], origin[0] + (dims[0] - 1) * spacing[0]),
				max: Math.max(origin[0], origin[0] + (dims[0] - 1) * spacing[0])
			},
			y: {
				min: Math.min(origin[1], origin[1] + (dims[1] - 1) * spacing[1]),
				max: Math.max(origin[1], origin[1] + (dims[1] - 1) * spacing[1])
			},
			z: {
				min: Math.min(origin[2], origin[2] + (dims[2] - 1) * spacing[2]),
				max: Math.max(origin[2], origin[2] + (dims[2] - 1) * spacing[2])
			}
		};
	}

	// Get view dimensions
	function getViewDimensions(viewType: ViewType, bounds: ReturnType<typeof getVolumeBounds>) {
		let widthMm: number;
		let heightMm: number;

		switch (viewType) {
			case ViewType.Axial:
				widthMm = bounds.x.max - bounds.x.min;
				heightMm = bounds.y.max - bounds.y.min;
				break;
			case ViewType.Coronal:
				widthMm = bounds.x.max - bounds.x.min;
				heightMm = bounds.z.max - bounds.z.min;
				break;
			case ViewType.Sagittal:
				widthMm = bounds.y.max - bounds.y.min;
				heightMm = bounds.z.max - bounds.z.min;
				break;
		}

		// Add padding
		const padding = 1.2;
		widthMm *= padding;
		heightMm *= padding;

		// Apply view scale
		return {
			width: widthMm / viewScale,
			height: heightMm / viewScale
		};
	}

	// Setup view parameters
	async function setupViewParameters() {
		if (!layerGpu || !crosshairPos) return;

		// Initialize view center
		if (!viewCenter) {
			viewCenter = [...crosshairPos];
		}

		const bounds = getVolumeBounds(layerGpu);
		const viewDims = getViewDimensions(viewType, bounds);

		// Update slice bounds
		switch (viewType) {
			case ViewType.Axial:
				sliceMin = bounds.z.min;
				sliceMax = bounds.z.max;
				slicePosition = crosshairPos[2];
				break;
			case ViewType.Coronal:
				sliceMin = bounds.y.min;
				sliceMax = bounds.y.max;
				slicePosition = crosshairPos[1];
				break;
			case ViewType.Sagittal:
				sliceMin = bounds.x.min;
				sliceMax = bounds.x.max;
				slicePosition = crosshairPos[0];
				break;
		}

		// Check bounds
		if (crosshairService && (
			crosshairPos[0] < bounds.x.min || crosshairPos[0] > bounds.x.max ||
			crosshairPos[1] < bounds.y.min || crosshairPos[1] > bounds.y.max ||
			crosshairPos[2] < bounds.z.min || crosshairPos[2] > bounds.z.max
		)) {
			const center: [number, number, number] = [
				(bounds.x.min + bounds.x.max) / 2,
				(bounds.y.min + bounds.y.max) / 2,
				(bounds.z.min + bounds.z.max) / 2
			];
			console.warn('[OrthogonalViewGPU] Crosshair outside bounds, resetting to center');
			await crosshairService.setWorldCoordinate(center);
			return;
		}

		// Set view plane
		const planeId = viewType as 0 | 1 | 2;
		await coreApi.set_view_plane(planeId);

		// Set crosshair for shader
		let shaderCrosshair: [number, number, number];
		switch (viewType) {
			case ViewType.Axial:
				shaderCrosshair = [crosshairPos[0], crosshairPos[1], slicePosition];
				break;
			case ViewType.Coronal:
				shaderCrosshair = [crosshairPos[0], slicePosition, crosshairPos[2]];
				break;
			case ViewType.Sagittal:
				shaderCrosshair = [slicePosition, crosshairPos[1], crosshairPos[2]];
				break;
		}
		await coreApi.set_crosshair(shaderCrosshair);

		// Update frame center
		let frameCenter: [number, number, number];
		switch (viewType) {
			case ViewType.Axial:
				frameCenter = [viewCenter[0], viewCenter[1], slicePosition];
				break;
			case ViewType.Coronal:
				frameCenter = [viewCenter[0], slicePosition, viewCenter[2]];
				break;
			case ViewType.Sagittal:
				frameCenter = [slicePosition, viewCenter[1], viewCenter[2]];
				break;
		}

		await coreApi.update_frame_for_synchronized_view(
			viewDims.width,
			viewDims.height,
			frameCenter,
			planeId
		);
	}

	// Add layer to render state
	async function addLayerToRenderState() {
		if (!layerGpu || !renderTargetCreated || layerAdded) return;

		try {
			const textureCoords = [
				layerGpu.texture_coords.u_min,
				layerGpu.texture_coords.v_min,
				layerGpu.texture_coords.u_max,
				layerGpu.texture_coords.v_max
			];

			await coreApi.add_render_layer(
				layerGpu.atlas_layer_index,
				layer?.opacity || 1.0,
				textureCoords
			);

			layerAdded = true;
			eventBus.emit('gpu.layer.added', { layerId, viewType });
		} catch (err) {
			console.error('[OrthogonalViewGPU] Failed to add layer:', err);
			eventBus.emit('gpu.layer.error', { layerId, viewType, error: err });
		}
	}

	// Render frame
	async function renderFrame() {
		if (!canvasElement || !layerGpu || !renderTargetCreated || !crosshairPos) return;

		if (containerSize.width === 0 || containerSize.height === 0) {
			console.warn('[OrthogonalViewGPU] Skipping render - invalid container size');
			return;
		}

		try {
			await setupViewParameters();
			
			const imageDataUrl = await coreApi.render_to_image();
			
			if (imageDataUrl.startsWith('data:image/raw-rgba;base64,')) {
				const base64Data = imageDataUrl.substring('data:image/raw-rgba;base64,'.length);
				const binaryData = atob(base64Data);
				const bytes = new Uint8Array(binaryData.length);
				for (let i = 0; i < binaryData.length; i++) {
					bytes[i] = binaryData.charCodeAt(i);
				}

				const ctx = canvasElement.getContext('2d');
				if (!ctx) return;

				// Handle buffer size mismatch
				const expectedSize = containerSize.width * containerSize.height * 4;
				if (bytes.length !== expectedSize) {
					await handleBufferSizeMismatch(ctx, bytes);
				} else {
					await drawImageData(ctx, bytes, containerSize.width, containerSize.height);
				}
			}

			eventBus.emit('gpu.frame.rendered', { viewType });
		} catch (err) {
			console.error('[OrthogonalViewGPU] Render frame error:', err);
			eventBus.emit('gpu.render.error', { viewType, error: err });
		}
	}

	// Handle buffer size mismatch
	async function handleBufferSizeMismatch(ctx: CanvasRenderingContext2D, bytes: Uint8Array) {
		const pixelCount = bytes.length / 4;
		
		// Try common dimensions
		const possibleSizes = [
			[512, 512], [256, 256], [352, 256], [256, 352],
			[512, 256], [256, 512], [512, 176], [176, 512]
		];
		
		let renderWidth = 0;
		let renderHeight = 0;
		
		for (const [w, h] of possibleSizes) {
			if (w * h === pixelCount) {
				renderWidth = w;
				renderHeight = h;
				break;
			}
		}
		
		if (renderWidth > 0 && renderHeight > 0) {
			await drawImageData(ctx, bytes, renderWidth, renderHeight);
		} else {
			console.warn('[OrthogonalViewGPU] Could not determine buffer dimensions');
		}
	}

	// Draw image data to canvas
	async function drawImageData(
		ctx: CanvasRenderingContext2D, 
		bytes: Uint8Array, 
		width: number, 
		height: number
	) {
		const imageData = new ImageData(
			new Uint8ClampedArray(bytes.buffer),
			width,
			height
		);
		
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = width;
		tempCanvas.height = height;
		const tempCtx = tempCanvas.getContext('2d');
		
		if (tempCtx) {
			tempCtx.putImageData(imageData, 0, 0);
			
			// Clear and draw with aspect ratio preservation
			ctx.clearRect(0, 0, containerSize.width, containerSize.height);
			
			const sourceAspect = width / height;
			const targetAspect = containerSize.width / containerSize.height;
			
			let drawWidth = containerSize.width;
			let drawHeight = containerSize.height;
			let drawX = 0;
			let drawY = 0;
			
			if (sourceAspect > targetAspect) {
				drawHeight = containerSize.width / sourceAspect;
				drawY = (containerSize.height - drawHeight) / 2;
			} else if (sourceAspect < targetAspect) {
				drawWidth = containerSize.height * sourceAspect;
				drawX = (containerSize.width - drawWidth) / 2;
			}
			
			ctx.drawImage(tempCanvas, 0, 0, width, height, drawX, drawY, drawWidth, drawHeight);
		}
	}

	// Start/stop render loop
	function startRenderLoop() {
		if (isRenderLoopRunning) return;
		isRenderLoopRunning = true;
		renderFrame();
	}

	function stopRenderLoop() {
		isRenderLoopRunning = false;
	}

	// Convert canvas to world coordinates
	function canvasToWorld(canvasX: number, canvasY: number): [number, number, number] | null {
		if (!layerGpu || !crosshairPos) return null;

		const rect = canvasElement?.getBoundingClientRect();
		if (!rect) return null;

		const ndcX = (canvasX / rect.width) * 2 - 1;
		const ndcY = -((canvasY / rect.height) * 2 - 1);

		const bounds = getVolumeBounds(layerGpu);
		const viewDims = getViewDimensions(viewType, bounds);

		const halfWidth = viewDims.width / 2;
		const halfHeight = viewDims.height / 2;

		let worldX = crosshairPos[0];
		let worldY = crosshairPos[1];
		let worldZ = crosshairPos[2];

		switch (viewType) {
			case ViewType.Axial:
				worldX = crosshairPos[0] + ndcX * halfWidth;
				worldY = crosshairPos[1] - ndcY * halfHeight;
				break;
			case ViewType.Coronal:
				worldX = crosshairPos[0] + ndcX * halfWidth;
				worldZ = crosshairPos[2] - ndcY * halfHeight;
				break;
			case ViewType.Sagittal:
				worldY = crosshairPos[1] + ndcX * halfWidth;
				worldZ = crosshairPos[2] - ndcY * halfHeight;
				break;
		}

		return [worldX, worldY, worldZ];
	}

	// Mouse handlers
	function handlePointerDown(event: PointerEvent) {
		if (event.button === 0) {
			const rect = canvasElement?.getBoundingClientRect();
			if (rect) {
				const canvasX = event.clientX - rect.left;
				const canvasY = event.clientY - rect.top;
				const worldCoords = canvasToWorld(canvasX, canvasY);
				
				if (worldCoords && crosshairService) {
					crosshairService.setWorldCoordinate(worldCoords);
				}
			}
		}
	}

	function handlePointerMove(event: PointerEvent) {
		const rect = canvasElement?.getBoundingClientRect();
		if (rect) {
			const canvasX = event.clientX - rect.left;
			const canvasY = event.clientY - rect.top;
			const worldCoords = canvasToWorld(canvasX, canvasY);
			
			if (worldCoords) {
				eventBus.emit('mouse.worldcoord', { coord: worldCoords, viewType });
			}
		}
	}

	function handlePointerLeave(event: PointerEvent) {
		eventBus.emit('mouse.worldcoord', { coord: null, viewType });
	}

	function handleWheel(event: WheelEvent) {
		event.preventDefault();
		const scaleFactor = event.deltaY > 0 ? 0.9 : 1.1;
		viewScale = Math.max(0.1, Math.min(10, viewScale * scaleFactor));
		onViewportChange?.(viewType, { scale: viewScale, offset: viewOffset });
	}

	// Slider change handler
	function handleSliderChange(event: Event) {
		const target = event.target as HTMLInputElement;
		slicePosition = parseFloat(target.value);
		
		if (isRenderLoopRunning && layerGpu) {
			setupViewParameters().then(() => {
				renderFrame();
			});
		}
	}

	// Debounced resize handler
	const handleResizeDebounced = debounce(async (width: number, height: number) => {
		const newWidth = Math.max(256, Math.floor(width));
		const newHeight = Math.max(256, Math.floor(height));
		
		if (newWidth !== containerSize.width || newHeight !== containerSize.height) {
			containerSize = { width: newWidth, height: newHeight };
			
			if (canvasElement) {
				canvasElement.width = newWidth;
				canvasElement.height = newHeight;
			}
			
			renderTargetCreated = false;
			await initializeGPU();
			
			if (isRenderLoopRunning && layerGpu) {
				await renderFrame();
			}
		}
	}, 250);

	// React to layer changes
	$effect(() => {
		if (layerGpu && gpuInitialized && renderTargetCreated && containerSize.width > 0) {
			if (layer?.id !== layerId) {
				layerAdded = false;
			}
			
			addLayerToRenderState().then(() => {
				startRenderLoop();
			});
		} else {
			stopRenderLoop();
		}
	});

	// React to crosshair changes
	$effect(() => {
		if (isRenderLoopRunning && layerGpu && crosshairPos) {
			setupViewParameters().then(() => {
				renderFrame();
			});
		}
	});

	// Lifecycle
	onMount(async () => {
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

			const unsubscribeCrosshair = useCrosshairStore.subscribe((state) => {
				crosshairStoreState = state;
			});

			// Subscribe to events
			const unsubscribeOpacity = eventBus.on('layer.opacity.changed', ({ layerId: id, opacity }) => {
				if (id === layerId && layerGpu) {
					layerAdded = false;
					addLayerToRenderState().then(() => {
						renderFrame();
					});
				}
			});

			// Initialize canvas
			if (canvasElement) {
				await new Promise(resolve => requestAnimationFrame(resolve));
				
				const parent = canvasElement.parentElement;
				const rect = parent?.getBoundingClientRect() || canvasElement.getBoundingClientRect();
				
				const width = Math.max(256, Math.floor(rect.width || 256));
				const height = Math.max(256, Math.floor(rect.height || 256));
				
				canvasElement.width = width;
				canvasElement.height = height;
				containerSize = { width, height };
				
				await initializeGPU();
				
				// Setup resize observer
				resizeObserver = new ResizeObserver((entries) => {
					const entry = entries[0];
					const { width, height } = entry.contentRect;
					handleResizeDebounced(width, height);
				});
				resizeObserver.observe(parent || canvasElement);
			}

			return () => {
				stopRenderLoop();
				resizeObserver?.disconnect();
				handleResizeDebounced.cancel();
				unsubscribeLayerStore();
				unsubscribeCrosshair();
				unsubscribeOpacity();
			};
		} catch (err) {
			console.error('[OrthogonalViewGPU] Failed to initialize:', err);
		}
	});
</script>

<div class="orthogonal-view" data-view-type={viewType}>
	<!-- View label -->
	<div class="view-label">{getViewTypeName(viewType)}</div>
	
	<!-- Error/loading overlays -->
	{#if !layer}
		<div class="overlay loading">No layer selected</div>
	{:else if layer.error}
		<div class="overlay error">Error: {layer.error instanceof Error ? layer.error.message : 'Unknown error'}</div>
	{:else if layer.isLoadingGpu}
		<div class="overlay loading">Loading GPU resources...</div>
	{:else if !layerGpu}
		<div class="overlay loading">Waiting for GPU resources...</div>
	{:else if !gpuInitialized}
		<div class="overlay loading">Initializing GPU...</div>
	{:else if !renderTargetCreated}
		<div class="overlay loading">Creating render target...</div>
	{/if}

	<!-- Canvas -->
	<canvas
		bind:this={canvasElement}
		class="view-canvas"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointerleave={handlePointerLeave}
		onpointercancel={handlePointerUp}
		onwheel={handleWheel}
		data-testid={`canvas-${getViewTypeName(viewType).toLowerCase()}`}
	></canvas>

	<!-- Orientation markers -->
	<div class="orientation-markers">
		{#if viewType === ViewType.Axial}
			<span class="marker top">A</span>
			<span class="marker bottom">P</span>
			<span class="marker left">R</span>
			<span class="marker right">L</span>
		{:else if viewType === ViewType.Coronal}
			<span class="marker top">S</span>
			<span class="marker bottom">I</span>
			<span class="marker left">R</span>
			<span class="marker right">L</span>
		{:else if viewType === ViewType.Sagittal}
			<span class="marker top">S</span>
			<span class="marker bottom">I</span>
			<span class="marker left">P</span>
			<span class="marker right">A</span>
		{/if}
	</div>
	
	<!-- Slice slider -->
	{#if layerGpu}
		<div class="slice-slider-container">
			<div class="slice-info">
				<span class="slice-label">
					{#if viewType === ViewType.Axial}
						I/S:
					{:else if viewType === ViewType.Coronal}
						P/A:
					{:else}
						R/L:
					{/if}
				</span>
				<span class="slice-value">{slicePosition.toFixed(1)} mm</span>
			</div>
			<input
				type="range"
				class="slice-slider"
				min={sliceMin}
				max={sliceMax}
				step={sliceStep}
				value={slicePosition}
				oninput={handleSliderChange}
			/>
		</div>
	{/if}
</div>

<style>
	.orthogonal-view {
		position: relative;
		width: 100%;
		height: 100%;
		min-width: 256px;
		min-height: 256px;
		background-color: var(--color-surface-900, #111);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.view-label {
		position: absolute;
		top: 10px;
		left: 10px;
		color: var(--color-text-primary, #fff);
		font-size: 14px;
		font-weight: bold;
		text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
		z-index: 10;
		pointer-events: none;
		user-select: none;
	}

	.view-canvas {
		display: block;
		width: 100%;
		height: 100%;
		min-width: 256px;
		min-height: 256px;
		background-color: var(--color-surface-800, #222);
		cursor: crosshair;
		image-rendering: pixelated;
	}

	.view-canvas:active {
		cursor: crosshair;
	}

	.overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: rgba(0, 0, 0, 0.7);
		color: var(--color-text-primary, #fff);
		font-size: 14px;
		pointer-events: none;
		z-index: 5;
	}

	.overlay.error {
		color: var(--color-error, #ff6b6b);
	}

	.overlay.loading {
		color: var(--color-info, #4dabf7);
	}

	.orientation-markers {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: none;
		z-index: 10;
	}

	.marker {
		position: absolute;
		color: var(--color-text-tertiary, #888);
		font-size: 12px;
		font-weight: bold;
		text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
		user-select: none;
	}

	.marker.top {
		top: 20px;
		left: 50%;
		transform: translateX(-50%);
	}

	.marker.bottom {
		bottom: 40px;
		left: 50%;
		transform: translateX(-50%);
	}

	.marker.left {
		left: 20px;
		top: 50%;
		transform: translateY(-50%);
	}

	.marker.right {
		right: 20px;
		top: 50%;
		transform: translateY(-50%);
	}
	
	/* Slice slider */
	.slice-slider-container {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.6));
		padding: 8px 12px;
		display: flex;
		align-items: center;
		gap: 12px;
		z-index: 15;
	}
	
	.slice-info {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 100px;
	}
	
	.slice-label {
		color: var(--color-text-secondary, #aaa);
		font-size: 12px;
		font-weight: 600;
	}
	
	.slice-value {
		color: var(--color-text-primary, #fff);
		font-size: 12px;
		font-family: 'SF Mono', Monaco, monospace;
		font-variant-numeric: tabular-nums;
	}
	
	.slice-slider {
		flex: 1;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: rgba(255, 255, 255, 0.2);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}
	
	.slice-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 16px;
		height: 16px;
		background: var(--color-primary, #00ff00);
		border-radius: 50%;
		cursor: pointer;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
		transition: all 0.2s ease;
	}
	
	.slice-slider::-webkit-slider-thumb:hover {
		background: var(--color-primary-light, #33ff33);
		transform: scale(1.2);
	}
	
	.slice-slider::-moz-range-thumb {
		width: 16px;
		height: 16px;
		background: var(--color-primary, #00ff00);
		border-radius: 50%;
		cursor: pointer;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
		border: none;
		transition: all 0.2s ease;
	}
	
	.slice-slider::-moz-range-thumb:hover {
		background: var(--color-primary-light, #33ff33);
		transform: scale(1.2);
	}
</style>