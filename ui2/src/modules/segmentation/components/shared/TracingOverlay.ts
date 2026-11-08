/** The H partition/preview rules on a live affine grid and shared viewport projection. */
import type { SegmentationSnapshot, SegmentationPreview, SegmentationSlice } from '@brainflow/api';
import { projectWorldToCanvas, type SliceViewerPlane, type SliceViewerPlacement } from '@brainflow/visualization/slice';
import { enclosedGaps, voxelFillPath, voxelOutlinePath, voxelsOf } from './geometry';
import { mutedColor } from './colour';
import type { LabelVoxel, Voxel } from './types';

export function voxelWorld(affine: readonly number[], voxel: readonly number[]): [number, number, number] {
  // nalgebra's exported affine is column-major; voxel centres are integer coordinates.
  return [0, 1, 2].map((a) => affine[a] * voxel[0] + affine[4 + a] * voxel[1] + affine[8 + a] * voxel[2] + affine[12 + a]) as [number, number, number];
}
export function planeAxes(normal: number): [number, number] {
  return [0, 1, 2].filter((axis) => axis !== normal) as [number, number];
}
export function labelSliceVoxels(labels: readonly (readonly number[])[], normal: number): LabelVoxel[] {
  const axes = planeAxes(normal);
  return labels.map((voxel) => [voxel[axes[0]], voxel[axes[1]], voxel[3]]);
}
/** Screen transform of native voxel corners, preserving shear, spacing and all affine signs. */
export function nativeGridTransform(snapshot: SegmentationSnapshot, sliceIndex: number, plane: SliceViewerPlane, placement: SliceViewerPlacement): [number, number, number, number, number, number] | null {
  const axes = planeAxes(snapshot.normalAxis);
  const corner = (c: number, r: number) => {
    const voxel = [0, 0, 0]; voxel[snapshot.normalAxis] = sliceIndex;
    voxel[axes[0]] = c - 0.5; voxel[axes[1]] = r - 0.5;
    return projectWorldToCanvas(voxelWorld(snapshot.voxelToWorld, voxel), plane, placement);
  };
  const o = corner(0, 0), x = corner(1, 0), y = corner(0, 1);
  return o && x && y ? [x.canvasX - o.canvasX, x.canvasY - o.canvasY, y.canvasX - o.canvasX, y.canvasY - o.canvasY, o.canvasX, o.canvasY] : null;
}

/** Every label fill: one constant alpha, so tissue still reads through. */
export const LABEL_FILL_ALPHA = 0.3;
/** The active label's outline on the slices before and after (label colour, no fill). */
export const NEIGHBOUR_ALPHA = 0.6;

/** The pointer in canvas px and the brush radius in canvas px. */
export interface BrushHover { x: number; y: number; radiusPx: number }

/** Voxels whose centres fall inside the brush disc, from the native grid's screen transform. */
export function footprintVoxels(transform: readonly number[], hover: BrushHover): Voxel[] {
  const [a, b, c, d, e, f] = transform;
  const det = a * d - b * c;
  if (!det || hover.radiusPx <= 0) return [];
  // Native (column, row) of the pointer, as a voxel-corner coordinate.
  const col = (d * (hover.x - e) - c * (hover.y - f)) / det, row = (a * (hover.y - f) - b * (hover.x - e)) / det;
  // Enough for any shear: the inverse map stretches a radius by at most (|a|+|b|+|c|+|d|)/|det|.
  const reach = Math.ceil(hover.radiusPx * (Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(d)) / Math.abs(det)) + 1;
  const result: Voxel[] = [];
  for (let x = Math.floor(col) - reach; x <= Math.floor(col) + reach; x++) for (let y = Math.floor(row) - reach; y <= Math.floor(row) + reach; y++) {
    const px = a * (x + 0.5) + c * (y + 0.5) + e, py = b * (x + 0.5) + d * (y + 0.5) + f;
    if (Math.hypot(px - hover.x, py - hover.y) <= hover.radiusPx) result.push([x, y]);
  }
  return result;
}

export function drawTracingOverlay(ctx: CanvasRenderingContext2D, placement: SliceViewerPlacement, options: {
  snapshot: SegmentationSnapshot; sliceIndex: number; plane: SliceViewerPlane; slice: SegmentationSlice;
  activeLabelId: number; hiddenLabelIds: readonly number[]; preview: SegmentationPreview | null; fill: boolean;
  /** The brush under the pointer while not drawing; null hides it. */
  hover?: BrushHover | null;
}): void {
  const { snapshot, sliceIndex, plane, slice, activeLabelId, preview } = options;
  const transform = nativeGridTransform(snapshot, sliceIndex, plane, placement);
  if (!transform) return;
  const matrix = new DOMMatrix(transform);
  const path = (d: string) => { const result = new Path2D(); result.addPath(new Path2D(d), matrix); return result; };
  const fill = (voxels: readonly Voxel[], color: string, alpha: number) => {
    ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = alpha; ctx.fill(path(voxelFillPath(voxels))); ctx.restore();
  };
  const all = labelSliceVoxels(slice.labels, snapshot.normalAxis);
  const voxels = all.filter((v) => !options.hiddenLabelIds.includes(v[2]));
  const neutral = getComputedStyle(ctx.canvas).getPropertyValue('--bf-text-primary').trim() || 'white';
  const halo = getComputedStyle(ctx.canvas).getPropertyValue('--bf-bg-canvas').trim() || 'black';
  ctx.save();
  ctx.beginPath(); ctx.rect(placement.x, placement.y, placement.width, placement.height); ctx.clip();
  const groups = new Map<number, Voxel[]>();
  for (const [x, y, id] of voxels) { const cells = groups.get(id); if (cells) cells.push([x, y]); else groups.set(id, [[x, y]]); }
  // Neighbour slices first, under the labels: the active label's whole
  // outline on the slice before and after, a thin translucent line in its own
  // colour with no fill, never dashed. (A neutral line vanished on white matter.)
  const activeRow = snapshot.labels.find((row) => row.definition.id === activeLabelId);
  ctx.save(); ctx.strokeStyle = activeRow ? `rgb(${activeRow.definition.color.join(' ')})` : neutral; ctx.globalAlpha = NEIGHBOUR_ALPHA; ctx.lineWidth = 1; ctx.lineJoin = 'round';
  for (const neighbour of [slice.previousLabels, slice.nextLabels]) {
    const cells = voxelsOf(labelSliceVoxels(neighbour, snapshot.normalAxis), activeLabelId);
    if (cells.length) ctx.stroke(path(voxelOutlinePath(cells)));
  }
  ctx.restore();
  // Each label: one even fill (unless "Outline only") and a crisp outline on
  // its voxel edges. No halo and no clipping, so small pieces stay whole.
  for (const label of snapshot.labels) {
    const id = label.definition.id;
    const cells = groups.get(id) ?? [];
    if (!cells.length) continue;
    const color = `rgb(${label.definition.color.join(' ')})`;
    const active = id === activeLabelId;
    const stroke = active ? color : mutedColor(color, label.locked || label.complete ? 'quiet' : 'inactive');
    if (options.fill) fill(cells, stroke, LABEL_FILL_ALPHA);
    ctx.save(); ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.lineWidth = active ? 1.5 : 1;
    ctx.stroke(path(voxelOutlinePath(cells))); ctx.restore();
  }
  const centre = ([x, y]: Voxel) => ({ x: transform[0] * (x + 0.5) + transform[2] * (y + 0.5) + transform[4], y: transform[1] * (x + 0.5) + transform[3] * (y + 0.5) + transform[5] });
  ctx.fillStyle = neutral; ctx.strokeStyle = neutral; ctx.lineWidth = 1;
  const voxelPx = Math.min(Math.hypot(transform[0], transform[1]), Math.hypot(transform[2], transform[3]));
  if (voxelPx >= 6) for (const gap of enclosedGaps(voxels)) { const p = centre(gap); ctx.beginPath(); ctx.arc(p.x, p.y, 1, 0, Math.PI * 2); ctx.fill(); }
  // The brush footprint: the stroke's own voxels while drawing, otherwise the
  // voxels whose centres fall in the disc under the pointer.
  const axes = planeAxes(snapshot.normalAxis);
  const inGrid = ([x, y]: Voxel) => x >= 0 && y >= 0 && x < snapshot.dimensions[axes[0]] && y < snapshot.dimensions[axes[1]];
  const footprint = preview ? preview.written.map((v) => [v[axes[0]], v[axes[1]]] as Voxel) : options.hover ? footprintVoxels(transform, options.hover).filter(inGrid) : [];
  if (footprint.length) {
    fill(footprint, neutral, 0.18);
    ctx.strokeStyle = halo; ctx.lineWidth = 2.5; ctx.stroke(path(voxelOutlinePath(footprint)));
    ctx.strokeStyle = neutral; ctx.lineWidth = 1; ctx.stroke(path(voxelOutlinePath(footprint)));
  }
  if (preview) {
    if (preview.blocked.length) {
      const cells = preview.blocked.map((v) => [v[axes[0]], v[axes[1]]] as Voxel);
      ctx.strokeStyle = getComputedStyle(ctx.canvas).getPropertyValue('--bf-warning').trim();
      ctx.lineWidth = 1; ctx.stroke(path(voxelOutlinePath(cells)));
    }
  }
  ctx.restore();
}

/** Continuous native slice coordinate, using the dual basis rather than a world-axis guess. */
export function nativeSliceAtWorld(snapshot: SegmentationSnapshot, world: readonly number[]): number {
  const m = snapshot.voxelToWorld, axis = snapshot.normalAxis;
  const other = [0, 1, 2].filter((a) => a !== axis);
  const a = other.map((c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]]);
  const n = [a[0][1] * a[1][2] - a[0][2] * a[1][1], a[0][2] * a[1][0] - a[0][0] * a[1][2], a[0][0] * a[1][1] - a[0][1] * a[1][0]];
  const denominator = n.reduce((sum, v, r) => sum + v * m[axis * 4 + r], 0);
  return n.reduce((sum, v, r) => sum + v * (world[r] - m[12 + r]), 0) / denominator;
}

/** Brush radius in canvas px for a radius in mm. */
export function brushRadiusPx(radiusMm: number, plane: SliceViewerPlane, placement: SliceViewerPlacement): number {
  return radiusMm / Math.hypot(...plane.u_mm) * placement.width / placement.imageWidth;
}

/** The crosshair clears three brush radii around the brush, and only while the brush is over the image. */
export function tracingClearance(brush: { x: number; y: number } | null, radiusPx: number) {
  if (!brush || radiusPx <= 0) return [];
  const gap = 3 * radiusPx;
  return [{ x: brush.x - gap, y: brush.y - gap, width: 2 * gap, height: 2 * gap }];
}
