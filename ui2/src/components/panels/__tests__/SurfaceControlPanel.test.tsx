import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SurfaceControlPanel } from '@/components/panels/SurfaceControlPanel';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import {
  useSurfaceStore,
  type LoadedSurface,
} from '@/stores/surfaceStore';

vi.mock('@/components/panels/SurfaceGeometryControls', () => ({
  SurfaceGeometryControls: ({ surfaceViewId }: { surfaceViewId: string }) => (
    <div data-testid="geometry-controls">{surfaceViewId}</div>
  ),
}));

vi.mock('@/components/panels/SurfaceDataLayerControls', () => ({
  SurfaceDataLayerControls: ({
    surfaceId,
    layerId,
  }: {
    surfaceId: string;
    layerId: string;
  }) => <div data-testid="data-layer-controls">{`${surfaceId}:${layerId}`}</div>,
}));

vi.mock('@/components/panels/SurfaceDerivedMappingControls', () => ({
  SurfaceDerivedMappingControls: ({
    surfaceId,
    surfaceViewId,
  }: {
    surfaceId: string;
    surfaceViewId?: string | null;
  }) => (
    <div data-testid="derived-mapping-controls">
      {surfaceId}:{surfaceViewId ?? 'no-view'}
    </div>
  ),
}));

function makeSurface(handle: string): LoadedSurface {
  return {
    handle,
    name: handle,
    visible: true,
    geometry: {
      vertices: new Float32Array(0),
      faces: new Uint32Array(0),
      hemisphere: 'left',
      surfaceType: 'pial',
    },
    layers: new Map([
      [
        'layer-1',
        {
          id: 'layer-1',
          name: 'Layer 1',
          values: new Float32Array(0),
          colormap: 'viridis',
          range: [0, 1],
          dataRange: [0, 1],
          opacity: 1,
          visible: true,
        },
      ],
    ]),
    metadata: {
      vertexCount: 0,
      faceCount: 0,
      hemisphere: 'left',
      surfaceType: 'pial',
      path: `templateflow://${handle}`,
    },
  };
}

describe('SurfaceControlPanel', () => {
  beforeEach(() => {
    useSurfaceStore.setState({
      surfaces: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      surfaceViewSettings: new Map(),
      surfaceViewHandles: new Map(),
      surfaceViewSelections: new Map(),
      isLoading: false,
      loadError: null,
      viewpoint: 'lateral',
      showControls: false,
    });
    useActivePanelStore.setState({
      componentType: null,
      componentState: null,
    });
    useActiveRenderContextStore.setState({
      activeId: null,
    });
  });

  it('prefers the active surface render context for geometry controls', () => {
    useSurfaceStore.setState({
      surfaces: new Map([['surface-a', makeSurface('surface-a')]]),
      activeSurfaceId: 'surface-a',
      selectedItemType: 'geometry',
      surfaceViewHandles: new Map([
        ['view-a', 'surface-a'],
        ['view-b', 'surface-a'],
      ]),
      surfaceViewSelections: new Map([
        ['view-a', {
          activeSurfaceId: 'surface-a',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
        ['view-b', {
          activeSurfaceId: 'surface-a',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });
    useActiveRenderContextStore.setState({
      activeId: 'surfaceview:surface-a:view-b',
    });

    render(<SurfaceControlPanel />);

    expect(screen.getByTestId('geometry-controls')).toHaveTextContent('view-b');
  });

  it('follows the focused surface panel even when the compatibility global points elsewhere', () => {
    useSurfaceStore.setState({
      surfaces: new Map([
        ['surface-a', makeSurface('surface-a')],
        ['surface-b', makeSurface('surface-b')],
      ]),
      activeSurfaceId: 'surface-a',
      selectedItemType: 'geometry',
      surfaceViewHandles: new Map([
        ['view-a', 'surface-a'],
        ['view-b', 'surface-b'],
      ]),
      surfaceViewSelections: new Map([
        ['view-a', {
          activeSurfaceId: 'surface-a',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
        ['view-b', {
          activeSurfaceId: 'surface-b',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });
    useActivePanelStore.setState({
      componentType: 'SurfaceView',
      componentState: {
        surfaceViewId: 'view-b',
        surfaceHandle: 'surface-b',
      },
    });

    render(<SurfaceControlPanel />);

    expect(screen.getByTestId('geometry-controls')).toHaveTextContent('view-b');
  });

  it('shows the data layer controls for a selected surface layer', () => {
    useSurfaceStore.setState({
      surfaces: new Map([['surface-a', makeSurface('surface-a')]]),
      activeSurfaceId: 'surface-a',
      surfaceViewHandles: new Map([['view-a', 'surface-a']]),
      surfaceViewSelections: new Map([
        ['view-a', {
          activeSurfaceId: 'surface-a',
          selectedItemType: 'dataLayer',
          selectedLayerId: 'layer-1',
        }],
      ]),
    });

    render(<SurfaceControlPanel />);

    expect(screen.getByTestId('data-layer-controls')).toHaveTextContent('surface-a:layer-1');
  });

  it('shows an explicit empty state when geometry is selected without an active surface view', () => {
    useSurfaceStore.setState({
      surfaces: new Map([['surface-a', makeSurface('surface-a')]]),
      activeSurfaceId: 'surface-a',
      selectedItemType: 'geometry',
      surfaceViewHandles: new Map(),
    });

    render(<SurfaceControlPanel />);

    expect(screen.getByText('No active surface view')).toBeInTheDocument();
  });

  it('routes derived surfaces through the mapping inspector instead of plain geometry controls', () => {
    const surface = makeSurface('surface-a');
    surface.metadata.sourceVolumeId = 'vol-1';
    surface.metadata.mappingOptions = {
      method: 'trilinear',
      projectionDepth: 2,
      smoothingKernel: 1,
    };

    useSurfaceStore.setState({
      surfaces: new Map([['surface-a', surface]]),
      activeSurfaceId: 'surface-a',
      selectedItemType: 'geometry',
      surfaceViewHandles: new Map([['view-a', 'surface-a']]),
      surfaceViewSelections: new Map([
        ['view-a', {
          activeSurfaceId: 'surface-a',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });
    useActiveRenderContextStore.setState({
      activeId: 'surfaceview:surface-a:view-a',
    });

    render(<SurfaceControlPanel />);

    expect(screen.getByText('Derived Surface Controls')).toBeInTheDocument();
    expect(screen.getByTestId('derived-mapping-controls')).toHaveTextContent('surface-a:view-a');
    expect(screen.queryByTestId('geometry-controls')).not.toBeInTheDocument();
  });

  it('does not infer geometry controls from a bound view when no surface view is explicit', () => {
    useSurfaceStore.setState({
      surfaces: new Map([['surface-a', makeSurface('surface-a')]]),
      activeSurfaceId: 'surface-a',
      selectedItemType: 'geometry',
      surfaceViewHandles: new Map([['view-a', 'surface-a']]),
      surfaceViewSelections: new Map([
        ['view-a', {
          activeSurfaceId: 'surface-a',
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });

    render(<SurfaceControlPanel />);

    expect(screen.getByText('No active surface view')).toBeInTheDocument();
    expect(screen.queryByTestId('geometry-controls')).not.toBeInTheDocument();
  });
});
