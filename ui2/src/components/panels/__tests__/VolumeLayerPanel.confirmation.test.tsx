import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VolumeLayerPanel } from '../VolumeLayerPanel';

const {
  mockRemoveLayer,
  mockConfirmVolumeLayerRemoval,
} = vi.hoisted(() => ({
  mockRemoveLayer: vi.fn(),
  mockConfirmVolumeLayerRemoval: vi.fn(),
}));

const layerState = vi.hoisted(() => ({
  layers: [
    {
      id: 'layer-1',
      name: 'Layer One',
      type: 'label',
      source: 'atlas',
      sourcePath: '/tmp/layer.nii.gz',
      visible: true,
      volumeId: 'vol-1',
      order: 0,
    },
  ],
  selectedLayerId: 'layer-1',
  selectedLayer: {
    id: 'layer-1',
    name: 'Layer One',
    type: 'label',
    source: 'atlas',
    sourcePath: '/tmp/layer.nii.gz',
    visible: true,
    volumeId: 'vol-1',
    order: 0,
  },
  viewLayers: [
    {
      id: 'layer-1',
      name: 'Layer One',
      opacity: 1,
      intensity: [0, 100] as [number, number],
      threshold: [0, 100] as [number, number],
      colormap: 'gray',
      interpolation: 'linear' as const,
      visible: true,
      volumeId: 'vol-1',
      order: 0,
    },
  ],
}));

vi.mock('@/services/ConfirmationService', () => ({
  getConfirmationService: () => ({
    confirmVolumeLayerRemoval: mockConfirmVolumeLayerRemoval,
  }),
}));

vi.mock('@/stores/layerStore', () => ({
  useLayers: () => layerState.layers,
  useSelectedLayerId: () => layerState.selectedLayerId,
  useSelectedLayer: () => layerState.selectedLayer,
  layerSelectors: {
    getLayerMetadata: () => undefined,
  },
  useLayer: () => undefined,
  useLayerStore: (
    selector: (state: {
      selectLayer: (layerId: string) => void;
      layers: typeof layerState.layers;
      getLayerMetadata: (id: string) => undefined;
    }) => unknown
  ) =>
    selector({
      selectLayer: vi.fn(),
      layers: layerState.layers,
      getLayerMetadata: () => undefined,
    }),
}));

vi.mock('@/stores/viewStateStore', () => {
  const storeFn = ((selector: (state: { viewState: { layers: typeof layerState.viewLayers } }) => unknown) =>
    selector({ viewState: { layers: layerState.viewLayers } })) as (
      selector: (state: { viewState: { layers: typeof layerState.viewLayers } }) => unknown
    ) => unknown;

  return {
    useViewStateStore: Object.assign(storeFn, {
      getState: () => ({
        viewState: { layers: layerState.viewLayers },
        setViewState: vi.fn(),
      }),
    }),
  };
});

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: (selector: (state: { activeWorkspaceId: string | null }) => string | null) =>
    selector({ activeWorkspaceId: 'ws-1' }),
}));

vi.mock('@/services/LayerService', () => ({
  getLayerService: () => ({
    toggleVisibility: vi.fn(),
    reorderLayers: vi.fn(),
    removeLayer: mockRemoveLayer,
  }),
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock('@/hooks/useLayerPanelServices', () => ({
  useLayerPanelServices: () => ({
    isInitialized: true,
    error: null,
  }),
}));

vi.mock('@/hooks/useMetadataShortcut', () => ({
  useMetadataShortcut: () => undefined,
}));

vi.mock('@/components/ui/LayerTable', () => ({
  LayerTable: ({ onRemove }: { onRemove?: (layerId: string) => void }) => (
    <button type="button" onClick={() => onRemove?.('layer-1')}>
      Remove Mock Layer
    </button>
  ),
}));

vi.mock('@/components/panels/LayerPropertiesManager', () => ({
  LayerPropertiesManager: () => <div data-testid="layer-properties-manager" />,
}));

vi.mock('@/components/panels/LayerEmptyState', () => ({
  LayerEmptyState: () => <div data-testid="layer-empty-state" />,
}));

vi.mock('@/components/panels/LayerStatusBar', () => ({
  LayerStatusBar: () => <div data-testid="layer-status-bar" />,
}));

vi.mock('@/components/panels/PlotPanel', () => ({
  PlotPanel: () => <div data-testid="plot-panel" />,
}));

vi.mock('@/components/common/PanelErrorBoundary', () => ({
  PanelErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/MetadataDrawer', () => ({
  MetadataDrawer: () => null,
}));

describe('VolumeLayerPanel removal confirmation', () => {
  beforeEach(() => {
    mockRemoveLayer.mockReset();
    mockConfirmVolumeLayerRemoval.mockReset();
    mockRemoveLayer.mockResolvedValue(undefined);
    mockConfirmVolumeLayerRemoval.mockResolvedValue(true);
    window.localStorage.clear();
  });

  it('routes removal through the confirmation service', async () => {
    render(<VolumeLayerPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Mock Layer' }));

    await waitFor(() => {
      expect(mockConfirmVolumeLayerRemoval).toHaveBeenCalledWith('Layer One');
      expect(mockRemoveLayer).toHaveBeenCalledWith('layer-1');
    });
  });

  it('does not remove the layer when confirmation is declined', async () => {
    mockConfirmVolumeLayerRemoval.mockResolvedValue(false);

    render(<VolumeLayerPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Mock Layer' }));

    await waitFor(() => {
      expect(mockConfirmVolumeLayerRemoval).toHaveBeenCalledWith('Layer One');
    });
    expect(mockRemoveLayer).not.toHaveBeenCalled();
  });
});
