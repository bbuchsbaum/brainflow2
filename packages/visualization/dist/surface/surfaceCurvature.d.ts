/**
 * Sulcal depth (FreeSurfer `sulc`-like, positive in sulci) of a FOLDED mesh
 * (white, pial or midthickness), for the grey underlay of any surface with
 * the same topology (inflated, sphere). surfview's estimate: r ≈ 0.96 against
 * FreeSurfer on fsaverage5; ~0.3 s for fs_LR 32k. Compute once per mesh.
 */
export declare function computeSurfaceSulcalDepth(vertices: Float32Array, faces: Uint32Array, hemisphere?: string): Float32Array;
//# sourceMappingURL=surfaceCurvature.d.ts.map