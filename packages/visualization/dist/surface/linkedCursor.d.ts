import type { SurfaceRenderable } from './types.js';
type Point = [number, number, number];
/** Search in anatomical coordinates; report the corresponding display vertex. */
export declare function findLinkedVertex(surfaces: readonly SurfaceRenderable[], world: Point, anatomy?: ReadonlyMap<string, Float32Array>): {
    handle: string;
    index: number;
    position: Point;
    distanceMm: number;
} | null;
/** Barycentric picking preserves vertex correspondence across deformation. */
export declare function mapPickedTriangle(reference: Float32Array, indices: Point, display: [Point, Point, Point], point: Point): Point | null;
export {};
//# sourceMappingURL=linkedCursor.d.ts.map