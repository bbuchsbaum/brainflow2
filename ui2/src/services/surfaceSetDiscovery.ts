/**
 * Surface sets: the other geometries (pial, white, inflated, sphere…) and the
 * other hemisphere of a loaded surface, found next to it on disk or offered
 * by its TemplateFlow template. A surface view lists them in its geometry
 * switcher, so a full set is one click away and loads into the same scene.
 */
import {
  normalizeLateralHemisphere,
  resolveTemplateflowSurfaceIdentity,
  surfaceGeometryFromPath,
  surfaceGroupKey,
} from '@/utils/surfaceIdentity';

export interface SurfaceSetMember {
  /** File path, or the `templateflow://space_geometry_hemi` id of a template mesh. */
  path: string;
  geometry: string;
  hemisphere: 'left' | 'right';
  /** Present for a TemplateFlow mesh: the load request. */
  template?: { space: string; geometry_type: string; hemisphere: 'left' | 'right' };
}

/** Geometries TemplateFlow ships for the fsaverage family (no inflated). */
const FSAVERAGE_GEOMETRIES = ['pial', 'white', 'sphere'];

const SURFACE_FILE = /[.](surf[.])?gii$/i;

function hemisphereOfName(name: string): 'left' | 'right' | null {
  const match = name.match(/^(lh|rh)[.]/i) ?? name.match(/(?:^|_)hemi-([LR])(?=_|[.])/i);
  return match ? normalizeLateralHemisphere(match[1]) : null;
}

/**
 * The members of `anchorPath`'s set among `filePaths` (a directory listing):
 * surface meshes whose scene key matches and whose name declares a geometry.
 * Overlays (`.func.gii`, `.shape.gii`, `.label.gii`) are not meshes.
 */
export function surfaceSetFromListing(
  anchorPath: string,
  filePaths: readonly string[],
): SurfaceSetMember[] {
  const key = surfaceGroupKey(anchorPath);
  if (!key) return [];
  const members: SurfaceSetMember[] = [];
  for (const path of filePaths) {
    const name = path.replaceAll('\\', '/').split('/').pop() ?? '';
    if (!SURFACE_FILE.test(name) || /[.](func|shape|label)[.]gii$/i.test(name)) continue;
    if (surfaceGroupKey(path) !== key) continue;
    const geometry = surfaceGeometryFromPath(path);
    const hemisphere = hemisphereOfName(name);
    if (!geometry || !hemisphere) continue;
    if (members.some((m) => m.geometry === geometry && m.hemisphere === hemisphere)) continue;
    members.push({ path, geometry, hemisphere });
  }
  return members;
}

/** The meshes a TemplateFlow template offers for both hemispheres, or null. */
export function templateSurfaceSet(anchorPath: string): SurfaceSetMember[] | null {
  const identity = resolveTemplateflowSurfaceIdentity({ path: anchorPath });
  if (!identity) return null;
  const space = identity.basePath.slice('templateflow://'.length).split('_')[0];
  if (!/^fsaverage[5-7]?$/i.test(space)) return null;
  const members: SurfaceSetMember[] = [];
  for (const hemisphere of ['left', 'right'] as const) {
    for (const geometry of FSAVERAGE_GEOMETRIES) {
      members.push({
        path: `templateflow://${space}_${geometry}_${hemisphere}`,
        geometry,
        hemisphere,
        template: { space, geometry_type: geometry, hemisphere },
      });
    }
  }
  return members;
}

/** The directory part of a path ('' for a bare name). */
export function directoryOf(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}
