/**
 * Phase 6c — Inspector STATS summary + Open in Plot affordance.
 *
 * The Inspector renders a "Stats" section per layer kind:
 *   - Volume layers fetch via HistogramService (cached) and show n/min/max/mean/std.
 *   - Surface data layers read mean/std/dataRange directly off the layer object.
 *
 * The "Open in Plot" button writes to `usePlotModeStore`. PlotPanel reads
 * the same store and switches PlotHost into controlled mode, completing the
 * cross-pane handshake.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LayerInspectorContent } from '../LayerInspectorContent';
import { PlotPanel } from '../PlotPanel';
import type { ActiveLayerSummary } from '../inspectorAnnotatePanel.helpers';
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

// AtlasPaletteService is unused by these tests but `LayerInspectorContent`
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

describe('Volume Stats section (6c)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders metadata-derived min/max immediately and fills mean/SD after the histogram resolves', async () => {
    seedVolumeLayer({ id: 'vol-1', name: 'BOLD', type: 'functional' });

    const summary: ActiveLayerSummary = {
      id: 'vol-1',
      name: 'BOLD',
      typeLabel: 'Functional',
      kind: 'volume-3d',
      source: 'file',
    };

    render(<LayerInspectorContent layer={summary} />);

    // Synchronous min/max derived from layerMetadata.dataRange.
    const stats = screen.getByTestId('volume-inspector-stats');
    expect(stats.textContent).toContain('Min');
    expect(stats.textContent).toContain('Max');

    // Mean / SD arrive after the mocked histogram resolves. The volume's
    // dataRange (0–100) yields integer-rounded display via `precisionFor`;
    // mean=42.5 → "43", std=12.7 → "13", n=4096 → "4,096".
    await waitFor(() => {
      expect(stats.textContent).toContain('Mean43');
      expect(stats.textContent).toContain('SD13');
      expect(stats.textContent).toContain('4,096');
    });
  });

  it('uses the histogram-mode "Open in Plot" affordance for 3D volumes', async () => {
    seedVolumeLayer({ id: 'vol-1', name: 'T1w', type: 'anatomical' });

    const summary: ActiveLayerSummary = {
      id: 'vol-1',
      name: 'T1w',
      typeLabel: 'Anatomical',
      kind: 'volume-3d',
      source: 'file',
    };

    render(<LayerInspectorContent layer={summary} />);

    const button = screen.getByTestId('volume-inspector-open-in-plot');
    expect(button.getAttribute('data-target-mode')).toBe('histogram');
    expect(button.textContent).toMatch(/histogram/i);

    await act(async () => {
      fireEvent.click(button);
    });

    expect(usePlotModeStore.getState().activePlotModeId).toBe('histogram');
  });

  it('uses the time-series mode "Open in Plot" affordance for 4D volumes', async () => {
    seedVolumeLayer({
      id: 'vol-1',
      name: 'BOLD',
      type: 'functional',
      timeSeriesInfo: { num_timepoints: 200, tr: 2, temporal_unit: 's', acquisition_time: null },
    });

    const summary: ActiveLayerSummary = {
      id: 'vol-1',
      name: 'BOLD',
      typeLabel: 'Functional',
      kind: 'volume-4d',
      source: 'file',
    };

    render(<LayerInspectorContent layer={summary} />);

    const button = screen.getByTestId('volume-inspector-open-in-plot');
    expect(button.getAttribute('data-target-mode')).toBe('crosshair-time-series');
    expect(button.textContent).toMatch(/time series/i);

    await act(async () => {
      fireEvent.click(button);
    });

    expect(usePlotModeStore.getState().activePlotModeId).toBe('crosshair-time-series');
  });
});

describe('Surface data layer Stats section (6c)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('reads mean / SD / data range directly from the surface data layer', () => {
    const surfaceId = 'surf-1';
    const dataLayerId = 'data-1';
    act(() => {
      useSurfaceStore.setState({
        surfaces: new Map([
          [
            surfaceId,
            {
              handle: surfaceId,
              name: 'lh.pial',
              visible: true,
              geometry: { vertices: new Float32Array(), faces: new Uint32Array() },
              layers: new Map([
                [
                  dataLayerId,
                  {
                    id: dataLayerId,
                    name: 'curvature',
                    values: new Float32Array(2048),
                    colormap: 'viridis',
                    range: [0, 1],
                    dataRange: [-1.5, 1.5],
                    threshold: [0, 0],
                    opacity: 1,
                    mean: 0.12,
                    std: 0.45,
                  },
                ],
              ]) as never,
              metadata: {
                vertexCount: 2048,
                faceCount: 4096,
                hemisphere: 'left',
                surfaceType: 'pial',
                path: '/tmp/test.gii',
              },
            } as never,
          ],
        ]),
        activeSurfaceId: surfaceId,
        selectedItemType: 'dataLayer',
        selectedLayerId: dataLayerId,
        isLoading: false,
        loadError: null,
      });
    });

    const summary: ActiveLayerSummary = {
      id: dataLayerId,
      parentId: surfaceId,
      name: 'curvature',
      typeLabel: 'Surface Data',
      kind: 'surface-data',
      source: 'file',
    };

    render(<LayerInspectorContent layer={summary} />);

    const stats = screen.getByTestId('surface-data-inspector-stats');
    expect(stats.textContent).toContain('0.12'); // mean
    expect(stats.textContent).toContain('0.45'); // std
    expect(stats.textContent).toContain('-1.50'); // min
    expect(stats.textContent).toContain('1.50'); // max
  });
});

describe('PlotPanel ↔ plotModeStore handshake (6c)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('reflects activePlotModeId from the store as the controlled PlotHost mode', async () => {
    // No layer selected — PlotHost still renders, just empty-state. We only
    // care that the toolbar's mode selector reflects the store.
    act(() => {
      usePlotModeStore.getState().setActivePlotMode('crosshair-time-series');
    });

    render(<PlotPanel defaultMode="histogram" />);

    const host = screen.getByTestId('plot-host');
    expect(host.getAttribute('data-mode')).toBe('crosshair-time-series');
  });

  it('falls back to defaultMode when no override is active', () => {
    render(<PlotPanel defaultMode="histogram" />);

    const host = screen.getByTestId('plot-host');
    expect(host.getAttribute('data-mode')).toBe('histogram');
  });

  it('writes back to the store when the user clicks a tab in the host', () => {
    render(<PlotPanel defaultMode="histogram" />);

    const tab = screen.getByTestId('plot-host-mode-crosshair-time-series');
    act(() => {
      fireEvent.click(tab);
    });

    expect(usePlotModeStore.getState().activePlotModeId).toBe('crosshair-time-series');
  });
});
