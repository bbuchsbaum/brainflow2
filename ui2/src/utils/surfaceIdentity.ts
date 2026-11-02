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
 * distinct. Local lh/rh or BIDS hemi-L/hemi-R pairs share a scene only when the
 * directory and remaining filename agree. Unidentified surfaces remain separate.
 *
 * Accepts either the full identity arg shape or a bare path string for convenience
 * (e.g. a stored GoldenLayout `componentState.path`).
 */
export function surfaceGroupKey(input: string | SurfaceGroupKeyInput): string | null {
  const args = typeof input === 'string' ? { path: input } : input;
  return resolveSurfaceSceneIdentity(args)?.basePath ?? null;
}

/** Pair local hemispheres only when the filenames explicitly identify them.
 * Directory, subject, space, density and geometry remain part of the key.
 */
export function resolveSurfaceSceneIdentity(args: SurfaceGroupKeyInput): TemplateflowSurfaceIdentity | null {
  const template = resolveTemplateflowSurfaceIdentity(args);
  if (template) return template;
  const path = (args.path ?? '').replaceAll('\\', '/');
  const slash = path.lastIndexOf('/');
  const directory = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const match = name.match(/^(lh|rh)[.](.+)$/i) ?? name.match(/(?:^|_)hemi-([LR])(?=_|[.])/i);
  if (!match) return null;
  const hemisphere = normalizeLateralHemisphere(match[1]);
  const declared = normalizeLateralHemisphere(args.geometryHemisphere ?? args.metadataHemisphere);
  if (!hemisphere || (declared && declared !== hemisphere)) return null;
  const pairedName = /^(lh|rh)[.]/i.test(name)
    ? name.replace(/^(lh|rh)[.]/i, 'hemi-pair.')
    : name.replace(/(^|_)hemi-[LR](?=_|[.])/i, '$1hemi-pair');
  return { basePath: directory + pairedName, hemisphere, surfaceType: args.surfaceType ?? '' };
}
