import type { RenderableLayerSpec, SurfaceReconciliationPlan, SurfaceRenderable, SurfaceRenderableLayer } from './types.js';
interface PlanSurfaceReconciliationOptions {
    previousUseGPUProjection: boolean;
    nextUseGPUProjection: boolean;
}
/**
 * Whether `next` only moves `previous` to another of its embeddings (pial ->
 * inflated): same faces, hemisphere and vertex count, a different variant.
 * The viewer morphs such a change in place.
 */
export declare function isSurfaceVariantSwitch(previousSurface: SurfaceRenderable, nextSurface: SurfaceRenderable): boolean;
/** Whether the drawn mesh must be rebuilt (a variant switch is not: it morphs). */
export declare function isSurfaceGeometryChanged(previousSurface: SurfaceRenderable, nextSurface: SurfaceRenderable): boolean;
export declare function buildRenderableLayerSpec(layer: SurfaceRenderableLayer, useGPUProjection: boolean): RenderableLayerSpec;
export declare function buildRenderableLayerSpecs(surface: SurfaceRenderable, useGPUProjection: boolean): RenderableLayerSpec[];
export declare function areRenderableLayerSpecsEqual(previousSpec: RenderableLayerSpec, nextSpec: RenderableLayerSpec): boolean;
export declare function planSurfaceReconciliation(previousSurface: SurfaceRenderable, nextSurface: SurfaceRenderable, options: PlanSurfaceReconciliationOptions): SurfaceReconciliationPlan;
export {};
//# sourceMappingURL=surfaceReconciler.d.ts.map