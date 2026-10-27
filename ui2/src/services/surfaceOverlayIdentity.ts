import type { LoadedSurface } from '@/stores/surfaceStore';
import { normalizeLateralHemisphere } from '@/utils/surfaceIdentity';

function identity(path: string) {
  const name = path.replaceAll('\\', '/').split('/').pop() ?? '';
  const hemi = name.match(/^(lh|rh)[.]/i)?.[1] ?? name.match(/(?:^|_)hemi-([LR])(?=_|[.])/i)?.[1];
  return {
    hemisphere: normalizeLateralHemisphere(hemi),
    space: name.match(/(?:^|_)space-([^_.]+)/i)?.[1]?.toLowerCase(),
    subject: path.match(/(?:^|[/_])sub-([^/_.]+)/i)?.[1]?.toLowerCase(),
  };
}

/** Reject contradictory identity evidence before allocating backend data.
 * Absent identity is not evidence of a match; vertex-count checks still apply.
 */
export function validateSurfaceOverlayIdentity(path: string, surface: LoadedSurface): void {
  const overlay = identity(path);
  const target = identity(surface.metadata.path);
  target.hemisphere =
    normalizeLateralHemisphere(surface.geometry.hemisphere ?? surface.metadata.hemisphere) ??
    target.hemisphere;
  target.space =
    surface.metadata.path.match(/^templateflow:\/\/([^_]+)/i)?.[1]?.toLowerCase() ?? target.space;
  for (const field of ['hemisphere', 'space', 'subject'] as const) {
    if (overlay[field] && target[field] && overlay[field] !== target[field]) {
      throw new Error(
        `Overlay ${field} '${overlay[field]}' does not match surface ${field} '${target[field]}'. Select the matching surface.`,
      );
    }
  }
}

/**
 * The surface an overlay should go to: `preferred` unless the overlay names
 * the other hemisphere (rh.*.func.gii onto a left mesh), then the loaded
 * surface of its hemisphere that agrees on every identity field (the one in
 * `preferred`'s folder first). Phase 4: loading lh, rh and both overlays in
 * a row put rh's overlay on lh and failed.
 */
export function matchingOverlayTarget(
  path: string,
  preferred: LoadedSurface,
  surfaces: readonly LoadedSurface[],
): LoadedSurface {
  const agrees = (surface: LoadedSurface) => {
    try {
      validateSurfaceOverlayIdentity(path, surface);
      return true;
    } catch {
      return false;
    }
  };
  if (agrees(preferred)) return preferred;
  const folder = (p: string) => p.replaceAll('\\', '/').replace(/[^/]*$/, '');
  const matches = surfaces.filter(agrees);
  return matches.find((s) => folder(s.metadata.path) === folder(preferred.metadata.path)) ?? matches[0] ?? preferred;
}
