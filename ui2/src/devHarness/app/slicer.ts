/**
 * CPU stand-in for the GPU slice renderer (`slice_world_space_masked.wgsl`).
 *
 * Contract mirrored from the real backend:
 * - frame: world(ndc) = origin + ndc.x * U + ndc.y * V with U/V spanning the
 *   whole frame; fragments sample at pixel centres. After the backend's
 *   readback Y-flip, image row 0 corresponds to ndc.y ~ 0 (the frame origin),
 *   so image pixel (x, y) samples origin + (x+.5)/W * U + (y+.5)/H * V.
 * - voxel coordinate = world_to_voxel * world; outside [0, dim) is transparent.
 * - linear sampling interpolates between voxel centres with clamp-to-edge;
 *   nearest picks floor(v + 0.5).
 * - window/level -> LUT; range threshold mode (0) hides samples INSIDE
 *   [low, high]; composite "over" per layer; output is straight-alpha RGBA.
 * - optional crosshair tick (same 1 px / 20 px rule as the shader).
 *
 * Colour LUTs are built from the app's own colormap gradient stops
 * (components/ui/colormapOptions.ts), not the backend's exact tables.
 */
import { colormaps } from '@/components/ui/colormapOptions';
import type { Vec3 } from './geometry';

export interface SliceLayer {
  data: Float32Array;
  dims: [number, number, number];
  worldToVoxel: number[][];
  colormap: string;
  intensity: [number, number];
  threshold: [number, number];
  opacity: number;
  nearest: boolean;
  blend: 'alpha' | 'additive' | 'max' | 'min';
  /**
   * Categorical LUT (`register_categorical_colormap` bytes, RGB per label id)
   * for a label layer with a registered `colormapId`: like the GPU's label
   * path, the rounded value indexes the table, label 0 and ids beyond it are
   * transparent, and the intensity window / threshold do not apply.
   */
  labelLut?: Uint8Array;
  /**
   * Label boundary outline (the GPU's `sampleSelectedLabelOutline`): every
   * region boundary when `selectedLabelId` is 0, else that region's; drawn
   * over the layer in `color` at `thicknessPx` screen pixels.
   */
  outline?: { color: [number, number, number, number]; thicknessPx: number; selectedLabelId: number };
}

/** Label id at a world point (nearest voxel; 0 outside), as the GPU outline samples it. */
function labelAt(layer: SliceLayer, wx: number, wy: number, wz: number): number {
  const m = layer.worldToVoxel;
  const vx = m[0][0] * wx + m[0][1] * wy + m[0][2] * wz + m[0][3];
  const vy = m[1][0] * wx + m[1][1] * wy + m[1][2] * wz + m[1][3];
  const vz = m[2][0] * wx + m[2][1] * wy + m[2][2] * wz + m[2][3];
  const [nx, ny, nz] = layer.dims;
  const i = Math.floor(vx + 0.5);
  const j = Math.floor(vy + 0.5);
  const k = Math.floor(vz + 0.5);
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 0;
  return Math.max(Math.round(layer.data[i + nx * (j + ny * k)]), 0);
}

function outlineHit(layer: SliceLayer, w: Vec3, du: Vec3, dv: Vec3): boolean {
  const o = layer.outline!;
  const centre = labelAt(layer, w[0], w[1], w[2]);
  if (centre === 0 || (o.selectedLabelId > 0 && centre !== o.selectedLabelId)) return false;
  for (const [sx, d] of [
    [1, du],
    [-1, du],
    [1, dv],
    [-1, dv],
  ] as Array<[number, Vec3]>) {
    if (labelAt(layer, w[0] + sx * d[0], w[1] + sx * d[1], w[2] + sx * d[2]) !== centre) return true;
  }
  return false;
}

export interface SliceFrame {
  origin: Vec3;
  /** Full-frame extents (per-pixel step x width / height). */
  U: Vec3;
  V: Vec3;
  width: number;
  height: number;
  crosshair?: { world: Vec3; color: [number, number, number, number] } | null;
}

const lutCache = new Map<string, Uint8Array>();

function parseStops(gradient: string): Array<[number, number, number]> {
  const hexes = gradient.match(/#[0-9a-fA-F]{6}/g) ?? ['#000000', '#ffffff'];
  return hexes.map((h) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]);
}

export function colormapLut(name: string): Uint8Array {
  const key = (name || 'gray').toLowerCase();
  const cached = lutCache.get(key);
  if (cached) return cached;
  const alias: Record<string, string> = {
    grey: 'gray',
    grayscale: 'gray',
    pet_hot_metal: 'pet',
    activation: 'fmri',
  };
  const option = colormaps.find((c) => c.name === (alias[key] ?? key)) ?? colormaps[0];
  const stops = parseStops(option.gradient);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (stops.length - 1);
    const s = Math.min(Math.floor(t), stops.length - 2);
    const f = t - s;
    for (let c = 0; c < 3; c++) {
      lut[i * 3 + c] = Math.round(stops[s][c] * (1 - f) + stops[s + 1][c] * f);
    }
  }
  lutCache.set(key, lut);
  return lut;
}

function sample(layer: SliceLayer, x: number, y: number, z: number): number {
  const [nx, ny, nz] = layer.dims;
  const d = layer.data;
  if (layer.nearest) {
    const i = Math.min(Math.floor(x + 0.5), nx - 1);
    const j = Math.min(Math.floor(y + 0.5), ny - 1);
    const k = Math.min(Math.floor(z + 0.5), nz - 1);
    return d[i + nx * (j + ny * k)];
  }
  const cx = Math.min(Math.max(x, 0), nx - 1);
  const cy = Math.min(Math.max(y, 0), ny - 1);
  const cz = Math.min(Math.max(z, 0), nz - 1);
  const i0 = Math.floor(cx),
    j0 = Math.floor(cy),
    k0 = Math.floor(cz);
  const i1 = Math.min(i0 + 1, nx - 1),
    j1 = Math.min(j0 + 1, ny - 1),
    k1 = Math.min(k0 + 1, nz - 1);
  const fx = cx - i0,
    fy = cy - j0,
    fz = cz - k0;
  const at = (i: number, j: number, k: number) => d[i + nx * (j + ny * k)];
  const c00 = at(i0, j0, k0) * (1 - fx) + at(i1, j0, k0) * fx;
  const c10 = at(i0, j1, k0) * (1 - fx) + at(i1, j1, k0) * fx;
  const c01 = at(i0, j0, k1) * (1 - fx) + at(i1, j0, k1) * fx;
  const c11 = at(i0, j1, k1) * (1 - fx) + at(i1, j1, k1) * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}

export function renderSlice(frame: SliceFrame, layers: SliceLayer[]): Uint8Array {
  const { width: W, height: H, origin, U, V } = frame;
  const out = new Uint8Array(W * H * 4);
  const luts = layers.map((l) => colormapLut(l.colormap));
  const px = Math.hypot(U[0], U[1], U[2]) / Math.max(W, 1);
  const py = Math.hypot(V[0], V[1], V[2]) / Math.max(H, 1);
  // Frame normal -> which world axes a crosshair line may be drawn along.
  const n: Vec3 = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
  const nn = Math.hypot(n[0], n[1], n[2]) || 1;
  const visibleAxis = n.map((c) => Math.abs(c / nn) < 0.9);
  const step = (t: number): [Vec3, Vec3] => [
    [(U[0] / W) * t, (U[1] / W) * t, (U[2] / W) * t],
    [(V[0] / H) * t, (V[1] / H) * t, (V[2] / H) * t],
  ];

  for (let y = 0; y < H; y++) {
    const ty = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const tx = (x + 0.5) / W;
      const wx = origin[0] + tx * U[0] + ty * V[0];
      const wy = origin[1] + tx * U[1] + ty * V[1];
      const wz = origin[2] + tx * U[2] + ty * V[2];
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        const m = layer.worldToVoxel;
        const vx = m[0][0] * wx + m[0][1] * wy + m[0][2] * wz + m[0][3];
        const vy = m[1][0] * wx + m[1][1] * wy + m[1][2] * wz + m[1][3];
        const vz = m[2][0] * wx + m[2][1] * wy + m[2][2] * wz + m[2][3];
        const [nx, ny, nz] = layer.dims;
        // Edge rule split (documented, intentional): the slicer draws voxel
        // coordinates in [0, n) like the GPU texture lookup, while value
        // queries (sample_layer_value_at_world, volume_queries::nearest_voxel)
        // answer for [-0.5, n - 0.5). The half-voxel rim at each face differs.
        if (vx < 0 || vy < 0 || vz < 0 || vx >= nx || vy >= ny || vz >= nz) continue;
        const value = sample(layer, vx, vy, vz);
        if (!Number.isFinite(value)) continue;
        const sa = layer.opacity;
        if (sa <= 0) continue;
        let lut = luts[li];
        let idx: number;
        if (layer.labelLut) {
          const id = Math.round(value);
          if (id <= 0 || (id + 1) * 3 > layer.labelLut.length) continue;
          lut = layer.labelLut;
          idx = id * 3;
        } else {
          if (value >= layer.threshold[0] && value <= layer.threshold[1]) continue;
          const span = Math.max(layer.intensity[1] - layer.intensity[0], 1e-9);
          const t = Math.min(Math.max((value - layer.intensity[0]) / span, 0), 1);
          idx = Math.round(t * 255) * 3;
        }
        const sr = lut[idx] / 255,
          sg = lut[idx + 1] / 255,
          sb = lut[idx + 2] / 255;
        if (layer.blend === 'additive') {
          r = Math.min(r + sr * sa, 1);
          g = Math.min(g + sg * sa, 1);
          b = Math.min(b + sb * sa, 1);
          a = Math.max(a, sa);
        } else if (layer.blend === 'max') {
          r = Math.max(r, sr);
          g = Math.max(g, sg);
          b = Math.max(b, sb);
          a = Math.max(a, sa);
        } else if (layer.blend === 'min') {
          r = Math.min(r, sr);
          g = Math.min(g, sg);
          b = Math.min(b, sb);
          a = Math.max(a, sa);
        } else {
          const oa = sa + a * (1 - sa);
          if (oa < 1e-5) {
            r = g = b = a = 0;
            continue;
          }
          r = (sr * sa + r * a * (1 - sa)) / oa;
          g = (sg * sa + g * a * (1 - sa)) / oa;
          b = (sb * sa + b * a * (1 - sa)) / oa;
          a = oa;
        }
        if (layer.outline) {
          const [du, dv] = step(Math.max(layer.outline.thicknessPx, 1));
          if (outlineHit(layer, [wx, wy, wz], du, dv)) {
            const [cr, cg, cb, ca] = layer.outline.color;
            const oa = ca + a * (1 - ca);
            if (oa > 1e-5) {
              r = (cr * ca + r * a * (1 - ca)) / oa;
              g = (cg * ca + g * a * (1 - ca)) / oa;
              b = (cb * ca + b * a * (1 - ca)) / oa;
              a = oa;
            }
          }
        }
      }
      const ch = frame.crosshair;
      if (ch) {
        const dx = Math.abs(wx - ch.world[0]);
        const dy = Math.abs(wy - ch.world[1]);
        const dz = Math.abs(wz - ch.world[2]);
        const hit =
          (visibleAxis[0] && dx < px && dy < py * 20 && dz < py * 20) ||
          (visibleAxis[1] && dy < py && dx < px * 20 && dz < px * 20) ||
          (visibleAxis[2] && dz < py && dx < px * 20 && dy < px * 20);
        if (hit) {
          const [cr, cg, cb, ca] = ch.color;
          const oa = ca + a * (1 - ca);
          r = (cr * ca + r * a * (1 - ca)) / oa;
          g = (cg * ca + g * a * (1 - ca)) / oa;
          b = (cb * ca + b * a * (1 - ca)) / oa;
          a = oa;
        }
      }
      const o = (y * W + x) * 4;
      out[o] = Math.round(r * 255);
      out[o + 1] = Math.round(g * 255);
      out[o + 2] = Math.round(b * 255);
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}
