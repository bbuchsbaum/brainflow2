/**
 * SliceViewerGPU Interaction Tests
 * Tests for mouse interactions, tool modes, and user input handling
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
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
import type { Annotation } from '../../types/annotations';

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

describe('SliceViewerGPU - Interactions', () => {
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
		} as any
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
			startDragging: vi.fn(),
			updateAnnotationPosition: vi.fn(),
			stopDragging: vi.fn()
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
			isDragging: false,
			draggedAnnotationId: null,
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

	describe('Mouse Interactions', () => {
		it('should handle click events', async () => {
			const handleClick = vi.fn();
			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					onclick: handleClick
				}
			});

			const canvas = await screen.findByRole('img');
			fireEvent.click(canvas, { clientX: 100, clientY: 100 });

			await waitFor(() => {
				expect(handleClick).toHaveBeenCalledWith(
					expect.objectContaining({
						detail: expect.objectContaining({
							world: expect.objectContaining({ x: 100, y: 100, z: 0 })
						})
					})
				);
			});
		});

		it('should handle drag to pan', async () => {
			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			const canvas = await screen.findByRole('img');

			// Start drag
			fireEvent.pointerDown(canvas, {
				clientX: 100,
				clientY: 100,
				button: 0
			});

			// Move
			fireEvent.pointerMove(canvas, {
				clientX: 150,
				clientY: 150
			});

			// End drag
			fireEvent.pointerUp(canvas);

			await waitFor(() => {
				expect(mockEventBus.emit).toHaveBeenCalledWith(
					'viewer.pan',
					expect.objectContaining({ dx: 50, dy: 50 })
				);
			});
		});

		it('should handle wheel zoom', async () => {
			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			const canvas = await screen.findByRole('img');

			fireEvent.wheel(canvas, {
				deltaY: -100,
				clientX: 200,
				clientY: 200
			});

			await waitFor(() => {
				expect(mockEventBus.emit).toHaveBeenCalledWith(
					'viewer.zoom',
					expect.objectContaining({
						factor: expect.any(Number),
						point: expect.objectContaining({ x: 200, y: 200 })
					})
				);
			});
		});

		it('should prevent context menu on right click', async () => {
			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			const canvas = await screen.findByRole('img');
			const contextMenuEvent = new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true
			});

			const preventDefault = vi.spyOn(contextMenuEvent, 'preventDefault');
			canvas.dispatchEvent(contextMenuEvent);

			expect(preventDefault).toHaveBeenCalled();
		});
	});

	describe('Tool Modes', () => {
		it('should handle annotation selection in select mode', async () => {
			mockAnnotationState.activeToolMode = 'select';
			mockAnnotationService.getAnnotationsForSlice = vi.fn().mockReturnValue(mockAnnotations);

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			const canvas = await screen.findByRole('img');

			// Click near the annotation
			fireEvent.click(canvas, { clientX: 5, clientY: 5 });

			await waitFor(() => {
				expect(mockAnnotationService.selectAnnotation).toHaveBeenCalledWith('ann1');
			});
		});

		it('should drag annotations in select mode', async () => {
			mockAnnotationState.activeToolMode = 'select';
			mockAnnotationState.selectedAnnotationIds = new Set(['ann1']);
			mockAnnotationService.getAnnotationsForSlice = vi.fn().mockReturnValue(mockAnnotations);

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			const canvas = await screen.findByRole('img');

			// Start drag on annotation
			fireEvent.pointerDown(canvas, {
				clientX: 5,
				clientY: 5,
				button: 0
			});

			await waitFor(() => {
				expect(mockAnnotationService.startDragging).toHaveBeenCalledWith('ann1');
			});

			// Move
			fireEvent.pointerMove(canvas, {
				clientX: 50,
				clientY: 50
			});

			await waitFor(() => {
				expect(mockAnnotationService.updateAnnotationPosition).toHaveBeenCalled();
			});

			// End drag
			fireEvent.pointerUp(canvas);

			await waitFor(() => {
				expect(mockAnnotationService.stopDragging).toHaveBeenCalled();
			});
		});

		it('should add marker annotation in marker mode', async () => {
			mockAnnotationState.activeToolMode = 'marker';
			vi.mocked(annotationStore).addAnnotation = vi.fn();

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			const canvas = await screen.findByRole('img');
			fireEvent.click(canvas, { clientX: 100, clientY: 100 });

			await waitFor(() => {
				expect(annotationStore.addAnnotation).toHaveBeenCalledWith(
					expect.objectContaining({
						type: 'marker',
						worldCoord: expect.objectContaining({ x: 100, y: 100, z: 0 })
					})
				);
			});
		});

		it('should not interact with annotations when tool mode is not select', async () => {
			mockAnnotationState.activeToolMode = 'marker';
			mockAnnotationService.getAnnotationsForSlice = vi.fn().mockReturnValue(mockAnnotations);

			render(SliceViewerGPU, {
				props: {
					volumeMeta: mockVolumeMeta,
					plane: 'axial',
					sliceMm: 0
				}
			});

			const canvas = await screen.findByRole('img');

			// Click on annotation
			fireEvent.click(canvas, { clientX: 5, clientY: 5 });

			await waitFor(() => {
				expect(mockAnnotationService.selectAnnotation).not.toHaveBeenCalled();
			});
		});
	});

	describe('Keyboard Interactions', () => {
		it('should handle keyboard shortcuts', async () => {
			render(SliceViewerGPU, {
				props: { volumeMeta: mockVolumeMeta }
			});

			await screen.findByRole('img');

			// Test delete key
			fireEvent.keyDown(window, { key: 'Delete' });

			await waitFor(() => {
				expect(mockEventBus.emit).toHaveBeenCalledWith('annotation.delete.selected');
			});
		});
	});
});
