/**
 * Slice geometry for the design mocks: display <-> world mm on the 1 mm MNI
 * reference grid, the brush rasterization rule, the constraint gate, and SVG
 * paths for voxel fills and voxel-edge outlines.
 *
 * The brush rule is the one research contract 4 asks for ("cursor equals
 * fill"): a voxel is painted when its CENTRE lies inside the brush disc,
 * measured in millimetres on the reference grid, so the preview footprint and
 * the written voxels are the same set at every zoom.
 */

import type { LabelState, LabelVoxel, Plane, Point, Voxel } from './types';

/** Grid of the MNI152NLin2009cAsym 1 mm template (origin of voxel 0,0,0). */
const ORIGIN = [-96, -132, -78] as const;
const DIMS = [193, 229, 193] as const;

/** World mm of a display point on a slice (voxel centres sit at c + 0.5). */
export function displayToWorld(plane: Plane, index: number, p: Point): [number, number, number] {
  const [c, r] = [p[0] - 0.5, p[1] - 0.5];
  switch (plane) {
    case 'coronal':
      return [ORIGIN[0] + c, ORIGIN[1] + index, ORIGIN[2] + (DIMS[2] - 1 - r)];
    case 'axial':
      return [ORIGIN[0] + c, ORIGIN[1] + (DIMS[1] - 1 - r), ORIGIN[2] + index];
    case 'sagittal':
      return [ORIGIN[0] + index, ORIGIN[1] + (DIMS[1] - 1 - c), ORIGIN[2] + (DIMS[2] - 1 - r)];
  }
}

/** Display point of a world position projected onto a slice plane. */
export function worldToDisplay(plane: Plane, w: readonly [number, number, number]): Point {
  const i = w[0] - ORIGIN[0];
  const j = w[1] - ORIGIN[1];
  const k = w[2] - ORIGIN[2];
  switch (plane) {
    case 'coronal':
      return [i + 0.5, DIMS[2] - 1 - k + 0.5];
    case 'axial':
      return [i + 0.5, DIMS[1] - 1 - j + 0.5];
    case 'sagittal':
      return [DIMS[1] - 1 - j + 0.5, DIMS[2] - 1 - k + 0.5];
  }
}

/** Slice position along the plane normal, mm. */
export function slicePositionMm(plane: Plane, index: number): number {
  if (plane === 'coronal') return ORIGIN[1] + index;
  if (plane === 'axial') return ORIGIN[2] + index;
  return ORIGIN[0] + index;
}

export const PLANE_AXIS: Record<Plane, 'x' | 'y' | 'z'> = { coronal: 'y', axial: 'z', sagittal: 'x' };
export const PLANE_NAME: Record<Plane, string> = { coronal: 'Coronal', axial: 'Axial', sagittal: 'Sagittal' };

/** Orientation letters at the panel edges [left, right, top, bottom]. */
export const PLANE_LETTERS: Record<Plane, readonly [string, string, string, string]> = {
  coronal: ['L', 'R', 'S', 'I'],
  axial: ['L', 'R', 'A', 'P'],
  sagittal: ['A', 'P', 'S', 'I'],
};

/** Signed mm with a true minus sign and one decimal ("−22.0"). */
export function fmtMm(v: number, digits = 1): string {
  const s = Math.abs(v).toFixed(digits);
  return v < 0 ? `−${s}` : s;
}

/** Grouped integer ("1,376"). */
export function fmtInt(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

const key = (c: number, r: number) => `${c},${r}`;

/** Voxels whose centres lie inside a disc of `radiusMm` (1 px = 1 mm) around `center`. */
export function discFootprint(center: Point, radiusMm: number): Voxel[] {
  const out: Voxel[] = [];
  const r2 = radiusMm * radiusMm;
  for (let r = Math.floor(center[1] - radiusMm) - 1; r <= Math.ceil(center[1] + radiusMm); r++) {
    for (let c = Math.floor(center[0] - radiusMm) - 1; c <= Math.ceil(center[0] + radiusMm); c++) {
      const dx = c + 0.5 - center[0];
      const dy = r + 0.5 - center[1];
      if (dx * dx + dy * dy <= r2) out.push([c, r]);
    }
  }
  return out;
}

/** Union of brush discs swept along a polyline (sampled every quarter voxel). */
export function strokeFootprint(points: readonly Point[], radiusMm: number): Voxel[] {
  const seen = new Map<string, Voxel>();
  const add = (p: Point) => {
    for (const v of discFootprint(p, radiusMm)) seen.set(key(v[0], v[1]), v);
  };
  if (points.length === 1) add(points[0]);
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25));
    for (let s = 0; s <= n; s++) add([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]);
  }
  return [...seen.values()];
}

export type PaintOver = 'unlocked' | 'background' | 'all';

export interface GateResult {
  /** Voxels the stroke writes. */
  written: Voxel[];
  /** Voxels refused, with the label that protected each. */
  blocked: Array<{ voxel: Voxel; label: number }>;
}

/**
 * The constraint gate every tool shares: labels in `locked` are never
 * overwritten; `background` only writes empty voxels; voxels already holding
 * the active label are no-ops (neither written nor blocked).
 */
export function gateStroke(
  footprint: readonly Voxel[],
  labelsAt: ReadonlyMap<string, number>,
  active: number,
  locked: ReadonlySet<number>,
  paintOver: PaintOver,
): GateResult {
  const written: Voxel[] = [];
  const blocked: GateResult['blocked'] = [];
  for (const v of footprint) {
    const cur = labelsAt.get(key(v[0], v[1])) ?? 0;
    if (cur === active) continue;
    if (cur !== 0 && (locked.has(cur) || paintOver === 'background')) {
      blocked.push({ voxel: v, label: cur });
      continue;
    }
    written.push(v);
  }
  return { written, blocked };
}

export function labelIndex(voxels: readonly LabelVoxel[]): Map<string, number> {
  return new Map(voxels.map(([c, r, l]) => [key(c, r), l]));
}

/** SVG path covering a set of voxels (one unit square each). */
export function voxelFillPath(voxels: readonly Voxel[]): string {
  return voxels.map(([c, r]) => `M${c} ${r}h1v1h-1z`).join('');
}

/** SVG path of the voxel edges that separate a set from everything else. */
export function voxelOutlinePath(voxels: readonly Voxel[]): string {
  const inSet = new Set(voxels.map(([c, r]) => key(c, r)));
  const parts: string[] = [];
  for (const [c, r] of voxels) {
    if (!inSet.has(key(c, r - 1))) parts.push(`M${c} ${r}h1`);
    if (!inSet.has(key(c, r + 1))) parts.push(`M${c} ${r + 1}h1`);
    if (!inSet.has(key(c - 1, r))) parts.push(`M${c} ${r}v1`);
    if (!inSet.has(key(c + 1, r))) parts.push(`M${c + 1} ${r}v1`);
  }
  return parts.join('');
}

/** Voxels of one label (or several) from a label slice. */
export function voxelsOf(voxels: readonly LabelVoxel[], ids: number | readonly number[]): Voxel[] {
  const want = new Set(typeof ids === 'number' ? [ids] : ids);
  return voxels.filter((v) => want.has(v[2])).map(([c, r]) => [c, r] as Voxel);
}

/** Voxels where two raters disagree (either labelled, labels differ). */
export function disagreement(a: readonly LabelVoxel[], b: readonly LabelVoxel[]): Voxel[] {
  const ia = labelIndex(a);
  const ib = labelIndex(b);
  const out: Voxel[] = [];
  for (const k of new Set([...ia.keys(), ...ib.keys()])) {
    if ((ia.get(k) ?? 0) !== (ib.get(k) ?? 0)) {
      const [c, r] = k.split(',').map(Number);
      out.push([c, r]);
    }
  }
  return out;
}

/** Connected groups of voxels (4-neighbour), largest first. */
export function components(voxels: readonly Voxel[]): Voxel[][] {
  const left = new Map(voxels.map((v) => [key(v[0], v[1]), v]));
  const groups: Voxel[][] = [];
  for (const start of voxels) {
    if (!left.has(key(start[0], start[1]))) continue;
    const group: Voxel[] = [];
    const stack: Voxel[] = [start];
    left.delete(key(start[0], start[1]));
    while (stack.length) {
      const v = stack.pop()!;
      group.push(v);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = key(v[0] + dc, v[1] + dr);
        const n = left.get(k);
        if (n) {
          left.delete(k);
          stack.push(n);
        }
      }
    }
    groups.push(group);
  }
  return groups.sort((x, y) => y.length - x.length);
}

/** Bounding box of a voxel set (display coords), grown by `marginMm` on every side. */
export function bboxOf(voxels: readonly Voxel[], marginMm = 0): { x0: number; y0: number; x1: number; y1: number } {
  const xs = voxels.map((v) => v[0]);
  const ys = voxels.map((v) => v[1]);
  return {
    x0: Math.min(...xs) - marginMm,
    y0: Math.min(...ys) - marginMm,
    x1: Math.max(...xs) + 1 + marginMm,
    y1: Math.max(...ys) + 1 + marginMm,
  };
}

/** Bounding-box centre of a voxel set (display coords). */
export function centreOf(voxels: readonly Voxel[]): Point {
  const xs = voxels.map((v) => v[0]);
  const ys = voxels.map((v) => v[1]);
  return [(Math.min(...xs) + Math.max(...xs) + 1) / 2, (Math.min(...ys) + Math.max(...ys) + 1) / 2];
}

// ---------------------------------------------------------------------------
// Label partition rendering (round 1). A label slice is an exclusive
// partition: one label per voxel. Fills use one constant alpha; outlines run
// only where the label changes, and every voxel edge is drawn exactly once.

/** Constant fill alpha for label voxels (critique round 0: at most 0.25). */
export const LABEL_FILL_ALPHA = 0.22;

const H = (c: number, r: number) => `h${c},${r}`; // edge on top of voxel (c, r)
const V = (c: number, r: number) => `v${c},${r}`; // edge on the left of voxel (c, r)

function edgeD(edge: string): string {
  const [c, r] = edge.slice(1).split(',').map(Number);
  return edge[0] === 'h' ? `M${c} ${r}h1` : `M${c} ${r}v1`;
}

/** The 4 edges between a voxel and its neighbours, as [edge key, neighbour]. */
function edgesOf(c: number, r: number): Array<[string, number, number]> {
  return [
    [H(c, r), c, r - 1],
    [H(c, r + 1), c, r + 1],
    [V(c, r), c - 1, r],
    [V(c + 1, r), c + 1, r],
  ];
}

export interface PartitionEdge {
  /** The label whose colour draws the edge. */
  label: number;
  /** SVG path in display units. */
  d: string;
  /** Edge count (for tests). */
  count: number;
}

/**
 * Boundary edges of a label partition, each drawn once. An edge between a
 * label and background belongs to the label. An edge between two labels
 * belongs to the higher-priority one: labels in `priority` first (in order,
 * normally the active label), then the lower id. Within a label, voxels of
 * the same label never produce an edge.
 */
export function partitionEdges(voxels: readonly LabelVoxel[], priority: readonly number[] = []): PartitionEdge[] {
  const at = labelIndex(voxels);
  const rank = (l: number) => {
    const i = priority.indexOf(l);
    return i >= 0 ? i - priority.length : l;
  };
  const byLabel = new Map<number, string[]>();
  for (const [c, r, l] of voxels) {
    for (const [edge, nc, nr] of edgesOf(c, r)) {
      const m = at.get(key(nc, nr)) ?? 0;
      if (m === l) continue;
      // Shared edge: only the owner emits it, so it is drawn once.
      if (m !== 0 && rank(m) < rank(l)) continue;
      const list = byLabel.get(l) ?? [];
      list.push(edge);
      byLabel.set(l, list);
    }
  }
  return [...byLabel.entries()]
    .sort((a, b) => rank(b[0]) - rank(a[0]))
    .map(([label, edges]) => ({ label, d: edges.map(edgeD).join(''), count: edges.length }));
}

/** The set of boundary edges of a partition (edge keys), for comparisons. */
export function boundaryEdgeSet(voxels: readonly LabelVoxel[]): Set<string> {
  const at = labelIndex(voxels);
  const out = new Set<string>();
  for (const [c, r, l] of voxels) {
    for (const [edge, nc, nr] of edgesOf(c, r)) if ((at.get(key(nc, nr)) ?? 0) !== l) out.add(edge);
  }
  return out;
}

export interface ReviewEncoding {
  /** Rater B's boundary edges that are not rater A's (drawn as a neutral dash). */
  departures: string;
  departureCount: number;
  /** A labelled, B background. */
  aOnly: Voxel[];
  /** B labelled, A background. */
  bOnly: Voxel[];
  /** Both labelled, with different labels. */
  relabelled: Voxel[];
}

/**
 * Review encoding of two raters on one slice: A's outline is the reference
 * (drawn once, solid, label colour); B is drawn only where its boundary
 * departs from A's; disagreeing voxels split into A only, B only and
 * relabelled, each with its own achromatic texture.
 */
export function reviewEncoding(a: readonly LabelVoxel[], b: readonly LabelVoxel[]): ReviewEncoding {
  const ea = boundaryEdgeSet(a);
  const eb = boundaryEdgeSet(b);
  const dep = [...eb].filter((e) => !ea.has(e)).sort();
  const ia = labelIndex(a);
  const ib = labelIndex(b);
  const aOnly: Voxel[] = [];
  const bOnly: Voxel[] = [];
  const relabelled: Voxel[] = [];
  for (const k of [...new Set([...ia.keys(), ...ib.keys()])].sort()) {
    const la = ia.get(k) ?? 0;
    const lb = ib.get(k) ?? 0;
    if (la === lb) continue;
    const [c, r] = k.split(',').map(Number);
    (lb === 0 ? aOnly : la === 0 ? bOnly : relabelled).push([c, r]);
  }
  return { departures: dep.map(edgeD).join(''), departureCount: dep.length, aOnly, bOnly, relabelled };
}

/** Replace voxels with `label` (a stroke's written voxels join the partition). */
export function paintInto(voxels: readonly LabelVoxel[], written: readonly Voxel[], label: number): LabelVoxel[] {
  const w = new Set(written.map(([c, r]) => key(c, r)));
  return [...voxels.filter(([c, r]) => !w.has(key(c, r))), ...written.map(([c, r]) => [c, r, label] as LabelVoxel)];
}

/**
 * The crosshair yields while a paint tool is active: it opens a gap of at
 * least three brush radii around the cursor (and never less than `minPx`).
 */
export function crosshairGapRadius(brushRadiusPx: number, minPx = 12): number {
  return Math.max(3 * brushRadiusPx, minPx);
}

/** Native acquisition geometry (mm): in-plane x, in-plane y, slice thickness. */
export type Spacing = readonly [number, number, number];

export interface BrushReadout {
  /** Voxels across the disc's diameter, in-plane. */
  across: number;
  /** Voxels inside the disc on one slice (centre-inside rule). */
  inPlane: number;
  /** Slices the brush writes through-plane (1 for a 2D disc). */
  slices: number;
}

/**
 * What a brush of `diameterMm` writes on a native grid, centred on a voxel
 * centre, by the same centre-inside rule as the footprint.
 */
export function brushReadout(diameterMm: number, spacing: Spacing, shape: '2D' | '3D'): BrushReadout {
  const r = diameterMm / 2;
  const nx = Math.floor(r / spacing[0] + 1e-9);
  const ny = Math.floor(r / spacing[1] + 1e-9);
  let inPlane = 0;
  for (let j = -ny; j <= ny; j++)
    for (let i = -nx; i <= nx; i++) if ((i * spacing[0]) ** 2 + (j * spacing[1]) ** 2 <= r * r + 1e-9) inPlane++;
  const nz = Math.floor(r / spacing[2] + 1e-9);
  return { across: 2 * nx + 1, inPlane, slices: shape === '2D' ? 1 : 2 * nz + 1 };
}

/** Review gate: Approve is available only once every disagreement was visited. */
export function canApprove(visited: ReadonlySet<number> | readonly number[], total: number): boolean {
  const n = Array.isArray(visited) ? new Set(visited).size : (visited as ReadonlySet<number>).size;
  return total === 0 || n >= total;
}

/** Voxel volume of the grid the counts are on: 1 mm isotropic shows mm³ only. */
export interface CountGrid {
  voxelMm3: number;
}

/** "1,376 mm³" on a 1 mm grid; "1,376 vx · 440 mm³" otherwise. */
export function formatVolume(voxels: number, grid: CountGrid = { voxelMm3: 1 }): string {
  if (Math.abs(grid.voxelMm3 - 1) < 1e-9) return `${fmtInt(voxels)} mm³`;
  return `${fmtInt(voxels)} vx · ${fmtInt(voxels * grid.voxelMm3)} mm³`;
}

// ---------------------------------------------------------------------------
// Round 3: inner-edge label strokes. Every label strokes the inner edge of
// its own voxels, so on a shared edge both labels show, each in its own
// colour on its own side; emphasis levels set width and opacity.

export type InnerSide = 'top' | 'bottom' | 'left' | 'right';

/** One boundary edge of a label, on the inside of the voxel that owns it. */
export interface InnerEdge {
  c: number;
  r: number;
  side: InnerSide;
}

/**
 * Boundary edges of one label (every edge where the neighbour is another
 * label or background), each attributed to the label's own voxel. A shared
 * edge between labels 1 and 2 appears once for each, on opposite sides.
 */
export function innerEdges(voxels: readonly LabelVoxel[], label: number): InnerEdge[] {
  const at = labelIndex(voxels);
  const out: InnerEdge[] = [];
  for (const [c, r, l] of voxels) {
    if (l !== label) continue;
    if ((at.get(key(c, r - 1)) ?? 0) !== l) out.push({ c, r, side: 'top' });
    if ((at.get(key(c, r + 1)) ?? 0) !== l) out.push({ c, r, side: 'bottom' });
    if ((at.get(key(c - 1, r)) ?? 0) !== l) out.push({ c, r, side: 'left' });
    if ((at.get(key(c + 1, r)) ?? 0) !== l) out.push({ c, r, side: 'right' });
  }
  return out;
}

const n4 = (v: number) => +v.toFixed(4);

/**
 * Filled SVG path of the band between `t0` and `t1` (display units, measured
 * inward from the edge; a negative `t0` reaches outside) along a label's
 * inner edges, plus the concave corners the edge bands leave open.
 */
export function innerBandPath(voxels: readonly LabelVoxel[], label: number, t0: number, t1: number): string {
  const at = labelIndex(voxels);
  const own = (c: number, r: number) => (at.get(key(c, r)) ?? 0) === label;
  const rect = (x: number, y: number, w: number, h: number) => `M${n4(x)} ${n4(y)}h${n4(w)}v${n4(h)}h${n4(-w)}z`;
  const parts: string[] = [];
  const t = t1 - t0;
  for (const e of innerEdges(voxels, label)) {
    const { c, r } = e;
    if (e.side === 'top') parts.push(rect(c, r + t0, 1, t));
    else if (e.side === 'bottom') parts.push(rect(c, r + 1 - t1, 1, t));
    else if (e.side === 'left') parts.push(rect(c + t0, r, t, 1));
    else parts.push(rect(c + 1 - t1, r, t, 1));
  }
  // Concave corners: both side neighbours belong to the label, the diagonal does not.
  for (const [c, r, l] of voxels) {
    if (l !== label) continue;
    for (const [dc, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      if (own(c + dc, r) && own(c, r + dr) && !own(c + dc, r + dr)) {
        // The square within t1 of the corner, less the square within t0 (an L when t0 > 0).
        const a = Math.max(0, t0);
        const x = dc > 0 ? c + 1 - t1 : c;
        const y = dr > 0 ? r + 1 - t1 : r;
        if (a === 0) parts.push(rect(x, y, t1, t1));
        else {
          const w = t1 - a;
          // Strip along the far side (full t1 height), then the remaining strip.
          parts.push(rect(dc > 0 ? x : c + a, y, w, t1));
          parts.push(rect(dc > 0 ? c + 1 - a : c, dr > 0 ? y : r + a, a, w));
        }
      }
    }
  }
  return parts.join('');
}

/** Voxels of a label whose eight neighbours all share it: the fill inset by one voxel. */
export function insetVoxels(voxels: readonly LabelVoxel[], label: number): Voxel[] {
  const at = labelIndex(voxels);
  const out: Voxel[] = [];
  for (const [c, r, l] of voxels) {
    if (l !== label) continue;
    let inside = true;
    for (let dr = -1; dr <= 1 && inside; dr++)
      for (let dc = -1; dc <= 1; dc++) if ((at.get(key(c + dc, r + dr)) ?? 0) !== label) inside = false;
    if (inside) out.push([c, r]);
  }
  return out;
}

/** Unlabelled voxels enclosed by labels (not connected to the outside through unlabelled voxels). */
export function enclosedGaps(voxels: readonly LabelVoxel[]): Voxel[] {
  if (!voxels.length) return [];
  const at = labelIndex(voxels);
  const { x0, y0, x1, y1 } = bboxOf(voxels.map(([c, r]) => [c, r] as Voxel), 1);
  const outside = new Set<string>();
  const stack: Voxel[] = [[x0, y0]];
  outside.add(key(x0, y0));
  while (stack.length) {
    const [c, r] = stack.pop()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const [nc, nr] = [c + dc, r + dr];
      if (nc < x0 || nr < y0 || nc >= x1 || nr >= y1) continue;
      const k = key(nc, nr);
      if (outside.has(k) || at.has(k)) continue;
      outside.add(k);
      stack.push([nc, nr]);
    }
  }
  const out: Voxel[] = [];
  for (let r = y0; r < y1; r++) for (let c = x0; c < x1; c++) if (!at.has(key(c, r)) && !outside.has(key(c, r))) out.push([c, r]);
  return out;
}

/** Emphasis of a label's stroke: the active label, the other labels, and complete or locked ones (quieter). */
export type LabelEmphasis = 'active' | 'inactive' | 'quiet' | 'plain';

/** Stroke width (screen px) and opacity per emphasis level. */
export const LABEL_STROKE: Readonly<Record<LabelEmphasis, { width: number; opacity: number }>> = {
  active: { width: 1.5, opacity: 1 },
  inactive: { width: 1, opacity: 0.58 },
  quiet: { width: 1, opacity: 0.46 },
  plain: { width: 1, opacity: 1 },
};

/** Faint fill of the active label, inset by one voxel so the traced edge stays untinted. */
export const ACTIVE_FILL_ALPHA = 0.1;

/** With no active label every stroke is plain; otherwise active, quiet (complete/locked) or inactive. */
export function labelEmphasis(id: number, active: readonly number[], quiet: readonly number[] = []): LabelEmphasis {
  if (!active.length) return 'plain';
  if (active.includes(id)) return 'active';
  return quiet.includes(id) ? 'quiet' : 'inactive';
}

/**
 * The neighbour slice's outline only where it departs from the current
 * slice's by more than `tol` voxels (edge midpoints, Chebyshev distance):
 * where the two agree the line would only double the label's own.
 */
export function neighbourDeparturePath(prev: readonly Voxel[], cur: readonly Voxel[], tol = 1): string {
  const mids = (vs: readonly Voxel[]) => {
    const set = new Set(vs.map(([c, r]) => key(c, r)));
    const out: Array<{ x: number; y: number; d: string }> = [];
    for (const [c, r] of vs) {
      if (!set.has(key(c, r - 1))) out.push({ x: c + 0.5, y: r, d: `M${c} ${r}h1` });
      if (!set.has(key(c, r + 1))) out.push({ x: c + 0.5, y: r + 1, d: `M${c} ${r + 1}h1` });
      if (!set.has(key(c - 1, r))) out.push({ x: c, y: r + 0.5, d: `M${c} ${r}v1` });
      if (!set.has(key(c + 1, r))) out.push({ x: c + 1, y: r + 0.5, d: `M${c + 1} ${r}v1` });
    }
    return out;
  };
  const a = mids(prev);
  const b = mids(cur);
  return a
    .filter((e) => b.every((f) => Math.max(Math.abs(e.x - f.x), Math.abs(e.y - f.y)) > tol))
    .map((e) => e.d)
    .join('');
}

/** Whether a label's lock departs from what its status implies (complete means locked). */
export function lockDeparts(label: Pick<LabelState, 'status' | 'locked'>): boolean {
  return label.status === 'complete' ? !label.locked : label.locked;
}
