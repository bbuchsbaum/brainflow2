/** Below this centre width the similarity strip is a sheet over the grid. */
export const STRIP_SHEET_BELOW_PX = 720;
export const STRIP_MAX_PX = 300;
export const STRIP_FRACTION = 0.4;
export const STRIP_RAIL_PX = 24;

/** Where and how wide the strip is for a row `width` px wide. */
export function stripLayout(width: number, collapsed: boolean) {
  const mode: 'inline' | 'sheet' = width < STRIP_SHEET_BELOW_PX ? 'sheet' : 'inline';
  const open =
    mode === 'inline'
      ? Math.min(STRIP_MAX_PX, Math.floor(width * STRIP_FRACTION))
      : // A sheet never covers the grid: at most the strip's width, and 40 % of the row stays visible.
        Math.min(STRIP_MAX_PX, Math.max(STRIP_RAIL_PX, Math.floor(width * 0.6)));
  return { mode, width: collapsed ? STRIP_RAIL_PX : open };
}

/* ------------------------------------------------------------------------ */
/* The relationship map's frame and its labels (pure geometry).             */
/* ------------------------------------------------------------------------ */

/** A drawing frame in viewBox units, with a margin kept free for edge marks and labels. */
export interface ScatterFrame {
  w: number;
  h: number;
  margin: number;
}

/** A point as drawn: inside the frame, or clamped to its edge (`out` is the unit direction it lies off). */
export interface ProjectedPoint {
  x: number;
  y: number;
  /** Where it would be drawn without clamping (outside the frame when clamped). */
  trueX: number;
  trueY: number;
  out: [number, number] | null;
}

/** Padding round the framed extent, as a share of its span on each side. */
export const ROBUST_PADDING = 0.08;

function quantile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at),
    hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** A true outlier lies further than this many robust SDs (1.4826 × MAD) from the median on an axis. */
export const OUTLIER_ROBUST_SD = 3;

/** Below this many points every point is drawn where it lies: the extent is the full range. */
export const ROBUST_MIN_POINTS = 20;

/**
 * Whether the robust ("core") framing can differ from the full range: it
 * needs `ROBUST_MIN_POINTS` finite points. Below that "Fit core" frames
 * every point, as "Fit all" does, so the choice offers nothing.
 */
export function robustFramingAvailable(coordinates: readonly (readonly [number, number])[]): boolean {
  let finite = 0;
  for (const point of coordinates)
    if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) finite += 1;
  return finite >= ROBUST_MIN_POINTS;
}

/**
 * One axis's inlier band: the median ± `OUTLIER_ROBUST_SD` robust SDs. With
 * no spread (more than half the values equal) nothing on the axis is an outlier.
 */
function inlierBand(sorted: readonly number[]): [number, number] {
  const median = quantile(sorted, 0.5);
  const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const sd = 1.4826 * quantile(deviations, 0.5);
  if (!(sd > 0)) return [-Infinity, Infinity];
  return [median - OUTLIER_ROBUST_SD * sd, median + OUTLIER_ROBUST_SD * sd];
}

/**
 * How the map is framed:
 * - `core`: the robust core of all points (every point within
 *   `OUTLIER_ROBUST_SD` robust SDs of the median on both axes); anything
 *   further, a whole dispersed group included, is drawn as an edge tick and
 *   named in the off-scale note. The similarity strip's default ("Fit core").
 * - `groups`: the core widened to take in any group that would lose half or
 *   more of its members (the wide relationship panel).
 * - `all`: every point in the frame ("Fit all").
 * Fewer than `ROBUST_MIN_POINTS` points always frame the full range.
 */
export type ScatterExtent = 'core' | 'groups' | 'all';

/**
 * The extent each axis is framed on. Fewer than `ROBUST_MIN_POINTS` points:
 * the full range, so no genuine extreme is pinned to the edge. Otherwise the
 * box of every point within `OUTLIER_ROBUST_SD` robust SDs of the median on
 * both axes, widened to take in any group (two or more members) that would
 * otherwise lose half or more of its members to the edge: clamping a whole
 * minority group is an integrity failure, not outlier handling. Lone true
 * outliers stay outside.
 */
function framingRanges(
  coordinates: readonly (readonly [number, number])[],
  groups: readonly (readonly number[])[],
  extent: ScatterExtent,
): [[number, number], [number, number]] {
  const finiteAt = (i: number) =>
    !!coordinates[i] && Number.isFinite(coordinates[i][0]) && Number.isFinite(coordinates[i][1]);
  const finite = coordinates.flatMap((_, i) => (finiteAt(i) ? [i] : []));
  const box = (indices: readonly number[]): [[number, number], [number, number]] => {
    const xs = indices.map((i) => coordinates[i][0]);
    const ys = indices.map((i) => coordinates[i][1]);
    return xs.length
      ? [
          [Math.min(...xs), Math.max(...xs)],
          [Math.min(...ys), Math.max(...ys)],
        ]
      : [
          [0, 0],
          [0, 0],
        ];
  };
  if (extent === 'all' || finite.length < ROBUST_MIN_POINTS) return box(finite);
  const [bx0, bx1] = inlierBand(finite.map((i) => coordinates[i][0]).sort((a, b) => a - b));
  const [by0, by1] = inlierBand(finite.map((i) => coordinates[i][1]).sort((a, b) => a - b));
  const kept = new Set(
    finite.filter((i) => {
      const [x, y] = coordinates[i];
      return x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
    }),
  );
  for (const group of extent === 'groups' ? groups : []) {
    const members = group.filter(finiteAt);
    if (members.length < 2) continue;
    const lost = members.filter((i) => !kept.has(i)).length;
    if (2 * lost >= members.length) for (const i of members) kept.add(i);
  }
  return box(kept.size ? [...kept] : finite);
}

/**
 * Projects MDS coordinates into `frame` with one scale on both axes. The
 * extent (see `framingRanges`) is the full range for few points, else the
 * box of the non-outlying points and of every group that outliers would
 * otherwise gut, plus 8 % padding, centred. Points beyond the frame (true
 * lone outliers) are clamped to its inner edge and say which way they lie
 * (`out`). `groups` are the partition's groups, as point indices; `extent`
 * chooses the frame (see `ScatterExtent`).
 */
export function robustProjection(
  coordinates: readonly (readonly [number, number])[],
  frame: ScatterFrame,
  groups: readonly (readonly number[])[] = [],
  extent: ScatterExtent = 'groups',
): { points: ProjectedPoint[]; scale: number } {
  const [[loX, hiX], [loY, hiY]] = framingRanges(coordinates, groups, extent);
  const spanX = (hiX - loX) * (1 + 2 * ROBUST_PADDING),
    spanY = (hiY - loY) * (1 + 2 * ROBUST_PADDING);
  const innerW = Math.max(1, frame.w - 2 * frame.margin),
    innerH = Math.max(1, frame.h - 2 * frame.margin);
  let scale = Math.min(spanX > 0 ? innerW / spanX : Infinity, spanY > 0 ? innerH / spanY : Infinity);
  // One place (or none): any scale draws it; the centre is the only position.
  if (!Number.isFinite(scale)) scale = Math.min(innerW, innerH) / 2;
  const midX = (loX + hiX) / 2,
    midY = (loY + hiY) / 2;
  const points = coordinates.map(([cx, cy]) => {
    const trueX = Number.isFinite(cx) ? frame.w / 2 + (cx - midX) * scale : frame.w / 2;
    const trueY = Number.isFinite(cy) ? frame.h / 2 - (cy - midY) * scale : frame.h / 2;
    const x = Math.min(frame.w - frame.margin, Math.max(frame.margin, trueX));
    const y = Math.min(frame.h - frame.margin, Math.max(frame.margin, trueY));
    const dx = trueX - x,
      dy = trueY - y;
    const length = Math.hypot(dx, dy);
    return { x, y, trueX, trueY, out: length > 1e-6 ? ([dx / length, dy / length] as [number, number]) : null };
  });
  return { points, scale };
}

/**
 * Groups (two or more members) with half or more of their members off-scale:
 * their label leaves the map for the off-scale note ("G2 · 6 · 4 off-scale").
 */
export function offScaleGroups<G extends { members: readonly number[] }>(
  groups: readonly G[],
  points: readonly ProjectedPoint[],
): { group: G; off: number }[] {
  return groups.flatMap((group) => {
    const members = group.members.filter((i) => points[i]);
    const off = members.filter((i) => points[i].out).length;
    return members.length >= 2 && off > 0 && 2 * off >= members.length ? [{ group, off }] : [];
  });
}

/**
 * Short IDs for labels: the prefix every ID shares ("sub-") dropped, when it
 * ends in a separator or every remainder starts with a digit. Else the IDs.
 */
export function shortIdPrefix(ids: readonly string[]): string {
  if (ids.length < 2) return '';
  let prefix = ids[0];
  for (const id of ids) {
    let i = 0;
    while (i < prefix.length && i < id.length && prefix[i] === id[i]) i++;
    prefix = prefix.slice(0, i);
  }
  prefix = prefix.replace(/\d+$/, '');
  if (!prefix || ids.some((id) => id.length <= prefix.length)) return '';
  const separated = /[^A-Za-z0-9]$/.test(prefix);
  return separated || ids.every((id) => /^\d/.test(id.slice(prefix.length))) ? prefix : '';
}

/** Monospace label metrics at 10 px (IBM Plex Mono advances 0.6 em). */
export const LABEL_CHAR_W = 6;
const ASCENT = 8;
const DESCENT = 2.5;
/** A point's footprint for collisions (its mark plus a hair of air). */
const POINT_HALF = 4.5;

export interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export type LabelAnchor = 'start' | 'middle' | 'end';
export interface PlacedLabel {
  id: string;
  text: string;
  /** Text position (baseline) and anchor, as `<text>` takes them. */
  x: number;
  y: number;
  anchor: LabelAnchor;
  box: LabelBox;
  /** A hairline from the label to its nearest member, when the label sits apart. */
  leader: [number, number, number, number] | null;
}

export function textBox(x: number, y: number, text: string, anchor: LabelAnchor): LabelBox {
  const width = text.length * LABEL_CHAR_W;
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
  return { x0, y0: y - ASCENT, x1: x0 + width, y1: y + DESCENT };
}

function overlap(a: LabelBox, b: LabelBox): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

const pointBox = ([x, y]: readonly [number, number]): LabelBox => ({
  x0: x - POINT_HALF,
  y0: y - POINT_HALF,
  x1: x + POINT_HALF,
  y1: y + POINT_HALF,
});

/** Eight places round (x, y) at distance d: the text's anchor and its direction. */
function around(x: number, y: number, d: number) {
  const k = d * Math.SQRT1_2;
  const mid = (ASCENT - DESCENT) / 2; // baseline offset that centres the text on y
  return [
    { x: x + d, y: y + mid, anchor: 'start' as const, dir: [1, 0] },
    { x: x - d, y: y + mid, anchor: 'end' as const, dir: [-1, 0] },
    { x, y: y - d, anchor: 'middle' as const, dir: [0, -1] },
    { x, y: y + d + ASCENT, anchor: 'middle' as const, dir: [0, 1] },
    { x: x + k, y: y - k, anchor: 'start' as const, dir: [Math.SQRT1_2, -Math.SQRT1_2] },
    { x: x - k, y: y - k, anchor: 'end' as const, dir: [-Math.SQRT1_2, -Math.SQRT1_2] },
    { x: x + k, y: y + k + ASCENT, anchor: 'start' as const, dir: [Math.SQRT1_2, Math.SQRT1_2] },
    { x: x - k, y: y + k + ASCENT, anchor: 'end' as const, dir: [-Math.SQRT1_2, Math.SQRT1_2] },
  ];
}

export interface LabelRequest {
  id: string;
  text: string;
}

/**
 * Collision-avoiding labels for the map, in priority order: the focused
 * point's label always places; then each group's label, at the centroid of
 * the members passed (the caller passes those drawn in the frame) or just
 * outside their core (a hairline leader joins it when it sits apart); then
 * short labels for the most extreme points, dropped when no free place
 * remains; last the neighbour numerals (`ranks`), each on its spoke near its
 * point, never over another label (dropped when no such place remains).
 * Placing the numerals last keeps every other label where it was when they
 * appear. `obstacles` are boxes already drawn; every point is one too.
 */
export function placeScatterLabels({
  frame,
  points,
  focus,
  groups,
  extremes,
  ranks = [],
  obstacles = [],
  focusOffset = 11,
}: {
  frame: ScatterFrame;
  points: readonly (readonly [number, number])[];
  focus: (LabelRequest & { index: number }) | null;
  groups: readonly (LabelRequest & { members: readonly number[] })[];
  extremes: readonly (LabelRequest & { index: number })[];
  /** Neighbour numerals: `index` is the neighbour's point; spokes run from the focus. */
  ranks?: readonly (LabelRequest & { index: number })[];
  obstacles?: readonly LabelBox[];
  focusOffset?: number;
}): { focus: PlacedLabel | null; groups: PlacedLabel[]; extremes: PlacedLabel[]; ranks: PlacedLabel[] } {
  const pointBoxes = points.map(pointBox);
  const placed: LabelBox[] = [...obstacles];
  const labelBoxes: LabelBox[] = [];
  const all = points.length
    ? [
        points.reduce((s, p) => s + p[0], 0) / points.length,
        points.reduce((s, p) => s + p[1], 0) / points.length,
      ]
    : [frame.w / 2, frame.h / 2];
  const cost = (box: LabelBox, skip: ReadonlySet<number>) => {
    let c = 0;
    // Off the frame is worst: a label never clips.
    const outside =
      Math.max(0, 1 - box.x0) + Math.max(0, box.x1 - (frame.w - 1)) +
      Math.max(0, 1 - box.y0) + Math.max(0, box.y1 - (frame.h - 1));
    c += outside * 1000;
    for (const other of placed) c += 8 * overlap(box, other);
    pointBoxes.forEach((p, i) => {
      if (!skip.has(i)) c += overlap(box, p);
    });
    return c;
  };
  /** Candidates in preference order (most outward from `from` first). */
  const ranked = (x: number, y: number, d: number, from: readonly number[]) => {
    const ox = x - from[0],
      oy = y - from[1];
    const length = Math.hypot(ox, oy) || 1;
    return around(x, y, d)
      .map((c, i) => ({ ...c, score: (c.dir[0] * ox + c.dir[1] * oy) / length, i }))
      .sort((a, b) => b.score - a.score || a.i - b.i);
  };
  const choose = (
    request: LabelRequest,
    candidates: { x: number; y: number; anchor: LabelAnchor }[],
    skip: ReadonlySet<number>,
    required: boolean,
  ) => {
    let best: { c: (typeof candidates)[number]; box: LabelBox; cost: number } | null = null;
    for (const c of candidates) {
      const box = textBox(c.x, c.y, request.text, c.anchor);
      const k = cost(box, skip);
      if (k === 0) {
        best = { c, box, cost: 0 };
        break;
      }
      if (!best || k < best.cost) best = { c, box, cost: k };
    }
    if (!best || (!required && best.cost > 0)) return null;
    placed.push(best.box);
    labelBoxes.push(best.box);
    return { id: request.id, text: request.text, ...best.c, box: best.box, leader: null } as PlacedLabel;
  };

  let focusLabel: PlacedLabel | null = null;
  if (focus && points[focus.index]) {
    const [x, y] = points[focus.index];
    focusLabel = choose(focus, ranked(x, y, focusOffset, all), new Set([focus.index]), true);
  }

  const groupLabels: PlacedLabel[] = [];
  for (const group of groups) {
    const members = group.members.filter((i) => points[i]);
    if (!members.length) continue;
    // The centroid of the members drawn: on it when it is free (a dispersed
    // group), else just outside their core.
    const ax = members.reduce((sum, i) => sum + points[i][0], 0) / members.length;
    const ay = members.reduce((sum, i) => sum + points[i][1], 0) / members.length;
    const radii = members.map((i) => Math.hypot(points[i][0] - ax, points[i][1] - ay)).sort((a, b) => a - b);
    const core = Math.min(40, Math.max(4, quantile(radii, 0.5)));
    const centred = { x: ax, y: ay + (ASCENT - DESCENT) / 2, anchor: 'middle' as const };
    const candidates = [
      centred,
      ...[7, 14, 24, 36, 52].flatMap((step) => ranked(ax, ay, core + step, all)),
    ];
    const label = choose(group, candidates, new Set(), true);
    if (!label) continue;
    // A leader when the label sits apart from every member.
    const centre = [(label.box.x0 + label.box.x1) / 2, (label.box.y0 + label.box.y1) / 2];
    const nearest = members.reduce((best, i) =>
      Math.hypot(points[i][0] - centre[0], points[i][1] - centre[1]) <
      Math.hypot(points[best][0] - centre[0], points[best][1] - centre[1])
        ? i
        : best,
    );
    const [mx, my] = points[nearest];
    const bx = Math.min(label.box.x1, Math.max(label.box.x0, mx));
    const by = Math.min(label.box.y1, Math.max(label.box.y0, my));
    const gap = Math.hypot(mx - bx, my - by);
    if (gap > 10) {
      const ux = (mx - bx) / gap,
        uy = (my - by) / gap;
      label.leader = [bx + ux, by + uy, mx - ux * 5, my - uy * 5];
    }
    groupLabels.push(label);
  }

  const extremeLabels: PlacedLabel[] = [];
  for (const extreme of extremes) {
    if (!points[extreme.index] || extreme.index === focus?.index) continue;
    const [x, y] = points[extreme.index];
    const label = choose(extreme, ranked(x, y, 6, all), new Set([extreme.index]), false);
    if (label) extremeLabels.push(label);
  }

  const rankLabels: PlacedLabel[] = [];
  const from = focus && points[focus.index] ? points[focus.index] : null;
  for (const rank of ranks) {
    const at = points[rank.index];
    if (!from || !at) continue;
    const [nx, ny] = at;
    const length = Math.hypot(nx - from[0], ny - from[1]) || 1;
    const ux = (nx - from[0]) / length,
      uy = (ny - from[1]) / length;
    const mid = (ASCENT - DESCENT) / 2;
    // On the spoke, short of the neighbour; then round the neighbour.
    const centres = [
      ...[11, 16, 22]
        .filter((back) => back < length)
        .map((back) => [nx - ux * back, ny - uy * back] as const),
      ...around(nx, ny, 8).map((c) => [c.x + c.dir[0] * 2, c.y - mid + c.dir[1] * 2] as const),
    ];
    let best: { x: number; y: number; box: LabelBox; cost: number } | null = null;
    for (const [cx, cy] of centres) {
      const box = textBox(cx, cy + mid, rank.text, 'middle');
      // Never over a label (the focused ID above all), nor off the frame.
      if (labelBoxes.some((other) => overlap(box, other) > 0)) continue;
      const k = cost(box, new Set([rank.index]));
      if (k >= 1000) continue;
      if (!best || k < best.cost) best = { x: cx, y: cy + mid, box, cost: k };
      if (k === 0) break;
    }
    if (!best) continue;
    placed.push(best.box);
    labelBoxes.push(best.box);
    rankLabels.push({ id: rank.id, text: rank.text, x: best.x, y: best.y, anchor: 'middle', box: best.box, leader: null });
  }
  return { focus: focusLabel, groups: groupLabels, extremes: extremeLabels, ranks: rankLabels };
}

/**
 * The `count` points farthest from the cloud's median, by their true MDS
 * coordinates (so clamped outliers come first): indices, farthest first.
 */
export function extremePoints(
  coordinates: readonly (readonly [number, number])[],
  count: number,
): number[] {
  const xs = coordinates.map(([x]) => x).filter(Number.isFinite).sort((a, b) => a - b);
  const ys = coordinates.map(([, y]) => y).filter(Number.isFinite).sort((a, b) => a - b);
  const mx = quantile(xs, 0.5),
    my = quantile(ys, 0.5);
  return coordinates
    .map(([x, y], i) => ({ i, d: Number.isFinite(x) && Number.isFinite(y) ? Math.hypot(x - mx, y - my) : -1 }))
    .filter((p) => p.d > 0)
    .sort((a, b) => b.d - a.d || a.i - b.i)
    .slice(0, count)
    .map((p) => p.i);
}

/** Below this share of variance the 2-D map's distances are said to be approximate. */
export const FAITHFUL_SHARE = 0.8;
/** The map's fidelity in words: "2-D keeps 21% — distances approximate". */
export function fidelityText(share: number): string {
  const percent = Math.round(100 * share);
  return share < FAITHFUL_SHARE
    ? `2-D keeps ${percent}% — distances approximate`
    : `2-D keeps ${percent}% of variance`;
}
