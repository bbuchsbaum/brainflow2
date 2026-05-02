import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SurfaceDerivedMappingControls } from '@/components/panels/SurfaceDerivedMappingControls';
import { useLayerStore } from '@/stores/layerStore';
import {
  useSurfaceStore,
  type LoadedSurface,
} from '@/stores/surfaceStore';

vi.mock('@/components/panels/SurfaceGeometryControls', () => ({
  SurfaceGeometryControls: ({ surfaceViewId }: { surfaceViewId: string }) => (
    <div data-testid="geometry-controls">{surfaceViewId}</div>
  ),
}));

function makeDerivedSurface(handle: string): LoadedSurface {
  return {
    handle,
    name: 'Mapped Surface',
    visible: true,
    geometry: {
      vertices: new Float32Array(0),
      faces: new Uint32Array(0),
      hemisphere: 'left',
      surfaceType: 'pial',
    },
    layers: new Map(),
    metadata: {
      vertexCount: 0,
      faceCount: 0,
      hemisphere: 'left',
      surfaceType: 'pial',
      path: `derived://${handle}`,
      sourceVolumeId: 'vol-1',
      mappingOptions: {
        method: 'weighted',
        projectionDepth: 3.5,
        smoothingKernel: 1.5,
      },
    },
  };
}

describe('SurfaceDerivedMappingControls', () => {
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
    useLayerStore.setState({
      layers: [],
      selectedLayerId: null,
    });
  });

  it('shows source volume and mapping metadata for a derived surface', () => {
    useSurfaceStore.setState({
      surfaces: new Map([['surface-a', makeDerivedSurface('surface-a')]]),
    });
    useLayerStore.setState({
      layers: [
        {
          id: 'vol-1',
          name: 'Functional Contrast',
          volumeId: 'vol-1',
          type: 'functional',
          visible: true,
          order: 0,
        },
      ],
    });

    render(<SurfaceDerivedMappingControls surfaceId="surface-a" surfaceViewId="view-a" />);

    expect(screen.getByText('Mapped Surface')).toBeInTheDocument();
    expect(screen.getByText('Functional Contrast')).toBeInTheDocument();
    expect(screen.getByText('Weighted')).toBeInTheDocument();
    expect(screen.getByText('3.5 mm')).toBeInTheDocument();
    expect(screen.getByText('1.5')).toBeInTheDocument();
  });

  it('selects the source volume from the mapping context action', () => {
    useSurfaceStore.setState({
      surfaces: new Map([['surface-a', makeDerivedSurface('surface-a')]]),
    });
    useLayerStore.setState({
      layers: [
        {
          id: 'vol-1',
          name: 'Functional Contrast',
          volumeId: 'vol-1',
          type: 'functional',
          visible: true,
          order: 0,
        },
      ],
      selectedLayerId: null,
    });

    render(<SurfaceDerivedMappingControls surfaceId="surface-a" surfaceViewId="view-a" />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Source Volume' }));

    expect(useLayerStore.getState().selectedLayerId).toBe('vol-1');
  });

  it('keeps geometry empty-state guidance available when no view is focused', () => {
    useSurfaceStore.setState({
      surfaces: new Map([['surface-a', makeDerivedSurface('surface-a')]]),
    });
    useLayerStore.setState({
      layers: [
        {
          id: 'vol-1',
          name: 'Functional Contrast',
          volumeId: 'vol-1',
          type: 'functional',
          visible: true,
          order: 0,
        },
      ],
    });

    render(<SurfaceDerivedMappingControls surfaceId="surface-a" />);

    fireEvent.click(screen.getByRole('button', { name: /Geometry/i }));

    expect(screen.getByText('No active surface view')).toBeInTheDocument();
    expect(
      screen.getByText('Focus a surface tab to edit lighting, material, and projection settings for this derived surface.')
    ).toBeInTheDocument();
  });
});
