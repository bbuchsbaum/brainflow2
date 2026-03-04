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
