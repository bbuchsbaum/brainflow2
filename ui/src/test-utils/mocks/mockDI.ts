/**
 * Mock Dependency Injection Container
 * Provides test-friendly DI container for isolating services
 */
import { vi } from 'vitest';
import type { DIContainer, ServiceFactory } from '$lib/di/Container';

export interface MockDIContainer extends DIContainer {
	// Test helpers
	getRegisteredServices(): string[];
	hasService(name: string): boolean;
	clearAll(): void;
	registerMock<T>(name: string, mockInstance: T): void;
}

/**
 * Creates a mock DI container for testing
 */
export function createMockDIContainer(): MockDIContainer {
	const services = new Map<string, any>();
	const factories = new Map<string, ServiceFactory<any>>();
	const resolving = new Set<string>();

	const register = vi.fn(<T>(name: string, factory: ServiceFactory<T>) => {
		factories.set(name, factory);
	});

	const get = vi.fn(async <T>(name: string): Promise<T> => {
		// Return mock if registered
		if (services.has(name)) {
			return services.get(name);
		}

		// Check for circular dependency
		if (resolving.has(name)) {
			throw new Error(`Circular dependency detected: ${name}`);
		}

		// Get factory
		const factory = factories.get(name);
		if (!factory) {
			throw new Error(`Service not registered: ${name}`);
		}

		// Resolve service
		resolving.add(name);
		try {
			const service = await factory(container);
			services.set(name, service);
			return service;
		} finally {
			resolving.delete(name);
		}
	});

	const has = vi.fn((name: string): boolean => {
		return factories.has(name) || services.has(name);
	});

	const clear = vi.fn(() => {
		services.clear();
		factories.clear();
		resolving.clear();
	});

	// Test helpers
	const getRegisteredServices = () => {
		const serviceNames = new Set([...Array.from(services.keys()), ...Array.from(factories.keys())]);
		return Array.from(serviceNames);
	};

	const hasService = (name: string) => has(name);

	const clearAll = () => clear();

	const registerMock = <T>(name: string, mockInstance: T) => {
		services.set(name, mockInstance);
	};

	const container: MockDIContainer = {
		register,
		get,
		has,
		clear,
		getRegisteredServices,
		hasService,
		clearAll,
		registerMock
	};

	return container;
}

/**
 * Helper to set up common mocked services
 */
export function setupMockServices(container: MockDIContainer) {
	// Mock API
	const mockApi = {
		load_file: vi.fn().mockResolvedValue('mock-volume-id'),
		request_layer_gpu_resources: vi.fn().mockResolvedValue({
			textureView: 'mock-texture',
			width: 512,
			height: 512
		}),
		release_view_resources: vi.fn().mockResolvedValue(undefined),
		get_volume_info: vi.fn().mockResolvedValue({
			shape: [256, 256, 100],
			affine: [
				[1, 0, 0, 0],
				[0, 1, 0, 0],
				[0, 0, 1, 0],
				[0, 0, 0, 1]
			],
			dtype: 'f32'
		}),
		sample_world_coordinate: vi.fn().mockResolvedValue({ value: 0.5 }),
		world_to_voxel: vi.fn().mockResolvedValue({ voxel: [128, 128, 50] })
	};

	// Mock EventBus
	const mockEventBus = {
		emit: vi.fn(),
		on: vi.fn().mockReturnValue(() => {}),
		once: vi.fn().mockReturnValue(() => {}),
		off: vi.fn(),
		clear: vi.fn()
	};

	// Mock NotificationService
	const mockNotificationService = {
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
		confirm: vi.fn().mockResolvedValue(true)
	};

	// Mock ConfigService
	const mockConfigService = {
		get: vi.fn().mockImplementation((key: string, defaultValue?: any) => defaultValue),
		set: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		clear: vi.fn().mockResolvedValue(undefined)
	};

	// Register all mocks
	container.registerMock('api', mockApi);
	container.registerMock('eventBus', mockEventBus);
	container.registerMock('notificationService', mockNotificationService);
	container.registerMock('configService', mockConfigService);

	return {
		mockApi,
		mockEventBus,
		mockNotificationService,
		mockConfigService
	};
}

/**
 * Helper to create a test context with DI
 */
export function createTestContext() {
	const container = createMockDIContainer();
	const mocks = setupMockServices(container);

	// Override global getService to use our mock container
	const originalGetService = global.getService;
	global.getService = container.get;

	const cleanup = () => {
		global.getService = originalGetService;
		container.clearAll();
	};

	return {
		container,
		...mocks,
		cleanup
	};
}
