import type { RenderableLayerSpec, SurfaceReconciliationPlan, SurfaceRenderable, SurfaceRenderableLayer } from './types.js';
interface PlanSurfaceReconciliationOptions {
    previousUseGPUProjection: boolean;
    nextUseGPUProjection: boolean;
}
export declare function isSurfaceGeometryChanged(previousSurface: SurfaceRenderable, nextSurface: SurfaceRenderable): boolean;
export declare function buildRenderableLayerSpec(layer: SurfaceRenderableLayer, useGPUProjection: boolean): RenderableLayerSpec;
export declare function buildRenderableLayerSpecs(surface: SurfaceRenderable, useGPUProjection: boolean): RenderableLayerSpec[];
export declare function areRenderableLayerSpecsEqual(previousSpec: RenderableLayerSpec, nextSpec: RenderableLayerSpec): boolean;
export declare function planSurfaceReconciliation(previousSurface: SurfaceRenderable, nextSurface: SurfaceRenderable, options: PlanSurfaceReconciliationOptions): SurfaceReconciliationPlan;
export {};
//# sourceMappingURL=surfaceReconciler.d.ts.map