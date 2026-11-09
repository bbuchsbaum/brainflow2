/**
 * An inflated embedding of a folded cortical mesh, for templates that ship
 * none (TemplateFlow fsaverage): iterative Laplacian smoothing, in the spirit
 * of FreeSurfer's `mris_inflate` without its metric-preservation term, then
 * rescaled about the centroid to the folded mesh's surface area. Folds wider
 * than about `foldScaleMm` are smoothed out; vertex numbering is unchanged, so
 * every per-vertex overlay applies as is.
 *
 * Runs as a generator so a host can spread the work over several tasks:
 * each `next()` performs a slice of iterations and yields the fraction done;
 * the return value is the inflated xyz array.
 */
export interface InflateOptions {
    /** Fold wavelength to smooth out (mm). Default 12. */
    foldScaleMm?: number;
    /** Iterations per `next()`. Default 10. */
    chunk?: number;
    /** Bounds on the iteration count derived from the mesh's edge length. */
    minIterations?: number;
    maxIterations?: number;
}
/** Iterations needed for smoothing to reach `foldScaleMm` on this mesh. */
export declare function inflationIterations(vertices: Float32Array, faces: Uint32Array, options?: InflateOptions): number;
export declare function inflateSurfaceSteps(vertices: Float32Array, faces: Uint32Array, options?: InflateOptions): Generator<number, Float32Array, void>;
/** The whole inflation at once (tests, workers). */
export declare function inflateSurface(vertices: Float32Array, faces: Uint32Array, options?: InflateOptions): Float32Array;
//# sourceMappingURL=inflate.d.ts.map