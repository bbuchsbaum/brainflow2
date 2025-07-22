/**
 * Test setup and utilities
 * Configures testing environment with mocks and helpers
 */
import { vi } from 'vitest';
import { DIContainer } from '$lib/di/Container';
import { EventBus } from '$lib/events/EventBus';
import { ValidationService } from '$lib/validation/ValidationService';
import { getGpuAdapterMock, getGpuDeviceMock } from '@test-utils/mocks/mockPool';

// Mock WebGPU API
export function mockWebGPU() {
	const mockDevice = getGpuDeviceMock();
	const mockAdapter = getGpuAdapterMock();

	const mockGPU = {
		requestAdapter: vi.fn().mockResolvedValue(mockAdapter)
	};

	(global as any).navigator = {
		...global.navigator,
		gpu: mockGPU
	};

	return { mockGPU, mockAdapter, mockDevice };
}

// Mock Tauri API
export function mockTauriAPI() {
	const invoke = vi.fn().mockImplementation((cmd: string, args?: any) => {
		// Default mock responses
		const responses: Record<string, any> = {
			load_file: {
				id: 'mock-volume-id',
				dims: [256, 256, 128],
				voxel_size: [1, 1, 1]
			},
			fs_list_directory: {
				entries: [
					{ name: 'test.nii', is_dir: false },
					{ name: 'data', is_dir: true }
				]
			},
			request_layer_gpu_resources: {
				texture_id: 'mock-texture-id',
				buffer_id: 'mock-buffer-id',
				data_range: { min: 0, max: 255 }
			}
		};

		return Promise.resolve(responses[cmd] || {});
	});

	(global as any).__TAURI__ = {
		invoke
	};

	return { invoke };
}

// Create test container with mocked services
export function createTestContainer(): DIContainer {
	const container = new DIContainer();

	// Mock Event Bus
	container.registerValue('eventBus', new EventBus());

	// Mock Validation Service
	container.registerValue('validator', new ValidationService());

	// Mock API
	container.registerValue('api', {
		load_file: vi.fn().mockResolvedValue({ id: 'test-volume' }),
		fs_list_directory: vi.fn().mockResolvedValue({ entries: [] }),
		request_layer_gpu_resources: vi.fn().mockResolvedValue({
			texture_id: 'test-texture',
			data_range: { min: 0, max: 1 }
		}),
		release_view_resources: vi.fn().mockResolvedValue({}),
		world_to_voxel: vi.fn().mockResolvedValue([0, 0, 0]),
		voxel_to_world: vi.fn().mockResolvedValue([0, 0, 0])
	});

	// Mock GPU Resource Manager
	container.registerValue('gpuResourceManager', {
		init: vi.fn().mockResolvedValue(undefined),
		acquireRenderTarget: vi.fn().mockResolvedValue({
			texture: {},
			view: {},
			width: 512,
			height: 512
		}),
		releaseRenderTarget: vi.fn(),
		getDevice: vi.fn().mockReturnValue({}),
		getStats: vi.fn().mockReturnValue({
			texturesAllocated: 0,
			buffersAllocated: 0,
			totalMemory: 0
		})
	});

	// Mock Render Scheduler
	container.registerValue('renderScheduler', {
		markDirty: vi.fn(),
		isDirty: vi.fn().mockReturnValue(false),
		registerTask: vi.fn(),
		unregisterTask: vi.fn(),
		forceRender: vi.fn()
	});

	return container;
}

// Test utilities for Svelte components
export function createComponentTest() {
	const container = createTestContainer();

	return {
		container,
		eventBus: container.resolve('eventBus'),
		api: container.resolve('api'),

		// Helper to wait for async updates
		async waitForUpdates() {
			await new Promise((resolve) => setTimeout(resolve, 0));
		},

		// Helper to simulate events
		async emitEvent(event: string, data: any) {
			const eventBus = await container.resolve<EventBus>('eventBus');
			eventBus.emit(event, data);
			await this.waitForUpdates();
		},

		// Helper to check if event was emitted
		expectEvent(event: string) {
			const eventBus = container.resolve('eventBus') as EventBus;
			const spy = vi.spyOn(eventBus, 'emit');

			return {
				toHaveBeenCalledWith(data?: any) {
					if (data) {
						expect(spy).toHaveBeenCalledWith(event, data);
					} else {
						expect(spy).toHaveBeenCalledWith(event, expect.anything());
					}
				}
			};
		}
	};
}

// Performance test utilities
export function createPerformanceTest() {
	const measurements: Array<{ name: string; duration: number }> = [];

	return {
		measure(name: string, fn: () => void | Promise<void>) {
			const start = performance.now();
			const result = fn();

			if (result instanceof Promise) {
				return result.then(() => {
					const duration = performance.now() - start;
					measurements.push({ name, duration });
					return duration;
				});
			}

			const duration = performance.now() - start;
			measurements.push({ name, duration });
			return duration;
		},

		assertPerformance(name: string, maxMs: number) {
			const measurement = measurements.find((m) => m.name === name);
			if (!measurement) {
				throw new Error(`No measurement found for "${name}"`);
			}

			expect(measurement.duration).toBeLessThan(maxMs);
		},

		getReport() {
			return measurements.map((m) => `${m.name}: ${m.duration.toFixed(2)}ms`).join('\n');
		}
	};
}

// Mock stores for testing
export function createMockStores() {
	return {
		volumeStore: {
			volumes: new Map(),
			addVolume: vi.fn(),
			removeVolume: vi.fn(),
			getVolume: vi.fn()
		},

		layerStore: {
			layers: [],
			selectedLayerId: null,
			addLayer: vi.fn(),
			updateLayer: vi.fn(),
			removeLayer: vi.fn(),
			selectLayer: vi.fn()
		},

		crosshairStore: {
			worldPosition: [0, 0, 0],
			voxelPosition: [0, 0, 0],
			setWorldPosition: vi.fn(),
			setVoxelPosition: vi.fn()
		}
	};
}

// Visual regression test helper
export function createVisualTest() {
	return {
		async captureScreenshot(element: HTMLElement, name: string) {
			// In real implementation, this would use something like Playwright
			// For now, we'll just mock it
			console.log(`Visual test captured: ${name}`);
			return `screenshots/${name}.png`;
		},

		async compareScreenshots(actual: string, expected: string, threshold = 0.01) {
			// Mock comparison
			console.log(`Comparing ${actual} with ${expected}`);
			return { match: true, diff: 0 };
		}
	};
}
