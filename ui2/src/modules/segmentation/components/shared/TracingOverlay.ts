/** The H partition/preview rules on a live affine grid and shared viewport projection. */
import type { SegmentationSnapshot, SegmentationPreview, SegmentationSlice } from '@brainflow/api';
import { projectWorldToCanvas, type SliceViewerPlane, type SliceViewerPlacement } from '@brainflow/visualization/slice';
import { enclosedGaps, insetVoxels, labelIslands, neighbourDeparturePath, voxelFillPath, voxelOutlinePath, voxelsOf } from './geometry';
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

export function drawTracingOverlay(ctx: CanvasRenderingContext2D, placement: SliceViewerPlacement, options: {
  snapshot: SegmentationSnapshot; sliceIndex: number; plane: SliceViewerPlane; slice: SegmentationSlice;
  activeLabelId: number; hiddenLabelIds: readonly number[]; preview: SegmentationPreview | null; fill: boolean;
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
  for (const label of snapshot.labels) {
    const id = label.definition.id;
    const cells = groups.get(id) ?? [];
    if (!cells.length) continue;
    const color = `rgb(${label.definition.color.join(' ')})`;
    const active = id === activeLabelId;
    const stroke = active ? color : mutedColor(color, label.locked || label.complete ? 'quiet' : 'inactive');
    if (options.fill) fill(cells, color, 0.25);
    else if (active) fill(insetVoxels(voxels, id), color, 0.1);
    // Clipping each doubled stroke to its own partition draws both inner edges
    // at a shared boundary, each in the label's own colour with a dark halo.
    ctx.save(); ctx.clip(path(voxelFillPath(cells)));
    const edge = path(voxelOutlinePath(cells));
    ctx.lineJoin = 'miter'; ctx.strokeStyle = halo; ctx.lineWidth = (active ? 1.5 : 1) * 2 + 1.5; ctx.stroke(edge);
    ctx.strokeStyle = stroke; ctx.lineWidth = (active ? 1.5 : 1) * 2; ctx.stroke(edge); ctx.restore();
  }
  // Native neighbours have one neutral solid line only where their boundary departs.
  const current = voxelsOf(all, activeLabelId);
  ctx.strokeStyle = neutral; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
  for (const neighbour of [slice.previousLabels, slice.nextLabels]) {
    const previous = voxelsOf(labelSliceVoxels(neighbour, snapshot.normalAxis), activeLabelId);
    ctx.stroke(path(neighbourDeparturePath(previous, current)));
  }
  ctx.globalAlpha = 1;
  const centre = ([x, y]: Voxel) => ({ x: transform[0] * (x + 0.5) + transform[2] * (y + 0.5) + transform[4], y: transform[1] * (x + 0.5) + transform[3] * (y + 0.5) + transform[5] });
  ctx.fillStyle = neutral; ctx.strokeStyle = neutral; ctx.lineWidth = 1;
  const voxelPx = Math.min(Math.hypot(transform[0], transform[1]), Math.hypot(transform[2], transform[3]));
  if (voxelPx >= 6) for (const gap of enclosedGaps(voxels)) { const p = centre(gap); ctx.beginPath(); ctx.arc(p.x, p.y, 1, 0, Math.PI * 2); ctx.fill(); }
  for (const island of labelIslands(voxels, activeLabelId)) {
    const x = island.reduce((sum, v) => sum + v[0], 0) / island.length;
    const y = island.reduce((sum, v) => sum + v[1], 0) / island.length;
    const p = centre([x, y]); ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(4, voxelPx * Math.sqrt(island.length) * 0.65), 0, Math.PI * 2); ctx.stroke();
  }
  if (preview) {
    const axes = planeAxes(snapshot.normalAxis);
    const cells = preview.written.map((v) => [v[axes[0]], v[axes[1]]] as Voxel);
    fill(cells, neutral, 0.18);
    ctx.strokeStyle = halo; ctx.lineWidth = 2.5; ctx.stroke(path(voxelOutlinePath(cells)));
    ctx.strokeStyle = neutral; ctx.lineWidth = 1; ctx.stroke(path(voxelOutlinePath(cells)));
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

/** The crosshair avoids the visible structure and at least three brush radii. */
export function tracingClearance(snapshot: SegmentationSnapshot, slice: SegmentationSlice, index: number, plane: SliceViewerPlane, placement: SliceViewerPlacement, cursor: [number, number, number] | null, radiusMm: number) {
  const result: Array<{ x: number; y: number; width: number; height: number }> = [];
  const transform = nativeGridTransform(snapshot, index, plane, placement);
  const cells = labelSliceVoxels(slice.labels, snapshot.normalAxis);
  if (transform && cells.length) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of cells) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
    const corners = [[x0, y0], [x0, y1], [x1, y0], [x1, y1]].map(([x, y]) => [transform[0] * x + transform[2] * y + transform[4], transform[1] * x + transform[3] * y + transform[5]]);
    const left = Math.min(...corners.map((v) => v[0])) - 4, top = Math.min(...corners.map((v) => v[1])) - 4;
    result.push({ x: left, y: top, width: Math.max(...corners.map((v) => v[0])) + 4 - left, height: Math.max(...corners.map((v) => v[1])) + 4 - top });
  }
  const point = cursor ? projectWorldToCanvas(cursor, plane, placement) : null;
  if (point && radiusMm > 0) {
    const gap = 3 * radiusMm / Math.hypot(...plane.u_mm) * placement.width / placement.imageWidth;
    result.push({ x: point.canvasX - gap, y: point.canvasY - gap, width: 2 * gap, height: 2 * gap });
  }
  return result;
}
