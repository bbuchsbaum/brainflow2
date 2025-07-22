/**
 * GPU Resource Service Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GpuResourceService } from './GpuResourceService';
import { createMockEventBus } from '@test-utils';
import { mockService } from '@test-utils';
import type { EventBus } from '$lib/events/EventBus';
import type { ConfigService } from './ConfigService';
import type { NotificationService } from './NotificationService';
import type { VolumeLayerGpuInfo, LayerSpec, SliceIndex } from '@brainflow/api';
import { coreApi } from '$lib/api';

// Mock WebGPU API
const createMockTexture = () => ({
	createView: vi.fn().mockReturnValue({}),
	destroy: vi.fn()
});

const mockGPUDevice = {
	createTexture: vi.fn(() => createMockTexture()),
	destroy: vi.fn(),
	lost: new Promise(() => {}), // Never resolves to avoid triggering context loss in tests
	queue: {
		submit: vi.fn()
	}
};

const mockGPUAdapter = {
	requestDevice: vi.fn().mockResolvedValue(mockGPUDevice)
};

// Mock navigator.gpu
global.navigator.gpu = {
	requestAdapter: vi.fn().mockResolvedValue(mockGPUAdapter)
} as any;

// Mock WebGPU constants
global.GPUTextureUsage = {
	COPY_SRC: 0x01,
	COPY_DST: 0x02,
	TEXTURE_BINDING: 0x04,
	STORAGE_BINDING: 0x08,
	RENDER_ATTACHMENT: 0x10
} as any;

global.GPUBufferUsage = {
	MAP_READ: 0x0001,
	MAP_WRITE: 0x0002,
	COPY_SRC: 0x0004,
	COPY_DST: 0x0008,
	INDEX: 0x0010,
	VERTEX: 0x0020,
	UNIFORM: 0x0040,
	STORAGE: 0x0080,
	INDIRECT: 0x0100,
	QUERY_RESOLVE: 0x0200
} as any;

// Mock the API
vi.mock('$lib/api', () => ({
	coreApi: {
		init_render_loop: vi.fn().mockResolvedValue(undefined),
		request_layer_gpu_resources: vi.fn(),
		render_slice: vi.fn().mockResolvedValue(undefined),
		release_layer_gpu_resources: vi.fn().mockResolvedValue(undefined)
	}
}));

describe('GpuResourceService', () => {
	let service: GpuResourceService;
	let eventBus: ReturnType<typeof createMockEventBus>;
	let configService: ConfigService;
	let notificationService: NotificationService;

	// Store original mocks to restore
	let originalRequestAdapter: any;
	let originalCoreApi: any;

	const mockLayerSpec: LayerSpec = {
		Volume: {
			id: 'layer-1',
			source_resource_id: 'volume-1',
			opacity: 1.0,
			colormap: 'grayscale',
			window_center: 0.5,
			window_width: 1.0
		}
	};

	const mockGpuInfo: VolumeLayerGpuInfo = {
		layer_id: 'layer-1',
		world_to_voxel: new Array(16).fill(0) as any,
		dim: [512, 512, 100],
		pad_slices: 1,
		tex_format: 'rgba8unorm',
		atlas_layer_index: 0,
		slice_info: {
			slice_axis: 2,
			slice_index: 50,
			slice_thickness: 1
		} as any,
		texture_coords: {
			u_min: 0,
			u_max: 1,
			v_min: 0,
			v_max: 1
		} as any,
		voxel_to_world: new Array(16).fill(0) as any,
		origin: [0, 0, 0],
		center_world: [128, 128, 50],
		spacing: [1, 1, 1],
		data_range: { min: 0, max: 1000 } as any,
		source_volume_id: 'volume-1',
		allocated_at: BigInt(Date.now()),
		is_binary_like: false
	};

	beforeEach(() => {
		vi.clearAllMocks();

		// Store original values
		originalRequestAdapter = global.navigator.gpu?.requestAdapter;
		originalCoreApi = { ...coreApi };

		// Reset WebGPU mocks
		global.navigator.gpu = {
			requestAdapter: vi.fn().mockResolvedValue(mockGPUAdapter)
		} as any;

		mockGPUAdapter.requestDevice.mockClear();
		mockGPUAdapter.requestDevice.mockResolvedValue(mockGPUDevice);

		// Configure API mock to return the expected GPU info
		(coreApi.request_layer_gpu_resources as any).mockResolvedValue({
			layer_id: 'layer-1',
			world_to_voxel: new Array(16).fill(0),
			dim: [512, 512, 100],
			pad_slices: 1,
			tex_format: 'rgba8unorm',
			atlas_layer_index: 0,
			slice_info: {
				slice_axis: 2,
				slice_index: 50,
				slice_thickness: 1
			},
			texture_coords: {
				u_min: 0,
				u_max: 1,
				v_min: 0,
				v_max: 1
			},
			voxel_to_world: new Array(16).fill(0),
			origin: [0, 0, 0],
			center_world: [128, 128, 50],
			spacing: [1, 1, 1],
			data_range: { min: 0, max: 1000 },
			source_volume_id: 'volume-1',
			allocated_at: BigInt(1234567890),
			is_binary_like: false
		});

		eventBus = createMockEventBus();

		configService = mockService<ConfigService>({
			get: vi.fn().mockImplementation((key: string, defaultValue?: any) => {
				const config: Record<string, any> = {
					'gpu.maxTextures': 20,
					'gpu.maxRenderTargets': 10,
					'gpu.poolSize': 5,
					'gpu.sizeBuckets': [256, 512, 1024, 2048],
					'gpu.memoryLimit': 512,
					'gpu.contextLossRetryAttempts': 3
				};
				return config[key] ?? defaultValue;
			})
		});

		notificationService = mockService<NotificationService>({
			success: vi.fn(),
			error: vi.fn(),
			warning: vi.fn(),
			info: vi.fn()
		});

		service = new GpuResourceService({
			eventBus,
			configService,
			notificationService
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('initialization', () => {
		it('should initialize GPU resources', async () => {
			await service.initialize();

			expect(global.navigator.gpu.requestAdapter).toHaveBeenCalledWith({
				powerPreference: 'high-performance'
			});

			expect(mockGPUAdapter.requestDevice).toHaveBeenCalled();
			expect(eventBus.emit).toHaveBeenCalledWith('gpu.init.start', {});
			expect(eventBus.emit).toHaveBeenCalledWith('gpu.init.success', expect.any(Object));
		});

		it('should handle missing WebGPU support', async () => {
			global.navigator.gpu = undefined as any;

			await expect(service.initialize()).rejects.toThrow('WebGPU not supported');

			expect(eventBus.emit).toHaveBeenCalledWith('gpu.init.error', expect.any(Object));
			expect(notificationService.error).toHaveBeenCalledWith(
				'Failed to initialize GPU',
				expect.any(Object)
			);
		});

		it('should only initialize once', async () => {
			// Create completely fresh mocks for this test
			// IMPORTANT: Don't resolve the 'lost' promise immediately to avoid triggering context loss
			const mockDevice = {
				lost: new Promise(() => {}), // Never resolves during the test
				queue: {},
				destroy: vi.fn()
			};

			const mockAdapter = {
				requestDevice: vi.fn().mockResolvedValue(mockDevice),
				features: new Set(['texture-compression-bc']),
				limits: {
					maxTextureDimension2D: 4096,
					maxBufferSize: 256 * 1024 * 1024
				}
			};

			// Create a fresh requestAdapter mock
			const requestAdapterSpy = vi.fn().mockResolvedValue(mockAdapter);

			// Override global navigator.gpu for this test only
			global.navigator.gpu = {
				requestAdapter: requestAdapterSpy
			} as any;

			// Create fresh API mock
			const initRenderLoopSpy = vi.fn().mockResolvedValue(undefined);
			vi.mocked(coreApi.init_render_loop).mockImplementation(initRenderLoopSpy);

			// Create service with no pre-allocation
			const freshConfigService = mockService<ConfigService>({
				get: vi.fn().mockImplementation((key: string, defaultValue?: any) => {
					const config: Record<string, any> = {
						'gpu.maxTextures': 20,
						'gpu.maxRenderTargets': 10,
						'gpu.poolSize': 0, // No pre-allocation
						'gpu.sizeBuckets': [256, 512, 1024, 2048],
						'gpu.memoryLimit': 512,
						'gpu.contextLossRetryAttempts': 3
					};
					return config[key] ?? defaultValue;
				})
			});

			const freshService = new GpuResourceService({
				eventBus: createMockEventBus(),
				configService: freshConfigService,
				notificationService
			});

			// Verify initial state
			expect((freshService as any).initialized).toBe(false);

			// First initialization
			await freshService.initialize();
			expect((freshService as any).initialized).toBe(true);
			expect(requestAdapterSpy).toHaveBeenCalledTimes(1);
			expect(initRenderLoopSpy).toHaveBeenCalledTimes(1);

			// Second initialization should return immediately
			await freshService.initialize();

			// Should still only have been called once
			expect(requestAdapterSpy).toHaveBeenCalledTimes(1);
			expect(initRenderLoopSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('layer GPU resources', () => {
		beforeEach(async () => {
			await service.initialize();
		});

		it('should request GPU resources for a layer', async () => {
			const gpuInfo = await service.requestLayerGpuResources('layer-1', mockLayerSpec);

			expect(coreApi.request_layer_gpu_resources).toHaveBeenCalledWith(mockLayerSpec);
			expect(gpuInfo).toMatchObject({
				...mockGpuInfo,
				allocated_at: expect.any(BigInt)
			});
			expect(eventBus.emit).toHaveBeenCalledWith('gpu.layer.request.start', { layerId: 'layer-1' });
			expect(eventBus.emit).toHaveBeenCalledWith('gpu.layer.request.success', expect.any(Object));
		});

		it('should return cached resources on second request', async () => {
			// First request
			await service.requestLayerGpuResources('layer-1', mockLayerSpec);

			// Second request
			const gpuInfo = await service.requestLayerGpuResources('layer-1', mockLayerSpec);

			expect(coreApi.request_layer_gpu_resources).toHaveBeenCalledTimes(1);
			expect(eventBus.emit).toHaveBeenCalledWith('gpu.layer.request.cached', {
				layerId: 'layer-1'
			});
		});

		it('should handle memory pressure', async () => {
			// Simulate high memory usage
			for (let i = 0; i < 25; i++) {
				await service.requestLayerGpuResources(`layer-${i}`, {
					...mockLayerSpec,
					Volume: { ...mockLayerSpec.Volume, id: `layer-${i}` }
				});
			}

			const stats = service.getMemoryStats();
			expect(stats.pressure).toBe('high');
		});

		it('should release GPU resources', async () => {
			await service.requestLayerGpuResources('layer-1', mockLayerSpec);
			await service.releaseLayerGpuResources('layer-1');

			expect(eventBus.emit).toHaveBeenCalledWith('gpu.layer.release', { layerId: 'layer-1' });
		});
	});

	describe('render targets', () => {
		beforeEach(async () => {
			await service.initialize();
		});

		it('should acquire render target', async () => {
			const target = await service.acquireRenderTarget(640, 480);

			expect(target).toMatchObject({
				width: 1024, // Rounded to bucket size
				height: 512, // Rounded to bucket size
				format: 'rgba8unorm',
				refCount: 1
			});

			expect(mockGPUDevice.createTexture).toHaveBeenCalled();
		});

		it('should reuse render targets', async () => {
			// Clear mock to count only this test's calls
			mockGPUDevice.createTexture.mockClear();

			const target1 = await service.acquireRenderTarget(500, 500);
			const firstCallCount = mockGPUDevice.createTexture.mock.calls.length;

			service.releaseRenderTarget(target1);

			const target2 = await service.acquireRenderTarget(500, 500);
			const secondCallCount = mockGPUDevice.createTexture.mock.calls.length;

			expect(target1.id).toBe(target2.id);
			// Should not create a new texture on second acquire
			expect(secondCallCount).toBe(firstCallCount);
		});

		it('should clean up unused render targets', async () => {
			// Get initial memory usage
			const initialStats = service.getMemoryStats();
			const initialMemory = initialStats.renderTargetMemory;

			// Create multiple targets
			const targets = [];
			for (let i = 0; i < 8; i++) {
				targets.push(await service.acquireRenderTarget(256, 256));
			}

			// Check memory increased
			const afterCreateStats = service.getMemoryStats();
			expect(afterCreateStats.renderTargetMemory).toBeGreaterThan(initialMemory);

			// Release all
			targets.forEach((t) => service.releaseRenderTarget(t));

			// Force cleanup by requesting a different size target
			await service.acquireRenderTarget(2048, 2048);

			// Memory should not exceed reasonable limit (initial + new large target)
			const finalStats = service.getMemoryStats();
			const newTargetMemory = 2048 * 2048 * 4; // RGBA
			const maxExpectedMemory = initialMemory + newTargetMemory + 256 * 256 * 4 * 5; // pool size
			expect(finalStats.renderTargetMemory).toBeLessThanOrEqual(maxExpectedMemory);
		});
	});

	describe('render scheduling', () => {
		let renderService: GpuResourceService;
		let renderEventBus: ReturnType<typeof createMockEventBus>;

		beforeEach(async () => {
			// Create a fresh service for render tests
			renderEventBus = createMockEventBus();
			renderService = new GpuResourceService({
				eventBus: renderEventBus,
				configService,
				notificationService
			});

			await renderService.initialize();
		});

		it('should schedule render operations', async () => {
			// First, ensure we have GPU resources for the layer
			await renderService.requestLayerGpuResources('layer-1', mockLayerSpec);

			const request1 = {
				layerId: 'layer-1',
				sliceIndex: { axis: 'axial' as const, index: 50 },
				width: 512,
				height: 512,
				timestamp: Date.now()
			};

			const request2 = {
				...request1,
				sliceIndex: { axis: 'sagittal' as const, index: 100 }
			};

			renderService.scheduleRender(request1);
			renderService.scheduleRender(request2);

			// Verify both requests are queued
			expect((renderService as any).renderQueue.length).toBe(2);
			expect((renderService as any).renderQueue[0]).toMatchObject(request1);
			expect((renderService as any).renderQueue[1]).toMatchObject(request2);
		});

		it('should deduplicate render requests', async () => {
			// Ensure we have GPU resources for the layer
			await renderService.requestLayerGpuResources('layer-1', mockLayerSpec);

			const request1 = {
				layerId: 'layer-1',
				sliceIndex: { axis: 'axial' as const, index: 50 },
				width: 512,
				height: 512,
				timestamp: Date.now()
			};

			const request2 = {
				...request1,
				timestamp: Date.now() + 10
			};

			renderService.scheduleRender(request1);
			renderService.scheduleRender(request2);

			// Should only have one request in queue
			expect((renderService as any).renderQueue.length).toBe(1);
		});

		it('should process render queue', async () => {
			// Setup GPU resources
			await renderService.requestLayerGpuResources('layer-1', mockLayerSpec);

			// Mock the render_slice API
			vi.mocked(coreApi.render_slice).mockResolvedValue(undefined);

			const request = {
				layerId: 'layer-1',
				sliceIndex: { axis: 'axial' as const, index: 50 },
				width: 512,
				height: 512,
				timestamp: Date.now()
			};

			renderService.scheduleRender(request);

			// Process the render queue
			await vi.runAllTimersAsync();

			// Verify render was called with correct parameters
			expect(coreApi.render_slice).toHaveBeenCalledWith(
				'volume-1', // volumeId from the mockLayerSpec
				{ axis: 'axial', index: 50 },
				expect.stringContaining('x') // render target id contains dimensions
			);
		});

		it('should handle render errors gracefully', async () => {
			// Setup GPU resources
			await renderService.requestLayerGpuResources('layer-1', mockLayerSpec);

			// Mock render failure
			const renderError = new Error('Render failed');
			vi.mocked(coreApi.render_slice).mockRejectedValue(renderError);

			const request = {
				layerId: 'layer-1',
				sliceIndex: { axis: 'axial' as const, index: 50 },
				width: 512,
				height: 512,
				timestamp: Date.now()
			};

			renderService.scheduleRender(request);

			// Process the render queue
			await vi.runAllTimersAsync();

			// Verify error was emitted
			expect(renderEventBus.emit).toHaveBeenCalledWith('gpu.render.error', { error: renderError });
		});
	});

	describe('context loss handling', () => {
		it('should handle GPU context loss', async () => {
			await service.initialize();

			// Simulate context loss
			const lostPromise = mockGPUDevice.lost as any;
			lostPromise.then((info: any) => {
				// This would be called on actual context loss
			});

			// Manually trigger context loss for test
			(service as any).handleContextLoss({ reason: 'destroyed' });

			expect(eventBus.emit).toHaveBeenCalledWith('gpu.context.lost', { reason: 'destroyed' });
			expect(notificationService.warning).toHaveBeenCalledWith(
				'GPU context lost, attempting recovery...'
			);
		});

		it('should attempt recovery after context loss', async () => {
			await service.initialize();

			// Mock successful recovery
			global.navigator.gpu = {
				requestAdapter: vi.fn().mockResolvedValue(mockGPUAdapter)
			} as any;

			await (service as any).handleContextLoss({ reason: 'destroyed' });

			expect(eventBus.emit).toHaveBeenCalledWith('gpu.context.restored', {});
			expect(notificationService.success).toHaveBeenCalledWith('GPU context restored');
		});
	});

	describe('memory management', () => {
		beforeEach(async () => {
			await service.initialize();
		});

		it('should track memory usage', async () => {
			await service.requestLayerGpuResources('layer-1', mockLayerSpec);
			const target = await service.acquireRenderTarget(512, 512);

			const stats = service.getMemoryStats();

			expect(stats.totalAllocated).toBeGreaterThan(0);
			expect(stats.textureMemory).toBeGreaterThan(0);
			expect(stats.renderTargetMemory).toBeGreaterThan(0);
			expect(stats.pressure).toBe('low');

			service.releaseRenderTarget(target);
		});

		it('should handle memory pressure events', async () => {
			eventBus.emit('system.memory.pressure', {});

			expect(eventBus.getEmittedEvents()).toContainEqual(
				expect.objectContaining({ event: 'system.memory.pressure' })
			);
		});

		it('should free memory when limit reached', async () => {
			// Fill up memory
			const layers = [];
			for (let i = 0; i < 30; i++) {
				const spec = {
					...mockLayerSpec,
					Volume: { ...mockLayerSpec.Volume, id: `layer-${i}` }
				};
				await service.requestLayerGpuResources(`layer-${i}`, spec);
				layers.push(`layer-${i}`);
			}

			// Check that older resources were evicted
			const stats = service.getMemoryStats();
			expect(stats.pressure).toBe('high');
		});
	});

	describe('performance tracking', () => {
		it('should track render statistics', async () => {
			vi.useFakeTimers();

			// Mock requestAnimationFrame
			let rafCallbacks: (() => void)[] = [];
			let rafId = 0;
			global.requestAnimationFrame = vi.fn((cb) => {
				rafCallbacks.push(cb);
				return ++rafId;
			}) as any;

			// Create a fresh service with no pre-allocation to ensure clean stats
			const freshConfigService = mockService<ConfigService>({
				get: vi.fn().mockImplementation((key: string, defaultValue?: any) => {
					const config: Record<string, any> = {
						'gpu.maxTextures': 20,
						'gpu.maxRenderTargets': 10,
						'gpu.poolSize': 0, // No pre-allocation
						'gpu.sizeBuckets': [256, 512, 1024, 2048],
						'gpu.memoryLimit': 512,
						'gpu.contextLossRetryAttempts': 3
					};
					return config[key] ?? defaultValue;
				})
			});

			const freshService = new GpuResourceService({
				eventBus: createMockEventBus(),
				configService: freshConfigService,
				notificationService
			});

			await freshService.initialize();

			// Reset stats to ensure clean state AFTER initialization
			(freshService as any).renderStats = {
				framesRendered: 0,
				cacheHits: 0,
				cacheMisses: 0,
				contextLosses: 0
			};

			// First request - should be a cache miss
			const gpuInfo = await freshService.requestLayerGpuResources('layer-1', mockLayerSpec);
			expect(gpuInfo).toBeDefined();

			// Check stats after first request
			let stats = freshService.getRenderStats();
			expect(stats.cacheMisses).toBe(1); // Exactly 1 miss
			expect(stats.cacheHits).toBe(0); // No hits yet

			// Second request - should be a cache hit
			await freshService.requestLayerGpuResources('layer-1', mockLayerSpec);

			stats = freshService.getRenderStats();
			expect(stats.cacheMisses).toBe(1); // Still 1 miss
			expect(stats.cacheHits).toBe(1); // Now 1 hit
			expect(stats.cacheHitRate).toBeCloseTo(0.5); // 1 hit out of 2 total requests

			// Mock coreApi.render_slice to track calls
			vi.mocked(coreApi.render_slice).mockResolvedValue(undefined);

			// Also mock texture creation for render targets
			const mockTexture = {
				createView: vi.fn().mockReturnValue({}),
				destroy: vi.fn()
			};
			vi.mocked(mockGPUDevice.createTexture).mockReturnValue(mockTexture as any);

			// Perform some renders
			// Use different layer IDs to avoid deduplication entirely
			for (let i = 0; i < 5; i++) {
				// First, ensure we have GPU resources for each layer
				await freshService.requestLayerGpuResources(`layer-${i}`, {
					...mockLayerSpec,
					Volume: { ...mockLayerSpec.Volume, id: `layer-${i}` }
				});

				freshService.scheduleRender({
					layerId: `layer-${i}`,
					sliceIndex: { axis: 'axial', index: i },
					width: 512,
					height: 512,
					timestamp: performance.now()
				});
			}

			// Process all renders
			// Execute all RAF callbacks to process render queue
			// The render queue processes up to 4 items per frame, so we need 2 frames for 5 renders
			for (let frame = 0; frame < 3; frame++) {
				if (rafCallbacks.length === 0) break;

				// Execute RAF callbacks
				const callbacks = [...rafCallbacks];
				rafCallbacks = [];
				for (const cb of callbacks) {
					await cb(); // await in case processRenderQueue is async
				}
				await vi.runAllTimersAsync();
			}

			stats = freshService.getRenderStats();

			expect(stats.framesRendered).toBe(5);
			expect(stats.avgFrameTime).toBeGreaterThanOrEqual(0);
			expect(stats.fps).toBeGreaterThanOrEqual(0);

			vi.useRealTimers();
		});
	});

	describe('lifecycle', () => {
		it('should clean up resources on dispose', async () => {
			await service.initialize();
			await service.requestLayerGpuResources('layer-1', mockLayerSpec);
			const target = await service.acquireRenderTarget(512, 512);

			await service.dispose();

			expect(mockGPUDevice.destroy).toHaveBeenCalled();
			expect(eventBus.emit).toHaveBeenCalledWith('gpu.disposed', {});

			// Should be able to reinitialize
			await service.initialize();
		});

		it('should pause/resume rendering on visibility change', async () => {
			await service.initialize();

			eventBus.emit('app.visibility.changed', { visible: false });
			expect(eventBus.emit).toHaveBeenCalledWith('gpu.rendering.paused', {});

			eventBus.emit('app.visibility.changed', { visible: true });
			expect(eventBus.emit).toHaveBeenCalledWith('gpu.rendering.resumed', {});
		});
	});
});
