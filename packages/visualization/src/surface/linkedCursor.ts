import type { SurfaceRenderable } from './types.js';

type Point = [number, number, number];

/** Search in anatomical coordinates; report the corresponding display vertex. */
export function findLinkedVertex(
  surfaces: readonly SurfaceRenderable[],
  world: Point,
  anatomy?: ReadonlyMap<string, Float32Array>,
): { handle: string; index: number; position: Point; distanceMm: number } | null {
  if (!world.every(Number.isFinite)) return null;
  let best: ReturnType<typeof findLinkedVertex> = null;
  let distanceSquared = Infinity;
  for (const surface of surfaces) {
    if (surface.visible === false) continue;
    const display = surface.geometry.vertices;
    const reference = anatomy ? anatomy.get(surface.handle) : display;
    if (!reference || reference.length !== display.length) continue;
    for (let i = 0; i + 2 < reference.length; i += 3) {
      const d =
        (reference[i] - world[0]) ** 2 +
        (reference[i + 1] - world[1]) ** 2 +
        (reference[i + 2] - world[2]) ** 2;
      if (d < distanceSquared) {
        distanceSquared = d;
        best = {
          handle: surface.handle,
          index: i / 3,
          position: [display[i], display[i + 1], display[i + 2]],
          distanceMm: Math.sqrt(d),
        };
      }
    }
  }
  return best;
}

/** Barycentric picking preserves vertex correspondence across deformation. */
export function mapPickedTriangle(
  reference: Float32Array,
  indices: Point,
  display: [Point, Point, Point],
  point: Point,
): Point | null {
  if (!indices.every((i) => Number.isInteger(i) && i >= 0 && 3 * i + 2 < reference.length))
    return null;
  const [a, b, c] = display;
  const sub = (p: Point, q: Point): Point => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const dot = (p: Point, q: Point) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const v0 = sub(b, a),
    v1 = sub(c, a),
    v2 = sub(point, a);
  const d00 = dot(v0, v0),
    d01 = dot(v0, v1),
    d11 = dot(v1, v1);
  const denom = d00 * d11 - d01 * d01;
  if (!Number.isFinite(denom) || denom <= Number.EPSILON * d00 * d11) return null;
  const v = (d11 * dot(v2, v0) - d01 * dot(v2, v1)) / denom;
  const w = (d00 * dot(v2, v1) - d01 * dot(v2, v0)) / denom;
  const weights = [1 - v - w, v, w];
  const world = [0, 1, 2].map((axis) =>
    weights.reduce((sum, weight, i) => sum + weight * reference[indices[i] * 3 + axis], 0),
  ) as Point;
  return world.every(Number.isFinite) ? world : null;
}
