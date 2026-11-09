export type SurfaceHemisphere = 'left' | 'right' | 'both';
export type LateralHemisphere = 'left' | 'right';

/**
 * Geometry names a surface file carries in its name (FreeSurfer, BIDS, HCP,
 * TemplateFlow). Meshes that differ only by this token are embeddings of one
 * cortical sheet (same subject, space and hemisphere) and share a scene.
 */
export const SURFACE_GEOMETRY_TOKENS = [
  'pial',
  'white',
  'wm',
  'smoothwm',
  'midthickness',
  'graymid',
  'orig',
  'inflated',
  'very_inflated',
  'veryinflated',
  'sphere',
] as const;

const GEOMETRY_TOKEN_PATTERN = new RegExp(
  `(^|[_.])(${SURFACE_GEOMETRY_TOKENS.join('|')})(?=[_.]|$)`,
  'i',
);

/** Placeholder a scene key holds where the file name had its geometry. */
export const GEOMETRY_PLACEHOLDER = '{geometry}';

/** The geometry a file name declares (`lh.inflated.gii` -> `inflated`), else null. */
export function surfaceGeometryFromPath(path?: string | null): string | null {
  const name = (path ?? '').replaceAll('\\', '/').split('/').pop() ?? '';
  const match = name.match(GEOMETRY_TOKEN_PATTERN);
  if (!match) return null;
  const token = match[2].toLowerCase();
  if (token === 'wm') return 'white';
  if (token === 'veryinflated') return 'very_inflated';
  return token;
}

/** Replace the geometry token of a scene key's file name with a placeholder. */
function withoutGeometry(basePath: string): string {
  const slash = basePath.lastIndexOf('/');
  const directory = basePath.slice(0, slash + 1);
  const name = basePath.slice(slash + 1);
  return directory + name.replace(GEOMETRY_TOKEN_PATTERN, `$1${GEOMETRY_PLACEHOLDER}`);
}

/**
 * A scene key as this version writes it. Tabs saved before geometries shared a
 * scene stored keys with the geometry in them (`templateflow://fsaverage_pial`);
 * read through this, they name the same scene as new keys. Idempotent.
 */
export function normalizeSurfaceGroupKey(key: string): string;
export function normalizeSurfaceGroupKey(key: string | null | undefined): string | null;
export function normalizeSurfaceGroupKey(key: string | null | undefined): string | null {
  return key ? withoutGeometry(key) : null;
}

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
    basePath: withoutGeometry(match[1]),
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
 * `basePath` (`templateflow://<space>_{geometry}`), so Left and Right of one
 * template, and its pial / white / inflated embeddings, collapse to one scene:
 * the view shows one geometry per hemisphere and morphs between them. Local
 * lh/rh or BIDS hemi-L/hemi-R files share a scene only when the directory and
 * the rest of the filename agree. Unidentified surfaces remain separate.
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
  return {
    basePath: withoutGeometry(directory + pairedName),
    hemisphere,
    surfaceType: args.surfaceType ?? '',
  };
}
