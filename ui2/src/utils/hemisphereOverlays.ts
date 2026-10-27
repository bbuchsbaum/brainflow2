/**
 * Paired hemisphere overlays (phase 4 v1, critique fix F1): the same map
 * loaded on the left and the right hemisphere ("lh.sensorimotor.func.gii",
 * "rh.sensorimotor.func.gii", or `hemi-L` / `hemi-R` entities) shares one
 * colour range, so one value has one colour in both hemispheres, live and in
 * a figure with one colorbar.
 */
import type { LoadedSurface, SurfaceDataLayer } from '@/stores/surfaceStore';

/** The map's name without its hemisphere: "lh.sensorimotor.func.gii" -> "sensorimotor.func". */
export function overlayMapName(name: string): string {
  return name
    .replace(/\.gii$/i, '')
    .replace(/^(lh|rh)\./i, '')
    .replace(/(^|_)hemi-[LR](?=_|\.|$)/i, '')
    .replace(/^_+/, '');
}

const isScalar = (layer: SurfaceDataLayer) => !layer.rgba && !layer.labels && !layer.atlasConfig && (layer.values?.length ?? 0) > 0;

/** Every scalar layer of the same map on any loaded surface (the given one included). */
export function pairedOverlayLayers(
  surfaces: Iterable<LoadedSurface>,
  name: string,
): Array<{ surfaceId: string; layer: SurfaceDataLayer }> {
  const key = overlayMapName(name);
  const out: Array<{ surfaceId: string; layer: SurfaceDataLayer }> = [];
  for (const surface of surfaces)
    for (const layer of surface.layers.values())
      if (isScalar(layer) && overlayMapName(layer.name) === key) out.push({ surfaceId: surface.handle, layer });
  return out;
}

/** The union of the paired layers' data ranges. */
export function unionRange(layers: readonly SurfaceDataLayer[]): [number, number] {
  return [Math.min(...layers.map((l) => l.dataRange[0])), Math.max(...layers.map((l) => l.dataRange[1]))];
}

const sameRange = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];

/**
 * Ranges to set so paired layers share the union of their data ranges.
 * Layers the user re-windowed (range ≠ its own data range, and ≠ the union)
 * are left alone.
 */
export function pairedRangeUpdates(
  pairs: ReadonlyArray<{ surfaceId: string; layer: SurfaceDataLayer }>,
): Array<{ surfaceId: string; layerId: string; range: [number, number] }> {
  if (pairs.length < 2) return [];
  const union = unionRange(pairs.map((p) => p.layer));
  return pairs
    .filter(({ layer }) => sameRange(layer.range, layer.dataRange) && !sameRange(layer.range, union))
    .map(({ surfaceId, layer }) => ({ surfaceId, layerId: layer.id, range: union }));
}
