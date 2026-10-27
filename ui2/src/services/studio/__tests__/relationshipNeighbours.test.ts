import { describe, expect, it } from 'vitest';
import type { RelationshipFit } from '../PopulationRelationshipService';
import {
  RELATIONSHIP_TIE_EPSILON_LINEAR,
  RELATIONSHIP_TIE_EPSILON_SQUARED,
  distanceToCentroid,
  distancesTie,
  nearestToCentroid,
  neighbourPreservation,
  rankNeighbours,
  tieTolerance,
} from '../relationshipNeighbours';

type Point = number[];
const euclid = (a: Point, b: Point) => Math.hypot(...a.map((v, i) => v - b[i]));
const matrix = (points: Point[]) => points.map((a) => points.map((b) => euclid(a, b)));

/** Deterministic pseudo-random generator (LCG) for reproducible configurations. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const randomPoints = (n: number, d: number, seed: number) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => Array.from({ length: d }, () => r() * 10 - 5));
};

/**
 * Port of `relationship_math.rs::fit` up to the distance matrix: f32 inputs,
 * Welford mean/M2 for pattern shape, rows centred across observations against
 * row 0, Gram accumulated in float64, d = √max(0, gᵢᵢ + gⱼⱼ − 2gᵢⱼ).
 */
function rustDistances(rows: number[][], metric: 'effect' | 'pattern-shape'): number[][] {
  const n = rows.length,
    p = rows[0].length,
    f32 = rows.map((row) => row.map(Math.fround));
  const means = new Array<number>(n).fill(0),
    norms = new Array<number>(n).fill(Math.sqrt(p));
  if (metric === 'pattern-shape')
    f32.forEach((row, i) => {
      let m2 = 0;
      row.forEach((value, k) => {
        const delta = value - means[i];
        means[i] += delta / (k + 1);
        m2 += delta * (value - means[i]);
      });
      norms[i] = Math.sqrt(m2);
    });
  const gram = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let v = 0; v < p; v++) {
    const reference = (f32[0][v] - means[0]) / norms[0];
    const delta = (i: number) =>
      metric === 'effect'
        ? (f32[i][v] - f32[0][v]) / norms[i]
        : (f32[i][v] - means[i]) / norms[i] - reference;
    const deltas = f32.map((_, i) => delta(i));
    const average = deltas.reduce((a, b) => a + b, 0) / n;
    const block = deltas.map((d) => d - average);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) gram[a][b] += block[a] * block[b];
  }
  return gram.map((_, i) =>
    gram.map((__, j) => Math.sqrt(Math.max(0, gram[i][i] + gram[j][j] - 2 * gram[i][j]))),
  );
}

/** Three rows with one shape (affine transforms of a base map) and two unrelated rows. */
function coincidentPatternRows(p = 20000) {
  const r = rng(12345);
  const base = Array.from({ length: p }, () => r() * 10);
  return [
    base,
    base.map((v) => 3 * v + 5),
    base.map((v) => 0.5 * v - 1),
    Array.from({ length: p }, () => r()),
    Array.from({ length: p }, () => r()),
  ];
}

/** Three affine copies of one map, a map correlated with them, and an unrelated map. */
function correlatedThirdMapRows(p = 20000) {
  const r = rng(12345);
  const base = Array.from({ length: p }, () => r() * 10);
  return [
    base,
    base.map((v) => 3 * v + 5),
    base.map((v) => 0.5 * v - 1),
    base.map((v) => v + 4 * r()),
    Array.from({ length: p }, () => r()),
  ];
}

/**
 * A fit whose context is `contextIds`; `fitted` (a subset, in context order) carry
 * the given distances, and the rest are unassigned.
 */
function makeFit(
  contextIds: string[],
  fitted: string[],
  distances: number[][],
  coords: [number, number][],
): RelationshipFit {
  const unassigned = contextIds.filter((id) => !fitted.includes(id));
  return {
    fitId: 'a'.repeat(64),
    request: {
      members: contextIds.map((memberId) => ({
        memberId,
        sourcePath: `/data/${memberId}.nii.gz`,
        expectedSha256: 'b'.repeat(64),
      })),
      mask: null,
      region: null,
      distance: 'effect',
      eligibility: { lowCoverageTau: 0.9 },
    },
    supportSha256: 'c'.repeat(64),
    candidateVoxels: 1000,
    commonVoxels: 800,
    finiteCounts: contextIds.map((id) => (fitted.includes(id) ? 900 : 0)),
    fittedMemberIds: fitted,
    unassigned: unassigned.map((memberId) => ({
      memberId,
      reason: { kind: 'allMissing' as const },
      finiteCount: 0,
      supportLossVoxels: 800,
    })),
    dimensions: [10, 10, 10],
    affine: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ],
    geometry: {
      coordinates: coords,
      distances,
      eigenvalues: fitted.map(() => 1),
      explainedFraction: 1,
      stress: 0,
      orderable: false,
      merges: [],
    },
  };
}
const pointFit = (
  context: string[],
  fitted: string[],
  points: Point[],
  coords?: [number, number][],
) =>
  makeFit(
    context,
    fitted,
    matrix(points),
    coords ?? points.map((p) => [p[0], p[1] ?? 0] as [number, number]),
  );
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

describe('squared-space tie rule', () => {
  it('absorbs the Gram rounding of coincident pattern-shape maps that the old ε × max d rule splits', () => {
    const d = rustDistances(coincidentPatternRows(), 'pattern-shape');
    const maxD = Math.max(...d.flat());
    // Rust-like noise: coincident maps come out well above 1e-10 ...
    const noise = Math.max(d[0][1], d[0][2], d[1][2]);
    expect(noise).toBeGreaterThan(1e-8);
    // ... so the old rule (|a − b| ≤ 1e-9 × max d) separates them,
    expect(noise).toBeGreaterThan(1e-9 * maxD);
    // while the shared rule ties them and still separates unrelated maps.
    const tol = tieTolerance(d);
    expect(distancesTie(d[0][1], d[0][2], tol)).toBe(true);
    expect(distancesTie(d[1][0], d[1][2], tol)).toBe(true);
    expect(distancesTie(d[0][3], d[0][4], tol)).toBe(false);
    expect(tol.squared).toBeCloseTo(RELATIONSHIP_TIE_EPSILON_SQUARED * maxD ** 2, 25);
    expect(tol.linear).toBeCloseTo(RELATIONSHIP_TIE_EPSILON_LINEAR * maxD, 20);
  });

  it('ties either on the squared term or on the linear term', () => {
    const tol = { squared: 1e-12, linear: 1e-7 };
    // Near zero: d = 1e-6 vs 0 differs by 10× the linear term but its square is tiny.
    expect(distancesTie(1e-6, 0, tol)).toBe(true);
    // Away from zero: the squared term is far too small, the linear term ties.
    expect(distancesTie(1, 1 + 5e-8, tol)).toBe(true);
    expect(distancesTie(1, 1 + 2e-7, tol)).toBe(false);
    // Precomputed squares drive the squared term.
    expect(distancesTie(1, 2, tol, 4, 4)).toBe(true);
  });

  it('is zero-tolerance when every distance is zero', () => {
    const tol = tieTolerance([
      [0, 0],
      [0, 0],
    ]);
    expect(tol).toEqual({ squared: 0, linear: 0 });
    expect(distancesTie(0, 0, tol)).toBe(true);
  });
});

describe('rankNeighbours', () => {
  it('orders by distance and ranks 1..n−1 on a tie-free random configuration with unassigned members', () => {
    const context = ['u0', 'm0', 'm1', 'u1', 'm2', 'm3', 'm4', 'm5', 'u2', 'm6'];
    const fitted = context.filter((id) => id.startsWith('m'));
    const points = randomPoints(fitted.length, 5, 7);
    const coords = randomPoints(fitted.length, 2, 11) as [number, number][];
    const fit = pointFit(context, fitted, points, coords);
    for (const [i, id] of fitted.entries()) {
      const result = rankNeighbours(fit, id)!;
      const others = fitted.map((_, j) => j).filter((j) => j !== i);
      const byDistance = [...others].sort(
        (a, b) => euclid(points[i], points[a]) - euclid(points[i], points[b]),
      );
      const byScreen = [...others].sort(
        (a, b) => euclid(coords[i], coords[a]) - euclid(coords[i], coords[b]),
      );
      // Precondition: no two consecutive values are anywhere near each other.
      for (let r = 1; r < byDistance.length; r++)
        expect(
          euclid(points[i], points[byDistance[r]]) - euclid(points[i], points[byDistance[r - 1]]),
        ).toBeGreaterThan(1e-6);
      expect(result.map((e) => e.memberId)).toEqual(byDistance.map((j) => fitted[j]));
      result.forEach((entry, r) => {
        const j = fitted.indexOf(entry.memberId);
        expect(entry.distance).toBeCloseTo(euclid(points[i], points[j]), 12);
        expect(entry.rank).toBe(r + 1);
        expect(entry.screenRank).toBe(byScreen.indexOf(j) + 1);
      });
    }
  });

  it('returns null for unassigned or unknown members and throws on malformed geometry', () => {
    const fit = pointFit(['a', 'b', 'c', 'x'], ['a', 'b', 'c'], [[0], [1], [3]]);
    expect(rankNeighbours(fit, 'x')).toBeNull();
    expect(rankNeighbours(fit, 'nope')).toBeNull();
    const bad = structuredClone(fit);
    bad.geometry.distances[1][2] = NaN;
    expect(() => rankNeighbours(bad, 'a')).toThrow();
    const short = structuredClone(fit);
    short.geometry.coordinates.pop();
    expect(() => rankNeighbours(short, 'a')).toThrow();
  });

  it('indexes geometry by fitted position, not by request position', () => {
    // Request order puts the unassigned member first; a request-indexed lookup
    // would read the wrong rows.
    const fit = pointFit(['x', 'a', 'b', 'c'], ['a', 'b', 'c'], [[0], [10], [1]]);
    expect(rankNeighbours(fit, 'a')!.map((e) => [e.memberId, e.distance, e.rank])).toEqual([
      ['c', 1, 1],
      ['b', 10, 2],
    ]);
  });

  it('ties Rust-computed coincident maps, ordered by fit order', () => {
    const d = rustDistances(coincidentPatternRows(), 'pattern-shape');
    const coords: [number, number][] = [
      [0, 0],
      [1e-9, 0],
      [0, 1e-9],
      [1, 0],
      [0, 1],
    ];
    const fit = makeFit(ids(5), ids(5), d, coords);
    const fromM0 = rankNeighbours(fit, 'm0')!;
    // From m0, its coincident partners (d ≈ 5.6e-8 and 0) form one tie block at
    // rank 1 in fit order, and their 1e-9 layout offsets tie on screen too.
    expect(d[0][1]).toBeGreaterThan(1e-8);
    expect(fromM0.slice(0, 2).map((e) => [e.memberId, e.rank, e.screenRank])).toEqual([
      ['m1', 1, 1],
      ['m2', 1, 1],
    ]);
    expect(fromM0.slice(2).map((e) => e.rank)).toEqual([3, 4]);
    expect(rankNeighbours(fit, 'm1')!.slice(0, 2).map((e) => [e.memberId, e.rank])).toEqual([
      ['m0', 1],
      ['m2', 1],
    ]);
    // Displayed distances stay unsquared.
    expect(fromM0[0].distance).toBe(d[0][1]);
  });

  it('ties affine copies ranked from a correlated third map', () => {
    const d = rustDistances(correlatedThirdMapRows(), 'pattern-shape');
    const maxD = Math.max(...d.flat());
    // From m3 the copies differ by f32 rounding: beyond the squared term alone ...
    const spread = Math.max(d[3][0], d[3][1], d[3][2]) - Math.min(d[3][0], d[3][1], d[3][2]);
    expect(spread).toBeGreaterThan(0);
    expect(Math.abs(d[3][0] ** 2 - d[3][1] ** 2)).toBeGreaterThan(
      RELATIONSHIP_TIE_EPSILON_SQUARED * maxD ** 2,
    );
    // ... but within the f32 resolution term.
    expect(spread).toBeLessThan(RELATIONSHIP_TIE_EPSILON_LINEAR * maxD);
    const coords: [number, number][] = [
      [1, 0],
      [1, 1e-9],
      [1 + 1e-9, 0],
      [0, 0],
      [-3, 3],
    ];
    const fit = makeFit(ids(5), ids(5), d, coords);
    expect(rankNeighbours(fit, 'm3')!.map((e) => [e.memberId, e.rank, e.screenRank])).toEqual([
      ['m0', 1, 1],
      ['m1', 1, 1],
      ['m2', 1, 1],
      ['m4', 4, 4],
    ]);
  });

  it('separates a real difference of 1e-6 × max d', () => {
    const distances = [
      [0, 1, 1 + 1e-6],
      [1, 0, 1],
      [1 + 1e-6, 1, 0],
    ];
    const coords: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    const fit = makeFit(['a', 'b', 'c'], ['a', 'b', 'c'], distances, coords);
    // |a − b| = 1e-6 > 1e-7 × max d and |a² − b²| ≈ 2e-6 > 1e-12 × max d².
    expect(rankNeighbours(fit, 'a')!.map((e) => e.rank)).toEqual([1, 2]);
    expect(rankNeighbours(fit, 'a', { epsilonLinear: 1e-5 })!.map((e) => e.rank)).toEqual([1, 1]);
    // Below 1e-7 × max d it is a tie.
    const close = structuredClone(fit);
    close.geometry.distances[0][2] = close.geometry.distances[2][0] = 1 + 5e-8;
    expect(rankNeighbours(close, 'a')!.map((e) => e.rank)).toEqual([1, 1]);
  });

  it('anchors tie blocks at their first member so ties do not chain', () => {
    // Distances from a: 1, 1 + 0.6·tol, 1 + 1.2·tol, 10 (tol = ε₁ × max d = ε₁ × 10;
    // the squared term, ε₂ × 100, is far smaller than these gaps).
    const tol = RELATIONSHIP_TIE_EPSILON_LINEAR * 10;
    const row = [0, 1, 1 + 0.6 * tol, 1 + 1.2 * tol, 10];
    const distances = row.map((_, i) =>
      row.map((_, j) => (i === j ? 0 : i === 0 ? row[j] : j === 0 ? row[i] : 10)),
    );
    const fit = makeFit(
      ['a', 'b', 'c', 'd', 'e'],
      ['a', 'b', 'c', 'd', 'e'],
      distances,
      row.map((v) => [v, 0] as [number, number]),
    );
    expect(rankNeighbours(fit, 'a')!.map((e) => [e.memberId, e.rank])).toEqual([
      ['b', 1],
      ['c', 1],
      ['d', 3],
      ['e', 4],
    ]);
  });

  it('reports screen ranks that disagree with true ranks', () => {
    const distances = [
      [0, 1, 3],
      [1, 0, 3],
      [3, 3, 0],
    ];
    const fit = makeFit(['a', 'b', 'c'], ['a', 'b', 'c'], distances, [
      [0, 0],
      [5, 0],
      [1, 0],
    ]);
    expect(rankNeighbours(fit, 'a')!.map((e) => [e.memberId, e.rank, e.screenRank])).toEqual([
      ['b', 1, 2],
      ['c', 2, 1],
    ]);
  });

  it('ranks every member 1 when all maps coincide (max d = 0)', () => {
    const n = 4;
    const zeros = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const fit = makeFit(
      ids(n),
      ids(n),
      zeros,
      ids(n).map(() => [0, 0] as [number, number]),
    );
    expect(rankNeighbours(fit, 'm2')!.map((e) => [e.memberId, e.rank, e.screenRank])).toEqual([
      ['m0', 1, 1],
      ['m1', 1, 1],
      ['m3', 1, 1],
    ]);
  });

  it('handles n = 2', () => {
    const fit = pointFit(['a', 'b'], ['a', 'b'], [[0], [3]]);
    expect(rankNeighbours(fit, 'b')).toEqual([
      { memberId: 'a', distance: 3, rank: 1, screenRank: 1 },
    ]);
  });
});

describe('neighbourPreservation', () => {
  const onLine = (xs: number[]) => matrix(xs.map((x) => [x]));
  const lineCoords = (xs: number[]) => xs.map((x) => [x, 0] as [number, number]);

  it.each([2, 3, 4])('is not informative for n = %i at k = 3', (n) => {
    const xs = Array.from({ length: n }, (_, i) => i * i);
    expect(neighbourPreservation(onLine(xs), lineCoords(xs))).toMatchObject({
      informative: false,
      k: 3,
    });
  });

  it('is not informative when k exceeds n', () => {
    const xs = [0, 1, 3, 7, 15];
    expect(neighbourPreservation(onLine(xs), lineCoords(xs), 10)).toMatchObject({
      informative: false,
      k: 10,
    });
  });

  it('is perfect at n = 5 for an exact layout', () => {
    const points = randomPoints(5, 2, 3);
    expect(neighbourPreservation(matrix(points), points as [number, number][])).toEqual({
      informative: true,
      k: 3,
      perMember: [1, 1, 1, 1, 1],
      overall: 1,
    });
  });

  it('gives the hand-computed answer when the layout swaps two members', () => {
    // True positions 0, 1, 2, 3, 10; the layout swaps members 3 and 4 (x = 10 ↔ 3).
    // Every member keeps exactly two of its three true neighbours.
    const result = neighbourPreservation(onLine([0, 1, 2, 3, 10]), lineCoords([0, 1, 2, 10, 3]));
    if (!result.informative) throw new Error('expected informative');
    result.perMember.forEach((v) => expect(v).toBeCloseTo(2 / 3, 15));
    expect(result.overall).toBeCloseTo(2 / 3, 15);
  });

  it('includes ties at the layout boundary', () => {
    // Source neighbours of member 0 are {2, 3, 4} (member 1 is far). In the layout all
    // four others sit at distance 1 from member 0 (one with 1e-13 noise), so the tie-
    // inclusive layout neighbourhood is all four and keeps every true neighbour. A
    // strict top-3 in index order would pick {1, 2, 3} and score 2/3.
    const source = onLine([0, 10, 1, 2, 3]);
    const coords: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -(1 + 1e-13)],
    ];
    const result = neighbourPreservation(source, coords);
    if (!result.informative) throw new Error('expected informative');
    expect(result.perMember[0]).toBe(1);
  });

  it('includes ties at the source boundary from Rust-computed coincident maps', () => {
    // From member 0, members 1 (d ≈ 5.6e-8) and 2 (d = 0) tie, so its k = 1 source
    // neighbourhood is {1, 2}. The layout puts only member 1 next to it: 1/2. Without
    // the tie the source set would be {2} and the score 0.
    const d = rustDistances(coincidentPatternRows(), 'pattern-shape');
    expect(d[0][1]).not.toBe(d[0][2]);
    const coords: [number, number][] = [
      [0, 0],
      [0.001, 0],
      [-5, 0],
      [3, 3],
      [-3, 3],
    ];
    const result = neighbourPreservation(d, coords, 1);
    if (!result.informative) throw new Error('expected informative');
    expect(result.perMember[0]).toBe(0.5);
  });

  it('is 1 for every member when all maps coincide', () => {
    const n = 5;
    const zeros = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    expect(
      neighbourPreservation(
        zeros,
        zeros.map(() => [0, 0] as [number, number]),
      ),
    ).toEqual({
      informative: true,
      k: 3,
      perMember: [1, 1, 1, 1, 1],
      overall: 1,
    });
  });

  it('rejects malformed input, including NaN distances', () => {
    expect(() => neighbourPreservation(onLine([0, 1]), [[0, 0]])).toThrow(RangeError);
    expect(() => neighbourPreservation(onLine([0, 1]), lineCoords([0, 1]), 0)).toThrow(RangeError);
    const xs = [0, 1, 2, 3, 4];
    const nan = onLine(xs);
    nan[1][3] = NaN;
    expect(() => neighbourPreservation(nan, lineCoords(xs))).toThrow(RangeError);
  });
});

describe('distanceToCentroid', () => {
  const centroidOf = (points: Point[], w: number[]) =>
    points[0].map((_, k) => points.reduce((acc, p, j) => acc + w[j] * p[k], 0));

  it('matches direct computation for random weights, including zero weights', () => {
    const points = randomPoints(8, 7, 99);
    const r = rng(5);
    const raw = points.map((_, i) => (i % 3 === 0 ? 0 : r()));
    const total = raw.reduce((a, b) => a + b, 0);
    const w = raw.map((v) => v / total);
    const c = centroidOf(points, w);
    const result = distanceToCentroid(matrix(points), w)!;
    result.forEach((v, i) => expect(v).toBeCloseTo(euclid(points[i], c), 10));
    expect(w[0]).toBe(0);
    expect(result[0]).toBeGreaterThan(0);
  });

  it('clamps cancellation near zero instead of returning NaN', () => {
    // All weight on one member: its own distance is exactly a cancellation.
    const points = [
      [1e8, 1e8 + 1],
      [1e8 + 1e-3, 1e8],
      [1e8, 1e8],
    ];
    const result = distanceToCentroid(matrix(points), [1, 0, 0])!;
    expect(result.every(Number.isFinite)).toBe(true);
    expect(result[0]).toBeGreaterThanOrEqual(0);
    expect(result[0]).toBeLessThan(1e-6);
    // Rust-computed coincident maps: centroid distance is ~0, never NaN.
    const d = rustDistances(coincidentPatternRows(), 'pattern-shape');
    const tiny = distanceToCentroid(d, [1 / 3, 1 / 3, 1 / 3, 0, 0])!;
    expect(tiny.slice(0, 3).every((v) => Number.isFinite(v) && v >= 0 && v < 1e-6)).toBe(true);
    // A non-Euclidean perturbation that drives the radicand negative is clamped to 0.
    const negative = distanceToCentroid(
      [
        [0, 1, 1],
        [1, 0, 3],
        [1, 3, 0],
      ],
      [0, 0.5, 0.5],
    )!;
    expect(negative[0]).toBe(0);
  });

  it('returns null for invalid weights', () => {
    const d = onLineMatrix([0, 1, 2]);
    expect(distanceToCentroid(d, [0.5, 0.5])).toBeNull();
    expect(distanceToCentroid(d, [0.5, 0.6, -0.1])).toBeNull();
    expect(distanceToCentroid(d, [0.5, 0.25, 0.2])).toBeNull();
    expect(distanceToCentroid(d, [NaN, 0.5, 0.5])).toBeNull();
    expect(distanceToCentroid(d, [Infinity, 0, 0])).toBeNull();
    expect(distanceToCentroid(d, [0, 0, 0])).toBeNull();
    expect(distanceToCentroid([], [])).toBeNull();
    expect(distanceToCentroid(d, [1 / 3, 1 / 3, 1 / 3])).not.toBeNull();
  });

  it('accepts a weight sum of 1 ± 1e-9 and rejects 1 + 2e-9', () => {
    const d = onLineMatrix([0, 1, 2]);
    expect(distanceToCentroid(d, [0.5, 0.5 + 1e-9, 0])).not.toBeNull();
    expect(distanceToCentroid(d, [0.5, 0.5 - 1e-9, 0])).not.toBeNull();
    expect(distanceToCentroid(d, [0.5, 0.5 + 2e-9, 0])).toBeNull();
    expect(distanceToCentroid(d, [0.5, 0.5 - 2e-9, 0])).toBeNull();
  });

  it('returns null for NaN distances', () => {
    const d = onLineMatrix([0, 1, 2]);
    d[0][2] = NaN;
    expect(distanceToCentroid(d, [1 / 3, 1 / 3, 1 / 3])).toBeNull();
  });
});

function onLineMatrix(xs: number[]) {
  return matrix(xs.map((x) => [x]));
}

describe('nearestToCentroid', () => {
  const context = ['x', 'p1a', 'p1b', 'p1c', 'y', 'p2a', 'p3a'];
  const fitted = ['p1a', 'p1b', 'p1c', 'p2a', 'p3a'];
  const points = randomPoints(fitted.length, 4, 41);
  const fit = pointFit(context, fitted, points);
  const participantOf = new Map([
    ['x', 'P1'],
    ['p1a', 'P1'],
    ['p1b', 'P1'],
    ['p1c', 'P1'],
    ['y', 'P2'],
    ['p2a', 'P2'],
    ['p3a', 'P3'],
  ]);
  const base = { summaryKind: 'mean' as const, usable: true };
  const observations = { ...base, weighting: { kind: 'observations' as const } };

  it('weights observations equally and ranks against the direct centroid', () => {
    const result = nearestToCentroid(fit, ['p1a', 'p1b', 'p2a'], observations);
    if (!result.enabled) throw new Error(result.message);
    const c = points[0].map((_, k) => (points[0][k] + points[1][k] + points[3][k]) / 3);
    const direct = fitted.map((id, i) => ({ id, d: euclid(points[i], c) }));
    expect(result.entries.map((e) => e.memberId)).toEqual(
      [...direct].sort((a, b) => a.d - b.d).map((e) => e.id),
    );
    for (const e of result.entries)
      expect(e.distance).toBeCloseTo(direct.find((d) => d.id === e.memberId)!.d, 10);
    expect(result.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(result.weights.map((w) => w.weight)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(result.selectedUnassigned).toEqual([]);
    expect(result.commonVoxels).toBe(800);
  });

  it('ignores duplicate ids in the selection', () => {
    const result = nearestToCentroid(fit, ['p1a', 'p1a', 'p2a', 'x', 'x'], observations);
    if (!result.enabled) throw new Error(result.message);
    expect(result.weights).toEqual([
      { memberId: 'p1a', weight: 0.5 },
      { memberId: 'p2a', weight: 0.5 },
    ]);
    expect(result.selectedUnassigned).toEqual(['x']);
  });

  it('gives each participant equal weight divided among its fitted observations', () => {
    const selection = ['x', 'p1a', 'p1b', 'p1c', 'y', 'p2a', 'p3a'];
    const result = nearestToCentroid(fit, selection, {
      ...base,
      weighting: { kind: 'participants', participantOf },
    });
    if (!result.enabled) throw new Error(result.message);
    // P1 has three fitted observations (x is unassigned), P2 one (y unassigned), P3 one.
    const w = [1 / 9, 1 / 9, 1 / 9, 1 / 3, 1 / 3];
    expect(result.weights.map((e) => e.memberId)).toEqual(fitted);
    result.weights.forEach((e, i) => expect(e.weight).toBeCloseTo(w[i], 15));
    const c = points[0].map((_, k) => points.reduce((acc, p, j) => acc + w[j] * p[k], 0));
    for (const e of result.entries)
      expect(e.distance).toBeCloseTo(euclid(points[fitted.indexOf(e.memberId)], c), 10);
    expect(result.selectedUnassigned).toEqual(['x', 'y']);
  });

  it('differs from observation weighting when participants contribute unequally', () => {
    const selection = ['p1a', 'p1b', 'p1c', 'p3a'];
    const byObs = nearestToCentroid(fit, selection, observations);
    const byPart = nearestToCentroid(fit, selection, {
      ...base,
      weighting: { kind: 'participants', participantOf },
    });
    if (!byObs.enabled || !byPart.enabled) throw new Error('expected enabled');
    expect(byObs.weights.find((w) => w.memberId === 'p3a')!.weight).toBeCloseTo(0.25, 15);
    expect(byPart.weights.find((w) => w.memberId === 'p3a')!.weight).toBeCloseTo(0.5, 15);
  });

  it('ties Rust-computed coincident maps (old rule: ranks 2, 3, 1)', () => {
    const d = rustDistances(coincidentPatternRows(), 'pattern-shape');
    const coords = ids(5).map((_, i) => [i, 0] as [number, number]);
    const coincident = makeFit(ids(5), ids(5), d, coords);
    const result = nearestToCentroid(coincident, ['m0', 'm1', 'm2'], observations);
    if (!result.enabled) throw new Error(result.message);
    expect(result.entries.slice(0, 3).map((e) => [e.memberId, e.rank])).toEqual([
      ['m0', 1],
      ['m1', 1],
      ['m2', 1],
    ]);
    expect(result.entries.slice(3).every((e) => e.rank > 3)).toBe(true);
    expect(result.entries.every((e) => Number.isFinite(e.distance))).toBe(true);
    // The old rule (|a − b| ≤ 1e-9 × max centroid distance) would split them.
    const near = result.entries.slice(0, 3).map((e) => e.distance);
    const far = Math.max(...result.entries.map((e) => e.distance));
    expect(Math.max(...near) - Math.min(...near)).toBeGreaterThan(1e-9 * far);
  });

  it('ranks every member 1 when all maps coincide', () => {
    const n = 4;
    const zeros = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const flat = makeFit(
      ids(n),
      ids(n),
      zeros,
      ids(n).map(() => [0, 0] as [number, number]),
    );
    const result = nearestToCentroid(flat, ['m0', 'm3'], observations);
    if (!result.enabled) throw new Error(result.message);
    expect(result.entries.map((e) => [e.memberId, e.rank, e.distance])).toEqual([
      ['m0', 1, 0],
      ['m1', 1, 0],
      ['m2', 1, 0],
      ['m3', 1, 0],
    ]);
  });

  it('throws on NaN distances', () => {
    const bad = structuredClone(fit);
    bad.geometry.distances[0][1] = NaN;
    expect(() => nearestToCentroid(bad, ['p1a'], observations)).toThrow();
  });

  it.each(['median', 'mad', 'sampleSd', 'meanAbsolute', 'cancellation', 'coverage'] as const)(
    'is disabled for the %s summary',
    (summaryKind) => {
      const result = nearestToCentroid(fit, ['p1a', 'x'], {
        summaryKind,
        usable: true,
        weighting: { kind: 'observations' },
      });
      expect(result).toMatchObject({
        enabled: false,
        reason: 'not-a-mean',
        selectedUnassigned: ['x'],
      });
    },
  );

  it('is disabled for a stale or out-of-scope fit', () => {
    expect(nearestToCentroid(fit, ['p1a'], { ...observations, usable: false })).toMatchObject({
      enabled: false,
      reason: 'unusable-fit',
    });
  });

  it('is disabled when no selected member is fitted, reporting unassigned ones', () => {
    expect(nearestToCentroid(fit, ['x', 'y', 'not-in-context'], observations)).toMatchObject({
      enabled: false,
      reason: 'no-fitted-selection',
      selectedUnassigned: ['x', 'y'],
    });
    expect(nearestToCentroid(fit, [], observations)).toMatchObject({
      enabled: false,
      reason: 'no-fitted-selection',
    });
  });

  it('is disabled when a selected fitted member has no participant identity', () => {
    const result = nearestToCentroid(fit, ['p1a', 'p3a'], {
      ...base,
      weighting: { kind: 'participants', participantOf: new Map([['p1a', 'P1']]) },
    });
    expect(result).toMatchObject({ enabled: false, reason: 'participant-unresolved' });
  });
});
