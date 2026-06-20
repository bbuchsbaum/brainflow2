import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { LayerInspectorContent } from '../LayerInspectorContent';
import { InspectorAnnotatePanel } from '../InspectorAnnotatePanel';
import type { ActiveLayerSummary } from '../inspectorAnnotatePanel.helpers';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';

vi.mock('@/services/HistogramService', () => ({
  histogramService: {
    computeHistogram: vi.fn(() => new Promise(() => {})),
    getSelectedLayerHistogram: vi.fn(() => new Promise(() => {})),
    clearCache: vi.fn(),
    clearLayerCache: vi.fn(),
  },
}));

// AtlasPaletteService.applyToVolumeLayer makes a backend call when invoked. The
// 6b tests never click the palette select (rendering it is enough), but the
// import-time bindings are mocked here as a safety net for future tests.
vi.mock('@/services/AtlasPaletteService', () => ({
  AtlasPaletteService: {
    applyToVolumeLayer: vi.fn().mockResolvedValue(undefined),
  },
}));

function resetLayerStore() {
  act(() => {
    useLayerStore.setState({
      layers: [],
      selectedLayerId: null,
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
  });
}

function resetSurfaceStore() {
  act(() => {
    useSurfaceStore.setState({
      surfaces: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      isLoading: false,
      loadError: null,
    });
  });
}

function resetViewState() {
  act(() => {
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [];
    });
  });
}

function seedVolumeLayer(
  layer: Record<string, unknown>,
  viewStateOverrides: Record<string, unknown> = {},
) {
  act(() => {
    useLayerStore.setState({
      layers: [layer as never],
      selectedLayerId: (layer as { id: string }).id,
      layerMetadata: new Map([
        [
          (layer as { id: string }).id,
          {
            dataRange: { min: 0, max: 100 },
            dimensions: [64, 64, 64],
            spacing: [2, 2, 2],
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
          opacity: 0.8,
          colormap: 'gray',
          intensity: [0, 100],
          threshold: [10, 90],
          interpolation: 'linear',
          order: 0,
          ...viewStateOverrides,
        } as never,
      ];
    });
  });
}

function seedSurface(surfaceId: string, name: string, dataLayer?: { id: string; name: string }) {
  const layers = new Map<string, unknown>();
  if (dataLayer) {
    layers.set(dataLayer.id, {
      id: dataLayer.id,
      name: dataLayer.name,
      values: new Float32Array([0]),
      colormap: 'viridis',
      range: [0, 1],
      dataRange: [0, 1],
      threshold: [0, 0],
      opacity: 1,
    });
  }

  act(() => {
    useSurfaceStore.setState({
      surfaces: new Map([
        [
          surfaceId,
          {
            handle: surfaceId,
            name,
            visible: true,
            geometry: { vertices: new Float32Array(), faces: new Uint32Array() },
            layers: layers as never,
            metadata: {
              vertexCount: 1024,
              faceCount: 2048,
              hemisphere: 'left',
              surfaceType: 'pial',
              path: '/tmp/test.gii',
            },
          } as never,
        ],
      ]),
      activeSurfaceId: surfaceId,
      selectedItemType: dataLayer ? 'dataLayer' : 'geometry',
      selectedLayerId: dataLayer?.id ?? null,
    });
  });
}

describe('LayerInspectorContent — kind dispatch (6b)', () => {
  beforeEach(() => {
    resetLayerStore();
    resetSurfaceStore();
    resetViewState();
  });

  it('renders the volume-3d section for an anatomical layer', () => {
    seedVolumeLayer({ id: 'vol-3d', name: 'T1w', type: 'anatomical' });

    const summary: ActiveLayerSummary = {
      id: 'vol-3d',
      name: 'T1w',
      typeLabel: 'Anatomical',
      kind: 'volume-3d',
      source: 'file',
    };

    render(<LayerInspectorContent layer={summary} />);

    const section = screen.getByTestId('volume-inspector-section');
    expect(section).toBeInTheDocument();
    expect(section.getAttribute('data-four-d')).toBe('false');
    expect(screen.getByTestId('volume-inspector-mapping')).toBeInTheDocument();
    expect(screen.getByTestId('volume-inspector-display')).toBeInTheDocument();
  });

  it('marks the section as 4D when kind is volume-4d (and shows timepoint info)', () => {
    seedVolumeLayer({
      id: 'vol-4d',
      name: 'BOLD run-01',
      type: 'functional',
      timeSeriesInfo: { num_timepoints: 200, tr: 2, temporal_unit: 's', acquisition_time: null },
    });

    const summary: ActiveLayerSummary = {
      id: 'vol-4d',
      name: 'BOLD run-01',
      typeLabel: 'Functional',
      kind: 'volume-4d',
      source: 'file',
    };

    render(<LayerInspectorContent layer={summary} />);

    const section = screen.getByTestId('volume-inspector-section');
    expect(section.getAttribute('data-four-d')).toBe('true');
    expect(screen.getByText(/timepoints/i)).toBeInTheDocument();
  });

  it('renders the atlas section with palette + region info for an atlas layer', () => {
    seedVolumeLayer({
      id: 'atlas-1',
      name: 'AAL',
      type: 'label',
      source: 'atlas',
      atlasMetadata: {
        id: 'aal',
        space: 'mni',
        resolution: '2mm',
        n_regions: 116,
        citation: 'Tzourio-Mazoyer 2002',
      },
    });

    const summary: ActiveLayerSummary = {
      id: 'atlas-1',
      name: 'AAL',
      typeLabel: 'Label',
      kind: 'atlas',
      source: 'atlas',
    };

    render(<LayerInspectorContent layer={summary} />);

    expect(screen.getByTestId('atlas-inspector-section')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-inspector-palette')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-inspector-citation').textContent).toMatch(/Tzourio/);
    // Volume section must NOT render for atlas.
    expect(screen.queryByTestId('volume-inspector-section')).toBeNull();
  });

  it('renders the surface-geometry section for a surface kind', () => {
    seedSurface('surf-1', 'lh.pial');

    const summary: ActiveLayerSummary = {
      id: 'surf-1',
      name: 'lh.pial',
      typeLabel: 'Surface',
      kind: 'surface',
      source: 'file',
    };

    render(<LayerInspectorContent layer={summary} />);

    expect(screen.getByTestId('surface-inspector-section')).toBeInTheDocument();
    expect(screen.queryByTestId('volume-inspector-section')).toBeNull();
  });

  it('renders the surface-data section for a data layer pinned to a surface', () => {
    seedSurface('surf-1', 'lh.pial', { id: 'data-1', name: 'curvature' });

    const summary: ActiveLayerSummary = {
      id: 'data-1',
      parentId: 'surf-1',
      name: 'curvature',
      typeLabel: 'Surface Data',
      kind: 'surface-data',
      source: 'file',
    };

    render(<LayerInspectorContent layer={summary} />);

    expect(screen.getByTestId('surface-data-inspector-section')).toBeInTheDocument();
    expect(screen.getByTestId('surface-data-inspector-mapping')).toBeInTheDocument();
  });

  // ---- AC#4 regression ----------------------------------------------------
  it('does NOT render histogram or intensity-range controls (AC#4 regression)', () => {
    seedVolumeLayer({ id: 'vol-3d', name: 'T1w', type: 'anatomical' });

    const summary: ActiveLayerSummary = {
      id: 'vol-3d',
      name: 'T1w',
      typeLabel: 'Anatomical',
      kind: 'volume-3d',
      source: 'file',
    };

    render(<LayerInspectorContent layer={summary} />);

    // Plot pane owns the histogram and the intensity-range scrubber. The
    // inspector body must not duplicate either.
    expect(screen.queryByTestId('histogram-plot')).toBeNull();
    expect(screen.queryByTestId('histogram-canvas')).toBeNull();
    expect(screen.queryByText(/intensity window/i)).toBeNull();
    expect(screen.queryByText(/intensity range/i)).toBeNull();
    // But threshold and blend-mode WERE asked for — sanity-check they render.
    expect(screen.getByText(/threshold/i)).toBeInTheDocument();
    expect(screen.getByTestId('layer-inspector-blend-nearest')).toBeInTheDocument();
    expect(screen.getByTestId('layer-inspector-blend-linear')).toBeInTheDocument();
  });

  it.each([
    ['alpha', false],
    ['max', true],
    ['min', true],
  ])(
    'sets Alpha controls from Inspector blend mode "%s"',
    (blendMode, shouldDisable) => {
      seedVolumeLayer(
        { id: `vol-${blendMode}`, name: 'T1w', type: 'anatomical' },
        {
          blendMode,
          alphaMod: { mode: 'linear', gamma: 1, center: 0 },
        },
      );

      const summary: ActiveLayerSummary = {
        id: `vol-${blendMode}`,
        name: 'T1w',
        typeLabel: 'Anatomical',
        kind: 'volume-3d',
        source: 'file',
      };

      render(<LayerInspectorContent layer={summary} />);

      for (const testId of [
        'alpha-mod-off',
        'alpha-mod-linear',
        'alpha-mod-gamma',
      ]) {
        const button = screen.getByTestId(testId);
        if (shouldDisable) {
          expect(button).toBeDisabled();
        } else {
          expect(button).not.toBeDisabled();
        }
      }
    },
  );
});

describe('LayerInspectorContent — wired into the InspectorAnnotatePanel shell', () => {
  beforeEach(() => {
    resetLayerStore();
    resetSurfaceStore();
    resetViewState();
  });

  it('replaces the placeholder body with kind-specific content when a volume is selected', () => {
    seedVolumeLayer({ id: 'vol-1', name: 'T1w', type: 'anatomical' });

    render(<InspectorAnnotatePanel />);

    // Wrapper testid stays — 6a's contract holds.
    expect(screen.getByTestId('inspector-content-placeholder')).toBeInTheDocument();
    // But it now contains the volume section instead of placeholder text.
    expect(screen.getByTestId('volume-inspector-section')).toBeInTheDocument();
  });

  it('falls back to the active surface when no volume layer is selected', () => {
    seedSurface('surf-1', 'lh.pial');

    render(<InspectorAnnotatePanel />);

    expect(screen.getByTestId('inspector-content-placeholder').getAttribute('data-layer-kind')).toBe(
      'surface',
    );
    expect(screen.getByTestId('surface-inspector-section')).toBeInTheDocument();
  });
});
