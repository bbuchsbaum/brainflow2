import { SurfaceGeometry, computeSulcalDepth } from 'neurosurface';

/**
 * Sulcal depth (FreeSurfer `sulc`-like, positive in sulci) of a FOLDED mesh
 * (white, pial or midthickness), for the grey underlay of any surface with
 * the same topology (inflated, sphere). surfview's estimate: r ≈ 0.96 against
 * FreeSurfer on fsaverage5; ~0.3 s for fs_LR 32k. Compute once per mesh.
 */
export function computeSurfaceSulcalDepth(
  vertices: Float32Array,
  faces: Uint32Array,
  hemisphere = 'both',
): Float32Array {
  // No THREE mesh: only the arrays and the adjacency are needed.
  const geometry = new SurfaceGeometry(vertices, faces, hemisphere, null, false);
  return computeSulcalDepth(geometry);
}
