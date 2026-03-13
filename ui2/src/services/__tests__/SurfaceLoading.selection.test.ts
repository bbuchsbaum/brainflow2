import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SurfaceLoadingService } from '@/services/SurfaceLoadingService';

const {
  mockInvoke,
  mockApplySurfaceSelectionInContext,
  mockEventBusEmit,
  mockEnsureSurfaceView,
  mockFocusSurfacePanel,
  mockQueueState,
  mockSurfaceStoreState,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockApplySurfaceSelectionInContext: vi.fn(),
  mockEventBusEmit: vi.fn(),
  mockEnsureSurfaceView: vi.fn(),
  mockFocusSurfacePanel: vi.fn(),
  mockQueueState: {
    isLoading: vi.fn(() => false),
    enqueue: vi.fn(() => 'queue-1'),
    startLoading: vi.fn(),
    updateProgress: vi.fn(),
    markComplete: vi.fn(),
    markError: vi.fn(),
  },
  mockSurfaceStoreState: {
    setLoadingState: vi.fn(),
    addSurface: vi.fn(),
    setSurfaceGeometry: vi.fn(),
  },
}));

vi.mock('@/services/transport', () => ({
  getTransport: () => ({
    invoke: mockInvoke,
  }),
}));

vi.mock('@/utils/surfaceCommandContext', () => ({
  applySurfaceSelectionInContext: mockApplySurfaceSelectionInContext,
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({
    emit: mockEventBusEmit,
  }),
}));

vi.mock('@/services/layoutService', () => ({
  getLayoutService: () => ({
    ensureSurfaceView: mockEnsureSurfaceView,
    focusSurfacePanel: mockFocusSurfacePanel,
  }),
}));

vi.mock('@/stores/loadingQueueStore', () => ({
  useLoadingQueueStore: {
    getState: () => mockQueueState,
  },
}));

vi.mock('@/stores/surfaceStore', () => ({
  useSurfaceStore: {
    getState: () => mockSurfaceStoreState,
  },
}));

describe('SurfaceLoadingService selection routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueState.isLoading.mockReturnValue(false);
    mockQueueState.enqueue.mockReturnValue('queue-1');
  });

  it('activates loaded file surfaces through the shared selection helper without targeting a surface view', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'load_surface') {
        return {
          type: 'Surface',
          handle: 'surface-1',
          vertex_count: 3,
          face_count: 1,
          hemisphere: 'left',
          surface_type: 'pial',
        };
      }
      if (command === 'get_surface_geometry') {
        return {
          vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          faces: [0, 1, 2],
        };
      }
      throw new Error(`Unexpected command ${command}`);
    });

    const service = new SurfaceLoadingService();
    const handle = await service.loadSurfaceFile({
      path: '/tmp/lh.pial.gii',
      autoActivate: true,
      validateMesh: false,
    });

    expect(handle).toBe('surface-1');
    expect(mockSurfaceStoreState.addSurface).toHaveBeenCalledWith(expect.any(Object), false);
    expect(mockApplySurfaceSelectionInContext).toHaveBeenCalledWith('surface-1', 'geometry', null, null);
    expect(mockEnsureSurfaceView).toHaveBeenCalledWith('surface-1', '/tmp/lh.pial.gii');
  });

  it('activates loaded template surfaces through the shared selection helper without targeting a surface view', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'load_surface_template') {
        return {
          success: true,
          surface_handle: 'surface-template-1',
          vertex_count: 3,
          face_count: 1,
          space: 'fsaverage',
          geometry_type: 'pial',
          hemisphere: 'left',
        };
      }
      if (command === 'get_surface_geometry') {
        return {
          vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          faces: [0, 1, 2],
        };
      }
      throw new Error(`Unexpected command ${command}`);
    });

    const service = new SurfaceLoadingService();
    const handle = await service.loadSurfaceTemplate({
      space: 'fsaverage',
      geometry_type: 'pial',
      hemisphere: 'left',
    });

    expect(handle).toBe('surface-template-1');
    expect(mockSurfaceStoreState.addSurface).toHaveBeenCalledWith(expect.any(Object), false);
    expect(mockApplySurfaceSelectionInContext).toHaveBeenCalledWith(
      'surface-template-1',
      'geometry',
      null,
      null
    );
    expect(mockEnsureSurfaceView).toHaveBeenCalledWith(
      'surface-template-1',
      'templateflow://fsaverage_pial_left'
    );
  });
});
