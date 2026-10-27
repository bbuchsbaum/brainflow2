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
    // HCP ("sub.L.thickness") and suffix forms ("zstat_lh.func").
    .replace(/\.[LR](?=\.)/, '')
    .replace(/[._](lh|rh)(?=\.|$)/i, '')
    .replace(/^_+/, '');
}

/** The BIDS subject / session / space entities of a path (last occurrence of each). */
function entities(path: string): { sub?: string; ses?: string; space?: string } {
  const last = (key: string) => {
    const all = [...path.matchAll(new RegExp(`(?:^|[/_.])${key}-([A-Za-z0-9]+)`, 'g'))];
    return all.length ? all[all.length - 1][1] : undefined;
  };
  return { sub: last('sub'), ses: last('ses'), space: last('space') };
}

const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/**
 * Whose map this is: BIDS sub / ses / space when the path names a subject,
 * else the overlay's directory (FreeSurfer `<subject>/surf/lh.*`), else the
 * mesh's directory. Null when nothing is known (then names alone decide).
 */
export function overlaySubjectKey(overlay: { name: string; sourcePath?: string }, meshPath?: string): string | null {
  const path = overlay.sourcePath ?? overlay.name;
  const e = entities(path);
  if (e.sub) return `sub-${e.sub}|ses-${e.ses ?? ''}|space-${e.space ?? ''}`;
  const dir = dirname(overlay.sourcePath ?? '') || dirname(meshPath ?? '');
  return dir ? `dir:${dir}` : null;
}

const isScalar = (layer: SurfaceDataLayer) => !layer.rgba && !layer.labels && !layer.atlasConfig && (layer.values?.length ?? 0) > 0;

/**
 * Every scalar layer of the same map of the same subject / session on any
 * loaded surface (the given one included): the same name without its
 * hemisphere, and the same subject key (v1 fidelity 8: two subjects'
 * lh.zstat.gii do not pair). `base` is a layer or its name and source path;
 * `baseSurfaceId` supplies the mesh directory when the overlay has no path.
 */
export function pairedOverlayLayers(
  surfaces: Iterable<LoadedSurface>,
  base: string | { name: string; sourcePath?: string },
  baseSurfaceId?: string,
): Array<{ surfaceId: string; layer: SurfaceDataLayer }> {
  const list = [...surfaces];
  const overlay = typeof base === 'string' ? { name: base } : base;
  const key = overlayMapName(overlay.name);
  const meshPath = list.find((s) => s.handle === baseSurfaceId)?.metadata?.path;
  const subject = overlaySubjectKey(overlay, meshPath);
  const out: Array<{ surfaceId: string; layer: SurfaceDataLayer }> = [];
  for (const surface of list)
    for (const layer of surface.layers.values())
      if (
        isScalar(layer) &&
        overlayMapName(layer.name) === key &&
        overlaySubjectKey(layer, surface.metadata?.path) === subject
      )
        out.push({ surfaceId: surface.handle, layer });
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
