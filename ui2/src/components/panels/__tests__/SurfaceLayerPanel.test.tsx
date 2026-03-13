import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SurfaceLayerPanel } from '@/components/panels/SurfaceLayerPanel';
import {
  useSurfaceStore,
  type LoadedSurface,
} from '@/stores/surfaceStore';

const {
  requestSurfaceFileSelection,
  unloadSurface,
  requestOverlayFileSelection,
  removeSurfaceDataLayer,
  confirmSurfaceRemoval,
  confirmSurfaceLayerRemoval,
} = vi.hoisted(() => ({
  requestSurfaceFileSelection: vi.fn(),
  unloadSurface: vi.fn(),
  requestOverlayFileSelection: vi.fn(),
  removeSurfaceDataLayer: vi.fn(),
  confirmSurfaceRemoval: vi.fn(),
  confirmSurfaceLayerRemoval: vi.fn(),
}));

vi.mock('@/services/SurfaceLoadingService', () => ({
  getSurfaceLoadingService: () => ({
    requestSurfaceFileSelection,
    unloadSurface,
  }),
}));

vi.mock('@/services/SurfaceOverlayService', () => ({
  surfaceOverlayService: {
    requestOverlayFileSelection,
    removeSurfaceDataLayer,
  },
}));

vi.mock('@/services/ConfirmationService', () => ({
  getConfirmationService: () => ({
    confirmSurfaceRemoval,
    confirmSurfaceLayerRemoval,
  }),
}));

vi.mock('@/components/ui/SurfaceMetadataDrawer', () => ({
  SurfaceMetadataDrawer: () => <div data-testid="surface-metadata-drawer" />,
}));

vi.mock('@/components/panels/SurfaceControlPanel', () => ({
  SurfaceControlPanel: () => <div data-testid="surface-control-panel" />,
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
    layers: new Map(),
    metadata: {
      vertexCount: 0,
      faceCount: 0,
      hemisphere: 'left',
      surfaceType: 'pial',
      path: `templateflow://${handle}`,
    },
  };
}

function makeSurfaceWithLayer(handle: string): LoadedSurface {
  const surface = makeSurface(handle);
  surface.layers = new Map([
    ['layer-1', {
      id: 'layer-1',
      name: 'Layer 1',
      values: new Float32Array(0),
      colormap: 'viridis',
      range: [0, 1],
      dataRange: [0, 1],
      opacity: 1,
      visible: true,
    }],
  ]);
  return surface;
}

describe('SurfaceLayerPanel', () => {
  beforeEach(() => {
    requestSurfaceFileSelection.mockReset();
    unloadSurface.mockReset();
    requestOverlayFileSelection.mockReset();
    removeSurfaceDataLayer.mockReset();
    confirmSurfaceRemoval.mockReset();
    confirmSurfaceLayerRemoval.mockReset();
    unloadSurface.mockResolvedValue(undefined);
    removeSurfaceDataLayer.mockResolvedValue(undefined);
    confirmSurfaceRemoval.mockResolvedValue(true);
    confirmSurfaceLayerRemoval.mockResolvedValue(true);
    useSurfaceStore.setState({
      surfaces: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      isLoading: false,
      loadError: null,
      surfaceViewSettings: new Map(),
      surfaceViewHandles: new Map(),
      surfaceViewSelections: new Map(),
    });
  });

  it('routes the primary load action through the surface loading service', () => {
    render(<SurfaceLayerPanel />);

    fireEvent.click(screen.getByTitle('Load surface file'));

    expect(requestSurfaceFileSelection).toHaveBeenCalledTimes(1);
  });

  it('routes add-layer actions through the overlay selection service for the chosen surface', () => {
    useSurfaceStore.setState({
      surfaces: new Map([['surface-1', makeSurface('surface-1')]]),
    });

    render(<SurfaceLayerPanel />);

    fireEvent.click(screen.getByTitle('Add Data Layer'));

    expect(requestOverlayFileSelection).toHaveBeenCalledWith('surface-1');
  });

  it('routes surface removal through the confirmation service', async () => {
    useSurfaceStore.setState({
      surfaces: new Map([['surface-1', makeSurface('surface-1')]]),
    });

    render(<SurfaceLayerPanel />);

    fireEvent.click(screen.getByTitle('Remove Surface'));

    await waitFor(() => {
      expect(confirmSurfaceRemoval).toHaveBeenCalledWith('surface-1');
      expect(unloadSurface).toHaveBeenCalledWith('surface-1');
    });
  });

  it('routes layer removal through the confirmation service', async () => {
    useSurfaceStore.setState({
      surfaces: new Map([['surface-1', makeSurfaceWithLayer('surface-1')]]),
    });

    render(<SurfaceLayerPanel />);

    fireEvent.click(screen.getAllByTitle('Expand')[0]);
    fireEvent.click(screen.getByTitle('Remove Layer'));

    await waitFor(() => {
      expect(confirmSurfaceLayerRemoval).toHaveBeenCalledWith('Layer 1');
      expect(removeSurfaceDataLayer).toHaveBeenCalledWith('surface-1', 'layer-1');
    });
  });
});
