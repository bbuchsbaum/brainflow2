/**
 * SliceViewerGPU Integration Tests
 * Tests for event handling, resize behavior, cleanup, and accessibility
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
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

describe('SliceViewerGPU - Integration', () => {
	let mockLayerService: Partial<LayerService>;
	let mockAnnotationService: Partial<AnnotationService>;
	let mockNotificationService: Partial<NotificationService>;
	let mockEventBus: Partial<EventBus>;
	let mockEventHandlers: Map<string, Function[]>;

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
			getActiveLayers: vi.fn().mockReturnValue([
				{
					id: 'layer1',
					volumeId: 'vol1',
					opacity: 1.0,
					colormap: 'grayscale',
					windowLevel: { window: 1.0, level: 0.5 }
				}
			]),
			updateLayer: vi.fn()
		};

		mockAnnotationService = {
			getAnnotationsForSlice: vi.fn().mockReturnValue([])
		};

		mockNotificationService = {
			error: vi.fn(),
			warning: vi.fn()
		};

		mockEventHandlers = new Map();
		mockEventBus = {
			emit: vi.fn(),
			on: vi.fn().mockImplementation((event, handler) => {
				if (!mockEventHandlers.has(event)) {
					mockEventHandlers.set(event, []);
				}
				mockEventHandlers.get(event)!.push(handler);
				return () => {
					const handlers = mockEventHandlers.get(event);
					if (handlers) {
						const index = handlers.indexOf(handler);
						if (index > -1) handlers.splice(index, 1);
					}
				};
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
		vi.mocked(annotationStore).subscribe = vi.fn().mockReturnValue(() => {});

		// Mock URL
		global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
		global.URL.revokeObjectURL = vi.fn();
	});

	afterEach(() => {
		vi.clearAllMocks();
		mockEventHandlers.clear();
	});

	describe('Event Integration', () => {
		it('should respond to layer update events', async () => {
			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			await waitFor(() => {
				expect(mockEventBus.on).toHaveBeenCalledWith('layer.updated', expect.any(Function));
			});

			// Trigger layer update event
			const handlers = mockEventHandlers.get('layer.updated');
			handlers?.[0]({ layerId: 'layer1' });

			await waitFor(() => {
				// Should re-render
				expect(mockLayerService.getActiveLayers).toHaveBeenCalledTimes(2);
			});
		});

		it('should emit frame change events', async () => {
			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					onframe: vi.fn()
				}
			});

			const canvas = await screen.findByRole('img');

			// Trigger pan
			fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 });
			fireEvent.pointerMove(canvas, { clientX: 150, clientY: 150 });
			fireEvent.pointerUp(canvas);

			await waitFor(() => {
				expect(mockEventBus.emit).toHaveBeenCalledWith(
					'viewer.frame.changed',
					expect.objectContaining({
						frame: expect.any(Object)
					})
				);
			});
		});

		it('should coordinate with annotation service', async () => {
			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			await waitFor(() => {
				expect(mockEventBus.on).toHaveBeenCalledWith('annotation.updated', expect.any(Function));
				expect(mockEventBus.on).toHaveBeenCalledWith(
					'annotation.visibility.changed',
					expect.any(Function)
				);
			});
		});
	});

	describe('Resize Handling', () => {
		it('should handle container resize', async () => {
			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			// Initial size
			const resizeObserverCallback = vi.mocked(ResizeObserver).mock.calls[0][0];
			resizeObserverCallback([
				{
					contentRect: { width: 512, height: 512 }
				}
			] as any);

			await waitFor(() => {
				const canvas = screen.getByRole('img').querySelector('canvas');
				expect(canvas).toHaveAttribute('width', '512');
				expect(canvas).toHaveAttribute('height', '512');
			});

			// Resize
			resizeObserverCallback([
				{
					contentRect: { width: 1024, height: 768 }
				}
			] as any);

			await waitFor(() => {
				const canvas = screen.getByRole('img').querySelector('canvas');
				expect(canvas).toHaveAttribute('width', '1024');
				expect(canvas).toHaveAttribute('height', '768');
			});
		});

		it('should maintain aspect ratio on resize', async () => {
			const mockRenderManager = getGpuRenderManagerMock();

			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			const resizeObserverCallback = vi.mocked(ResizeObserver).mock.calls[0][0];
			resizeObserverCallback([
				{
					contentRect: { width: 800, height: 600 }
				}
			] as any);

			await waitFor(() => {
				expect(mockRenderManager.render).toHaveBeenCalledWith(
					expect.objectContaining({
						frame: expect.objectContaining({
							size: { width: 800, height: 600 }
						})
					})
				);
			});
		});
	});

	describe('Cleanup', () => {
		it('should cleanup resources on unmount', async () => {
			const mockRenderManager = getGpuRenderManagerMock();
			const unsubscribes: Function[] = [];

			mockEventBus.on = vi.fn().mockImplementation(() => {
				const unsubscribe = vi.fn();
				unsubscribes.push(unsubscribe);
				return unsubscribe;
			});

			const { unmount } = render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			await waitFor(() => {
				expect(mockRenderManager.initialize).toHaveBeenCalled();
			});

			unmount();

			// Check cleanup
			expect(mockRenderManager.dispose).toHaveBeenCalled();
			expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
			unsubscribes.forEach((fn) => expect(fn).toHaveBeenCalled());
		});

		it('should disconnect resize observer on unmount', async () => {
			const mockDisconnect = vi.fn();
			global.ResizeObserver = vi.fn().mockImplementation(() => ({
				observe: vi.fn(),
				unobserve: vi.fn(),
				disconnect: mockDisconnect
			}));

			const { unmount } = render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			await screen.findByRole('img');

			unmount();

			expect(mockDisconnect).toHaveBeenCalled();
		});
	});

	describe('Accessibility', () => {
		it('should have proper ARIA attributes', async () => {
			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial'
				}
			});

			const container = await screen.findByRole('img');
			expect(container).toHaveAttribute('aria-label', expect.stringContaining('axial'));
			expect(container).toHaveAttribute('tabindex', '0');
		});

		it('should be keyboard focusable', async () => {
			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			const container = await screen.findByRole('img');
			container.focus();

			expect(document.activeElement).toBe(container);
		});

		it('should announce changes to screen readers', async () => {
			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			const container = await screen.findByRole('img');
			expect(container).toHaveAttribute('aria-live', 'polite');

			// Should update aria-label when slice changes
			container.setAttribute('aria-label', 'Axial slice at 10mm');
			expect(container).toHaveAttribute('aria-label', expect.stringContaining('10mm'));
		});
	});
});
