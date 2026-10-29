/**
 * The relationship scatter's hover peek (W1 UI, "Scope decision" in
 * docs/plans/neurotabs-contributors-and-space.md).
 *
 * The peek previews one observation's slice without touching focus, the
 * Inspector or the lens's displayed result. Rasters come from
 * `PopulationSliceService.evaluatePeek` (the focused-original path). This
 * owner keeps a small LRU of recent rasters and one in-flight request; a newer
 * request aborts the older one, and a response that arrives after the pointer
 * moved on is dropped. Raw values are cached, never bitmaps, so a changed
 * colour range recolours a cached raster without a native call.
 */
import type { ViewPlane } from '@/types/coordinates';
import type { PopulationOrientation, PopulationPeekRaster } from './PopulationSliceService';
import { formatTauriError } from '@/utils/formatTauriError';

export interface PopulationPeekTarget {
  memberId: string;
  crosshairMm: readonly [number, number, number];
  orientation: PopulationOrientation;
}
export type PopulationPeekEvaluate = (
  target: PopulationPeekTarget,
  signal: AbortSignal,
) => Promise<PopulationPeekRaster>;

export interface PopulationPeekSnapshot {
  target: PopulationPeekTarget | null;
  /** The raster for `target`, or the same member's previous raster while a new slice loads. */
  raster: PopulationPeekRaster | null;
  pending: boolean;
  error: string | null;
}

const EMPTY: PopulationPeekSnapshot = { target: null, raster: null, pending: false, error: null };
/** Recently peeked rasters kept per scope (a 256 × 256 raster is about 0.5 MB as numbers). */
export const POPULATION_PEEK_CACHE_SIZE = 12;

export function populationPeekKey(target: PopulationPeekTarget): string {
  return JSON.stringify([target.memberId, target.orientation, [...target.crosshairMm]]);
}

export class PopulationPeekService {
  private snapshot: PopulationPeekSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private cache = new Map<string, PopulationPeekRaster>();
  private scope: string | null = null;
  private generation = 0;
  private abort: AbortController | null = null;
  /** The request in flight: its key and member. */
  private inflight: { key: string; memberId: string } | null = null;
  /** The target the peek wants, kept across scope changes (null when closed). */
  private wanted: PopulationPeekTarget | null = null;
  private evaluate: PopulationPeekEvaluate | null;
  private readonly capacity: number;
  constructor(
    evaluate: PopulationPeekEvaluate | null = null,
    capacity = POPULATION_PEEK_CACHE_SIZE,
  ) {
    this.evaluate = evaluate;
    this.capacity = capacity;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** Number of cached rasters (diagnostics and tests). */
  get cacheSize() {
    return this.cache.size;
  }
  setEvaluator(evaluate: PopulationPeekEvaluate | null) {
    this.evaluate = evaluate;
  }
  /**
   * The population the cached rasters belong to (dataset, sources, mask,
   * raster size and zoom). A change clears the cache and drops the request in
   * flight; the wanted target is re-requested as soon as the scope is
   * non-null again.
   */
  setScope(scope: string | null) {
    if (scope === this.scope) return;
    this.scope = scope;
    this.cache.clear();
    this.cancel();
    const wanted = this.wanted;
    if (!wanted) {
      this.publish(EMPTY);
      return;
    }
    this.publish({ target: wanted, raster: null, pending: false, error: null });
    this.request(wanted);
  }
  /**
   * Show `target` (null hides the peek). Cached rasters are shown at once.
   * Requests for another member abort the one in flight (the pointer moved
   * on). Requests for the same member while one is in flight (wheel bursts,
   * plane switches) wait for it and then send only the latest target, so a
   * burst costs at most two native evaluations.
   */
  request(target: PopulationPeekTarget | null) {
    this.wanted = target;
    if (!target) {
      this.cancel();
      if (this.snapshot !== EMPTY) this.publish(EMPTY);
      return;
    }
    const key = populationPeekKey(target);
    const cached = this.cache.get(key);
    if (cached) {
      if (this.inflight && this.inflight.memberId !== target.memberId) this.cancel();
      // Refresh recency.
      this.cache.delete(key);
      this.cache.set(key, cached);
      this.publish({ target, raster: cached, pending: false, error: null });
      return;
    }
    const previous = this.snapshot.raster;
    // Same member in flight: it is sent when the in-flight request settles.
    const waits = this.inflight?.memberId === target.memberId;
    if (!waits) this.cancel();
    this.publish({
      target,
      raster: previous?.memberId === target.memberId ? previous : null,
      pending: true,
      error: null,
    });
    if (!waits) this.start(target);
  }
  private start(target: PopulationPeekTarget) {
    if (!this.evaluate || this.scope === null) {
      this.publish({
        target,
        raster: null,
        pending: false,
        error: 'No population slice to peek from.',
      });
      return;
    }
    const key = populationPeekKey(target),
      generation = this.generation,
      scope = this.scope,
      abort = new AbortController();
    this.abort = abort;
    this.inflight = { key, memberId: target.memberId };
    const current = () =>
      !abort.signal.aborted && generation === this.generation && scope === this.scope;
    const settle = (publish: () => void) => {
      this.abort = null;
      this.inflight = null;
      const wanted = this.wanted;
      if (wanted && populationPeekKey(wanted) === key) publish();
      else if (wanted) {
        const cached = this.cache.get(populationPeekKey(wanted));
        if (cached) this.publish({ target: wanted, raster: cached, pending: false, error: null });
        else this.start(wanted);
      }
    };
    this.evaluate(target, abort.signal).then(
      (raster) => {
        if (!current()) return;
        this.cache.set(key, raster);
        while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
        settle(() => this.publish({ target, raster, pending: false, error: null }));
      },
      (error) => {
        if (!current()) return;
        settle(() =>
          this.publish({ ...this.snapshot, pending: false, error: formatTauriError(error) }),
        );
      },
    );
  }
  /** Abort the request in flight; its response, if any, is dropped. */
  cancel() {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.inflight = null;
    if (this.snapshot.pending) this.publish({ ...this.snapshot, pending: false });
  }
  dispose() {
    this.cancel();
    this.cache.clear();
    this.wanted = null;
    this.snapshot = EMPTY;
  }
  private publish(next: PopulationPeekSnapshot) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}

/**
 * The raster value nearest `worldMm`: pixel (x, y) is centred at
 * origin + x·u + y·v (the native plane contract). Undefined outside the
 * raster, null where the observation has no finite value.
 */
export function peekValueAt(
  raster: { plane: ViewPlane; values: readonly (number | null)[] },
  worldMm: readonly number[],
): number | null | undefined {
  const {
    origin_mm: o,
    u_mm: u,
    v_mm: v,
    dim_px: [w, h],
  } = raster.plane;
  const d = [0, 1, 2].map((i) => worldMm[i] - o[i]);
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2],
    vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (!uu || !vv) return undefined;
  const x = Math.round((d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / uu),
    y = Math.round((d[0] * v[0] + d[1] * v[1] + d[2] * v[2]) / vv);
  if (x < 0 || y < 0 || x >= w || y >= h) return undefined;
  const value = raster.values[y * w + x];
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

export type ScatterDirection = 'left' | 'right' | 'up' | 'down';
const DIRECTIONS: Record<ScatterDirection, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/**
 * The point to move to from `from` with an arrow key, in screen coordinates
 * (y down). Candidates lie strictly ahead in that direction; those within 45°
 * of it are preferred, and among them the smallest distance ahead plus twice
 * the sideways offset wins (ties go to fit order). Coincident points are
 * reachable: a point at the same position counts as ahead for right/down when
 * it comes later in fit order, and for left/up when it comes earlier. Null
 * when nothing lies ahead.
 */
export function directionalNeighbour(
  points: readonly (readonly [number, number])[],
  from: number,
  direction: ScatterDirection,
): number | null {
  const [dx, dy] = DIRECTIONS[direction];
  const [x0, y0] = points[from] ?? [NaN, NaN];
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
  const forward = direction === 'right' || direction === 'down';
  let best: number | null = null,
    bestScore = Infinity;
  points.forEach(([x, y], i) => {
    if (i === from) return;
    const along = (x - x0) * dx + (y - y0) * dy,
      across = Math.abs((x - x0) * dy - (y - y0) * dx);
    const coincident = along === 0 && across === 0;
    if (coincident ? forward !== i > from : along <= 0) return;
    // Outside the 45° cone costs more than any candidate inside it.
    const cone = coincident || along >= across ? 0 : 1e12;
    const score = cone + (coincident ? Math.abs(i - from) * 1e-9 : along + 2 * across);
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}
