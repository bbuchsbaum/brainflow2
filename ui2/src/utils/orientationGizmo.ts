/**
 * Orientation glyph geometry (phase 4, D5): the world R / A / S axes seen
 * from a camera, in screen units (x right, y DOWN), for the surface frame's
 * SVG and the exported figure. Axes are drawn back to front (`depth`: + =
 * toward the viewer), so the one pointing at the viewer is on top.
 */
export interface CameraBasis {
  right: readonly [number, number, number];
  up: readonly [number, number, number];
  forward: readonly [number, number, number];
}

export interface GizmoAxis {
  label: 'R' | 'A' | 'S';
  /** End point for a unit-length axis, screen units (y down). */
  x: number;
  y: number;
  /** Toward the viewer (+) or away (−). */
  depth: number;
}

/** Below this projected length an axis points (nearly) at or away from the viewer. */
export const END_ON = 0.25;

const AXES: Array<[GizmoAxis['label'], [number, number, number]]> = [
  ['R', [1, 0, 0]],
  ['A', [0, 1, 0]],
  ['S', [0, 0, 1]],
];

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function projectGizmoAxes(basis: CameraBasis): GizmoAxis[] {
  return AXES.map(([label, axis]) => ({
    label,
    x: dot(axis, basis.right),
    y: -dot(axis, basis.up),
    depth: -dot(axis, basis.forward),
  })).sort((a, b) => a.depth - b.depth);
}
