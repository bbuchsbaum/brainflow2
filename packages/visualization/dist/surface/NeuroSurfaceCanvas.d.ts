import React from 'react';
import { VariantSurface } from 'neurosurface';
import { type NeuroSurfaceCanvasProps } from './types.js';
/**
 * Bring a mounted VariantSurface's embeddings in line with `item.variants`
 * (a geometry loaded or unloaded since it was mounted). SurfaceSet keeps
 * its own copies; `sources` remembers which input each copy came from.
 */
/**
 * VariantSurface API added in surfview 3.3 (targetVariant, add/removeVariant,
 * interpolated normals and both-shape bounds during a switch). On earlier
 * versions the canvas works around their absence; with them it steps aside.
 */
interface VariantSurfaceUpstream {
    targetVariant(): string;
    addVariant(name: string, positions: Float32Array): void;
    removeVariant(name: string): boolean;
}
export declare function hasUpstreamVariantApi(surface: unknown): surface is VariantSurface & VariantSurfaceUpstream;
export declare const NeuroSurfaceCanvas: React.NamedExoticComponent<NeuroSurfaceCanvasProps>;
export {};
//# sourceMappingURL=NeuroSurfaceCanvas.d.ts.map