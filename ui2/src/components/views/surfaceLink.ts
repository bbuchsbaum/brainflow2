import type { LoadedSurface } from '@/stores/surfaceStore';
import { resolveSurfaceSceneIdentity } from '@/utils/surfaceIdentity';

function anatomyKey(surface: LoadedSurface): string | null {
  const identity = resolveSurfaceSceneIdentity({
    path: surface.metadata.path,
    geometryHemisphere: surface.geometry.hemisphere,
    surfaceType: surface.geometry.surfaceType,
  });
  if (!identity) return null;
  return (
    identity.basePath.replace(/(^|[_.])(pial|white|inflated|sphere)(?=[_.]|$)/gi, '$1anatomical') +
    ':' +
    identity.hemisphere
  );
}

function isAnatomical(surface: LoadedSurface): boolean {
  const type = surface.geometry.surfaceType ?? surface.metadata.surfaceType;
  return type === 'pial' || type === 'white';
}

function sameTopology(a: LoadedSurface, b: LoadedSurface): boolean {
  return (
    a.geometry.vertices.length === b.geometry.vertices.length &&
    a.geometry.faces.length === b.geometry.faces.length &&
    a.geometry.faces.every((index, i) => index === b.geometry.faces[i])
  );
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
