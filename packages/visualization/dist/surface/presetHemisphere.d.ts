import type { SurfaceRenderable } from './types.js';
/** The fields of a surface the preset hemisphere is resolved from. */
export type PresetHemisphereSurface = Pick<SurfaceRenderable, 'visible' | 'geometry'>;
/** Left / right from a surface's geometry hemisphere field, else null. */
export declare function surfaceHemisphere(item: PresetHemisphereSurface | undefined): 'left' | 'right' | null;
export declare function hasRenderableGeometry(surface: PresetHemisphereSurface): boolean;
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
export declare function resolvePresetHemispheres(surfaces: readonly PresetHemisphereSurface[], viewpoint: string, requested?: 'left' | 'right'): PresetHemispheres;
//# sourceMappingURL=presetHemisphere.d.ts.map