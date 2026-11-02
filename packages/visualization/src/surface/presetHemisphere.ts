import type { SurfaceRenderable } from './types.js';

/** The fields of a surface the preset hemisphere is resolved from. */
export type PresetHemisphereSurface = Pick<SurfaceRenderable, 'visible' | 'geometry'>;

/** Left / right from a surface's geometry hemisphere field, else null. */
export function surfaceHemisphere(item: PresetHemisphereSurface | undefined): 'left' | 'right' | null {
  const value = String(item?.geometry.hemisphere ?? '').trim().toLowerCase();
  if (value === 'left' || value === 'lh' || value === 'l') return 'left';
  if (value === 'right' || value === 'rh' || value === 'r') return 'right';
  return null;
}

export function hasRenderableGeometry(surface: PresetHemisphereSurface): boolean {
  return Boolean(
    surface.geometry.vertices &&
      surface.geometry.faces &&
      surface.geometry.vertices.length > 0 &&
      surface.geometry.faces.length > 0,
  );
}

export interface PresetHemispheres {
  /**
   * The hemisphere presets aim at: the requested one when a left and a right
   * mesh are both drawn (left when none is requested), else the one drawn
   * hemisphere, else null (no drawn mesh names one).
   */
  aim: 'left' | 'right' | null;
  /** The hemisphere Medial hides (both drawn), else null: nothing is hidden. */
  hidden: 'left' | 'right' | null;
}

/**
 * Presets are hemisphere-relative (lateral is -x for left, +x for right).
 * With a left and a right mesh both drawn, Medial shows the aimed hemisphere
 * and hides the other, which would otherwise cover the medial wall. The one
 * resolver for the surface canvas and anything describing what it shows (the
 * pane header), so the two never disagree: drawn means visible with geometry
 * ready, and the hemisphere is the geometry's.
 */
export function resolvePresetHemispheres(
  surfaces: readonly PresetHemisphereSurface[],
  viewpoint: string,
  requested?: 'left' | 'right',
): PresetHemispheres {
  const drawn = new Set(
    surfaces.filter((item) => item.visible !== false && hasRenderableGeometry(item)).map(surfaceHemisphere),
  );
  const bilateral = drawn.has('left') && drawn.has('right');
  const aim = bilateral
    ? (requested ?? 'left')
    : drawn.has('left')
      ? 'left'
      : drawn.has('right')
        ? 'right'
        : null;
  const hidden = bilateral && viewpoint === 'medial' ? (aim === 'left' ? 'right' : 'left') : null;
  return { aim, hidden };
}
