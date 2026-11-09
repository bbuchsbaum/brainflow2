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

const LAMBDA = 0.5;

function surfaceArea(positions: Float64Array, faces: Uint32Array): number {
  let area = 0;
  for (let f = 0; f < faces.length; f += 3) {
    const a = 3 * faces[f],
      b = 3 * faces[f + 1],
      c = 3 * faces[f + 2];
    const ux = positions[b] - positions[a],
      uy = positions[b + 1] - positions[a + 1],
      uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a],
      vy = positions[c + 1] - positions[a + 1],
      vz = positions[c + 2] - positions[a + 2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return area;
}

function meanEdgeLength(positions: Float64Array, faces: Uint32Array): number {
  let sum = 0;
  let count = 0;
  for (let f = 0; f < faces.length; f += 3) {
    for (let e = 0; e < 3; e++) {
      const a = 3 * faces[f + e],
        b = 3 * faces[f + ((e + 1) % 3)];
      sum += Math.hypot(
        positions[b] - positions[a],
        positions[b + 1] - positions[a + 1],
        positions[b + 2] - positions[a + 2],
      );
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Iterations needed for smoothing to reach `foldScaleMm` on this mesh. */
export function inflationIterations(
  vertices: Float32Array,
  faces: Uint32Array,
  options: InflateOptions = {},
): number {
  const edge = meanEdgeLength(Float64Array.from(vertices), faces);
  const scale = options.foldScaleMm ?? 12;
  // Diffusion reach after n steps ≈ edge · sqrt(2 λ n).
  const n = edge > 0 ? (scale / edge) ** 2 / (2 * LAMBDA) : 0;
  return Math.round(
    Math.min(options.maxIterations ?? 400, Math.max(options.minIterations ?? 20, n)),
  );
}

export function* inflateSurfaceSteps(
  vertices: Float32Array,
  faces: Uint32Array,
  options: InflateOptions = {},
): Generator<number, Float32Array, void> {
  const n = vertices.length / 3;
  if (!Number.isInteger(n) || n === 0 || faces.length % 3) {
    throw new Error('Inflation needs a non-empty triangle mesh.');
  }
  // Neighbour lists from the triangles (CSR). On a closed manifold every
  // edge appears in two triangles, so each neighbour is listed twice: the
  // uniform average is unchanged.
  const degree = new Uint32Array(n);
  for (let f = 0; f < faces.length; f++) degree[faces[f]] += 2;
  const offsets = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++) offsets[v + 1] = offsets[v] + degree[v];
  const neighbours = new Uint32Array(offsets[n]);
  const fill = offsets.slice(0, n);
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f],
      b = faces[f + 1],
      c = faces[f + 2];
    neighbours[fill[a]++] = b;
    neighbours[fill[a]++] = c;
    neighbours[fill[b]++] = c;
    neighbours[fill[b]++] = a;
    neighbours[fill[c]++] = a;
    neighbours[fill[c]++] = b;
  }

  let current = Float64Array.from(vertices);
  let next = new Float64Array(current.length);
  const area0 = surfaceArea(current, faces);
  const iterations = inflationIterations(vertices, faces, options);
  const chunk = Math.max(1, options.chunk ?? 10);

  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < n; v++) {
      const start = offsets[v],
        end = offsets[v + 1];
      const i = 3 * v;
      if (end === start) {
        next[i] = current[i];
        next[i + 1] = current[i + 1];
        next[i + 2] = current[i + 2];
        continue;
      }
      let x = 0,
        y = 0,
        z = 0;
      for (let k = start; k < end; k++) {
        const j = 3 * neighbours[k];
        x += current[j];
        y += current[j + 1];
        z += current[j + 2];
      }
      const inv = 1 / (end - start);
      next[i] = current[i] + LAMBDA * (x * inv - current[i]);
      next[i + 1] = current[i + 1] + LAMBDA * (y * inv - current[i + 1]);
      next[i + 2] = current[i + 2] + LAMBDA * (z * inv - current[i + 2]);
    }
    [current, next] = [next, current];
    if ((it + 1) % chunk === 0 && it + 1 < iterations) yield (it + 1) / iterations;
  }

  // Smoothing shrinks the mesh: restore the folded mesh's surface area.
  const area = surfaceArea(current, faces);
  const scale = area > 0 && area0 > 0 ? Math.sqrt(area0 / area) : 1;
  const centroid = [0, 0, 0];
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) centroid[k] += current[3 * v + k] / n;
  const out = new Float32Array(current.length);
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) {
      out[3 * v + k] = centroid[k] + (current[3 * v + k] - centroid[k]) * scale;
    }
  }
  return out;
}

/** The whole inflation at once (tests, workers). */
export function inflateSurface(
  vertices: Float32Array,
  faces: Uint32Array,
  options: InflateOptions = {},
): Float32Array {
  const steps = inflateSurfaceSteps(vertices, faces, options);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
