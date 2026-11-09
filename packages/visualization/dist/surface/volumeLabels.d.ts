/** Nearest categorical sampling in anatomical world space. No renderer or host state. */
export declare function sampleVolumeLabels(vertices: Float32Array, values: Float32Array | Uint32Array, dims: readonly [number, number, number], affine: Float32Array): Uint32Array;
/**
 * Trilinear sampling of a scalar volume at anatomical world vertices (the
 * values a GPU volume-projection layer shows on a folded mesh), for drawing
 * on an inflated or spherical embedding of the same vertices. Outside the
 * volume (beyond half a voxel from its edge centres) is NaN.
 */
export declare function sampleVolumeLinear(vertices: Float32Array, values: Float32Array, dims: readonly [number, number, number], affine: Float32Array): Float32Array;
//# sourceMappingURL=volumeLabels.d.ts.map