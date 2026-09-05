import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SurfaceLoadingService } from '@/services/SurfaceLoadingService';

const {
  mockInvoke,
  mockApplySurfaceSelectionInContext,
  mockEventBusEmit,
  mockEnsureSurfaceView,
  mockFocusSurfacePanel,
  mockCloseSurfaceViewTabs,
  mockQueueState,
  mockSurfaceStoreState,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockApplySurfaceSelectionInContext: vi.fn(),
  mockEventBusEmit: vi.fn(),
  mockEnsureSurfaceView: vi.fn(),
  mockFocusSurfacePanel: vi.fn(),
  mockCloseSurfaceViewTabs: vi.fn(),
  mockQueueState: {
    activeLoads: new Map(),
    isLoading: vi.fn(() => false),
    enqueue: vi.fn(() => 'queue-1'),
    startLoading: vi.fn(),
    updateProgress: vi.fn(),
    markComplete: vi.fn(),
    markError: vi.fn(),
  },
  mockSurfaceStoreState: {
    surfaces: new Map(),
    setLoadingState: vi.fn(),
    addSurface: vi.fn(),
    setSurfaceGeometry: vi.fn(),
    removeSurface: vi.fn(),
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
    closeSurfaceViewTabs: mockCloseSurfaceViewTabs,
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
    mockSurfaceStoreState.surfaces = new Map();
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
    expect(mockQueueState.enqueue).toHaveBeenCalledWith({
      type: 'surface-load',
      path: '/tmp/lh.pial.gii',
      displayName: 'lh.pial.gii',
      retry: {
        kind: 'surface-load',
        path: '/tmp/lh.pial.gii',
        displayName: 'lh.pial.gii',
        autoActivate: true,
        validateMesh: false,
      },
    });
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
    expect(mockFocusSurfacePanel).toHaveBeenCalledTimes(1);
  });

  it('can load template surfaces inline without opening or focusing a standalone surface view', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'load_surface_template') {
        return {
          success: true,
          surface_handle: 'surface-template-inline',
          vertex_count: 3,
          face_count: 1,
          space: 'fsaverage5',
          geometry_type: 'white',
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
    const handle = await service.loadSurfaceTemplate(
      {
        space: 'fsaverage5',
        geometry_type: 'white',
        hemisphere: 'left',
      },
      {
        openViewer: false,
        focusSurfacePanel: false,
      }
    );

    expect(handle).toBe('surface-template-inline');
    expect(mockApplySurfaceSelectionInContext).toHaveBeenCalledWith(
      'surface-template-inline',
      'geometry',
      null,
      null
    );
    expect(mockEnsureSurfaceView).not.toHaveBeenCalled();
    expect(mockFocusSurfacePanel).not.toHaveBeenCalled();
  });

  it('forwards inline placement options to both hemispheres of a bilateral template load', async () => {
    type TemplateInvokeArgs = {
      request?: {
        hemisphere?: string;
      };
    };

    mockInvoke.mockImplementation(async (command: string, args?: TemplateInvokeArgs) => {
      if (command === 'load_surface_template') {
        const hemisphere = args?.request?.hemisphere ?? 'unknown';
        return {
          success: true,
          surface_handle: `surface-template-${hemisphere}`,
          vertex_count: 3,
          face_count: 1,
          space: 'fsaverage5',
          geometry_type: 'white',
          hemisphere,
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
    const result = await service.loadSurfaceTemplateBilateral(
      {
        space: 'fsaverage5',
        geometry_type: 'white',
      },
      {
        openViewer: false,
        focusSurfacePanel: false,
      }
    );

    expect(result).toEqual({
      left: 'surface-template-left',
      right: 'surface-template-right',
    });
    expect(mockEnsureSurfaceView).not.toHaveBeenCalled();
    expect(mockFocusSurfacePanel).not.toHaveBeenCalled();
  });

  it('routes surface unload through the lifecycle queue before removing local state', async () => {
    mockSurfaceStoreState.surfaces = new Map([
      ['surface-1', { handle: 'surface-1', name: 'Left Pial' }],
    ]);
    mockInvoke.mockResolvedValue({ success: true, message: 'ok' });

    const service = new SurfaceLoadingService();
    await service.unloadSurface('surface-1');

    expect(mockQueueState.enqueue).toHaveBeenCalledWith({
      type: 'surface-unload',
      path: 'surface-unload:surface-1',
      displayName: 'Left Pial',
      retry: {
        kind: 'surface-unload',
        surfaceHandle: 'surface-1',
        closeTabs: true,
        notify: true,
      },
    });
    expect(mockQueueState.startLoading).toHaveBeenCalledWith('queue-1');
    expect(mockQueueState.markComplete).toHaveBeenCalledWith('queue-1');
    expect(mockSurfaceStoreState.removeSurface).toHaveBeenCalledWith('surface-1');
    expect(mockCloseSurfaceViewTabs).toHaveBeenCalledWith('surface-1');
  });
  it('unloads provisional geometry without publishing a broken surface', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'load_surface') return { type: 'Surface', handle: 'broken', vertex_count: 3, face_count: 1 };
      if (command === 'get_surface_geometry') throw new Error('Geometry unavailable');
    });
    expect(await new SurfaceLoadingService().loadSurfaceFile({ path: '/broken.gii' })).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('unload_surface', { handle: 'broken' });
    expect(mockSurfaceStoreState.addSurface).not.toHaveBeenCalled();
    expect(mockEnsureSurfaceView).not.toHaveBeenCalled();
  });
});
