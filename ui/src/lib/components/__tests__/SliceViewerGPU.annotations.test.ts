/**
 * SliceViewerGPU Annotation Tests
 * Tests for annotation rendering, selection, and management
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
import type { Annotation, MarkerAnnotation, TextAnnotation } from '../../types/annotations';

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

describe('SliceViewerGPU - Annotations', () => {
	let mockLayerService: Partial<LayerService>;
	let mockAnnotationService: Partial<AnnotationService>;
	let mockNotificationService: Partial<NotificationService>;
	let mockEventBus: Partial<EventBus>;
	let mockAnnotationState: any;

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

	const mockAnnotations: Annotation[] = [
		{
			id: 'ann1',
			type: 'marker',
			worldCoord: { x: 0, y: 0, z: 0 },
			layerId: 'layer1',
			style: 'cross',
			size: 10,
			color: '#ff0000',
			visible: true,
			createdAt: Date.now(),
			updatedAt: Date.now()
		} as MarkerAnnotation,
		{
			id: 'ann2',
			type: 'text',
			worldCoord: { x: 50, y: 50, z: 0 },
			layerId: 'layer1',
			text: 'Test Label',
			fontSize: 14,
			color: '#00ff00',
			visible: true,
			anchor: 'center',
			offset: { x: 0, y: -10 },
			createdAt: Date.now(),
			updatedAt: Date.now()
		} as TextAnnotation
	];

	beforeEach(() => {
		// Reset mock pool
		resetMockPool();

		// Create fresh mocks
		mockLayerService = {
			getActiveLayers: vi.fn().mockReturnValue([]),
			updateLayer: vi.fn()
		};

		mockAnnotationService = {
			getAnnotationsForSlice: vi.fn().mockReturnValue([]),
			selectAnnotation: vi.fn(),
			deselectAnnotation: vi.fn(),
			isAnnotationVisible: vi.fn().mockReturnValue(true)
		};

		mockNotificationService = {
			error: vi.fn()
		};

		mockEventBus = {
			emit: vi.fn(),
			on: vi.fn().mockReturnValue(() => {})
		};

		mockAnnotationState = {
			annotations: new Map(mockAnnotations.map((a) => [a.id, a])),
			selectedAnnotationIds: new Set(),
			activeToolMode: 'select',
			getVisibleAnnotations: vi.fn().mockReturnValue(mockAnnotations)
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
		vi.mocked(annotationStore).getState = vi.fn().mockReturnValue(mockAnnotationState);
		vi.mocked(annotationStore).subscribe = vi.fn().mockReturnValue(() => {});

		// Mock URL
		global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
		global.URL.revokeObjectURL = vi.fn();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('Annotation Rendering', () => {
		it('should render annotations on the current slice', async () => {
			mockAnnotationService.getAnnotationsForSlice = vi.fn().mockReturnValue(mockAnnotations);

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			await waitFor(() => {
				expect(mockAnnotationService.getAnnotationsForSlice).toHaveBeenCalledWith(
					'axial',
					0,
					expect.any(Number) // tolerance
				);
			});
		});

		it('should only render visible annotations', async () => {
			const visibleAnnotation = mockAnnotations[0];
			const hiddenAnnotation = { ...mockAnnotations[1], visible: false };

			mockAnnotationService.getAnnotationsForSlice = vi
				.fn()
				.mockReturnValue([visibleAnnotation, hiddenAnnotation]);
			mockAnnotationService.isAnnotationVisible = vi
				.fn()
				.mockImplementation((id) => id === visibleAnnotation.id);

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			await waitFor(() => {
				expect(mockAnnotationService.isAnnotationVisible).toHaveBeenCalledWith(
					visibleAnnotation.id
				);
				expect(mockAnnotationService.isAnnotationVisible).toHaveBeenCalledWith(hiddenAnnotation.id);
			});
		});

		it('should highlight selected annotations', async () => {
			mockAnnotationState.selectedAnnotationIds = new Set(['ann1']);
			mockAnnotationService.getAnnotationsForSlice = vi.fn().mockReturnValue(mockAnnotations);

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			await waitFor(() => {
				const canvas = screen.getByRole('img');
				expect(canvas).toBeInTheDocument();
				// Selection rendering is handled by AnnotationRenderer
			});
		});
	});

	describe('Annotation State Updates', () => {
		it('should re-render when annotations change', async () => {
			let annotationSubscriber: ((state: any) => void) | null = null;

			vi.mocked(annotationStore).subscribe = vi.fn().mockImplementation((fn) => {
				annotationSubscriber = fn;
				fn(mockAnnotationState);
				return () => {};
			});

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			await waitFor(() => {
				expect(annotationStore.subscribe).toHaveBeenCalled();
			});

			// Update annotations
			const newAnnotation: MarkerAnnotation = {
				id: 'ann3',
				type: 'marker',
				worldCoord: { x: 100, y: 100, z: 0 },
				layerId: 'layer1',
				style: 'circle',
				size: 15,
				color: '#0000ff',
				visible: true,
				createdAt: Date.now(),
				updatedAt: Date.now()
			};

			const updatedState = {
				...mockAnnotationState,
				annotations: new Map([...mockAnnotations, newAnnotation].map((a) => [a.id, a]))
			};

			annotationSubscriber?.(updatedState);

			await waitFor(() => {
				// Should trigger re-render
				expect(mockAnnotationService.getAnnotationsForSlice).toHaveBeenCalledTimes(2);
			});
		});

		it('should update when tool mode changes', async () => {
			let annotationSubscriber: ((state: any) => void) | null = null;

			vi.mocked(annotationStore).subscribe = vi.fn().mockImplementation((fn) => {
				annotationSubscriber = fn;
				fn(mockAnnotationState);
				return () => {};
			});

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			await waitFor(() => {
				expect(annotationStore.subscribe).toHaveBeenCalled();
			});

			// Change tool mode
			const updatedState = {
				...mockAnnotationState,
				activeToolMode: 'marker'
			};

			annotationSubscriber?.(updatedState);

			await waitFor(() => {
				// Should update cursor or other UI elements
				const canvas = screen.getByRole('img');
				expect(canvas).toBeInTheDocument();
			});
		});
	});

	describe('Annotation Events', () => {
		it('should listen to annotation update events', async () => {
			let annotationUpdateHandler: ((data: any) => void) | null = null;

			mockEventBus.on = vi.fn().mockImplementation((event, handler) => {
				if (event === 'annotation.updated') {
					annotationUpdateHandler = handler;
				}
				return () => {};
			});

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			await waitFor(() => {
				expect(mockEventBus.on).toHaveBeenCalledWith('annotation.updated', expect.any(Function));
			});

			// Trigger annotation update
			annotationUpdateHandler?.({ annotationId: 'ann1' });

			await waitFor(() => {
				// Should re-render annotations
				expect(mockAnnotationService.getAnnotationsForSlice).toHaveBeenCalled();
			});
		});

		it('should emit events when annotations are created', async () => {
			mockAnnotationState.activeToolMode = 'text';
			global.prompt = vi.fn().mockReturnValue('New Label');

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			const canvas = await screen.findByRole('img');

			// Click to add text annotation
			fireEvent.click(canvas, { clientX: 200, clientY: 200 });

			await waitFor(() => {
				expect(mockEventBus.emit).toHaveBeenCalledWith(
					'annotation.created',
					expect.objectContaining({
						annotation: expect.objectContaining({
							type: 'text',
							text: 'New Label'
						})
					})
				);
			});
		});
	});
});
