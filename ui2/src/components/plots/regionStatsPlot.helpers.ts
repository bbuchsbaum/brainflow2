/**
 * Helpers for the region-stats plot: locating the active atlas (label) layer.
 * Mirrors the atlas detection in `services/atlasRegionLookup.ts`
 * (`type === "label"` + `atlasMetadata`). Both the mode's `supports` (non-
 * reactive) and the body (reactive) consume these so detection is single-sourced.
 */

import { useLayerStore } from "@/stores/layerStore";

interface AtlasLike {
  id: string;
  type?: string;
  atlasMetadata?: unknown;
}

function isAtlas(layer: AtlasLike | undefined): boolean {
  return layer?.type === "label" && layer?.atlasMetadata != null;
}

/** First loaded atlas (label) layer id, or undefined. Non-reactive. */
export function findAtlasLayerId(): string | undefined {
  const layers = useLayerStore.getState().layers as AtlasLike[];
  return layers.find(isAtlas)?.id;
}

/** True when the given layer id is an atlas (label) layer. Non-reactive. */
export function isAtlasLayer(layerId: string | undefined): boolean {
  if (!layerId) return false;
  return isAtlas(
    useLayerStore.getState().getLayer(layerId) as AtlasLike | undefined,
  );
}

/** Reactive first-atlas-layer id (a stable string|undefined selector). */
export function useAtlasLayerId(): string | undefined {
  return useLayerStore(
    (state) => (state.layers as AtlasLike[]).find(isAtlas)?.id,
  );
}
