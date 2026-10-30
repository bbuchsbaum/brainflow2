import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SurfaceLoadingService } from '@/services/SurfaceLoadingService';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { collectRenderSurfaces } from '@/components/views/surfaceRenderSurfaces';
import { surfaceGroupKey } from '@/utils/surfaceIdentity';

const { mockInvoke, mockEnsureSurfaceView } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockEnsureSurfaceView: vi.fn(),
}));

vi.mock('@/services/transport', () => ({
  getTransport: () => ({ invoke: mockInvoke }),
}));

vi.mock('@/services/layoutService', () => ({
  getLayoutService: () => ({
    ensureSurfaceView: mockEnsureSurfaceView,
    focusSurfacePanel: vi.fn(),
    closeSurfaceViewTabs: vi.fn(),
  }),
}));

// Mirrors `load_surface_template` in core/api_bridge: the result carries
// display names ("Pial (Gray Matter)", "Left"), not the request tokens.
function backendTemplateResult(hemisphere: 'left' | 'right') {
  return {
    success: true,
    surface_handle: `fsavg5-pial-${hemisphere}`,
    vertex_count: 3,
    face_count: 1,
    space: 'fsaverage5',
    geometry_type: 'Pial (Gray Matter)',
    hemisphere: hemisphere === 'left' ? 'Left' : 'Right',
    error_message: null,
  };
}

describe('template surfaces join their standalone tab scene', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockEnsureSurfaceView.mockReset();
    useSurfaceStore.setState({ surfaces: new Map() });
    useSurfaceStore.getState().setLoadingState(false, null);
    mockInvoke.mockImplementation(async (command: string, args: { request: { hemisphere: 'left' | 'right' } }) => {
      if (command === 'load_surface_template') {
        return backendTemplateResult(args.request.hemisphere);
      }
      if (command === 'get_surface_geometry') {
        return { vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], faces: [0, 1, 2] };
      }
      throw new Error(`Unexpected command ${command}`);
    });
  });

  it('renders both hemispheres in the tab opened for a bilateral fsaverage5 pial load', async () => {
    const service = new SurfaceLoadingService();
    const { left, right } = await service.loadSurfaceTemplateBilateral({
      space: 'fsaverage5',
      geometry_type: 'pial',
    });
    expect(left).toBe('fsavg5-pial-left');
    expect(right).toBe('fsavg5-pial-right');

    // The tab is created from the first ensureSurfaceView call (layoutService
    // derives its pinned groupKey from this path).
    const [tabHandle, tabPath] = mockEnsureSurfaceView.mock.calls[0];
    const tabGroupKey = surfaceGroupKey(tabPath);
    expect(tabGroupKey).not.toBeNull();

    const surfaces = useSurfaceStore.getState().surfaces;
    const rendered = collectRenderSurfaces(surfaces, tabHandle, tabGroupKey);
    expect(rendered.map((surface) => surface.handle)).toEqual([
      'fsavg5-pial-left',
      'fsavg5-pial-right',
    ]);
  });

  it('records the canonical surface type for template surfaces', async () => {
    const service = new SurfaceLoadingService();
    await service.loadSurfaceTemplate({
      space: 'fsaverage5',
      geometry_type: 'pial',
      hemisphere: 'left',
    });
    const surface = useSurfaceStore.getState().surfaces.get('fsavg5-pial-left');
    expect(surface?.geometry.surfaceType).toBe('pial');
    expect(surface?.geometry.hemisphere).toBe('left');
    expect(surface?.metadata?.path).toBe('templateflow://fsaverage5_pial_left');
  });
});
