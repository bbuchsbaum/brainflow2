/**
 * Neighbours, neighbour preservation and maps nearest a weighted centroid for a
 * relationship fit (W1 of docs/plans/neurotabs-contributors-and-space.md).
 *
 * Pure functions over the fit's geometry. Geometry (`distances`, `coordinates`)
 * is indexed by position in `relationshipFittedIds(fit)`, not in
 * `fit.request.members`; unassigned members have no position and never appear.
 *
 * Both declared distances are plain Euclidean on the common support
 * (`relationship_math.rs`): effect distance on rows / √p, pattern-shape distance
 * on centred unit-norm rows, so d = √(2 − 2r). No voxel weights.
 *
 * One tie rule (`distancesTie`) serves every comparison in this module: two
 * distances a, b tie when
 *   |a² − b²| ≤ ε₂ × max d²   or   |a − b| ≤ ε₁ × max d,
 * with ε₂ = `RELATIONSHIP_TIE_EPSILON_SQUARED` (1e-12), ε₁ =
 * `RELATIONSHIP_TIE_EPSILON_LINEAR` (1e-7), and max d taken over the matrix the
 * values come from (the fit's distances, or the layout's for screen ranks).
 * - The squared term absorbs Rust's arithmetic: it computes
 *   d = √max(0, gᵢᵢ + gⱼⱼ − 2gᵢⱼ) from a Gram matrix, so rounding lives in d², at
 *   roughly 1e-14 of the largest d², and a coincident pair comes out at
 *   d ≈ 1e-8 × max d rather than 0.
 * - The linear term reflects the input's resolution: map values are stored as
 *   f32, whose relative precision is about 6e-8, so distance differences below
 *   about 1e-7 of the largest distance are not resolvable. Affine copies of one
 *   map (same pattern shape) differ by that rounding, which is what separates
 *   them when they are ranked from a third map.
 * Ranking is by d²; displayed distances stay unsquared. Tie blocks are anchored
 * at their first (smallest) member, so ties never chain transitively.
 */
import {
  relationshipFittedIds,
  relationshipUnassigned,
  type RelationshipFit,
} from './PopulationRelationshipService';
import type { PopulationState } from '@/types/population';

/**
 * Default relative tie tolerance ε₂ on squared distances. A float64 port of the
 * pattern-shape Gram computation with f32 inputs gives coincident maps
 * d² / max d² ≈ 2e-15 at p = 20 000 and ≈ 9e-15 at p = 10⁶.
 */
export const RELATIONSHIP_TIE_EPSILON_SQUARED = 1e-12;

/**
 * Default relative tie tolerance ε₁ on distances, set by the f32 storage of map
 * values (relative precision ≈ 6e-8).
 */
export const RELATIONSHIP_TIE_EPSILON_LINEAR = 1e-7;

/** Default neighbourhood size for layout preservation. */
export const NEIGHBOUR_PRESERVATION_K = 3;

/** Population summary statistics the working summary can show. */
export type PopulationSummaryKind = NonNullable<PopulationState['restoredView']>['summary'];

export interface TieOptions {
  /** Relative tolerance on squared distances; defaults to `RELATIONSHIP_TIE_EPSILON_SQUARED`. */
  epsilonSquared?: number;
  /** Relative tolerance on distances; defaults to `RELATIONSHIP_TIE_EPSILON_LINEAR`. */
  epsilonLinear?: number;
}

/** Absolute tolerances for `distancesTie`. */
export interface TieTolerance {
  /** ε₂ × max d². */
  squared: number;
  /** ε₁ × max d. */
  linear: number;
}

/**
 * Absolute tie tolerances over a distance matrix: ε₂ × max d² and ε₁ × max d
 * (both 0 when every distance is 0).
 */
export function tieTolerance(
  distances: readonly (readonly number[])[],
  options?: TieOptions,
): TieTolerance {
  const epsilonSquared = options?.epsilonSquared ?? RELATIONSHIP_TIE_EPSILON_SQUARED,
    epsilonLinear = options?.epsilonLinear ?? RELATIONSHIP_TIE_EPSILON_LINEAR;
  if ([epsilonSquared, epsilonLinear].some((e) => !Number.isFinite(e) || e < 0))
    throw new RangeError('Tie tolerances must be finite, non-negative numbers.');
  let max = 0;
  for (const row of distances)
    for (const d of row) if (Number.isFinite(d)) max = Math.max(max, Math.abs(d));
  return { squared: epsilonSquared * max * max, linear: epsilonLinear * max };
}

/**
 * The shared tie rule: |a² − b²| ≤ `tolerance.squared` or |a − b| ≤
 * `tolerance.linear`. Callers that already hold the squares (e.g. centroid
 * radicands) pass them as `a2`, `b2` so the squared term uses them directly.
 */
export function distancesTie(
  a: number,
  b: number,
  tolerance: TieTolerance,
  a2 = a * a,
  b2 = b * b,
): boolean {
  return Math.abs(a2 - b2) <= tolerance.squared || Math.abs(a - b) <= tolerance.linear;
}

function pointDistances(coords: readonly (readonly [number, number])[]): number[][] {
  return coords.map(([xi, yi]) => coords.map(([xj, yj]) => Math.hypot(xi - xj, yi - yj)));
}

function isSquare(matrix: readonly (readonly number[])[], n: number): boolean {
  return (
    Array.isArray(matrix) &&
    matrix.length === n &&
    matrix.every((row) => Array.isArray(row) && row.length === n && row.every(Number.isFinite))
  );
}

/**
 * Orders `indices` by squared distance `square`, groups members that tie
 * (`distancesTie`) with the first member of each block, orders each block by
 * index (fit order) and assigns the competition rank (1, 2, 2, 4) of the
 * block's first position. `distance` is the unsquared value (√square).
 */
function rankBySquare(
  indices: readonly number[],
  square: (i: number) => number,
  distance: (i: number) => number,
  tolerance: TieTolerance,
): { index: number; rank: number }[] {
  const sorted = [...indices].sort((a, b) => square(a) - square(b) || a - b);
  const tie = (a: number, b: number) =>
    distancesTie(distance(a), distance(b), tolerance, square(a), square(b));
  const out: { index: number; rank: number }[] = [];
  let start = 0;
  while (start < sorted.length) {
    let end = start + 1;
    while (end < sorted.length && tie(sorted[start], sorted[end])) end++;
    for (const index of sorted.slice(start, end).sort((a, b) => a - b))
      out.push({ index, rank: start + 1 });
    start = end;
  }
  return out;
}

export interface RelationshipNeighbour {
  memberId: string;
  /** Declared fit distance (effect or pattern shape). */
  distance: number;
  /** Tie-inclusive competition rank by `distance`. */
  rank: number;
  /** Tie-inclusive competition rank of the same member by 2D layout distance. */
  screenRank: number;
}

/**
 * Other fitted members ranked by declared distance from `memberId`, with their
 * rank in the 2D layout. Null when `memberId` has no fitted position; throws when
 * the geometry does not match the fitted members.
 */
export function rankNeighbours(
  fit: RelationshipFit,
  memberId: string,
  options?: TieOptions,
): RelationshipNeighbour[] | null {
  const fitted = relationshipFittedIds(fit),
    i = fitted.indexOf(memberId),
    { distances, coordinates } = fit.geometry;
  if (i < 0) return null;
  if (
    !isSquare(distances, fitted.length) ||
    coordinates.length !== fitted.length ||
    coordinates.some((p) => p.length !== 2 || !p.every(Number.isFinite))
  )
    throw new Error('Relationship geometry does not match its fitted members.');
  const screen = pointDistances(coordinates);
  const others = fitted.map((_, j) => j).filter((j) => j !== i);
  const screenRanks = new Map(
    rankBySquare(
      others,
      (j) => screen[i][j] ** 2,
      (j) => screen[i][j],
      tieTolerance(screen, options),
    ).map((e) => [e.index, e.rank]),
  );
  return rankBySquare(
    others,
    (j) => distances[i][j] ** 2,
    (j) => distances[i][j],
    tieTolerance(distances, options),
  ).map((e) => ({
    memberId: fitted[e.index],
    distance: distances[i][e.index],
    rank: e.rank,
    screenRank: screenRanks.get(e.index)!,
  }));
}

export type NeighbourPreservation =
  | {
      informative: true;
      k: number;
      /** Per member, in the order of the input rows. */
      perMember: number[];
      /** Mean of `perMember`. */
      overall: number;
    }
  | { informative: false; k: number; reason: string };

/** Members j ≠ i no farther than the k-th smallest distance, or tied with it. */
function neighbourhood(
  row: readonly number[],
  i: number,
  k: number,
  tolerance: TieTolerance,
): Set<number> {
  const kth = row.filter((_, j) => j !== i).sort((a, b) => a - b)[k - 1];
  const out = new Set<number>();
  row.forEach((d, j) => {
    if (j !== i && (d <= kth || distancesTie(d, kth, tolerance))) out.add(j);
  });
  return out;
}

/**
 * Fraction of each member's k nearest neighbours by `distances` (ties at the
 * boundary included) that are also among its k nearest by Euclidean distance in
 * `coords` (ties included); overall is the mean over members. Follows neuroimjs
 * `neighborPreservation` (src/volumeset/nmds.ts, c4d23a4) but applies the
 * shared tie rule to both neighbourhoods. `coords` may be fitted
 * coordinates or drawn screen positions, in the same order as `distances`.
 * Not informative when n − 1 ≤ k: every neighbourhood is everyone.
 */
export function neighbourPreservation(
  distances: readonly (readonly number[])[],
  coords: readonly (readonly [number, number])[],
  k = NEIGHBOUR_PRESERVATION_K,
  options?: TieOptions,
): NeighbourPreservation {
  const n = distances.length;
  if (!Number.isInteger(k) || k < 1) throw new RangeError('k must be an integer ≥ 1.');
  if (!isSquare(distances, n))
    throw new RangeError('distances must be a square matrix of finite values.');
  if (coords.length !== n || coords.some((p) => p.length !== 2 || !p.every(Number.isFinite)))
    throw new RangeError('coords must hold one finite 2D point per distance row.');
  if (n - 1 <= k)
    return {
      informative: false,
      k,
      reason: `With ${n} ${n === 1 ? 'member' : 'members'} and k = ${k}, every neighbourhood contains all other members.`,
    };
  const screen = pointDistances(coords),
    sourceTol = tieTolerance(distances, options),
    screenTol = tieTolerance(screen, options);
  const perMember = distances.map((row, i) => {
    const source = neighbourhood(row, i, k, sourceTol),
      layout = neighbourhood(screen[i], i, k, screenTol);
    let hits = 0;
    for (const j of source) if (layout.has(j)) hits++;
    return hits / source.size;
  });
  return {
    informative: true,
    k,
    perMember,
    overall: perMember.reduce((a, b) => a + b, 0) / n,
  };
}

/** Accepted deviation of the weight sum from 1 (plus a few ulps of rounding). */
export const CENTROID_WEIGHT_SUM_TOLERANCE = 1e-9;

/**
 * Squared distance from every member to the w-weighted centroid, clamped at 0:
 *   max(0, Σⱼ wⱼ dᵢⱼ² − ½ Σⱼₖ wⱼ wₖ dⱼₖ²).
 * Null when the matrix or weights are invalid (see `distanceToCentroid`).
 */
export function squaredDistanceToCentroid(
  distances: readonly (readonly number[])[],
  weights: readonly number[],
): number[] | null {
  const n = distances.length;
  if (n === 0 || !isSquare(distances, n) || !Array.isArray(weights) || weights.length !== n)
    return null;
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) return null;
  const sum = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > CENTROID_WEIGHT_SUM_TOLERANCE + 8 * Number.EPSILON) return null;
  const w = weights.map((v) => v / sum);
  const a = distances.map((row) => row.reduce((acc, d, j) => acc + w[j] * d * d, 0));
  const half = 0.5 * a.reduce((acc, ai, i) => acc + w[i] * ai, 0);
  return a.map((ai) => Math.max(0, ai - half));
}

/**
 * Euclidean distance from every fitted member to the w-weighted centroid of the
 * fitted configuration, from distances alone:
 *   ‖xᵢ − x̄_w‖ = sqrt(max(0, Σⱼ wⱼ dᵢⱼ² − ½ Σⱼₖ wⱼ wₖ dⱼₖ²)).
 * Exact for any Euclidean configuration; members with zero weight still get a
 * distance. The clamp absorbs cancellation near zero. Weights must be finite,
 * non-negative, one per row and sum to 1 (within 1e-9); otherwise null. Null
 * also for a non-square or non-finite distance matrix.
 */
export function distanceToCentroid(
  distances: readonly (readonly number[])[],
  weights: readonly number[],
): number[] | null {
  return squaredDistanceToCentroid(distances, weights)?.map(Math.sqrt) ?? null;
}

export type CentroidWeighting =
  /** Equal weight per selected observation (`reduction: 'observations' | 'single'`). */
  | { kind: 'observations' }
  /**
   * Equal weight per participant, divided equally among its observations
   * (`reduction: 'mean'`). `participantOf` maps memberId → participantId, e.g.
   * the map from `participantIdentity`; resolving identity needs the dataset
   * and its metadata, which this pure module does not own.
   */
  | { kind: 'participants'; participantOf: ReadonlyMap<string, string> };

export interface NearestToCentroidOptions extends TieOptions {
  /** The working summary statistic; only `mean` has a centroid. */
  summaryKind: PopulationSummaryKind;
  /** False when the fit is stale or out of scope (as `order()` / `group()` refuse). */
  usable: boolean;
  weighting: CentroidWeighting;
}

export type NearestToCentroidDisabledReason =
  | 'unusable-fit'
  | 'not-a-mean'
  | 'no-fitted-selection'
  | 'participant-unresolved';

export interface CentroidNeighbour {
  memberId: string;
  /** Distance to the weighted centroid, in the fit's declared distance. */
  distance: number;
  /** Tie-inclusive competition rank. */
  rank: number;
}

export type NearestToCentroid =
  | {
      enabled: true;
      /** All fitted members, nearest first; ties ordered by fit order. */
      entries: CentroidNeighbour[];
      /** Weight per fitted selected member, in fit order. */
      weights: { memberId: string; weight: number }[];
      /** Selected members that are unassigned in the fit, in request order. */
      selectedUnassigned: string[];
      /** Size of the common support the centroid is defined on. */
      commonVoxels: number;
      distance: RelationshipFit['request']['distance'];
    }
  | {
      enabled: false;
      reason: NearestToCentroidDisabledReason;
      message: string;
      selectedUnassigned: string[];
    };

/**
 * Fitted members ranked by distance to the weighted centroid of the selection.
 *
 * This is the centroid on the fit's common support (`fit.commonVoxels` voxels,
 * fitted members only), not the displayed mean map, which averages each voxel
 * over its own finite observations. For pattern shape, ranking by the centroid
 * equals ranking by its normalized direction, since
 * ‖zᵢ − z̄‖² = 1 + ‖z̄‖² − 2 zᵢ·z̄ for unit-norm zᵢ.
 *
 * Ranking is by the clamped squared distance. Ties use the shared rule with
 * tolerances from the fit's max d (the scale of the rounding error), not from
 * the centroid distances themselves: the squared term compares radicands and
 * the linear term their square roots.
 *
 * Weights are built from the selected members that have a fitted position;
 * selected unassigned members are reported in `selectedUnassigned` and carry
 * no weight. With participant weighting, each participant with at least one
 * fitted selected observation gets equal weight, divided equally among those
 * observations. Duplicate and out-of-context selected IDs are ignored.
 * Throws when the geometry does not match the fitted members.
 */
export function nearestToCentroid(
  fit: RelationshipFit,
  selection: readonly string[],
  options: NearestToCentroidOptions,
): NearestToCentroid {
  const tolerance = tieTolerance(fit.geometry.distances, options);
  const selected = new Set(selection),
    fitted = relationshipFittedIds(fit),
    selectedUnassigned = relationshipUnassigned(fit)
      .map((u) => u.memberId)
      .filter((id) => selected.has(id));
  const disabled = (
    reason: NearestToCentroidDisabledReason,
    message: string,
  ): NearestToCentroid => ({
    enabled: false,
    reason,
    message,
    selectedUnassigned,
  });
  if (!options.usable)
    return disabled(
      'unusable-fit',
      'The similarity fit is stale or belongs to another context; refit to rank.',
    );
  if (options.summaryKind !== 'mean')
    return disabled(
      'not-a-mean',
      'Nearest the centroid is available only when the summary is the mean.',
    );
  const members = fitted.map((id, i) => ({ id, i })).filter(({ id }) => selected.has(id));
  if (!members.length)
    return disabled('no-fitted-selection', 'No selected observation has a position in this fit.');
  const weights = new Array<number>(fitted.length).fill(0);
  if (options.weighting.kind === 'observations') {
    for (const { i } of members) weights[i] = 1 / members.length;
  } else {
    const participantOf = options.weighting.participantOf,
      groups = new Map<string, number[]>();
    for (const { id, i } of members) {
      const participant = participantOf.get(id);
      if (participant === undefined)
        return disabled('participant-unresolved', `Observation ${id} has no participant identity.`);
      groups.set(participant, [...(groups.get(participant) ?? []), i]);
    }
    for (const indices of groups.values())
      for (const i of indices) weights[i] = 1 / groups.size / indices.length;
  }
  const squared = squaredDistanceToCentroid(fit.geometry.distances, weights);
  if (!squared) throw new Error('Relationship geometry does not match its fitted members.');
  return {
    enabled: true,
    entries: rankBySquare(
      fitted.map((_, i) => i),
      (i) => squared[i],
      (i) => Math.sqrt(squared[i]),
      tolerance,
    ).map((e) => ({
      memberId: fitted[e.index],
      distance: Math.sqrt(squared[e.index]),
      rank: e.rank,
    })),
    weights: members.map(({ id, i }) => ({ memberId: id, weight: weights[i] })),
    selectedUnassigned,
    commonVoxels: fit.commonVoxels,
    distance: fit.request.distance,
  };
}
