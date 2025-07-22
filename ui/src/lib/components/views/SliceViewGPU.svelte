<!--
  SliceViewGPU Component - Migrated to new architecture
  GPU-accelerated single slice view with clean separation of concerns
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getService } from '$lib/di/Container';
	import { getEventBus } from '$lib/events/EventBus';
	import type { LayerService } from '$lib/services/LayerService';
	import type { CrosshairService } from '$lib/services/CrosshairService';
	import type { NotificationService } from '$lib/services/NotificationService';
	import type { SliceNavigationService } from '$lib/services/SliceNavigationService';
	import type { GpuRenderManagerService } from '$lib/services/GpuRenderManagerService';
	import type { EventBus } from '$lib/events/EventBus';
	import { layerStore } from '$lib/stores/layerStore';
	import { crosshairStore } from '$lib/stores/crosshairSlice';
	import { ViewType, getViewTypeName } from '$lib/types/ViewType';
	import type { VolumeLayerGpuInfo } from '$lib/api';
	import { coreApi } from '$lib/api';
	import { debounce } from '$lib/utils/debounce';
	import { getColormapId } from '$lib/utils/colormaps';
	import type { FrameParams, ViewState, WorldCoord, CanvasCoord } from '$lib/types/coordinates';
	import { 
		calculateInitialFrame, 
		canvasToWorld as transformCanvasToWorld,
		worldToCanvas as transformWorldToCanvas,
		getSliceAxis,
		updateFrameSlice,
		VIEW_AXIS_CONFIG
	} from '$lib/types/coordinates';

	// Props
	let {
		layerId = null,
		viewType = ViewType.Axial,
		viewId = `slice-view-${ViewType[viewType].toLowerCase()}-${Date.now()}`,
		onViewportChange
	}: {
		layerId?: string | null;
		viewType?: ViewType;
		viewId?: string;
		onViewportChange?: (
			viewType: ViewType,
			viewport: { scale: number; offset: [number, number] }
		) => void;
	} = $props();

	// Services
	let layerService: LayerService | null = null;
	let crosshairService: CrosshairService | null = null;
	let notificationService: NotificationService | null = null;
	let sliceNavigationService: SliceNavigationService | null = null;
	let gpuRenderManagerService: GpuRenderManagerService | null = null;
	let eventBus: EventBus = getEventBus();

	// State - View Management
	let canvasElement = $state<HTMLCanvasElement>();
	let containerSize = $state({ width: 512, height: 512 });
	let viewScale = $state(1.0);
	let viewOffset = $state([0, 0] as [number, number]);
	let viewCenter = $state<[number, number, number] | null>(null);
	
	// Frame state - defines the viewing rectangle in world space
	let frameParams = $state<FrameParams | null>(null);
	let viewState = $derived<ViewState | null>(
		frameParams ? {
			frame: frameParams,
			crosshair: $crosshairStore.worldCoord,
			zoom: viewScale,
			panOffset: { x: viewOffset[0], y: viewOffset[1] },
			canvasSize: containerSize
		} : null
	);

	// State - GPU
	let gpuInitialized = $state(false);
	let renderTargetCreated = $state(false);
	let isRenderLoopRunning = $state(false);
	let layerAdded = $state(false);
	
	// Track window/level changes
	let previousWindowLevel = $state<{ window: number; level: number } | null>(null);
	let previousThreshold = $state<{ low: number; high: number; enabled: boolean } | null>(null);
	let isUpdatingLayer = $state(false);
	let previousSourceVolumeId = $state<string | null>(null);

	// State - Interaction
	let isDragging = $state(false);
	let lastPointerPos = $state<[number, number] | null>(null);
	let isSliding = $state(false);

	// State - View position (single source of truth in world space)
	let viewWorldPosition = $state<[number, number, number]>([0, 0, 0]);
	let sliceMin = $state(-100);
	let sliceMax = $state(100);
	let sliceStep = $state(1);
	let currentSliceIndex = $state<number | null>(null);
	let isLoadingSlice = $state(false);

	// State - Image drawing bounds for coordinate transformation
	let imageDrawBounds = $state<{ x: number; y: number; width: number; height: number } | null>(
		null
	);

	// State - Render scheduler to prevent duplicate renders
	let needsRender = $state(false);
	let renderScheduled = false;
	let isRendering = false;

	// Store subscriptions
	// Both layerStore and crosshairStore are Svelte stores, so we can use them directly with $

	// Derived values - use stores directly for reactivity
	// If no layerId is specified, use the active layer or first available layer
	let effectiveLayerId = $derived(
		layerId ||
			$layerStore.activeLayerId ||
			($layerStore.layers.length > 0 ? $layerStore.layers[0].id : null)
	);

	let layer = $derived(
		effectiveLayerId && $layerStore.layers
			? $layerStore.layers.find((l) => l.id === effectiveLayerId)
			: null
	);

	let layerGpu = $derived(layer?.gpu || null);
	let crosshairPos = $derived($crosshairStore.worldCoord);
	
	// Utility functions (defined before effects to avoid uninitialized variable errors)
	
	// Calculate volume bounds
	function getVolumeBounds(gpu: VolumeLayerGpuInfo) {
		const dims = gpu.dim;
		const spacing = gpu.spacing;
		const origin = gpu.origin;

		// Debug logging
		console.log('[SliceViewGPU] Calculating volume bounds:', {
			dims,
			spacing,
			origin,
			maxX: origin[0] + (dims[0] - 1) * spacing[0],
			maxY: origin[1] + (dims[1] - 1) * spacing[1],
			maxZ: origin[2] + (dims[2] - 1) * spacing[2]
		});

		// Return bounds organized by axis
		return {
			x: { min: origin[0], max: origin[0] + (dims[0] - 1) * spacing[0] },
			y: { min: origin[1], max: origin[1] + (dims[1] - 1) * spacing[1] },
			z: { min: origin[2], max: origin[2] + (dims[2] - 1) * spacing[2] },
			min: {
				x: origin[0],
				y: origin[1],
				z: origin[2]
			},
			max: {
				x: origin[0] + (dims[0] - 1) * spacing[0],
				y: origin[1] + (dims[1] - 1) * spacing[1],
				z: origin[2] + (dims[2] - 1) * spacing[2]
			}
		};
	}

	// Get view dimensions
	function getViewDimensions(viewType: ViewType, bounds: ReturnType<typeof getVolumeBounds>) {
		let widthMm: number;
		let heightMm: number;

		switch (viewType) {
			case ViewType.Axial:
				// Looking down Z axis - X is horizontal, Y is vertical
				widthMm = bounds.x.max - bounds.x.min;
				heightMm = bounds.y.max - bounds.y.min;
				break;
			case ViewType.Coronal:
				// Looking down Y axis - X is horizontal, Z is vertical
				widthMm = bounds.x.max - bounds.x.min;
				heightMm = bounds.z.max - bounds.z.min;
				break;
			case ViewType.Sagittal:
				// Looking down X axis - Y is horizontal, Z is vertical
				widthMm = bounds.y.max - bounds.y.min;
				heightMm = bounds.z.max - bounds.z.min;
				break;
		}

		// Add 20% padding
		return {
			width: widthMm * 1.2,
			height: heightMm * 1.2
		};
	}

	// Calculate view dimensions for current state
	function calculateViewDimensions() {
		if (!layerGpu) {
			return { width: 200, height: 200 }; // Default fallback
		}

		const bounds = getVolumeBounds(layerGpu);
		return getViewDimensions(viewType, bounds);
	}
	
	// Initialize frame parameters when GPU info is available
	$effect(() => {
		if (layerGpu && !frameParams) {
			// Defensive check for layerGpu properties
			if (!layerGpu.dim || !layerGpu.spacing || !layerGpu.origin) {
				console.warn('[SliceViewGPU] $effect: Invalid layerGpu data, skipping frame init:', layerGpu);
				return;
			}
			
			// Get volume bounds from GPU info
			const bounds = getVolumeBounds(layerGpu);
			const volumeBounds = {
				min: [bounds.min.x, bounds.min.y, bounds.min.z] as WorldCoord,
				max: [bounds.max.x, bounds.max.y, bounds.max.z] as WorldCoord
			};
			
			// Calculate initial frame centered on volume
			frameParams = calculateInitialFrame(volumeBounds, viewType);
			
			// Set initial view position to crosshair
			viewWorldPosition = [...crosshairPos];
		}
	});
	
	// Update frame slice position when view position changes
	$effect(() => {
		if (frameParams) {
			const sliceAxis = getSliceAxis(viewType);
			const newSlicePos = viewWorldPosition[sliceAxis];
			if (Math.abs(newSlicePos - frameParams.slicePosition) > 0.001) {
				frameParams = updateFrameSlice(frameParams, newSlicePos);
			}
		}
	});
	
	// Debug: Log crosshair store changes
	$effect(() => {
		console.log(`[SliceViewGPU ${getViewTypeName(viewType)}] Crosshair store updated:`, {
			worldCoord: $crosshairStore.worldCoord,
			visible: $crosshairStore.visible
		});
	});
	
	// Derived slice position for the current view axis
	let slicePosition = $derived(
		viewType === ViewType.Axial ? viewWorldPosition[2] :
		viewType === ViewType.Coronal ? viewWorldPosition[1] :
		viewWorldPosition[0]
	);

	// Canvas resize observer
	let resizeObserver: ResizeObserver | null = null;

	// Initialize GPU rendering
	async function initializeGPU() {
		// Skip GPU initialization in test environment
		if (import.meta.env.TEST) {
			console.log('[SliceViewGPU] Skipping GPU initialization in test mode');
			gpuInitialized = true; // Mark as initialized to prevent repeated attempts
			renderTargetCreated = true;
			return;
		}

		try {
			if (!gpuInitialized) {
				// GPU render loop is now managed by GpuRenderManagerService
				console.log('[SliceViewGPU] Checking GPU render manager...');
				if (!gpuRenderManagerService) {
					throw new Error('GpuRenderManagerService not available');
				}
				
				// Ensure the render manager is initialized
				if (!gpuRenderManagerService.isInitialized()) {
					console.log('[SliceViewGPU] Waiting for GPU render manager initialization...');
					await gpuRenderManagerService.initialize();
				}
				
				gpuInitialized = true;
				eventBus.emit('gpu.initialized', { viewType });
			}

			if (!renderTargetCreated && containerSize.width > 0 && containerSize.height > 0) {
				// Ensure offscreen target exists with the required size
				const renderManager = gpuRenderManagerService!.getRenderManager();
				await renderManager.ensureOffscreenTarget(containerSize.width, containerSize.height);
				
				renderTargetCreated = true;
				eventBus.emit('gpu.rendertarget.created', { viewType, size: containerSize });
			}
		} catch (err) {
			console.error('[SliceViewGPU] Failed to initialize GPU:', err);
			notificationService?.error('GPU initialization failed', {
				message: err instanceof Error ? err.message : 'Unknown error'
			});
			eventBus.emit('gpu.error', { viewType, error: err });
		}
	}

	// Calculate the slice index for this layer based on world position
	// Removed calculateSliceIndexForLayer - now in SliceNavigationService
	
	// Calculate world position from slice index (inverse of calculateSliceIndexForLayer)
	function calculateWorldPositionFromSliceIndex(sliceIndex: number, gpu: VolumeLayerGpuInfo): number {
		// Get voxel coordinate for the slice
		let voxelCoord: [number, number, number, number];
		switch (viewType) {
			case ViewType.Axial:
				voxelCoord = [gpu.dim[0] / 2, gpu.dim[1] / 2, sliceIndex, 1]; // Middle of XY, specific Z
				break;
			case ViewType.Coronal:
				voxelCoord = [gpu.dim[0] / 2, sliceIndex, gpu.dim[2] / 2, 1]; // Middle of XZ, specific Y
				break;
			case ViewType.Sagittal:
				voxelCoord = [sliceIndex, gpu.dim[1] / 2, gpu.dim[2] / 2, 1]; // Specific X, middle of YZ
				break;
		}
		
		// Transform to world space using voxel_to_world matrix
		const m = gpu.voxel_to_world;
		const worldX = m[0] * voxelCoord[0] + m[4] * voxelCoord[1] + m[8] * voxelCoord[2] + m[12] * voxelCoord[3];
		const worldY = m[1] * voxelCoord[0] + m[5] * voxelCoord[1] + m[9] * voxelCoord[2] + m[13] * voxelCoord[3];
		const worldZ = m[2] * voxelCoord[0] + m[6] * voxelCoord[1] + m[10] * voxelCoord[2] + m[14] * voxelCoord[3];
		const worldW = m[3] * voxelCoord[0] + m[7] * voxelCoord[1] + m[11] * voxelCoord[2] + m[15] * voxelCoord[3];
		
		// Get the appropriate world coordinate based on view type
		let worldPos: number;
		if (worldW !== 0) {
			switch (viewType) {
				case ViewType.Axial:
					worldPos = worldZ / worldW;
					break;
				case ViewType.Coronal:
					worldPos = worldY / worldW;
					break;
				case ViewType.Sagittal:
					worldPos = worldX / worldW;
					break;
			}
		} else {
			switch (viewType) {
				case ViewType.Axial:
					worldPos = worldZ;
					break;
				case ViewType.Coronal:
					worldPos = worldY;
					break;
				case ViewType.Sagittal:
					worldPos = worldX;
					break;
			}
		}
		
		return worldPos;
	}

	// Setup view parameters - refactored to separate initialization from API calls
	async function setupViewParameters(options: { skipAPICalls?: boolean } = {}) {
		if (!layerGpu || !crosshairPos) return;

		// Always do initialization logic
		// Initialize view center
		if (!viewCenter) {
			viewCenter = [...crosshairPos];
		}

		const bounds = getVolumeBounds(layerGpu);
		const viewDims = getViewDimensions(viewType, bounds);

		// Calculate the center of the volume
		const volumeCenter: [number, number, number] = [
			(bounds.x.min + bounds.x.max) / 2,
			(bounds.y.min + bounds.y.max) / 2,
			(bounds.z.min + bounds.z.max) / 2
		];

		// Update slice bounds and initialize view position if needed
		const isInitialized = viewWorldPosition[0] !== 0 || viewWorldPosition[1] !== 0 || viewWorldPosition[2] !== 0;
		
		switch (viewType) {
			case ViewType.Axial:
				sliceMin = bounds.z.min;
				sliceMax = bounds.z.max;
				// Initialize view position to volume center, not (0,0,0)
				if (!isInitialized) {
					viewWorldPosition = [...volumeCenter];
				}
				break;
			case ViewType.Coronal:
				sliceMin = bounds.y.min;
				sliceMax = bounds.y.max;
				if (!isInitialized) {
					viewWorldPosition = [...volumeCenter];
				}
				break;
			case ViewType.Sagittal:
				sliceMin = bounds.x.min;
				sliceMax = bounds.x.max;
				if (!isInitialized) {
					viewWorldPosition = [...volumeCenter];
				}
				break;
		}

		// Skip API calls if requested (e.g., during slider movement) or in test environment
		if (options.skipAPICalls || import.meta.env.TEST) {
			if (import.meta.env.TEST) {
				console.log('[SliceViewGPU] Skipping view setup in test mode');
			}
			return;
		}

		// Check bounds
		if (
			crosshairService &&
			(crosshairPos[0] < bounds.x.min ||
				crosshairPos[0] > bounds.x.max ||
				crosshairPos[1] < bounds.y.min ||
				crosshairPos[1] > bounds.y.max ||
				crosshairPos[2] < bounds.z.min ||
				crosshairPos[2] > bounds.z.max)
		) {
			const center: [number, number, number] = [
				(bounds.x.min + bounds.x.max) / 2,
				(bounds.y.min + bounds.y.max) / 2,
				(bounds.z.min + bounds.z.max) / 2
			];
			console.warn('[SliceViewGPU] Crosshair outside bounds, resetting to center');
			await crosshairService.setWorldCoordinate(center);
			return;
		}

		// View plane is now encoded in frame vectors (planeId passed to update_frame_for_synchronized_view)
		const planeId = viewType as 0 | 1 | 2;

		// Set crosshair for shader - use crosshair position on visible axes, view position on slice axis
		let shaderCrosshair: [number, number, number];
		switch (viewType) {
			case ViewType.Axial:
				shaderCrosshair = [crosshairPos[0], crosshairPos[1], viewWorldPosition[2]];
				break;
			case ViewType.Coronal:
				shaderCrosshair = [crosshairPos[0], viewWorldPosition[1], crosshairPos[2]];
				break;
			case ViewType.Sagittal:
				shaderCrosshair = [viewWorldPosition[0], crosshairPos[1], crosshairPos[2]];
				break;
		}
		await coreApi.set_crosshair(shaderCrosshair);

		// Get frame parameters based on volume bounds (not crosshair)
		if (!frameParams) {
			const sliceAxis = getSliceAxis(viewType);
			const frameData = await coreApi.get_frame_params(
				layerGpu.source_volume_id,
				viewType,
				viewWorldPosition[sliceAxis]
			);
			frameParams = {
				center: frameData.center,
				width: frameData.width,
				height: frameData.height,
				viewType: frameData.viewType,
				slicePosition: frameData.slicePosition
			};
		}
		
		// Update the frame based on fixed volume bounds
		// The frame origin should be based on volume bounds, not crosshair
		const config = VIEW_AXIS_CONFIG[viewType];
		const halfWidth = frameParams.width / 2.0;
		const halfHeight = frameParams.height / 2.0;
		
		// Calculate frame origin - FIXED based on volume center, not crosshair
		let origin_mm: number[];
		let u_mm: number[];
		let v_mm: number[];
		
		switch (viewType) {
			case ViewType.Axial:
				origin_mm = [
					frameParams.center[0] - halfWidth,
					frameParams.center[1] - halfHeight,
					viewWorldPosition[2], // Only slice position changes
					1.0
				];
				u_mm = [frameParams.width, 0.0, 0.0, 0.0];
				v_mm = [0.0, frameParams.height, 0.0, 0.0];
				break;
			case ViewType.Coronal:
				origin_mm = [
					frameParams.center[0] - halfWidth,
					viewWorldPosition[1], // Only slice position changes
					frameParams.center[2] + halfHeight,
					1.0
				];
				u_mm = [frameParams.width, 0.0, 0.0, 0.0];
				v_mm = [0.0, 0.0, -frameParams.height, 0.0];
				break;
			case ViewType.Sagittal:
				origin_mm = [
					viewWorldPosition[0], // Only slice position changes
					frameParams.center[1] - halfWidth,
					frameParams.center[2] + halfHeight,
					1.0
				];
				u_mm = [0.0, frameParams.width, 0.0, 0.0];
				v_mm = [0.0, 0.0, -frameParams.height, 0.0];
				break;
		}
		
		// Update frame using the new API that takes explicit frame vectors
		await coreApi.request_frame(
			origin_mm.slice(0, 3),
			u_mm.slice(0, 3),
			v_mm.slice(0, 3),
			1.0, // pixels_per_mm
			containerSize.width,
			containerSize.height
		);
	}

	// Reload layer with a new slice index
	// Removed reloadLayerWithNewSlice - now in SliceNavigationService

	// Ensure layers are synchronized with GPU render manager
	async function syncLayersWithGpu() {
		if (!layerGpu || !renderTargetCreated || !effectiveLayerId || !gpuRenderManagerService) return;

		// Skip in test environment
		if (import.meta.env.TEST) {
			console.log('[SliceViewGPU] Skipping layer sync in test mode');
			layerAdded = true; // Mark as added to prevent repeated attempts
			return;
		}

		console.log(`[SliceViewGPU] Syncing layers for view ${viewType} (${viewId})`);

		try {
			const renderManager = gpuRenderManagerService.getRenderManager();
			
			// Get all active layers from the layer store
			const activeLayers = $layerStore.layers
				.filter(l => l.visible && l.gpu)
				.map(l => {
					// Ensure we have valid window/level values
					const windowWidth = l.windowLevel?.window ?? 1.0;
					const windowLevel = l.windowLevel?.level ?? 0.5;
					
					return {
						volumeId: l.id,
						opacity: l.opacity ?? 1.0,
						colormapId: getColormapId(l.colormap),
						window: {
							width: isFinite(windowWidth) ? windowWidth : 1.0,
							level: isFinite(windowLevel) ? windowLevel : 0.5
						},
						threshold: l.threshold,
						atlasIndex: l.gpu!.atlas_index
					};
				});
			
			console.log('[SliceViewGPU] Setting up layers:', activeLayers);
			
			// Setup all layers in the render manager
			await renderManager.setupLayers(activeLayers);

			layerAdded = true;
			eventBus.emit('gpu.layers.synced', { viewType, viewId, layerCount: activeLayers.length });
		} catch (err) {
			console.error('[SliceViewGPU] Failed to sync layers:', err);
			eventBus.emit('gpu.layer.error', { layerId: effectiveLayerId, viewType, error: err });
		}
	}

	// Schedule a render using requestAnimationFrame to coalesce multiple render requests
	function scheduleRender() {
		needsRender = true;
		
		if (!renderScheduled && !isRendering) {
			renderScheduled = true;
			requestAnimationFrame(() => {
				renderScheduled = false;
				if (needsRender && !isRendering) {
					needsRender = false;
					renderFrame().catch(err => {
						console.error(`[SliceViewGPU ${getViewTypeName(viewType)}] Render error:`, err);
					});
				}
			});
		}
	}

	// Render frame
	async function renderFrame() {
		// Prevent concurrent renders
		if (isRendering) {
			console.log(`[SliceViewGPU ${getViewTypeName(viewType)}] Skipping render - already rendering`);
			needsRender = true; // Mark that we need another render after this one
			return;
		}
		
		if (!canvasElement || !layerGpu || !renderTargetCreated || !crosshairPos || !gpuRenderManagerService) {
			console.log('[SliceViewGPU] Skipping render - missing requirements:', {
				hasCanvas: !!canvasElement,
				hasLayerGpu: !!layerGpu,
				renderTargetCreated,
				hasCrosshairPos: !!crosshairPos,
				hasGpuManager: !!gpuRenderManagerService
			});
			return;
		}

		// Debug: Log current layer being rendered vs all layers in store
		console.log('[SliceViewGPU] Rendering frame:', {
			renderingLayerId: effectiveLayerId,
			allLayersInStore: $layerStore.layers.map(l => ({ id: l.id, hasGpu: !!l.gpu })),
			viewType: getViewTypeName(viewType),
			timestamp: new Date().toISOString()
		});

		// Skip rendering in test environment
		if (import.meta.env.TEST) {
			console.log('[SliceViewGPU] Skipping render in test mode');
			return;
		}

		if (containerSize.width === 0 || containerSize.height === 0) {
			console.warn('[SliceViewGPU] Skipping render - invalid container size', {
				viewType: getViewTypeName(viewType),
				viewId,
				containerSize
			});
			return;
		}

		isRendering = true;
		
		try {
			console.log('[SliceViewGPU] Starting render frame');
			
			const renderManager = gpuRenderManagerService.getRenderManager();
			
			// Defensive check for layerGpu
			if (!layerGpu || !layerGpu.dim || !layerGpu.spacing || !layerGpu.origin) {
				console.error('[SliceViewGPU] Invalid layerGpu data:', layerGpu);
				return;
			}
			
			const bounds = getVolumeBounds(layerGpu);
			const viewDims = getViewDimensions(viewType, bounds);
			
			// Calculate the center of the volume
			const volumeCenter: [number, number, number] = [
				(bounds.x.min + bounds.x.max) / 2,
				(bounds.y.min + bounds.y.max) / 2,
				(bounds.z.min + bounds.z.max) / 2
			];
			
			// Render using the synchronized view method
			// TODO: Switch to renderSynchronizedViewFixed once startup issues are resolved
			console.log('[SliceViewGPU] Calling renderSynchronizedView (temporary fallback):', {
				viewType,
				viewTypeName: getViewTypeName(viewType),
				viewTypeValue: viewType as number,
				viewDims,
				// volumeCenter,
				viewWorldPosition,
				crosshairPos
			});
			const result = await renderManager.renderSynchronizedView(
				viewDims.width,
				viewDims.height,
				viewWorldPosition, // Use view world position for slice
				viewType as 0 | 1 | 2,
				containerSize.width,
				containerSize.height
			);
			
			// Draw the result
			const ctx = canvasElement.getContext('2d');
			if (!ctx) return;
			
			// Convert PNG binary data to image
			const blob = new Blob([result.imageData], { type: 'image/png' });
			const imageUrl = URL.createObjectURL(blob);
			
			const img = new Image();
			img.onload = () => {
				// Clear canvas with black background (lowest value for grayscale colormap)
				// This prevents the panel background color from showing through
				ctx.fillStyle = '#000000';
				ctx.fillRect(0, 0, containerSize.width, containerSize.height);
				
				// Calculate aspect ratio preservation
				const sourceAspect = result.dimensions[0] / result.dimensions[1];
				const targetAspect = containerSize.width / containerSize.height;
				
				let drawWidth = containerSize.width;
				let drawHeight = containerSize.height;
				let drawX = 0;
				let drawY = 0;
				
				if (sourceAspect > targetAspect) {
					// Image is wider than container
					drawHeight = containerSize.width / sourceAspect;
					drawY = (containerSize.height - drawHeight) / 2;
				} else if (sourceAspect < targetAspect) {
					// Image is taller than container
					drawWidth = containerSize.height * sourceAspect;
					drawX = (containerSize.width - drawWidth) / 2;
				}
				
				// Debug logging
				console.log(`[SliceViewGPU ${getViewTypeName(viewType)}] Image drawing:`, {
					sourceAspect,
					targetAspect,
					sourceDims: result.dimensions,
					containerSize,
					drawBounds: { drawX, drawY, drawWidth, drawHeight },
					viewDims,
					viewWorldPosition,
					bounds,
					volumeCenter: [
						(bounds.x.min + bounds.x.max) / 2,
						(bounds.y.min + bounds.y.max) / 2,
						(bounds.z.min + bounds.z.max) / 2
					],
					padding: {
						horizontal: drawX * 2, // Total horizontal padding
						vertical: drawY * 2,   // Total vertical padding
						isSymmetric: drawX === (containerSize.width - drawWidth) / 2
					}
				});
				
				// Flip Y-axis for all views (backend now uses negative v vectors consistently)
				if (viewType === ViewType.Axial || viewType === ViewType.Coronal || viewType === ViewType.Sagittal) {
					ctx.save();
					ctx.scale(1, -1);
					ctx.drawImage(img, 0, 0, result.dimensions[0], result.dimensions[1], 
					            drawX, -drawY - drawHeight, drawWidth, drawHeight);
					ctx.restore();
				} else {
					ctx.drawImage(img, 0, 0, result.dimensions[0], result.dimensions[1], 
					            drawX, drawY, drawWidth, drawHeight);
				}
				
				URL.revokeObjectURL(imageUrl);
				
				// Store the actual image drawing bounds for coordinate transformation
				imageDrawBounds = {
					x: drawX,
					y: drawY,
					width: drawWidth,
					height: drawHeight
				};
			};
			img.src = imageUrl;

			eventBus.emit('gpu.frame.rendered', { viewType });
		} catch (err) {
			console.error('[SliceViewGPU] Render frame error:', err);
			eventBus.emit('gpu.render.error', { viewType, error: err });
		} finally {
			isRendering = false;
			
			// If another render was requested while we were rendering, schedule it
			if (needsRender) {
				scheduleRender();
			}
		}
	}

	// Handle buffer size mismatch
	async function handleBufferSizeMismatch(ctx: CanvasRenderingContext2D, bytes: Uint8Array) {
		const pixelCount = bytes.length / 4;

		// Try common dimensions
		const possibleSizes = [
			[512, 512],
			[256, 256],
			[352, 256],
			[256, 352],
			[512, 256],
			[256, 512],
			[512, 176],
			[176, 512]
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
			console.warn('[SliceViewGPU] Could not determine buffer dimensions');
		}
	}

	// Draw image data to canvas
	async function drawImageData(
		ctx: CanvasRenderingContext2D,
		bytes: Uint8Array,
		width: number,
		height: number
	) {
		const imageData = new ImageData(new Uint8ClampedArray(bytes.buffer), width, height);

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

			// Flip Y-axis for coronal and sagittal views
			if (viewType === ViewType.Coronal || viewType === ViewType.Sagittal) {
				ctx.save();
				ctx.scale(1, -1);
				ctx.drawImage(tempCanvas, 0, 0, width, height, drawX, -drawY - drawHeight, drawWidth, drawHeight);
				ctx.restore();
			} else {
				ctx.drawImage(tempCanvas, 0, 0, width, height, drawX, drawY, drawWidth, drawHeight);
			}

			// Store the actual image drawing bounds for coordinate transformation
			imageDrawBounds = { x: drawX, y: drawY, width: drawWidth, height: drawHeight };
		}
	}

	// Start/stop render loop
	function startRenderLoop() {
		if (isRenderLoopRunning) return;
		isRenderLoopRunning = true;
		scheduleRender();
	}

	function stopRenderLoop() {
		isRenderLoopRunning = false;
	}

	// Convert canvas to world coordinates
	function canvasToWorld(canvasX: number, canvasY: number): [number, number, number] | null {
		if (!viewState || !imageDrawBounds) return null;

		const rect = canvasElement?.getBoundingClientRect();
		if (!rect) return null;

		// Convert canvas coordinates to image coordinates
		const imageX = canvasX - imageDrawBounds.x;
		const imageY = canvasY - imageDrawBounds.y;

		// Check if click is within image bounds
		if (
			imageX < 0 ||
			imageX > imageDrawBounds.width ||
			imageY < 0 ||
			imageY > imageDrawBounds.height
		) {
			return null;
		}

		// Map click position within image bounds to virtual canvas coordinate
		const mappedCanvasX = (imageX / imageDrawBounds.width) * containerSize.width;
		const mappedCanvasY = (imageY / imageDrawBounds.height) * containerSize.height;

		// Use the new coordinate transformation that uses fixed frame bounds
		const canvasCoord: CanvasCoord = { x: mappedCanvasX, y: mappedCanvasY };
		return transformCanvasToWorld(canvasCoord, viewState);
	}

	// Sync view to crosshair position
	function syncToCrosshair() {
		viewWorldPosition = [...crosshairPos];
		// Just schedule render - avoid setupViewParameters to prevent loops
		scheduleRender();
	}

	// Mouse handlers
	function handlePointerDown(event: PointerEvent) {
		if (event.button === 0) {
			const rect = canvasElement?.getBoundingClientRect();
			if (rect) {
				const canvasX = event.clientX - rect.left;
				const canvasY = event.clientY - rect.top;
				console.log(`[SliceViewGPU ${getViewTypeName(viewType)}] Click detected at canvas coords:`, { canvasX, canvasY });
				
				const worldCoords = canvasToWorld(canvasX, canvasY);
				console.log(`[SliceViewGPU ${getViewTypeName(viewType)}] Converted to world coords:`, worldCoords);

				if (worldCoords && crosshairService) {
					console.log(`[SliceViewGPU ${getViewTypeName(viewType)}] Setting crosshair to:`, worldCoords);
					crosshairService.setWorldCoordinate(worldCoords);
				} else {
					console.warn(`[SliceViewGPU ${getViewTypeName(viewType)}] No world coords or crosshair service`);
				}
			}
		}
	}
	
	// Handle double-click to sync view to crosshair
	function handleDoubleClick(event: MouseEvent) {
		syncToCrosshair();
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

	function handlePointerUp(event: PointerEvent) {
		// Handle pointer up - currently no specific action needed
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

	// REMOVED: Debounced slice reload - this was the performance killer!
	// GPU resources contain the entire volume, slice navigation should only update view position
	// Not reload GPU resources. Keeping for reference:
	/*
	const reloadSliceDebounced = debounce(async (worldPosition: number) => {
		// This was reloading GPU resources unnecessarily
		// SliceNavigationService.updateSlicePosition was calling:
		// - clear_render_layers() 
		// - release_layer_gpu_resources()
		// - request_layer_gpu_resources()
		// This is like reloading an entire video file just to seek!
	}, 150);
	*/

	// Slider change handler (called during sliding)
	async function handleSliderChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const newSliceValue = parseFloat(target.value);
		
		console.log(`[SliceViewGPU ${getViewTypeName(viewType)}] Slider change:`, {
			oldValue: viewWorldPosition[viewType],
			newValue: newSliceValue,
			viewType: getViewTypeName(viewType)
		});
		
		// Update the appropriate axis of viewWorldPosition
		switch (viewType) {
			case ViewType.Axial:
				viewWorldPosition = [viewWorldPosition[0], viewWorldPosition[1], newSliceValue];
				break;
			case ViewType.Coronal:
				viewWorldPosition = [viewWorldPosition[0], newSliceValue, viewWorldPosition[2]];
				break;
			case ViewType.Sagittal:
				viewWorldPosition = [newSliceValue, viewWorldPosition[1], viewWorldPosition[2]];
				break;
		}
		
		// Update the view immediately - NO GPU reload needed!
		// The GPU resources contain the entire volume, we just need to update the view position
		if (isRenderLoopRunning && layerGpu) {
			console.log(`[SliceViewGPU ${getViewTypeName(viewType)}] Scheduling render after slider change`);
			// Skip setting up view parameters during slider movement to avoid loops
			scheduleRender();
		}
		
		// NO debounced GPU reload - that's the performance killer!
		// Slice navigation should NEVER reload GPU resources
	}
	
	// Handle slider interaction start
	function handleSliderStart() {
		isSliding = true;
	}
	
	// Handle slider interaction end
	async function handleSliderEnd() {
		isSliding = false;
		// Just ensure the final position is rendered
		if (isRenderLoopRunning && layerGpu) {
			// Just schedule render - avoid setupViewParameters to prevent loops
			scheduleRender();
		}
	}

	// Debounced resize handler
	const handleResizeDebounced = debounce(async (width: number, height: number) => {
		const newWidth = Math.max(256, Math.floor(width));
		const newHeight = Math.max(256, Math.floor(height));

		if (newWidth !== containerSize.width || newHeight !== containerSize.height) {
			console.log('[SliceViewGPU] Handling resize:', { 
				from: containerSize, 
				to: { width: newWidth, height: newHeight } 
			});

			containerSize = { width: newWidth, height: newHeight };

			if (canvasElement) {
				canvasElement.width = newWidth;
				canvasElement.height = newHeight;
			}

			// Clear image bounds so they get recalculated on next render
			imageDrawBounds = null;

			// Recreate render target for new size
			renderTargetCreated = false;
			await initializeGPU();

			// Force a render after resize
			if (layerGpu && gpuInitialized && renderTargetCreated) {
				// Ensure render loop is running
				if (!isRenderLoopRunning) {
					startRenderLoop();
				} else {
					// Just schedule a render
					scheduleRender();
				}
			}
		}
	}, 250);

	// React to layer changes
	$effect(() => {
		console.log('[SliceViewGPU] Layer effect triggered:', {
			effectiveLayerId,
			layer,
			layerGpu,
			layerStoreLength: $layerStore.layers.length,
			allLayers: $layerStore.layers.map((l) => ({ id: l.id, gpu: !!l.gpu }))
		});

		if (layerGpu && gpuInitialized && renderTargetCreated && containerSize.width > 0) {
			// Track the slice index when GPU resources are loaded or updated
			if (layerGpu.slice_info) {
				const newSliceIndex = layerGpu.slice_info.index;
				if (currentSliceIndex !== newSliceIndex) {
					currentSliceIndex = newSliceIndex;
					console.log('[SliceViewGPU] Slice index changed to:', currentSliceIndex);
					
					// Don't update slider position during user interaction
					// The slice index change is expected when we're loading a new slice
				}
			}

			// Check if we need to reset the layer (e.g., when switching to a different volume)
			const currentSourceId = layer?.spec?.Volume?.source_resource_id;
			const gpuSourceId = layerGpu.source_volume_id;
			
			// Only reset if we have both IDs and they're different, and it's actually a change from our previous tracking
			if (currentSourceId && gpuSourceId && previousSourceVolumeId && currentSourceId !== gpuSourceId) {
				console.log('[SliceViewGPU] Source resource changed, resetting layer:', {
					previous: previousSourceVolumeId,
					current: currentSourceId,
					gpu: gpuSourceId
				});
				
				// Reset state when switching volumes
				layerAdded = false;
				previousWindowLevel = null;
				previousThreshold = null;
				isUpdatingLayer = false;
				previousSourceVolumeId = currentSourceId;
			} else if (!previousSourceVolumeId && gpuSourceId) {
				// First time setup - just track the source ID
				previousSourceVolumeId = gpuSourceId;
			}

			// Handle initial layer addition
			if (!layerAdded && !isUpdatingLayer) {
				console.log('[SliceViewGPU] Adding layer to render state');
				isUpdatingLayer = true;
				syncLayersWithGpu().then(() => {
					layerAdded = true;
					// Store initial window/level and threshold
					if (layer?.windowLevel) {
						previousWindowLevel = { ...layer.windowLevel };
					}
					if (layer?.threshold) {
						previousThreshold = { ...layer.threshold };
					}
					isUpdatingLayer = false;
					if (!isRenderLoopRunning) {
						startRenderLoop();
					}
				}).catch((err) => {
					console.error('[SliceViewGPU] Failed to add layer:', err);
					isUpdatingLayer = false;
				});
			}
			// Handle window/level updates
			else if (layerAdded && !isUpdatingLayer && layer?.windowLevel && previousWindowLevel) {
				const windowLevelChanged = 
					layer.windowLevel.window !== previousWindowLevel.window ||
					layer.windowLevel.level !== previousWindowLevel.level;
				
				if (windowLevelChanged) {
					console.log('[SliceViewGPU] Window/level changed:', {
						previous: previousWindowLevel,
						current: layer.windowLevel
					});
					
					isUpdatingLayer = true;
					syncLayersWithGpu().then(() => {
						// Update previousWindowLevel AFTER successful update
						previousWindowLevel = { ...layer.windowLevel };
						isUpdatingLayer = false;
						
						// Just schedule a render if loop is already running
						if (isRenderLoopRunning) {
							scheduleRender();
						}
					}).catch((err) => {
						console.error('[SliceViewGPU] Failed to update layer:', err);
						isUpdatingLayer = false;
					});
				}
			}
			// Handle threshold updates
			else if (layerAdded && !isUpdatingLayer && layer?.threshold) {
				const thresholdChanged = !previousThreshold ||
					layer.threshold.low !== previousThreshold.low ||
					layer.threshold.high !== previousThreshold.high ||
					layer.threshold.enabled !== previousThreshold.enabled;
				
				if (thresholdChanged) {
					console.log('[SliceViewGPU] Threshold changed:', {
						previous: previousThreshold,
						current: layer.threshold
					});
					
					isUpdatingLayer = true;
					syncLayersWithGpu().then(() => {
						// Update previousThreshold AFTER successful update
						previousThreshold = { ...layer.threshold };
						isUpdatingLayer = false;
						
						// Just schedule a render if loop is already running
						if (isRenderLoopRunning) {
							scheduleRender();
						}
					}).catch((err) => {
						console.error('[SliceViewGPU] Failed to update threshold:', err);
						isUpdatingLayer = false;
					});
				}
			}
		} else {
			console.log('[SliceViewGPU] Not rendering - missing requirements:', {
				hasLayerGpu: !!layerGpu,
				gpuInitialized,
				renderTargetCreated,
				containerWidth: containerSize.width
			});
			stopRenderLoop();
		}
	});

	// React to crosshair changes - update slice position to show crosshair
	$effect(() => {
		if (isRenderLoopRunning && layerGpu && crosshairPos) {
			console.log(`[SliceViewGPU ${getViewTypeName(viewType)}] Crosshair effect triggered:`, {
				crosshairPos,
				viewWorldPosition,
				viewType: getViewTypeName(viewType)
			});
			
			// Check if the crosshair position for our slice axis has changed
			// This means we need to navigate to a different slice
			let needsSliceUpdate = false;
			
			const sliceAxis = getSliceAxis(viewType);
			
			// Check if the crosshair position for our slice axis has changed
			if (Math.abs(crosshairPos[sliceAxis] - viewWorldPosition[sliceAxis]) > 0.001) {
				console.log(`[SliceViewGPU ${getViewTypeName(viewType)}] Slice axis ${sliceAxis} changed from ${viewWorldPosition[sliceAxis]} to ${crosshairPos[sliceAxis]}`);
				
				// Only update the slice position, not the entire view position
				// This prevents the view from translating when clicking
				const newViewPos = [...viewWorldPosition];
				newViewPos[sliceAxis] = crosshairPos[sliceAxis];
				viewWorldPosition = newViewPos;
				needsSliceUpdate = true;
			}
			
			// If slice changed, update view parameters
			if (needsSliceUpdate) {
				console.log(`[SliceViewGPU ${getViewTypeName(viewType)}] Updating slice position`);
				scheduleRender();
			} else {
				// Just update crosshair display
				scheduleRender();
			}
		}
	});

	// Lifecycle
	onMount(async () => {
		console.log('[SliceViewGPU] Mounting with props:', { layerId, viewType, viewId });
		console.log('[SliceViewGPU] Current layer store state:', $layerStore);

		try {
			// Get services
			[layerService, crosshairService, notificationService, sliceNavigationService, gpuRenderManagerService] = await Promise.all([
				getService<LayerService>('layerService'),
				getService<CrosshairService>('crosshairService'),
				getService<NotificationService>('notificationService'),
				getService<SliceNavigationService>('sliceNavigationService'),
				getService<GpuRenderManagerService>('gpuRenderManagerService')
			]);

			// Store subscriptions handled by Svelte's reactive statements

			// Subscribe to events
			const unsubscribeOpacity = eventBus.on(
				'layer.opacity.changed',
				({ layerId: id, opacity }) => {
					if (id === effectiveLayerId && layerGpu) {
						console.log('[SliceViewGPU] Opacity changed for layer', id);
						syncLayersWithGpu().then(() => {
							scheduleRender();
						});
					}
				}
			);
			
			const unsubscribeColormap = eventBus.on(
				'layer.colormap.changed',
				({ layerId: id, colormap }) => {
					console.log('[SliceViewGPU] Colormap change event received:', {
						eventLayerId: id,
						effectiveLayerId,
						layerGpu: !!layerGpu,
						colormap,
						willUpdate: id === effectiveLayerId && !!layerGpu
					});
					if (id === effectiveLayerId && layerGpu) {
						console.log('[SliceViewGPU] Processing colormap change for layer', id, 'to', colormap);
						
						// Sync layers with GPU and re-render
						syncLayersWithGpu().then(() => {
							console.log('[SliceViewGPU] Layer sync complete after colormap change');
							if (isRenderLoopRunning) {
								scheduleRender();
							} else {
								startRenderLoop();
							}
						}).catch(err => {
							console.error('[SliceViewGPU] Failed to sync layers after colormap change:', err);
						});
					}
				}
			);
			
			const unsubscribeWindowLevel = eventBus.on(
				'layer.windowlevel.changed',
				({ layerId: id, window, level }) => {
					if (id === effectiveLayerId && layerGpu) {
						console.log('[SliceViewGPU] Window/level changed for layer', id);
						syncLayersWithGpu().then(() => {
							scheduleRender();
						});
					}
				}
			);
			
			// Also listen for the new event format from UI
			const unsubscribeWindow = eventBus.on(
				'layer.window.changed',
				({ layerId: id, windowMin, windowMax }) => {
					if (id === effectiveLayerId && layerGpu) {
						console.log('[SliceViewGPU] Window changed for layer', id, { windowMin, windowMax });
						// The store will be updated by StoreServiceBridge, 
						// and our layer effect will detect the change
					}
				}
			);

			const unsubscribeThreshold = eventBus.on(
				'layer.threshold.changed',
				({ layerId: id, threshold }) => {
					if (id === effectiveLayerId && layerGpu) {
						console.log('[SliceViewGPU] Threshold changed for layer', id);
						syncLayersWithGpu().then(() => {
							scheduleRender();
						});
					}
				}
			);
			
			const unsubscribeGpuUpdate = eventBus.on(
				'layer.gpu.updated',
				({ layerId: id, gpu }) => {
					if (id === effectiveLayerId) {
						// Layer GPU resources have been updated
						// The layerStore should be updated via StoreServiceBridge
						console.log('[SliceViewGPU] GPU resources updated for layer', id);
					}
				}
			);
			
			const unsubscribeGpuLayersCleared = eventBus.on(
				'gpu.layers.cleared',
				({ reason }) => {
					console.log('[SliceViewGPU] GPU layers cleared, resetting state:', { reason });
					// Reset layer state since all layers were cleared
					layerAdded = false;
				}
			);

			// Initialize canvas
			if (canvasElement) {
				await new Promise((resolve) => requestAnimationFrame(resolve));

				const parent = canvasElement.parentElement;
				const rect = parent?.getBoundingClientRect() || canvasElement.getBoundingClientRect();

				const width = Math.max(256, Math.floor(rect.width || 256));
				const height = Math.max(256, Math.floor(rect.height || 256));

				canvasElement.width = width;
				canvasElement.height = height;
				containerSize = { width, height };
				
				console.log('[SliceViewGPU] Canvas initialized:', {
					viewType: getViewTypeName(viewType),
					viewId,
					containerSize,
					canvasElement: !!canvasElement,
					parent: !!parent
				});

				await initializeGPU();

				// Setup resize observer
				resizeObserver = new ResizeObserver((entries) => {
					const entry = entries[0];
					const { width, height } = entry.contentRect;
					handleResizeDebounced(width, height);
				});
				resizeObserver.observe(parent || canvasElement);
			}

			// Cleanup function
			return () => {
				// Stop render loop
				stopRenderLoop();

				// Clean up GPU resources
				if (layerId && gpuInitialized) {
					try {
						// Release layer GPU resources
						coreApi.release_layer_gpu_resources(layerId).catch(console.error);

						// Clear all render layers is now handled by GpuRenderManager
					} catch (err) {
						console.error('[SliceViewGPU] Error cleaning up GPU resources:', err);
					}
				}

				// Disconnect observers
				resizeObserver?.disconnect();
				handleResizeDebounced.cancel();
				// reloadSliceDebounced.cancel(); // Removed - no longer needed

				// Unsubscribe events
				unsubscribeOpacity();
				unsubscribeColormap();
				unsubscribeWindowLevel();
				unsubscribeWindow();
				unsubscribeThreshold();
				unsubscribeGpuUpdate();
				unsubscribeGpuLayersCleared();

				// GPU layer cleanup is handled by GpuRenderManager
				// The shared render manager will maintain layer state across views

				// Clear canvas context
				if (canvasElement) {
					const ctx = canvasElement.getContext('2d');
					if (ctx) {
						ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
					}
				}
			};
		} catch (err) {
			console.error('[SliceViewGPU] Failed to initialize:', err);
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
		<div class="overlay error">
			Error: {layer.error instanceof Error ? layer.error.message : 'Unknown error'}
		</div>
	{:else if layer.isLoadingGpu}
		<div class="overlay loading">Loading GPU resources...</div>
	{:else if !layerGpu}
		<div class="overlay loading">Waiting for GPU resources...</div>
	{:else if !gpuInitialized}
		<div class="overlay loading">Initializing GPU...</div>
	{:else if !renderTargetCreated}
		<div class="overlay loading">Creating render target...</div>
	{:else if isLoadingSlice}
		<div class="overlay loading">Loading slice...</div>
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
		ondblclick={handleDoubleClick}
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
				class="slice-slider orthogonal-view-slider"
				min={sliceMin}
				max={sliceMax}
				step={sliceStep}
				value={slicePosition}
				oninput={handleSliderChange}
				onmousedown={handleSliderStart}
				onmouseup={handleSliderEnd}
				ontouchstart={handleSliderStart}
				ontouchend={handleSliderEnd}
				disabled={isLoadingSlice}
				style="--thumb-color: {isLoadingSlice ? 'var(--color-base-600)' : 'var(--color-primary-500)'}"
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
		background-color: #000000; /* Black background to match medical imaging */
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
		/* Remove background-color to let canvas fillRect show through */
		cursor: crosshair;
		image-rendering: pixelated;
		border: 1px solid var(--color-border);
		box-sizing: border-box;
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
		color: var(--color-error);
	}

	.overlay.loading {
		color: var(--color-primary-500);
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
		color: var(--color-text-primary);
		font-size: var(--font-ui-xs);
		font-weight: bold;
		user-select: none;
		padding: 2px 6px;
		background-color: rgba(0, 0, 0, 0.7);
		border-radius: var(--radius-sm);
		backdrop-filter: blur(4px);
		border: 1px solid rgba(255, 255, 255, 0.1);
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
		font-size: var(--font-ui-sm);
		font-weight: 600;
	}

	.slice-value {
		color: var(--color-text-primary, #fff);
		font-size: var(--font-ui-sm);
		font-family: 'SF Mono', Monaco, monospace;
		font-variant-numeric: tabular-nums;
	}

	.slice-slider {
		flex: 1;
		height: 4px;
		-webkit-appearance: none;
		-moz-appearance: none;
		appearance: none;
		background: var(--color-base-600);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
		transition: background 0.2s ease;
		position: relative;
	}

	.slice-slider:hover {
		background: var(--color-base-700);
	}

	/* Webkit browsers (Chrome, Safari, Edge) */
	.slice-slider::-webkit-slider-thumb,
	.orthogonal-view-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 16px;
		height: 16px;
		background-color: var(--thumb-color, var(--color-primary-500, #22c55e));
		border-radius: 50%;
		cursor: pointer;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
		transition: all 0.2s ease;
		border: 2px solid transparent;
		margin-top: -6px; /* Center the thumb on the track */
	}

	.slice-slider::-webkit-slider-thumb:hover {
		background-color: var(--color-primary-400, #1a9949);
		transform: scale(1.2);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
	}

	.slice-slider::-webkit-slider-thumb:active {
		background-color: var(--color-primary-600, #4ade80);
		transform: scale(1.1);
	}

	/* Firefox */
	.slice-slider::-moz-range-thumb,
	.orthogonal-view-slider::-moz-range-thumb {
		width: 16px;
		height: 16px;
		background-color: var(--thumb-color, var(--color-primary-500, #22c55e));
		border-radius: 50%;
		cursor: pointer;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
		border: 2px solid transparent;
		transition: all 0.2s ease;
	}

	.slice-slider::-moz-range-thumb:hover {
		background-color: var(--color-primary-400, #1a9949);
		transform: scale(1.2);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
	}

	.slice-slider::-moz-range-thumb:active {
		background-color: var(--color-primary-600, #4ade80);
		transform: scale(1.1);
	}

	/* Track styling for better visibility */
	.slice-slider::-webkit-slider-runnable-track {
		width: 100%;
		height: 4px;
		background: transparent;
	}

	.slice-slider::-moz-range-track {
		width: 100%;
		height: 4px;
		background: transparent;
	}

	/* Focus styles */
	.slice-slider:focus {
		outline: none;
	}

	.slice-slider:focus::-webkit-slider-thumb {
		border: 2px solid var(--color-primary-700, #86efac);
	}

	.slice-slider:focus::-moz-range-thumb {
		border: 2px solid var(--color-primary-700, #86efac);
	}

	/* Disabled state */
	.slice-slider:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.slice-slider:disabled::-webkit-slider-thumb {
		background-color: var(--color-base-600);
		cursor: not-allowed;
	}

	.slice-slider:disabled::-moz-range-thumb {
		background-color: var(--color-base-600);
		cursor: not-allowed;
	}
</style>
