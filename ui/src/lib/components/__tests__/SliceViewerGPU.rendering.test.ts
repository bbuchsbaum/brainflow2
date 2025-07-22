/**
 * SliceViewerGPU Rendering Tests
 * Tests for basic rendering, GPU initialization, and visual features
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import SliceViewerGPU from '../SliceViewerGPU.svelte';
import '@testing-library/jest-dom';
import { getService } from '../../di/Container';
import { getEventBus } from '../../events/EventBus';
import { annotationStore } from '../../stores/annotationStore';
import { getGpuRenderManagerMock, resetMockPool } from '../../../test-utils/mocks/mockPool';
import type { LayerService } from '../../services/LayerService';
import type { AnnotationService } from '../../services/AnnotationService';
import type { NotificationService } from '../../services/NotificationService';
import type { EventBus } from '../../events/EventBus';
import type { VolumeMeta } from '../../geometry/types';

// Unmock the component we're testing
vi.unmock('../SliceViewerGPU.svelte');

// Mock dependencies
vi.mock('../../di/Container');
vi.mock('../../events/EventBus');
vi.mock('../../stores/annotationStore');
vi.mock('../../stores/zustandBridge', () => ({
	zustandToReadable: vi.fn((store) => ({
		subscribe: vi.fn((fn) => {
			fn(store.getState());
			return () => {};
		})
	}))
}));
vi.mock('../../gpu/renderManager', () => ({
	GpuRenderManager: vi.fn().mockImplementation(() => getGpuRenderManagerMock())
}));
vi.mock('../annotations/AnnotationRenderer', () => ({
	AnnotationRenderer: vi.fn().mockImplementation(() => ({
		render: vi.fn()
	}))
}));
vi.mock('../../geometry/viewFrameExplicit', () => ({
	screenToWorld: vi.fn((frame, screen) => ({ x: screen.x, y: screen.y, z: 0 })),
	worldToScreen: vi.fn((frame, world) => ({ x: world.x, y: world.y })),
	pan: vi.fn((frame, dx, dy, getVersion) => ({ ...frame, version: getVersion() })),
	zoomAroundPoint: vi.fn((frame, point, factor, getVersion) => ({
		...frame,
		version: getVersion()
	})),
	createFrameVersionGenerator: vi.fn(() => {
		let version = 0;
		return () => version++;
	}),
	makeFrameExplicit: vi.fn((meta, plane, slice, zoom, pan, size, getVersion) => ({
		plane,
		sliceMm: slice,
		zoom,
		pan,
		size,
		version: getVersion()
	}))
}));

describe('SliceViewerGPU - Rendering', () => {
	let mockLayerService: Partial<LayerService>;
	let mockAnnotationService: Partial<AnnotationService>;
	let mockNotificationService: Partial<NotificationService>;
	let mockEventBus: Partial<EventBus>;
	let mockEventUnsubscribes: (() => void)[];

	const mockVolumeMeta: VolumeMeta = {
		dims: { x: 256, y: 256, z: 150 },
		spacing: { x: 1, y: 1, z: 1 },
		origin: { x: -128, y: -128, z: -75 },
		direction: [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1]
		]
	};

	beforeEach(() => {
		// Reset mock pool
		resetMockPool();

		// Create fresh mocks
		mockLayerService = {
			getActiveLayers: vi.fn().mockReturnValue([]),
			updateLayer: vi.fn()
		};

		mockAnnotationService = {
			getAnnotationsForSlice: vi.fn().mockReturnValue([])
		};

		mockNotificationService = {
			error: vi.fn()
		};

		mockEventUnsubscribes = [];
		mockEventBus = {
			emit: vi.fn(),
			on: vi.fn().mockImplementation((event, handler) => {
				const unsubscribe = vi.fn();
				mockEventUnsubscribes.push(unsubscribe);
				return unsubscribe;
			})
		};

		// Mock getService
		vi.mocked(getService).mockImplementation(async (serviceName: string) => {
			switch (serviceName) {
				case 'layerService':
					return mockLayerService as LayerService;
				case 'annotationService':
					return mockAnnotationService as AnnotationService;
				case 'notificationService':
					return mockNotificationService as NotificationService;
				default:
					throw new Error(`Unknown service: ${serviceName}`);
			}
		});

		// Mock getEventBus
		vi.mocked(getEventBus).mockReturnValue(mockEventBus as EventBus);

		// Mock annotation store
		vi.mocked(annotationStore).getState = vi.fn().mockReturnValue({
			annotations: new Map(),
			selectedAnnotationIds: new Set(),
			activeToolMode: 'select'
		});

		// Mock URL
		global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
		global.URL.revokeObjectURL = vi.fn();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('Component Rendering', () => {
		it('should render canvas with loading spinner initially', () => {
			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			const canvas = screen.getByRole('img');
			expect(canvas).toBeInTheDocument();
			expect(canvas).toHaveClass('slice-viewer-canvas');
		});

		it('should display GPU render once initialized', async () => {
			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			await waitFor(() => {
				expect(URL.createObjectURL).toHaveBeenCalled();
			});

			const image = screen.getByRole('img') as HTMLImageElement;
			expect(image.src).toBe('blob:mock-url');
		});

		it('should set canvas dimensions from container size', async () => {
			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			// Trigger resize observer
			const resizeObserverCallback = vi.mocked(ResizeObserver).mock.calls[0][0];
			resizeObserverCallback([
				{
					contentRect: { width: 800, height: 600 }
				}
			] as any);

			await waitFor(() => {
				const canvas = screen.getByRole('img').querySelector('canvas');
				expect(canvas).toHaveAttribute('width', '800');
				expect(canvas).toHaveAttribute('height', '600');
			});
		});
	});

	describe('GPU Rendering', () => {
		it('should initialize GPU render manager', async () => {
			const mockRenderManager = getGpuRenderManagerMock();

			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			await waitFor(() => {
				expect(mockRenderManager.initialize).toHaveBeenCalled();
			});
		});

		it('should render with proper parameters', async () => {
			const mockRenderManager = getGpuRenderManagerMock();

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 10
				}
			});

			await waitFor(() => {
				expect(mockRenderManager.render).toHaveBeenCalledWith(
					expect.objectContaining({
						plane: 'axial',
						sliceMm: 10
					})
				);
			});
		});

		it('should handle GPU render errors', async () => {
			const mockRenderManager = getGpuRenderManagerMock();
			mockRenderManager.render.mockRejectedValueOnce(new Error('GPU error'));

			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			await waitFor(() => {
				expect(mockNotificationService.error).toHaveBeenCalledWith(
					'GPU rendering failed',
					expect.objectContaining({ error: expect.any(Error) })
				);
			});
		});
	});

	describe('Crosshair Rendering', () => {
		it('should render crosshair when enabled', async () => {
			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					showCrosshair: true,
					crosshairWorld: { x: 50, y: 50, z: 50 }
				}
			});

			await waitFor(() => {
				const canvas = screen.getByRole('img');
				expect(canvas).toBeInTheDocument();
			});

			// Crosshair rendering is done through canvas context
			const mockContext = HTMLCanvasElement.prototype.getContext('2d');
			expect(mockContext?.beginPath).toHaveBeenCalled();
			expect(mockContext?.stroke).toHaveBeenCalled();
		});

		it('should not render crosshair when disabled', async () => {
			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					showCrosshair: false
				}
			});

			await waitFor(() => {
				const canvas = screen.getByRole('img');
				expect(canvas).toBeInTheDocument();
			});

			const mockContext = HTMLCanvasElement.prototype.getContext('2d');
			expect(mockContext?.stroke).not.toHaveBeenCalled();
		});
	});

	describe('Performance Features', () => {
		it('should clean up blob URLs', async () => {
			const { unmount } = render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			await waitFor(() => {
				expect(URL.createObjectURL).toHaveBeenCalled();
			});

			unmount();

			expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
		});
	});
});
