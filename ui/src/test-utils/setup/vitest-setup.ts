/**
 * Test Setup and Utilities
 * Common setup for component tests
 */
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, vi } from 'vitest';

// Setup fake timers before tests
beforeEach(() => {
	vi.useFakeTimers();
});

// Track blob URLs for cleanup
const createdBlobUrls = new Set<string>();
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

// Override URL methods to track blob URLs
beforeEach(() => {
	URL.createObjectURL = vi.fn((blob) => {
		const url = `blob:mock-url-${Math.random()}`;
		createdBlobUrls.add(url);
		return url;
	});

	URL.revokeObjectURL = vi.fn((url) => {
		createdBlobUrls.delete(url);
	});
});

// Auto cleanup after each test
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();

	// Clean up any leaked blob URLs
	createdBlobUrls.forEach((url) => {
		originalRevokeObjectURL(url);
	});
	createdBlobUrls.clear();

	// Restore URL methods
	URL.createObjectURL = originalCreateObjectURL;
	URL.revokeObjectURL = originalRevokeObjectURL;

	// Force garbage collection if available (V8)
	if (global.gc) {
		global.gc();
	}
});

// Mock window.matchMedia
beforeEach(() => {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: vi.fn().mockImplementation((query) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn()
		}))
	});
});

// Mock ResizeObserver
beforeEach(() => {
	global.ResizeObserver = vi.fn().mockImplementation(() => ({
		observe: vi.fn(),
		unobserve: vi.fn(),
		disconnect: vi.fn()
	}));
});

// Mock IntersectionObserver
beforeEach(() => {
	global.IntersectionObserver = vi.fn().mockImplementation(() => ({
		observe: vi.fn(),
		unobserve: vi.fn(),
		disconnect: vi.fn()
	}));
});

// Mock requestAnimationFrame
beforeEach(() => {
	global.requestAnimationFrame = vi.fn((cb) => {
		setTimeout(cb, 0);
		return 1;
	});
	global.cancelAnimationFrame = vi.fn();
});

// Mock WebGPU API using singleton pool
import { getGpuAdapterMock, resetMockPool } from '../mocks/mockPool';

// Reset singleton instances
function resetSingletons() {
	// Reset EventBus if it exists
	if ((globalThis as any).__eventBus) {
		(globalThis as any).__eventBus.removeAllListeners();
		delete (globalThis as any).__eventBus;
	}

	// Reset DI Container if it exists
	if ((globalThis as any).__container) {
		(globalThis as any).__container = null;
	}

	// Reset any cached stores
	if ((globalThis as any).__stores) {
		(globalThis as any).__stores = new Map();
	}
}

beforeEach(() => {
	// Reset singletons before each test
	resetSingletons();

	// Use singleton GPU mocks from pool
	const mockGPUAdapter = getGpuAdapterMock();

	global.GPUAdapter = {} as any;
	global.GPUDevice = {} as any;

	// Mock WebGPU to prevent real GPU context creation
	global.navigator.gpu = {
		requestAdapter: vi.fn().mockResolvedValue(mockGPUAdapter),
		getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm')
	} as any;
});

// Clean up WebGPU mocks and singletons
afterEach(() => {
	resetMockPool(); // Reset mock functions but keep instances
	resetSingletons(); // Reset singleton instances
	delete (global as any).navigator.gpu;

	// Clear any pending async operations only if timers are mocked
	if (vi.isFakeTimers()) {
		vi.runAllTimers();
	}
});

// Mock Tauri API
beforeEach(() => {
	global.__TAURI__ = {
		invoke: vi.fn().mockResolvedValue({}),
		event: {
			emit: vi.fn(),
			listen: vi.fn().mockResolvedValue(() => {}),
			once: vi.fn().mockResolvedValue(() => {})
		},
		fs: {
			readDir: vi.fn().mockResolvedValue([])
		}
	} as any;
});

// Mock GpuRenderManager globally to prevent GPU initialization in tests
vi.mock('$lib/gpu/renderManager', () => ({
	GpuRenderManager: vi.fn().mockImplementation(() => ({
		initialize: vi.fn().mockResolvedValue(undefined),
		render: vi.fn().mockResolvedValue({
			imageData: new Uint8Array([])
		}),
		destroy: vi.fn()
	}))
}));

// Mock SliceViewerGPU component globally to prevent GPU initialization
vi.mock('$lib/components/SliceViewerGPU.svelte', () => ({
	default: {
		render: () => {
			const div = document.createElement('div');
			div.className = 'mock-slice-viewer-gpu';
			div.textContent = 'Mock SliceViewerGPU';
			return {
				container: div,
				destroy: () => {}
			};
		}
	}
}));

/**
 * Helper to wait for async updates
 */
export function waitFor(ms: number = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to flush promises
 */
export function flushPromises(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Helper to create a mock file
 */
export function createMockFile(
	name: string,
	type: string = 'application/octet-stream',
	size: number = 1024
): File {
	const blob = new Blob(['a'.repeat(size)], { type });
	return new File([blob], name, { type });
}

/**
 * Helper to create a mock drag event
 */
export function createMockDragEvent(type: string, files: File[] = []): DragEvent {
	const dataTransfer = {
		files: files as any as FileList,
		items: files.map((file) => ({
			kind: 'file',
			type: file.type,
			getAsFile: () => file
		})) as any as DataTransferItemList,
		types: ['Files'],
		dropEffect: 'copy' as DataTransferEffect,
		effectAllowed: 'all' as DataTransferEffect,
		clearData: vi.fn(),
		getData: vi.fn(),
		setData: vi.fn(),
		setDragImage: vi.fn()
	};

	return new Event(type, {
		bubbles: true,
		cancelable: true
	}) as DragEvent & { dataTransfer: DataTransfer };
}

/**
 * Helper to mock canvas context
 */
export function createMockCanvasContext() {
	return {
		clearRect: vi.fn(),
		fillRect: vi.fn(),
		strokeRect: vi.fn(),
		fillText: vi.fn(),
		strokeText: vi.fn(),
		measureText: vi.fn().mockReturnValue({ width: 100 }),
		beginPath: vi.fn(),
		closePath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		arc: vi.fn(),
		fill: vi.fn(),
		stroke: vi.fn(),
		save: vi.fn(),
		restore: vi.fn(),
		translate: vi.fn(),
		rotate: vi.fn(),
		scale: vi.fn(),
		setTransform: vi.fn(),
		drawImage: vi.fn(),
		createLinearGradient: vi.fn().mockReturnValue({
			addColorStop: vi.fn()
		}),
		createRadialGradient: vi.fn().mockReturnValue({
			addColorStop: vi.fn()
		}),
		createPattern: vi.fn(),
		getImageData: vi.fn().mockReturnValue({
			data: new Uint8ClampedArray(4),
			width: 1,
			height: 1
		}),
		putImageData: vi.fn()
	};
}

/**
 * Helper to create a mock HTMLCanvasElement
 */
export function createMockCanvas(width: number = 512, height: number = 512): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;

	const ctx = createMockCanvasContext();
	canvas.getContext = vi.fn((type: string) => {
		if (type === '2d') return ctx;
		return null;
	}) as any;

	return canvas;
}
