import { describe, expect, it } from 'vitest';
import {
  extremePoints,
  fidelityText,
  offScaleGroups,
  placeScatterLabels,
  robustFramingAvailable,
  robustProjection,
  shortIdPrefix,
  type LabelBox,
} from '../similarityStripLayout';

const FRAME = { w: 300, h: 300, margin: 12 };
const overlaps = (a: LabelBox, b: LabelBox) =>
  Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);

/** 29 points in a tight cloud and 6 far away, as in the native capture. */
function knotWithOutliers(): [number, number][] {
  const core: [number, number][] = Array.from({ length: 29 }, (_, i) => [
    0.05 * Math.cos(i * 2.4) * (1 + (i % 5) / 5),
    0.05 * Math.sin(i * 2.4) * (1 + (i % 3) / 3),
  ]);
  return [...core, [1.2, 0.9], [-0.4, 1.1], [1.6, -0.2], [-1.1, -0.9], [0.9, -1.4], [2.0, 0.3]];
}

const G1 = Array.from({ length: 29 }, (_, i) => i);
const G2 = [29, 30, 31, 32, 33, 34];

describe('robustProjection', () => {
  it('with no groups, clamps the true outliers (beyond 3 robust SD): the core spreads', () => {
    const coordinates = knotWithOutliers();
    const { points } = robustProjection(coordinates, FRAME);
    const core = points.slice(0, 29);
    const width = Math.max(...core.map((p) => p.x)) - Math.min(...core.map((p) => p.x));
    // The old full-extent scale gave the core about 25 px; the robust one gives it most of the frame.
    expect(width).toBeGreaterThan(60);
    const clamped = points.filter((p) => p.out);
    expect(clamped.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(FRAME.margin);
      expect(p.x).toBeLessThanOrEqual(FRAME.w - FRAME.margin);
      expect(p.y).toBeGreaterThanOrEqual(FRAME.margin);
      expect(p.y).toBeLessThanOrEqual(FRAME.h - FRAME.margin);
    }
    // A clamped point says which way it lies: toward its true position.
    for (const p of clamped) {
      const [ux, uy] = p.out!;
      expect(Math.hypot(ux, uy)).toBeCloseTo(1);
      expect((p.trueX - p.x) * ux + (p.trueY - p.y) * uy).toBeGreaterThan(0);
    }
  });

  it('never clamps most of a group: the 29 + 6 knot keeps G2 in frame when G2 is a group', () => {
    const coordinates = knotWithOutliers();
    const { points, scale } = robustProjection(coordinates, FRAME, [G1, G2]);
    expect(points.every((p) => p.out === null)).toBe(true);
    // One scale both ways, and the relative positions exact.
    expect(points[34].x - points[31].x).toBeCloseTo((2.0 - 1.6) * scale);
    expect(points[31].y - points[34].y).toBeCloseTo((0.3 - -0.2) * scale);
  });

  it('a group losing fewer than half keeps its frame; a lone true outlier still clamps', () => {
    const coordinates: [number, number][] = [...knotWithOutliers(), [6, -5]];
    // The lone point is in G1 (one of 30: not most of it) and far beyond G2.
    const { points } = robustProjection(coordinates, FRAME, [[...G1, 35], G2]);
    expect(points.flatMap((p, i) => (p.out ? [i] : []))).toEqual([35]);
    const [ux, uy] = points[35].out!;
    expect(ux).toBeGreaterThan(0);
    expect(uy).toBeGreaterThan(0); // down: y grows downward on screen
    // With no groups at all, the dispersed six are outliers too.
    const bare = robustProjection(coordinates, FRAME);
    expect(bare.points.flatMap((p, i) => (p.out ? [i] : []))).toEqual([...G2, 35]);
  });

  it('a genuine spread (no outliers) is drawn whole', () => {
    const coordinates = Array.from({ length: 40 }, (_, i): [number, number] => [
      (i % 8) / 7,
      Math.floor(i / 8) / 4,
    ]);
    expect(robustProjection(coordinates, FRAME).points.every((p) => p.out === null)).toBe(true);
  });

  it('keeps one scale on both axes, and up is up', () => {
    const { points, scale } = robustProjection(
      [
        [0, 0],
        [0.4, 0],
        [0, 0.4],
        [-1, -1],
        [1, 1],
      ],
      { w: 560, h: 300, margin: 14 },
    );
    expect(points.slice(0, 3).every((p) => p.out === null)).toBe(true);
    expect(points[1].x - points[0].x).toBeCloseTo(0.4 * scale);
    expect(points[0].y - points[2].y).toBeCloseTo(0.4 * scale);
  });

  it('with few points, frames the full range: a genuine extreme is drawn where it lies', () => {
    // Eight subjects, one well apart: with the 5–95 % box and MAD guard it
    // was pinned to the edge as if off-scale.
    const coordinates: [number, number][] = [
      [0, 0],
      [0.1, 0.05],
      [-0.1, 0.02],
      [0.05, -0.1],
      [-0.05, 0.08],
      [0.08, -0.04],
      [-0.02, -0.06],
      [1.5, 1.2],
    ];
    const { points, scale } = robustProjection(coordinates, FRAME);
    expect(points.every((p) => p.out === null)).toBe(true);
    // Relative positions are kept exactly at one scale.
    expect(points[7].x - points[0].x).toBeCloseTo(1.5 * scale);
    expect(points[0].y - points[7].y).toBeCloseTo(1.2 * scale);
  });

  it('Fit core frames the robust core even when a whole group lies outside it; Fit all frames every point', () => {
    const coordinates = knotWithOutliers();
    const core = robustProjection(coordinates, FRAME, [G1, G2], 'core');
    // The 29-member knot gets most of the frame, not a 40 px knot.
    const xs = core.points.slice(0, 29).map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(60);
    expect(core.points.flatMap((p, i) => (p.out ? [i] : []))).toEqual(G2);
    // G2 is mostly off-scale: its label belongs in the note.
    const groups = [
      { id: 'g1', members: G1 },
      { id: 'g2', members: G2 },
    ];
    expect(offScaleGroups(groups, core.points).map(({ group, off }) => [group.id, off])).toEqual([
      ['g2', 6],
    ]);
    const all = robustProjection(coordinates, FRAME, [G1, G2], 'all');
    expect(all.points.every((p) => p.out === null)).toBe(true);
    expect(all.scale).toBeLessThan(core.scale);
    expect(offScaleGroups(groups, all.points)).toEqual([]);
    // Fit all keeps a lone far point in frame too (the groups extent would clamp it).
    const far: [number, number][] = [...coordinates, [6, -5]];
    expect(robustProjection(far, FRAME, [[...G1, 35], G2], 'all').points.every((p) => !p.out)).toBe(true);
    expect(robustProjection(far, FRAME, [[...G1, 35], G2], 'groups').points[35].out).not.toBeNull();
  });

  it('draws a single point or identical points at the centre', () => {
    const { points } = robustProjection([[3, 3], [3, 3]], FRAME);
    expect(points.map((p) => [p.x, p.y, p.out])).toEqual([
      [150, 150, null],
      [150, 150, null],
    ]);
  });
});

describe('shortIdPrefix', () => {
  it('drops a shared prefix that ends in a separator or before digits', () => {
    expect(shortIdPrefix(['sub-1002', 'sub-1003', 'sub-1044'])).toBe('sub-');
    expect(shortIdPrefix(['sub001', 'sub002', 'sub010'])).toBe('sub');
    expect(shortIdPrefix(['alice', 'alan'])).toBe('');
    expect(shortIdPrefix(['only'])).toBe('');
  });
});

describe('placeScatterLabels', () => {
  it('never overprints: focus wins, groups sit outside their members, extremes only where free', () => {
    const coordinates = knotWithOutliers();
    const { points: projected } = robustProjection(coordinates, FRAME, [G1, G2]);
    const points = projected.map((p) => [p.x, p.y] as [number, number]);
    const layout = placeScatterLabels({
      frame: FRAME,
      points,
      focus: { id: 'sub-1000', text: 'sub-1000', index: 0 },
      groups: [
        { id: 'g1', text: 'G1 · 29', members: Array.from({ length: 29 }, (_, i) => i) },
        { id: 'g2', text: 'G2 · 6', members: [29, 30, 31, 32, 33, 34] },
      ],
      extremes: extremePoints(coordinates, 5).map((i) => ({ id: `p${i}`, text: `${i}`, index: i })),
      // Neighbour numerals for core points crowded round the focus.
      ranks: [1, 2, 3, 4, 5].map((r) => ({ id: `n${r}`, text: String(r), index: r })),
    });
    expect(layout.focus).not.toBeNull();
    expect(layout.groups.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(layout.ranks.length).toBeGreaterThan(0);
    const boxes = [layout.focus!, ...layout.groups, ...layout.extremes, ...layout.ranks].map((l) => l.box);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
    for (const box of boxes) {
      expect(box.x0).toBeGreaterThanOrEqual(0);
      expect(box.x1).toBeLessThanOrEqual(FRAME.w);
      expect(box.y0).toBeGreaterThanOrEqual(0);
      expect(box.y1).toBeLessThanOrEqual(FRAME.h);
    }
    // No group label lies on a point.
    for (const label of layout.groups)
      for (const [x, y] of points)
        expect(x > label.box.x0 && x < label.box.x1 && y > label.box.y0 && y < label.box.y1).toBe(false);
    // The dispersed group's label sits by a member, joined by a leader if apart.
    const g2 = layout.groups[1];
    const nearest = Math.min(
      ...[29, 30, 31, 32, 33, 34].map((i) => {
        const [x, y] = points[i];
        const bx = Math.min(g2.box.x1, Math.max(g2.box.x0, x));
        const by = Math.min(g2.box.y1, Math.max(g2.box.y0, y));
        return Math.hypot(x - bx, y - by);
      }),
    );
    if (nearest > 10) expect(g2.leader).not.toBeNull();
    else expect(g2.leader).toBeNull();
  });
});

describe('extremePoints and fidelityText', () => {
  it('ranks the farthest from the median first', () => {
    expect(extremePoints(knotWithOutliers(), 2)).toEqual([34, 33]);
  });
  it('says low fidelity in words', () => {
    expect(fidelityText(0.21)).toBe('2-D keeps 21% — distances approximate');
    expect(fidelityText(0.92)).toBe('2-D keeps 92% of variance');
  });
});

describe('robustFramingAvailable', () => {
  it('needs 20 finite points; non-finite ones do not count', () => {
    const points = (n: number) => Array.from({ length: n }, (_, i) => [i, -i] as [number, number]);
    expect(robustFramingAvailable(points(19))).toBe(false);
    expect(robustFramingAvailable(points(20))).toBe(true);
    expect(robustFramingAvailable([...points(19), [Number.NaN, 0]])).toBe(false);
  });
});
