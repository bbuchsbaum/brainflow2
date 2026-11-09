import type { LoadedSurface } from '@/stores/surfaceStore';
import { resolveSurfaceSceneIdentity, surfaceGeometryFromPath } from '@/utils/surfaceIdentity';

/** Same subject / space / hemisphere, whatever the geometry (the scene key). */
export function anatomyKey(surface: LoadedSurface): string | null {
  const identity = resolveSurfaceSceneIdentity({
    path: surface.metadata.path,
    geometryHemisphere: surface.geometry.hemisphere,
    surfaceType: surface.geometry.surfaceType,
  });
  return identity ? `${identity.basePath}:${identity.hemisphere}` : null;
}

/** Meshes in the volume's world space (midthickness and smoothwm too). */
export const ANATOMICAL_TYPES = new Set(['pial', 'white', 'midthickness', 'smoothwm', 'graymid', 'orig']);

/** The surface's geometry: declared by the loader, else read from its file name. */
export function surfaceGeometryType(surface: LoadedSurface): string | null {
  const declared = String(surface.geometry.surfaceType ?? surface.metadata.surfaceType ?? '')
    .trim()
    .toLowerCase();
  if (declared && declared !== 'unknown') return declared === 'wm' ? 'white' : declared;
  return surfaceGeometryFromPath(surface.metadata.path);
}

export function isAnatomical(surface: LoadedSurface): boolean {
  return ANATOMICAL_TYPES.has(surfaceGeometryType(surface) ?? '');
}

/**
 * Every anatomical mesh that stands for `surface` (itself when anatomical,
 * else the same-subject/hemisphere meshes of identical topology), for a
 * readout that takes the vertex nearest the crosshair on any of them.
 */
export function anatomicalMeshesFor(
  surface: LoadedSurface,
  all: Iterable<LoadedSurface>,
): Float32Array[] {
  if (isAnatomical(surface)) return [surface.geometry.vertices];
  const key = anatomyKey(surface);
  if (!key) return [];
  return [...all]
    .filter((c) => isAnatomical(c) && anatomyKey(c) === key && sameTopology(surface, c))
    .map((c) => c.geometry.vertices);
}

const topologyCache = new WeakMap<Uint32Array, WeakMap<Uint32Array, boolean>>();

/** Identical vertex count and triangle list (cached per face-array pair). */
export function sameTopology(a: LoadedSurface, b: LoadedSurface): boolean {
  if (a.geometry.vertices.length !== b.geometry.vertices.length) return false;
  const fa = a.geometry.faces;
  const fb = b.geometry.faces;
  if (fa === fb) return true;
  if (fa.length !== fb.length) return false;
  const cached = topologyCache.get(fa)?.get(fb);
  if (cached !== undefined) return cached;
  let same = true;
  for (let i = 0; i < fa.length; i += 1) {
    if (fa[i] !== fb[i]) {
      same = false;
      break;
    }
  }
  let row = topologyCache.get(fa);
  if (!row) topologyCache.set(fa, (row = new WeakMap()));
  row.set(fb, same);
  return same;
}

/** Backend vertices already have their GIfTI surf_to_world applied.
 * Inflated/spherical coordinates can drive volume navigation only through a
 * same-subject/space/hemisphere anatomical mesh with identical vertex topology.
 * Missing correspondence disables the cursor for that mesh, not its rendering.
 */
export function resolveCursorAnatomy(
  displayed: readonly LoadedSurface[],
  all: Iterable<LoadedSurface>,
): ReadonlyMap<string, Float32Array> {
  const references = [...all]
    .filter(isAnatomical)
    .sort(
      (a, b) =>
        Number(b.geometry.surfaceType === 'pial') - Number(a.geometry.surfaceType === 'pial'),
    );
  const result = new Map<string, Float32Array>();
  for (const surface of displayed) {
    if (isAnatomical(surface)) {
      result.set(surface.handle, surface.geometry.vertices);
      continue;
    }
    const key = anatomyKey(surface);
    if (!key) continue;
    const reference = references.find(
      (candidate) => anatomyKey(candidate) === key && sameTopology(surface, candidate),
    );
    if (reference) result.set(surface.handle, reference.geometry.vertices);
  }
  return result;
}
