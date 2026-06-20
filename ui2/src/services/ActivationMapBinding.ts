/**
 * ActivationMapBinding
 *
 * Keeps a single logical "activation map" in sync across its two renderings:
 * the orthogonal slice texture (a volume `ViewLayer` in the view-state store)
 * and the projected cortical overlay (a `SurfaceDataLayer` in the surface
 * store). A projected overlay carries a `volumeId` pointing back at its source
 * volume; this binding mirrors the volume layer's display properties
 * (colormap, intensity window, threshold, opacity, visibility) onto every
 * surface overlay derived from it.
 *
 * The binding is intentionally one-directional (volume → surface): the volume
 * layer is the source of truth for display props, so changing a colormap once
 * updates both the slices and the cortex. Because every write is guarded by an
 * equality check and self-induced store events are ignored while a sync is in
 * flight, the binding settles in a single pass and cannot feed back on itself.
 */

import { useViewStateStore } from '@/stores/viewStateStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import type { ViewLayer } from '@/types/viewState';

function arraysEqual(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Push display properties from each volume `ViewLayer` onto every projected
 * surface overlay that references it. Pure apart from the store writes it makes;
 * exported for unit testing.
 */
export function syncActivationMaps(): void {
  const viewLayers = useViewStateStore.getState().viewState.layers;
  if (!viewLayers || viewLayers.length === 0) return;

  // Index the source volume layers by the volume they render.
  const byVolume = new Map<string, ViewLayer>();
  for (const layer of viewLayers) {
    if (layer.volumeId) byVolume.set(layer.volumeId, layer);
  }
  if (byVolume.size === 0) return;

  const { surfaces, updateLayerProperty } = useSurfaceStore.getState();

  surfaces.forEach((surface, surfaceId) => {
    surface.layers.forEach((dataLayer, layerId) => {
      // Only projected overlays (those with a source volume) are bound.
      const volumeId = dataLayer.volumeId;
      if (!volumeId) return;

      const source = byVolume.get(volumeId);
      if (!source) return;

      if (dataLayer.colormap !== source.colormap) {
        updateLayerProperty(surfaceId, layerId, 'colormap', source.colormap);
      }
      if (dataLayer.opacity !== source.opacity) {
        updateLayerProperty(surfaceId, layerId, 'opacity', source.opacity);
      }
      // The volume's intensity window maps to the surface overlay's display range.
      if (!arraysEqual(dataLayer.range, source.intensity)) {
        updateLayerProperty(surfaceId, layerId, 'range', [...source.intensity]);
      }
      if (source.threshold && !arraysEqual(dataLayer.threshold, source.threshold)) {
        updateLayerProperty(surfaceId, layerId, 'threshold', [...source.threshold]);
      }
      const sourceVisible = source.visible;
      if ((dataLayer.visible ?? true) !== sourceVisible) {
        updateLayerProperty(surfaceId, layerId, 'visible', sourceVisible);
      }
    });
  });
}

// Module-level binding state: a single shared subscription, ref-counted so
// multiple consumers (e.g. several hybrid panels) share one binding.
let refCount = 0;
let unsubscribers: Array<() => void> = [];
let scheduled = false;
let running = false;

function scheduleSync(): void {
  // Ignore store events emitted by our own writes while a sync is running.
  if (running || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    running = true;
    try {
      syncActivationMaps();
    } finally {
      running = false;
    }
  });
}

/**
 * Start the activation-map binding. Returns a disposer; the underlying
 * subscriptions are torn down once the last consumer disposes.
 */
export function startActivationMapBinding(): () => void {
  refCount += 1;

  if (refCount === 1) {
    // Plain subscriptions fire on any state change and work regardless of
    // store middleware. Equality checks in syncActivationMaps make this cheap.
    unsubscribers = [
      useViewStateStore.subscribe(scheduleSync),
      useSurfaceStore.subscribe(scheduleSync),
    ];
    // Reconcile whatever is already loaded.
    scheduleSync();
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    refCount -= 1;
    if (refCount === 0) {
      unsubscribers.forEach((u) => u());
      unsubscribers = [];
    }
  };
}
