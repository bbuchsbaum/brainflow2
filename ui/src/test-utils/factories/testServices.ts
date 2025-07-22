/**
 * Test Service Factories
 * Creates lightweight service instances for testing
 */
import { EventBus } from '$lib/events/EventBus';
import { Container } from '$lib/di/Container';
import { mockService } from '../mocks/mockService';
import type { LayerService } from '$lib/services/LayerService';
import type { VolumeService } from '$lib/services/VolumeService';
import type { GpuResourceService } from '$lib/services/GpuResourceService';
import type { NotificationService } from '$lib/services/NotificationService';
import type { CrosshairService } from '$lib/services/CrosshairService';
import type { ConfigService } from '$lib/services/ConfigService';
import { vi } from 'vitest';

/**
 * Creates a test-specific EventBus instance
 */
export function createTestEventBus(): EventBus {
	const eventBus = new EventBus();

	// Add debug logging in test mode
	if (process.env.DEBUG_EVENTS) {
		eventBus.on('*', (event: any) => {
			console.log(`[Event] ${event.type}:`, event.data);
		});
	}

	return eventBus;
}

/**
 * Creates a test-specific DI container with mock services
 */
export function createTestContainer(): Container {
	const container = new Container();
	const eventBus = createTestEventBus();

	// Register core services
	container.register('eventBus', eventBus);

	// Register mock services
	container.register('layerService', createMockLayerService(eventBus));
	container.register('volumeService', createMockVolumeService(eventBus));
	container.register('gpuResourceService', createMockGpuResourceService(eventBus));
	container.register('notificationService', createMockNotificationService());
	container.register('crosshairService', createMockCrosshairService(eventBus));
	container.register('configService', createMockConfigService());

	return container;
}

/**
 * Creates a mock LayerService
 */
export function createMockLayerService(eventBus: EventBus): LayerService {
	return mockService<LayerService>({
		addLayer: vi.fn().mockResolvedValue('test-layer-id'),
		removeLayer: vi.fn().mockResolvedValue(undefined),
		updateLayerOpacity: vi.fn().mockImplementation((id, opacity) => {
			eventBus.emit('layer.opacity.changed', { layerId: id, opacity });
			return Promise.resolve();
		}),
		updateLayerVisibility: vi.fn().mockImplementation((id, visible) => {
			eventBus.emit('layer.visibility.changed', { layerId: id, visible });
			return Promise.resolve();
		}),
		selectLayer: vi.fn().mockImplementation((id) => {
			eventBus.emit('layer.selected', { layerId: id });
			return Promise.resolve();
		}),
		getSelectedLayerId: vi.fn().mockReturnValue('test-layer-id'),
		dispose: vi.fn()
	});
}

/**
 * Creates a mock VolumeService
 */
export function createMockVolumeService(eventBus: EventBus): VolumeService {
	return mockService<VolumeService>({
		loadVolume: vi.fn().mockResolvedValue('test-volume-id'),
		unloadVolume: vi.fn().mockResolvedValue(undefined),
		getSliceData: vi.fn().mockResolvedValue({
			data: new Float32Array(256 * 256),
			width: 256,
			height: 256,
			sliceIndex: 0,
			axis: 'axial',
			worldMatrix: new Float32Array(16)
		}),
		worldToVoxel: vi.fn().mockResolvedValue([128, 128, 64]),
		voxelToWorld: vi.fn().mockResolvedValue([0, 0, 0]),
		getVolumeInfo: vi.fn().mockReturnValue({
			id: 'test-volume-id',
			dimensions: [256, 256, 128],
			voxelSize: [1, 1, 1],
			dataRange: [0, 255]
		}),
		dispose: vi.fn()
	});
}

/**
 * Creates a mock GpuResourceService
 */
export function createMockGpuResourceService(eventBus: EventBus): GpuResourceService {
	return mockService<GpuResourceService>({
		initialize: vi.fn().mockResolvedValue(undefined),
		requestLayerGpuResources: vi.fn().mockResolvedValue({
			render_id: 1,
			texture_format: 'rgba8unorm',
			texture_size: [512, 512]
		}),
		releaseLayerGpuResources: vi.fn().mockResolvedValue(undefined),
		acquireRenderTarget: vi.fn().mockResolvedValue({
			texture: {},
			view: {},
			width: 512,
			height: 512,
			format: 'rgba8unorm'
		}),
		releaseRenderTarget: vi.fn(),
		scheduleRender: vi.fn(),
		pauseRendering: vi.fn(),
		resumeRendering: vi.fn(),
		getRenderStats: vi.fn().mockReturnValue({
			framesRendered: 0,
			cacheHits: 0,
			cacheMisses: 0,
			cacheHitRate: 0,
			contextLosses: 0
		}),
		dispose: vi.fn()
	});
}

/**
 * Creates a mock NotificationService
 */
export function createMockNotificationService(): NotificationService {
	return mockService<NotificationService>({
		info: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
		error: vi.fn(),
		dismiss: vi.fn(),
		dismissAll: vi.fn()
	});
}

/**
 * Creates a mock CrosshairService
 */
export function createMockCrosshairService(eventBus: EventBus): CrosshairService {
	return mockService<CrosshairService>({
		setVoxelCoord: vi.fn().mockImplementation((volumeId, coord) => {
			eventBus.emit('crosshair.moved', { volumeId, voxelCoord: coord });
			return Promise.resolve();
		}),
		setWorldCoord: vi.fn().mockImplementation((volumeId, coord) => {
			eventBus.emit('crosshair.moved', { volumeId, worldCoord: coord });
			return Promise.resolve();
		}),
		getVoxelCoord: vi.fn().mockReturnValue([128, 128, 64]),
		getWorldCoord: vi.fn().mockReturnValue([0, 0, 0]),
		linkVolumes: vi.fn(),
		unlinkVolumes: vi.fn(),
		dispose: vi.fn()
	});
}

/**
 * Creates a mock ConfigService
 */
export function createMockConfigService(): ConfigService {
	const config = new Map<string, any>([
		['gpu.maxTextures', 20],
		['gpu.maxRenderTargets', 10],
		['gpu.poolSize', 0], // No pre-allocation in tests
		['gpu.sizeBuckets', [256, 512, 1024, 2048]],
		['gpu.memoryLimit', 512],
		['gpu.contextLossRetryAttempts', 3]
	]);

	return mockService<ConfigService>({
		get: vi.fn().mockImplementation((key: string, defaultValue?: any) => {
			return config.get(key) ?? defaultValue;
		}),
		set: vi.fn().mockImplementation((key: string, value: any) => {
			config.set(key, value);
			return Promise.resolve();
		}),
		getAll: vi.fn().mockReturnValue(Object.fromEntries(config)),
		reset: vi.fn().mockImplementation(() => {
			config.clear();
			return Promise.resolve();
		})
	});
}

/**
 * Test environment setup and cleanup
 */
export interface TestEnvironment {
	eventBus: EventBus;
	container: Container;
	cleanup: () => void;
}

/**
 * Creates a complete test environment
 */
export function createTestEnvironment(): TestEnvironment {
	const eventBus = createTestEventBus();
	const container = createTestContainer();

	// Store references for cleanup
	(globalThis as any).__testEventBus = eventBus;
	(globalThis as any).__testContainer = container;

	const cleanup = () => {
		eventBus.removeAllListeners();
		container.dispose();
		delete (globalThis as any).__testEventBus;
		delete (globalThis as any).__testContainer;
	};

	return { eventBus, container, cleanup };
}
