/**
 * Helpers for `InspectorAnnotatePanel` (Phases 6a + 6b of the integrated
 * workspace refactor). Lives in its own file so the React component file
 * can satisfy the `react-refresh/only-export-components` invariant.
 *
 * The shell (6a) needs a small reactive summary of the active inspector
 * target: id, name, classification, and source. The content sections (6b)
 * additionally need a stable render-update callback for volume layers.
 *
 * Surface support: `useActiveLayerSummary` falls back to the active surface
 * when no volume layer is selected. Priority is volume → surface, since
 * that is how `selectedLayerId` is wired in `layerStore` and how the
 * existing volume-side IA expects selection to flow.
 */

import { useCallback, useEffect, useState } from 'react';

import { useLayerStore } from '@/stores/layerStore';
import { usePlotModeStore } from '@/stores/plotModeStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getEventBus } from '@/events/EventBus';
import { histogramService } from '@/services/HistogramService';
import type { HistogramData } from '@/types/histogram';
import type { LayerRender } from '@/types/layers';

/** Modes the shell exposes via the top toggle. Annotate is a *task mode*, not a data-type tab. */
export type InspectorAnnotateMode = 'inspector' | 'annotate';

/**
 * Coarse classification of the active inspector target. Drives content
 * dispatch in `LayerInspectorContent` (6b).
 */
export type ActiveLayerKind =
  | 'atlas'
  | 'volume-4d'
  | 'volume-3d'
  | 'surface'
  | 'surface-data';

export interface ActiveLayerSummary {
  readonly id: string;
  readonly name: string;
  /** Underlying classification from `Layer.type` or surface item type. */
  readonly typeLabel: string;
  /** Coarse classification used for shell-level + content-level UX decisions. */
  readonly kind: ActiveLayerKind;
  /** Logical source if known: file/template/atlas/other. */
  readonly source: 'file' | 'template' | 'atlas' | 'other' | null;
  /** For `surface-data` only: the parent surface handle. */
  readonly parentId?: string;
}

function classifyVolumeLayer(
  layerType: string | undefined,
  isAtlas: boolean,
  isFourD: boolean,
): ActiveLayerKind {
  if (isAtlas) return 'atlas';
  if (isFourD) return 'volume-4d';
  return 'volume-3d';
  void layerType;
}

const TYPE_LABEL_MAP: Record<string, string> = {
  anatomical: 'Anatomical',
  functional: 'Functional',
  mask: 'Mask',
  label: 'Label',
};

/**
 * Reactive selector hook: returns a summary of the currently selected
 * inspector target (volume layer first, surface as fallback), or `null`
 * when nothing is selected. Re-renders the consumer only when one of the
 * summary fields changes — primitive fields are subscribed individually
 * because Zustand v5 has no equality argument and a composite-object
 * selector would loop infinitely.
 */
export function useActiveLayerSummary(): ActiveLayerSummary | null {
  // ---- Volume side ----------------------------------------------------------
  const selectedLayerId = useLayerStore((state) => state.selectedLayerId);
  const layerName = useLayerStore((state) =>
    state.selectedLayerId
      ? state.layers.find((l) => l.id === state.selectedLayerId)?.name
      : undefined,
  );
  const layerType = useLayerStore((state) =>
    state.selectedLayerId
      ? state.layers.find((l) => l.id === state.selectedLayerId)?.type
      : undefined,
  );
  const layerSource = useLayerStore((state) => {
    if (!state.selectedLayerId) return null;
    const layer = state.layers.find((l) => l.id === state.selectedLayerId) as
      | { source?: 'file' | 'template' | 'atlas' | 'other' }
      | undefined;
    return layer?.source ?? null;
  });
  const isFourD = useLayerStore((state) => {
    if (!state.selectedLayerId) return false;
    const layer = state.layers.find((l) => l.id === state.selectedLayerId) as
      | { timeSeriesInfo?: { num_timepoints: number } }
      | undefined;
    const ts = layer?.timeSeriesInfo;
    return Boolean(ts && ts.num_timepoints >= 2);
  });
  const isAtlas = useLayerStore((state) => {
    if (!state.selectedLayerId) return false;
    const layer = state.layers.find((l) => l.id === state.selectedLayerId) as
      | { source?: string; atlasMetadata?: unknown }
      | undefined;
    return layer?.source === 'atlas' || Boolean(layer?.atlasMetadata);
  });

  // ---- Surface side (fallback) ---------------------------------------------
  const activeSurfaceId = useSurfaceStore((state) => state.activeSurfaceId);
  const surfaceItemType = useSurfaceStore((state) => state.selectedItemType);
  const surfaceDataLayerId = useSurfaceStore((state) => state.selectedLayerId);
  const surfaceName = useSurfaceStore((state) => {
    if (!state.activeSurfaceId) return undefined;
    return state.surfaces.get(state.activeSurfaceId)?.name;
  });
  const surfaceDataLayerName = useSurfaceStore((state) => {
    if (
      state.selectedItemType !== 'dataLayer' ||
      !state.activeSurfaceId ||
      !state.selectedLayerId
    ) {
      return undefined;
    }
    return state.surfaces
      .get(state.activeSurfaceId)
      ?.layers.get(state.selectedLayerId)?.name;
  });

  if (selectedLayerId && layerName) {
    return {
      id: selectedLayerId,
      name: layerName,
      typeLabel: layerType ? TYPE_LABEL_MAP[layerType] ?? layerType : 'Layer',
      kind: classifyVolumeLayer(layerType, isAtlas, isFourD),
      source: layerSource,
    };
  }

  if (activeSurfaceId && surfaceName) {
    if (
      surfaceItemType === 'dataLayer' &&
      surfaceDataLayerId &&
      surfaceDataLayerName
    ) {
      return {
        id: surfaceDataLayerId,
        parentId: activeSurfaceId,
        name: surfaceDataLayerName,
        typeLabel: 'Surface Data',
        kind: 'surface-data',
        source: 'file',
      };
    }
    return {
      id: activeSurfaceId,
      name: surfaceName,
      typeLabel: 'Surface',
      kind: 'surface',
      source: 'file',
    };
  }

  return null;
}

/**
 * Returns a stable callback that applies a `Partial<LayerRender>` to the
 * given volume layer in `viewStateStore` and emits the standard
 * `layer.render.changed` event.
 *
 * Mirrors the change-detection logic from `VolumeLayerPanel.handleRenderUpdate`
 * but trimmed to the fields the Inspector touches: opacity, colormap,
 * threshold, interpolation, and atlas-palette fields.
 */
export function useLayerRenderUpdater(layerId: string | null) {
  return useCallback(
    (updates: Partial<LayerRender>) => {
      if (!layerId) return;

      let didChange = false;

      useViewStateStore.getState().setViewState((state) => {
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer) return;

        if (updates.opacity !== undefined && !Object.is(layer.opacity, updates.opacity)) {
          layer.opacity = updates.opacity;
          layer.visible = updates.opacity > 0;
          didChange = true;
        }

        if (updates.colormap && layer.colormap !== updates.colormap) {
          layer.colormap = updates.colormap;
          (layer as unknown as { colormapId?: number }).colormapId = undefined;
          didChange = true;
        }

        if (updates.threshold) {
          let [low, high] = updates.threshold;
          if (low > high) [low, high] = [high, low];
          const current = layer.threshold;
          if (!current || current[0] !== low || current[1] !== high) {
            layer.threshold = [low, high];
            didChange = true;
          }
        }

        if (updates.interpolation && layer.interpolation !== updates.interpolation) {
          layer.interpolation = updates.interpolation;
          didChange = true;
        }

        const atlasUpdates = updates as Partial<LayerRender> & {
          colormapId?: number;
          atlasConfig?: unknown;
          atlasPaletteKind?: string;
          atlasPaletteSeed?: number;
          atlasMaxLabel?: number;
        };
        const layerWithAtlas = layer as unknown as {
          colormapId?: number;
          atlasConfig?: unknown;
          atlasPaletteKind?: string;
          atlasPaletteSeed?: number;
          atlasMaxLabel?: number;
        };

        if (
          atlasUpdates.colormapId !== undefined &&
          layerWithAtlas.colormapId !== atlasUpdates.colormapId
        ) {
          layerWithAtlas.colormapId = atlasUpdates.colormapId;
          didChange = true;
        }
        if (atlasUpdates.atlasConfig && layerWithAtlas.atlasConfig !== atlasUpdates.atlasConfig) {
          layerWithAtlas.atlasConfig = atlasUpdates.atlasConfig;
          didChange = true;
        }
        if (
          atlasUpdates.atlasPaletteKind &&
          layerWithAtlas.atlasPaletteKind !== atlasUpdates.atlasPaletteKind
        ) {
          layerWithAtlas.atlasPaletteKind = atlasUpdates.atlasPaletteKind;
          didChange = true;
        }
      });

      if (didChange) {
        getEventBus().emit('layer.render.changed', {
          layerId,
          renderProps: updates,
        });
      }
    },
    [layerId],
  );
}

// ---------------------------------------------------------------------------
// 6c — STATS summary + Open in Plot
// ---------------------------------------------------------------------------

export interface VolumeLayerStats {
  /** True while a backend histogram fetch is in flight. */
  readonly loading: boolean;
  /** Last error from the histogram service, if any. */
  readonly error: Error | null;
  /** Number of voxels included in the histogram (zero-excluded). */
  readonly count: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly mean: number | null;
  readonly std: number | null;
}

const EMPTY_VOLUME_STATS: VolumeLayerStats = {
  loading: false,
  error: null,
  count: null,
  min: null,
  max: null,
  mean: null,
  std: null,
};

/**
 * Reactive volume-layer stats: returns scalar summary (n, min, max, mean,
 * std) for the given volume layer. Reads from `HistogramService` (which
 * caches and dedupes pending requests) and falls back to `dataRange` from
 * `layerMetadata` for min/max while mean/std are loading.
 *
 * Re-runs when the layer id changes or when a `layer.render.changed`
 * event fires for that layer (matching the histogram cache's
 * invalidation semantics).
 */
export function useVolumeLayerStats(layerId: string | null): VolumeLayerStats {
  // Two primitive selectors — Zustand v5 has no equality argument, so a
  // composite selector that returned a fresh tuple would loop infinitely.
  const metadataMin = useLayerStore((state) => {
    if (!layerId) return null;
    return state.layerMetadata.get(layerId)?.dataRange?.min ?? null;
  });
  const metadataMax = useLayerStore((state) => {
    if (!layerId) return null;
    return state.layerMetadata.get(layerId)?.dataRange?.max ?? null;
  });

  const [data, setData] = useState<HistogramData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);

  // Invalidate locally on render.changed for this layer — mirrors
  // HistogramService cache invalidation so the next fetch is fresh.
  useEffect(() => {
    if (!layerId) return;
    const eventBus = getEventBus();
    const unsubscribe = eventBus.on(
      'layer.render.changed',
      (event: { layerId: string }) => {
        if (event.layerId === layerId) {
          setData(null);
          setRevision((r) => r + 1);
        }
      },
    );
    return () => {
      unsubscribe();
    };
  }, [layerId]);

  useEffect(() => {
    if (!layerId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    histogramService
      .computeHistogram({ layerId, binCount: 256, excludeZeros: true })
      .then((next) => {
        if (cancelled) return;
        setData(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [layerId, revision]);

  if (!layerId) return EMPTY_VOLUME_STATS;

  if (data) {
    return {
      loading,
      error,
      count: data.totalCount,
      min: data.minValue,
      max: data.maxValue,
      mean: data.mean,
      std: data.std,
    };
  }

  return {
    loading,
    error,
    count: null,
    min: metadataMin,
    max: metadataMax,
    mean: null,
    std: null,
  };
}

/**
 * Returns a stable callback that requests a specific plot-host mode.
 * Used by the Inspector's "Open in Plot" affordances. The actual
 * mode-switch is owned by `PlotPanel` reading the same store.
 */
export function useOpenInPlot() {
  const setActivePlotMode = usePlotModeStore((state) => state.setActivePlotMode);
  return useCallback(
    (modeId: string) => {
      setActivePlotMode(modeId);
    },
    [setActivePlotMode],
  );
}
