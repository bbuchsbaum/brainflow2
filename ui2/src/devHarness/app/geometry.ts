/**
 * Ports of the backend view geometry used by the harness backend.
 *
 * `fullExtent` mirrors `SliceGeometry::full_extent` (core/neuro-types/src/view_rect.rs,
 * neurological handedness): axial = (+X right, -Y down), coronal = (+X right,
 * -Z down), sagittal = (-Y right, -Z down); square pixels; origin is the
 * top-left pixel; u/v are per-pixel steps.
 */
import type { VolumeFixture } from './fixtures';

export type Vec3 = [number, number, number];
export type Orientation = 'axial' | 'sagittal' | 'coronal';

export interface ViewRectMm {
  origin_mm: Vec3;
  u_mm: Vec3;
  v_mm: Vec3;
  width_px: number;
  height_px: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

/** f32 rounding so serialized geometry matches what the Rust backend would emit. */
const f32 = (v: number) => Math.fround(v);
const f32v = (v: Vec3): Vec3 => [f32(v[0]), f32(v[1]), f32(v[2])];

export function voxelToWorld(affine: number[][], ijk: Vec3): Vec3 {
  return [0, 1, 2].map(
    (r) => affine[r][0] * ijk[0] + affine[r][1] * ijk[1] + affine[r][2] * ijk[2] + affine[r][3],
  ) as Vec3;
}

export function cornersWorld(vol: VolumeFixture): Vec3[] {
  const [nx, ny, nz] = vol.dims.map((d) => d - 1);
  const out: Vec3[] = [];
  for (const k of [0, nz])
    for (const j of [0, ny])
      for (const i of [0, nx]) {
        out.push(voxelToWorld(vol.affine, [i, j, k]));
      }
  return out;
}

export function volumeBounds(vol: VolumeFixture) {
  const corners = cornersWorld(vol);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of corners) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], c[a]);
      max[a] = Math.max(max[a], c[a]);
    }
  }
  const center = voxelToWorld(vol.affine, vol.dims.map((d) => (d - 1) / 2) as Vec3);
  // Mirrors volume_queries::centre_voxel_index: voxel floor((n - 1) / 2).
  const centerVoxel = voxelToWorld(
    vol.affine,
    vol.dims.map((d) => Math.floor((d - 1) / 2)) as Vec3,
  );
  return {
    min: f32v(min),
    max: f32v(max),
    center: f32v(center),
    dims: [...vol.dims],
    center_voxel_world: f32v(centerVoxel),
  };
}

export function volumeCenter(vol: VolumeFixture): Vec3 {
  return voxelToWorld(vol.affine, vol.dims.map((d) => (d - 1) / 2) as Vec3);
}

function columnUnit(affine: number[][], c: number): Vec3 {
  const v: Vec3 = [affine[0][c], affine[1][c], affine[2][c]];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function fullExtent(
  vol: VolumeFixture,
  orient: Orientation,
  cross: Vec3,
  screenPxMax: [number, number],
): ViewRectMm {
  const ex = columnUnit(vol.affine, 0);
  const ey = columnUnit(vol.affine, 1);
  const ez = columnUnit(vol.affine, 2);
  const [right, down] =
    orient === 'axial' ? [ex, neg(ey)] : orient === 'coronal' ? [ex, neg(ez)] : [neg(ey), neg(ez)];

  const rr = dot(right, right);
  const dd = dot(down, down);
  const rd = dot(right, down);
  let det = rr * dd - rd * rd;
  if (Math.abs(det) < 1e-8) det = 1;

  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const corner of cornersWorld(vol)) {
    const delta = sub(corner, cross);
    const rD = dot(right, delta);
    const dD = dot(down, delta);
    const u = (rD * dd - dD * rd) / det;
    const v = (dD * rr - rD * rd) / det;
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }
  const widthMm = Math.max(uMax - uMin, 0);
  const heightMm = Math.max(vMax - vMin, 0);
  const reqW = Math.max(screenPxMax[0], 1);
  const reqH = Math.max(screenPxMax[1], 1);
  const pixel = f32(Math.max(widthMm / reqW, heightMm / reqH, 1e-6));
  const widthPx = Math.max(Math.ceil(f32(widthMm / pixel)), 1);
  const heightPx = Math.max(Math.ceil(f32(heightMm / pixel)), 1);
  const origin = add(cross, add(scale(right, uMin), scale(down, vMin)));
  return {
    origin_mm: f32v(origin),
    u_mm: f32v(scale(right, pixel)),
    v_mm: f32v(scale(down, pixel)),
    width_px: widthPx,
    height_px: heightPx,
  };
}

/** Inverse of a row-major 4x4 affine (rotation/scale + translation). */
export function invertAffine(m: number[][]): number[][] {
  const a = m[0][0],
    b = m[0][1],
    c = m[0][2];
  const d = m[1][0],
    e = m[1][1],
    f = m[1][2];
  const g = m[2][0],
    h = m[2][1],
    i = m[2][2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv3 = [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
  const t = [m[0][3], m[1][3], m[2][3]];
  return [
    [...inv3[0], -(inv3[0][0] * t[0] + inv3[0][1] * t[1] + inv3[0][2] * t[2])],
    [...inv3[1], -(inv3[1][0] * t[0] + inv3[1][1] * t[1] + inv3[1][2] * t[2])],
    [...inv3[2], -(inv3[2][0] * t[0] + inv3[2][1] * t[1] + inv3[2][2] * t[2])],
    [0, 0, 0, 1],
  ];
}

export const flatRowMajor = (m: number[][]): number[] => m.flat().map(f32);

/**
 * Column-major flattening, the real backend's contract for the GPU-info
 * matrices (`world_to_voxel` / `voxel_to_world` in
 * `request_layer_gpu_resources`, core/api_bridge/src/lib.rs): element
 * (row r, col c) at index c * 4 + r. Read with
 * `utils/voxelTransform.transformWorldToVoxelColumnMajor`.
 */
export const flatColumnMajor = (m: number[][]): number[] => {
  const out: number[] = [];
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) out.push(f32(m[r][c]));
  return out;
};
