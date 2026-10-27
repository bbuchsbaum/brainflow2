/**
 * PlotPanel <-> plotModeStore handshake (phase 6c).
 *
 * PlotPanel reads usePlotModeStore and switches PlotHost into controlled mode.
 * Extracted from the former LayerInspectorStats test when the legacy
 * LayerInspectorContent panel (no live importers) was removed.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PlotPanel } from '../PlotPanel';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { usePlotModeStore } from '@/stores/plotModeStore';

// Stub the singleton — its `invoke('plugin:api-bridge|compute_layer_histogram')`
// call has no Tauri runtime in tests. We control the resolved value per test.
vi.mock('@/services/HistogramService', () => {
  return {
    histogramService: {
      computeHistogram: vi.fn().mockResolvedValue({
        bins: [],
        totalCount: 4096,
        minValue: 0,
        maxValue: 100,
        mean: 42.5,
        std: 12.7,
        binCount: 256,
        layerId: 'unused',
      }),
      getSelectedLayerHistogram: vi.fn().mockResolvedValue(null),
      clearCache: vi.fn(),
      clearLayerCache: vi.fn(),
    },
  };
});

// imports it at module load time.
vi.mock('@/services/AtlasPaletteService', () => ({
  AtlasPaletteService: {
    applyToVolumeLayer: vi.fn().mockResolvedValue(undefined),
  },
}));

function resetStores() {
  act(() => {
    useLayerStore.setState({
      layers: [],
      selectedLayerId: null,
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
    useSurfaceStore.setState({
      surfaces: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      isLoading: false,
      loadError: null,
    });
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [];
    });
    usePlotModeStore.getState().resetPlotModeStore();
  });
}

function seedVolumeLayer(layer: Record<string, unknown>) {
  act(() => {
    useLayerStore.setState({
      layers: [layer as never],
      selectedLayerId: (layer as { id: string }).id,
      layerMetadata: new Map([
        [
          (layer as { id: string }).id,
          {
            dataRange: { min: 0, max: 100 },
          } as never,
        ],
      ]),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        {
          id: (layer as { id: string }).id,
          name: (layer as { name: string }).name,
          volumeId: (layer as { id: string }).id,
          visible: true,
          opacity: 1,
          colormap: 'gray',
          intensity: [0, 100],
          threshold: [0, 0],
          interpolation: 'linear',
          order: 0,
        } as never,
      ];
    });
  });
}

describe('PlotPanel ↔ plotModeStore handshake (6c)', () => {
  beforeEach(() => {
    resetStores();
  });

  function selectTimeSeriesLayer() {
    seedVolumeLayer({
      id: 'bold-4d',
      name: 'BOLD',
      type: 'functional',
      timeSeriesInfo: {
        num_timepoints: 200,
        tr: 2,
        temporal_unit: 's',
        acquisition_time: null,
      },
    });
    act(() => {
      useViewStateStore.getState().setViewState((state) => {
        state.crosshair = { world_mm: [0, 0, 0], visible: true };
      });
    });
  }

  it('reflects a supported activePlotModeId from the store as the controlled PlotHost mode', () => {
    selectTimeSeriesLayer();
    act(() => {
      usePlotModeStore.getState().setActivePlotMode('crosshair-time-series');
    });

    render(<PlotPanel defaultMode="histogram" />);

    const host = screen.getByTestId('plot-host');
    expect(host.getAttribute('data-mode')).toBe('crosshair-time-series');
  });

  it('temporarily falls back without a layer and restores the manual mode when supported', () => {
    act(() => {
      usePlotModeStore.getState().setActivePlotMode('crosshair-time-series');
    });

    render(<PlotPanel defaultMode="histogram" />);

    // No layer and no Studio population: nothing is offered (no empty
    // Population tab, P3.11); the manual pick is kept for later.
    expect(screen.getByTestId('plot-host').getAttribute('data-state')).toBe('no-modes');
    expect(usePlotModeStore.getState().activePlotModeId).toBe('crosshair-time-series');
    expect(usePlotModeStore.getState().selectionSource).toBe('user');

    selectTimeSeriesLayer();

    expect(screen.getByTestId('plot-host').getAttribute('data-mode')).toBe('crosshair-time-series');
    expect(usePlotModeStore.getState().activePlotModeId).toBe('crosshair-time-series');
    expect(usePlotModeStore.getState().selectionSource).toBe('user');
  });

  it('falls back to defaultMode when no override is active', () => {
    render(<PlotPanel defaultMode="histogram" />);

    const host = screen.getByTestId('plot-host');
    expect(host.getAttribute('data-mode')).toBe('histogram');
  });

  it('writes back to the store when the user clicks a tab in the host', () => {
    // Tabs are now context-sensitive: seed a 4D layer so the Time Series tab is
    // actually afforded (a 3D volume offers no time series), then click it.
    seedVolumeLayer({
      id: 'bold-4d',
      name: 'BOLD',
      type: 'functional',
      timeSeriesInfo: {
        num_timepoints: 200,
        tr: 2,
        temporal_unit: 's',
        acquisition_time: null,
      },
    });

    render(<PlotPanel defaultMode="histogram" />);

    const tab = screen.getByRole('radio', { name: 'Series' });
    act(() => {
      fireEvent.click(tab);
    });

    expect(usePlotModeStore.getState().activePlotModeId).toBe('crosshair-time-series');
  });
});
