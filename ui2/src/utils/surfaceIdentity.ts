export type SurfaceHemisphere = 'left' | 'right' | 'both';
export type LateralHemisphere = 'left' | 'right';

export interface TemplateflowSurfaceIdentity {
  basePath: string;
  hemisphere: LateralHemisphere;
  surfaceType: string;
}

/**
 * Normalizes hemisphere tokens used across backend and UI payloads.
 *
 * Accepted aliases:
 * - left: left, l, lh
 * - right: right, r, rh
 * - both: both, bilateral, lr, rl
 */
export function normalizeSurfaceHemisphere(value?: string | null): SurfaceHemisphere | null {
  if (!value) return null;
  const token = value.trim().toLowerCase();

  if (token === 'left' || token === 'l' || token === 'lh') return 'left';
  if (token === 'right' || token === 'r' || token === 'rh') return 'right';
  if (token === 'both' || token === 'bilateral' || token === 'lr' || token === 'rl') return 'both';

  return null;
}

export function normalizeLateralHemisphere(value?: string | null): LateralHemisphere | null {
  const normalized = normalizeSurfaceHemisphere(value);
  if (normalized === 'left' || normalized === 'right') {
    return normalized;
  }
  return null;
}

export function resolveTemplateflowSurfaceIdentity(args: {
  path?: string | null;
  geometryHemisphere?: string | null;
  metadataHemisphere?: string | null;
  surfaceType?: string | null;
}): TemplateflowSurfaceIdentity | null {
  // Expected path form: templateflow://<space>_<surfaceType>_<hemisphereToken>
  // Hemisphere token is normalized with fallbacks to geometry/metadata fields.
  const path = (args.path || '').trim();
  const match = path.match(/^(templateflow:\/\/.+)_([^_]+)$/i);
  if (!match) {
    return null;
  }

  const pathHemisphere = normalizeLateralHemisphere(match[2]);
  const hemisphere =
    pathHemisphere ??
    normalizeLateralHemisphere(args.geometryHemisphere) ??
    normalizeLateralHemisphere(args.metadataHemisphere);
  if (!hemisphere) {
    return null;
  }

  const surfaceType = (args.surfaceType || '').trim().toLowerCase();
  return {
    basePath: match[1],
    hemisphere,
    surfaceType,
  };
}

export interface SurfaceGroupKeyInput {
  path?: string | null;
  geometryHemisphere?: string | null;
  metadataHemisphere?: string | null;
  surfaceType?: string | null;
}

/**
 * Group key for a surface "scene" — surfaces that share a key render together and
 * occupy a single surface view tab. For templateflow surfaces this is the identity
 * `basePath` (`templateflow://<space>_<surfaceType>`), so Left and Right of the same
 * template collapse to one scene while different geometries (white vs pial) stay
 * distinct. Returns `null` for ungroupable surfaces (e.g. local `.gii` files), which
 * keeps them one-tab-per-handle.
 *
 * Accepts either the full identity arg shape or a bare path string for convenience
 * (e.g. a stored GoldenLayout `componentState.path`).
 */
export function surfaceGroupKey(input: string | SurfaceGroupKeyInput): string | null {
  const args = typeof input === 'string' ? { path: input } : input;
  return resolveTemplateflowSurfaceIdentity(args)?.basePath ?? null;
}
