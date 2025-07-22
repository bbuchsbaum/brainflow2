/**
 * GPU Resource Service
 * Manages GPU resources including textures, render targets, and memory pooling
 * Provides efficient resource reuse and lifecycle management
 */
import type { EventBus } from '$lib/events/EventBus';
import type { ConfigService } from './ConfigService';
import type { NotificationService } from './NotificationService';
import { LRUCache } from '$lib/utils/LRUCache';
import type { CoreApi } from '$lib/api';
import type { VolumeLayerGpuInfo, LayerSpec, SliceIndex, SliceInfo } from '@brainflow/api';

export interface GpuResourceConfig {
	maxTextures: number;
	maxRenderTargets: number;
	poolSize: number;
	sizeBuckets: number[];
	memoryLimit: number; // MB
	contextLossRetryAttempts: number;
}

export interface RenderTarget {
	id: string;
	width: number;
	height: number;
	format: GPUTextureFormat;
	usage: GPUTextureUsageFlags;
	texture?: GPUTexture;
	view?: GPUTextureView;
	lastUsed: number;
	refCount: number;
	memorySize: number; // bytes
}

export interface TextureResource {
	id: string;
	layerId: string;
	volumeId: string;
	gpuInfo: VolumeLayerGpuInfo;
	texture?: GPUTexture;
	view?: GPUTextureView;
	lastUsed: number;
	refCount: number;
	memorySize: number; // bytes
	generation: number; // For detecting stale resources
}

export interface GpuMemoryStats {
	totalAllocated: number;
	textureMemory: number;
	renderTargetMemory: number;
	available: number;
	limit: number;
	pressure: 'low' | 'medium' | 'high';
}

export interface RenderRequest {
	layerId: string;
	sliceIndex: SliceIndex;
	width: number;
	height: number;
	timestamp: number;
}

export class GpuResourceService {
	private config: GpuResourceConfig;
	private eventBus: EventBus;
	private notificationService?: NotificationService;
	private api: CoreApi;
	private eventUnsubscribes: Array<() => void> = [];

	// Resource pools
	private renderTargets = new Map<string, RenderTarget>();
	private textureCache: LRUCache<string, TextureResource>;
	private renderQueue: RenderRequest[] = [];
	private isProcessingQueue = false;

	// GPU state
	private device: GPUDevice | null = null;
	private adapter: GPUAdapter | null = null;
	private initialized = false;
	private contextLost = false;
	private totalMemoryUsed = 0;

	// Performance tracking
	private frameTimings: number[] = [];
	private renderStats = {
		framesRendered: 0,
		cacheHits: 0,
		cacheMisses: 0,
		contextLosses: 0
	};

	constructor(deps: {
		eventBus: EventBus;
		configService: ConfigService;
		notificationService?: NotificationService;
		api: CoreApi;
	}) {
		this.eventBus = deps.eventBus;
		this.notificationService = deps.notificationService;
		this.api = deps.api;

		// Load configuration from ConfigService (no longer circular dependency)
		const renderSettings = deps.configService.getRenderSettings();
		this.config = {
			maxTextures: 20,
			maxRenderTargets: 10,
			poolSize: 5,
			sizeBuckets: [256, 512, 1024, 2048],
			memoryLimit: renderSettings.gpuMemoryLimit || 2048, // MB from render settings
			contextLossRetryAttempts: 3
		};

		// Initialize texture cache with eviction callback
		this.textureCache = new LRUCache<string, TextureResource>(
			this.config.maxTextures,
			(key, resource) => this.onTextureEvicted(key, resource)
		);

		this.setupEventListeners();
	}

	private setupEventListeners(): void {
		// Listen for layer lifecycle events
		this.eventUnsubscribes.push(
			this.eventBus.on('layer.removed', ({ layerId }) => {
				this.releaseLayerGpuResources(layerId);
			})
		);

		// Listen for memory pressure events
		this.eventUnsubscribes.push(
			this.eventBus.on('system.memory.pressure', () => {
				this.handleMemoryPressure();
			})
		);

		// Listen for visibility changes
		this.eventUnsubscribes.push(
			this.eventBus.on('app.visibility.changed', ({ visible }) => {
				if (!visible) {
					this.pauseRendering();
				} else {
					this.resumeRendering();
				}
			})
		);
	}

	/**
	 * Initialize GPU resources
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		try {
			this.eventBus.emit('gpu.init.start', {});

			// Check WebGPU support
			if (!navigator.gpu) {
				throw new Error('WebGPU not supported in this browser');
			}

			// Request adapter
			this.adapter = await navigator.gpu.requestAdapter({
				powerPreference: 'high-performance'
			});

			if (!this.adapter) {
				throw new Error('Failed to get GPU adapter');
			}

			// Request device
			this.device = await this.adapter.requestDevice({
				requiredFeatures: ['texture-compression-bc'] as any,
				requiredLimits: {
					maxTextureDimension2D: 4096,
					maxBufferSize: 256 * 1024 * 1024 // 256MB
				}
			});

			// Set up context loss handling
			this.device.lost.then((info) => {
				this.handleContextLoss(info);
			});

			// Initialize render loop
			await this.api.init_render_loop();

			// Pre-allocate common resources if pool size > 0
			if (this.config.poolSize > 0) {
				await this.preallocateResources();
			}

			this.initialized = true;
			this.eventBus.emit('gpu.init.success', {
				adapter: this.getAdapterInfo()
			});
		} catch (error) {
			this.eventBus.emit('gpu.init.error', { error });
			this.notificationService?.error('Failed to initialize GPU', { error });
			throw error;
		}
	}

	/**
	 * Pre-allocate common render target sizes
	 */
	private async preallocateResources(): Promise<void> {
		// Pre-allocate common sizes to avoid allocation during rendering
		const commonSizes = [512, 1024];

		for (const size of commonSizes) {
			const key = this.getRenderTargetKey(size, size, 'rgba8unorm');
			await this.createRenderTarget(key, size, size, 'rgba8unorm');
		}
	}

	/**
	 * Request GPU resources for a layer
	 */
	async requestLayerGpuResources(layerId: string, spec: LayerSpec): Promise<VolumeLayerGpuInfo> {
		if (!this.initialized) {
			await this.initialize();
		}

		try {
			this.eventBus.emit('gpu.layer.request.start', { layerId });

			// Check if we already have resources for this layer
			const cached = this.textureCache.get(layerId);
			if (cached && cached.generation === this.getLayerGeneration(spec)) {
				cached.refCount++;
				cached.lastUsed = Date.now();
				this.renderStats.cacheHits++;

				this.eventBus.emit('gpu.layer.request.cached', { layerId });
				return cached.gpuInfo;
			}

			// Request new GPU resources from backend
			const gpuInfo = await this.api.request_layer_gpu_resources(spec);

			// Calculate memory usage
			const memorySize = this.calculateTextureMemory(gpuInfo);

			// Check memory limits
			if (!this.checkMemoryLimit(memorySize)) {
				await this.freeMemory(memorySize);
			}

			// Create texture resource
			const resource: TextureResource = {
				id: `texture-${layerId}`,
				layerId,
				volumeId: this.getVolumeId(spec),
				gpuInfo,
				lastUsed: Date.now(),
				refCount: 1,
				memorySize,
				generation: this.getLayerGeneration(spec)
			};

			// Cache the resource
			this.textureCache.set(layerId, resource);
			this.totalMemoryUsed += memorySize;
			this.renderStats.cacheMisses++;

			// Debug logging
			console.log('Cached resource for', layerId, 'Cache size:', this.textureCache.size());

			this.eventBus.emit('gpu.layer.request.success', {
				layerId,
				memorySize
			});

			return gpuInfo;
		} catch (error) {
			this.eventBus.emit('gpu.layer.request.error', { layerId, error });
			throw error;
		}
	}

	/**
	 * Release GPU resources for a layer
	 */
	async releaseLayerGpuResources(layerId: string): Promise<void> {
		const resource = this.textureCache.get(layerId);
		if (!resource) return;

		resource.refCount--;

		if (resource.refCount <= 0) {
			// Don't immediately evict - LRU will handle it
			resource.refCount = 0;
			this.eventBus.emit('gpu.layer.release', { layerId });
		}
	}

	/**
	 * Acquire a render target for rendering
	 */
	async acquireRenderTarget(
		width: number,
		height: number,
		format: GPUTextureFormat = 'rgba8unorm'
	): Promise<RenderTarget> {
		if (!this.initialized || !this.device) {
			await this.initialize();
		}

		// Round to bucket size for better reuse
		const bucketWidth = this.findBucketSize(width);
		const bucketHeight = this.findBucketSize(height);
		const key = this.getRenderTargetKey(bucketWidth, bucketHeight, format);

		let target = this.renderTargets.get(key);

		if (!target) {
			target = await this.createRenderTarget(key, bucketWidth, bucketHeight, format);
		}

		target.refCount++;
		target.lastUsed = Date.now();

		return target;
	}

	/**
	 * Release a render target
	 */
	releaseRenderTarget(target: RenderTarget): void {
		target.refCount--;

		if (target.refCount <= 0) {
			target.refCount = 0;
			target.lastUsed = Date.now();

			// Clean up if we have too many unused targets
			this.cleanupUnusedRenderTargets();
		}
	}

	/**
	 * Create a new render target
	 */
	private async createRenderTarget(
		key: string,
		width: number,
		height: number,
		format: GPUTextureFormat
	): Promise<RenderTarget> {
		if (!this.device) {
			throw new Error('GPU device not initialized');
		}

		const usage =
			GPUTextureUsage.RENDER_ATTACHMENT |
			GPUTextureUsage.TEXTURE_BINDING |
			GPUTextureUsage.COPY_SRC;

		const texture = this.device.createTexture({
			size: { width, height },
			format,
			usage
		});

		const view = texture.createView();
		const memorySize = this.calculateRenderTargetMemory(width, height, format);

		const target: RenderTarget = {
			id: key,
			width,
			height,
			format,
			usage,
			texture,
			view,
			lastUsed: Date.now(),
			refCount: 0,
			memorySize
		};

		this.renderTargets.set(key, target);
		this.totalMemoryUsed += memorySize;

		this.eventBus.emit('gpu.rendertarget.created', {
			width,
			height,
			format,
			memorySize
		});

		return target;
	}

	/**
	 * Schedule a render operation
	 */
	scheduleRender(request: RenderRequest): void {
		// Add to queue with deduplication
		const existingIndex = this.renderQueue.findIndex(
			(r) => r.layerId === request.layerId && r.sliceIndex.axis === request.sliceIndex.axis
		);

		if (existingIndex >= 0) {
			// Update existing request
			this.renderQueue[existingIndex] = request;
		} else {
			this.renderQueue.push(request);
		}

		// Process queue on next frame if not already processing
		if (!this.isProcessingQueue && this.renderQueue.length > 0) {
			this.isProcessingQueue = true;
			requestAnimationFrame(() => this.processRenderQueue());
		}
	}

	/**
	 * Process the render queue
	 */
	private async processRenderQueue(): Promise<void> {
		if (this.renderQueue.length === 0 || this.contextLost) {
			this.isProcessingQueue = false;
			return;
		}

		const startTime = performance.now();
		const batch = this.renderQueue.splice(0, 4); // Process up to 4 renders per frame

		try {
			for (const request of batch) {
				await this.executeRender(request);
			}

			const frameTime = performance.now() - startTime;
			this.trackFrameTiming(frameTime);
		} catch (error) {
			this.eventBus.emit('gpu.render.error', { error });
			console.error('Render error:', error);
		}

		// Continue processing if more in queue
		if (this.renderQueue.length > 0) {
			requestAnimationFrame(() => this.processRenderQueue());
		} else {
			this.isProcessingQueue = false;
		}
	}

	/**
	 * Execute a single render operation
	 */
	private async executeRender(request: RenderRequest): Promise<void> {
		const { layerId, sliceIndex, width, height } = request;

		// Get texture resource
		const resource = this.textureCache.get(layerId);
		if (!resource) {
			throw new Error(`No GPU resources for layer ${layerId}`);
		}

		// Acquire render target
		const target = await this.acquireRenderTarget(width, height);

		try {
			// Call backend render
			await this.api.render_slice(resource.volumeId, sliceIndex, target.id);

			this.renderStats.framesRendered++;

			this.eventBus.emit('gpu.render.complete', {
				layerId,
				sliceIndex,
				duration: performance.now() - request.timestamp
			});
		} finally {
			this.releaseRenderTarget(target);
		}
	}

	/**
	 * Handle GPU context loss
	 */
	private async handleContextLoss(info: GPUDeviceLostInfo): Promise<void> {
		this.contextLost = true;
		this.renderStats.contextLosses++;

		this.eventBus.emit('gpu.context.lost', { reason: info.reason });
		this.notificationService?.warning('GPU context lost, attempting recovery...');

		// Clear all resources
		this.clearAllResources();

		// Attempt recovery
		let attempts = 0;
		while (attempts < this.config.contextLossRetryAttempts) {
			try {
				await this.initialize();
				this.contextLost = false;

				this.eventBus.emit('gpu.context.restored', {});
				this.notificationService?.success('GPU context restored');
				break;
			} catch (error) {
				attempts++;
				if (attempts >= this.config.contextLossRetryAttempts) {
					this.eventBus.emit('gpu.context.recovery.failed', { error });
					this.notificationService?.error('Failed to restore GPU context');
					throw error;
				}

				// Wait before retry
				await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
			}
		}
	}

	/**
	 * Handle memory pressure
	 */
	private async handleMemoryPressure(): Promise<void> {
		const stats = this.getMemoryStats();

		if (stats.pressure === 'high') {
			// Free 25% of memory
			const targetFree = this.totalMemoryUsed * 0.25;
			await this.freeMemory(targetFree);

			this.eventBus.emit('gpu.memory.freed', {
				amount: targetFree,
				pressure: stats.pressure
			});
		}
	}

	/**
	 * Free memory by evicting least recently used resources
	 */
	private async freeMemory(targetBytes: number): Promise<void> {
		let freed = 0;

		// First, clean up unused render targets
		const unusedTargets = Array.from(this.renderTargets.values())
			.filter((t) => t.refCount === 0)
			.sort((a, b) => a.lastUsed - b.lastUsed);

		for (const target of unusedTargets) {
			if (freed >= targetBytes) break;

			this.destroyRenderTarget(target);
			freed += target.memorySize;
		}

		// If still need more, evict textures
		if (freed < targetBytes) {
			const evictionCount = Math.ceil(
				(targetBytes - freed) / (this.totalMemoryUsed / this.textureCache.size())
			);

			for (let i = 0; i < evictionCount && freed < targetBytes; i++) {
				const evicted = this.textureCache.evictLRU();
				if (evicted) {
					freed += evicted.memorySize;
				}
			}
		}
	}

	/**
	 * Get memory statistics
	 */
	getMemoryStats(): GpuMemoryStats {
		const limitBytes = this.config.memoryLimit * 1024 * 1024;
		const usage = this.totalMemoryUsed / limitBytes;

		let pressure: 'low' | 'medium' | 'high' = 'low';
		if (usage > 0.9) pressure = 'high';
		else if (usage > 0.7) pressure = 'medium';

		const textureMemory = Array.from(this.textureCache.values()).reduce(
			(sum, r) => sum + r.memorySize,
			0
		);

		const renderTargetMemory = Array.from(this.renderTargets.values()).reduce(
			(sum, t) => sum + t.memorySize,
			0
		);

		return {
			totalAllocated: this.totalMemoryUsed,
			textureMemory,
			renderTargetMemory,
			available: limitBytes - this.totalMemoryUsed,
			limit: limitBytes,
			pressure
		};
	}

	/**
	 * Get render statistics
	 */
	getRenderStats() {
		const avgFrameTime =
			this.frameTimings.length > 0
				? this.frameTimings.reduce((a, b) => a + b) / this.frameTimings.length
				: 0;

		const cacheHitRate =
			this.renderStats.cacheHits + this.renderStats.cacheMisses > 0
				? this.renderStats.cacheHits / (this.renderStats.cacheHits + this.renderStats.cacheMisses)
				: 0;

		return {
			...this.renderStats,
			avgFrameTime,
			cacheHitRate,
			fps: avgFrameTime > 0 ? 1000 / avgFrameTime : 0
		};
	}

	/**
	 * Utility methods
	 */

	private findBucketSize(size: number): number {
		for (const bucket of this.config.sizeBuckets) {
			if (size <= bucket) return bucket;
		}
		return Math.ceil(size / 256) * 256;
	}

	private getRenderTargetKey(width: number, height: number, format: GPUTextureFormat): string {
		return `${width}x${height}-${format}`;
	}

	private calculateTextureMemory(info: VolumeLayerGpuInfo): number {
		// Estimate based on dimensions and format
		const [width, height, depth] = info.dim;
		const bytesPerPixel = this.getBytesPerPixel(info.tex_format);
		return width * height * depth * bytesPerPixel;
	}

	private checkMemoryLimit(requiredBytes: number): boolean {
		const limitBytes = this.config.memoryLimit * 1024 * 1024;
		return this.totalMemoryUsed + requiredBytes <= limitBytes;
	}

	private calculateRenderTargetMemory(
		width: number,
		height: number,
		format: GPUTextureFormat
	): number {
		const bytesPerPixel = this.getBytesPerPixel(format);
		return width * height * bytesPerPixel;
	}

	private getBytesPerPixel(format: string): number {
		// Simplified - real implementation would handle all formats
		switch (format) {
			case 'rgba8unorm':
			case 'bgra8unorm':
				return 4;
			case 'r32float':
				return 4;
			case 'rgba16float':
				return 8;
			case 'rgba32float':
				return 16;
			default:
				return 4;
		}
	}

	private getVolumeId(spec: LayerSpec): string {
		if ('Volume' in spec) {
			return spec.Volume.source_resource_id;
		}
		return 'unknown';
	}

	private getLayerGeneration(spec: LayerSpec): number {
		// Use spec properties to determine if resources need refresh
		if ('Volume' in spec) {
			const vol = spec.Volume;
			// Create hash from properties that affect GPU resources
			return [
				vol.window_center,
				vol.window_width,
				vol.colormap,
				vol.threshold_lower,
				vol.threshold_upper
			].reduce((hash, val) => hash + (val ? val.toString() : ''), 0).length;
		}
		return 0;
	}

	private cleanupUnusedRenderTargets(): void {
		const targets = Array.from(this.renderTargets.values());
		const unused = targets.filter((t) => t.refCount === 0).sort((a, b) => a.lastUsed - b.lastUsed);

		while (unused.length > this.config.poolSize) {
			const target = unused.shift()!;
			this.destroyRenderTarget(target);
		}
	}

	private destroyRenderTarget(target: RenderTarget): void {
		if (target.texture) {
			target.texture.destroy();
		}

		this.renderTargets.delete(target.id);
		this.totalMemoryUsed -= target.memorySize;

		this.eventBus.emit('gpu.rendertarget.destroyed', {
			id: target.id,
			memoryFreed: target.memorySize
		});
	}

	private onTextureEvicted(key: string, resource: TextureResource): void {
		this.totalMemoryUsed -= resource.memorySize;

		this.eventBus.emit('gpu.texture.evicted', {
			layerId: resource.layerId,
			memoryFreed: resource.memorySize
		});
	}

	private trackFrameTiming(time: number): void {
		this.frameTimings.push(time);

		// Keep last 60 frames
		if (this.frameTimings.length > 60) {
			this.frameTimings.shift();
		}
	}

	private getAdapterInfo(): any {
		if (!this.adapter) return null;

		// Get adapter info if available
		const info = (this.adapter as any).info || {};
		return {
			vendor: info.vendor || 'unknown',
			architecture: info.architecture || 'unknown',
			device: info.device || 'unknown',
			description: info.description || 'unknown'
		};
	}

	private clearAllResources(): void {
		// Destroy all render targets
		for (const target of this.renderTargets.values()) {
			if (target.texture) {
				target.texture.destroy();
			}
		}
		this.renderTargets.clear();

		// Clear texture cache
		this.textureCache.clear();

		// Reset memory tracking
		this.totalMemoryUsed = 0;
	}

	private pauseRendering(): void {
		// Clear render queue
		this.renderQueue = [];
		this.eventBus.emit('gpu.rendering.paused', {});
	}

	private resumeRendering(): void {
		this.eventBus.emit('gpu.rendering.resumed', {});
	}

	/**
	 * Clean up all resources
	 */
	async dispose(): Promise<void> {
		// Clean up event listeners
		this.eventUnsubscribes.forEach(unsubscribe => unsubscribe());
		this.eventUnsubscribes = [];

		this.clearAllResources();

		if (this.device) {
			this.device.destroy();
			this.device = null;
		}

		this.adapter = null;
		this.initialized = false;

		this.eventBus.emit('gpu.disposed', {});
	}
}
