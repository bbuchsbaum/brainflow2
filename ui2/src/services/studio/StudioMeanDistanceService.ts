/**
 * StudioMeanDistanceService - each listed observation's distance to the
 * group mean, for the Subjects list's "Distance to group mean" sort (QA
 * features 2026-10-31 §5).
 *
 * The group is the list as filtered (search, filters, scope), before sorting.
 * The backend (`population_mean_distance`) computes the voxelwise mean of the
 * group on its common finite support and, per observation, the Euclidean
 * distance to it with the correlation distance (1 − r) alongside. Results are
 * keyed by dataset, feature, mask and group membership, so a stale result is
 * never applied to another group.
 */

import type { PopulationMask, PopulationMemberSource } from '@/types/population';
import { formatTauriError } from '@/utils/formatTauriError';

export { DISTANCE_TO_MEAN_SORT } from './meanDistanceSort';

export interface MemberMeanDistance {
  memberId: string;
  euclidean: number;
  /** 1 − Pearson r with the mean; null when either is constant. */
  correlation: number | null;
}

export interface MeanDistanceResult {
  members: Array<MemberMeanDistance & { sha256: string }>;
  supportVoxels: number;
  candidateVoxels: number;
}

export interface MeanDistanceSnapshot {
  /** The group actually measured: dataset, feature, mask and the sent members. */
  key: string | null;
  /** The Subjects list the calculation was made for (it may list members
   * without a usable source, which are not measured). */
  listKey: string | null;
  /** Members listed when the calculation was requested. */
  listSize: number;
  status: 'idle' | 'pending' | 'ready' | 'failed';
  byMember: ReadonlyMap<string, MemberMeanDistance>;
  supportVoxels: number;
  groupSize: number;
  error: string | null;
}

const IDLE: MeanDistanceSnapshot = {
  key: null,
  listKey: null,
  listSize: 0,
  status: 'idle',
  byMember: new Map(),
  supportVoxels: 0,
  groupSize: 0,
  error: null,
};

/** The identity of a distance calculation: dataset, feature, mask, group. */
export function meanDistanceKey(
  setId: string | null,
  featureId: string | null,
  maskPath: string | null | undefined,
  memberIds: readonly string[],
): string {
  return JSON.stringify([setId, featureId, maskPath ?? null, [...memberIds].sort()]);
}

/**
 * `ids` ordered by distance to the mean when `snapshot` holds the result for
 * the list `key`: descending (the default) puts the observation least like the mean
 * first. Observations without a distance keep their order, last.
 */
export function sortByMeanDistance(
  ids: readonly string[],
  snapshot: MeanDistanceSnapshot,
  key: string,
  direction: 'asc' | 'desc',
): string[] {
  if (snapshot.listKey !== key || snapshot.status !== 'ready') return [...ids];
  const position = new Map(ids.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => {
    const da = snapshot.byMember.get(a)?.euclidean;
    const db = snapshot.byMember.get(b)?.euclidean;
    if (da === undefined || db === undefined) {
      if (da !== db) return da === undefined ? 1 : -1;
      return position.get(a)! - position.get(b)!;
    }
    const order = direction === 'desc' ? db - da : da - db;
    return order !== 0 ? order : position.get(a)! - position.get(b)!;
  });
}

type Evaluate = (
  request: { members: PopulationMemberSource[]; mask: PopulationMask | null },
  signal: AbortSignal,
) => Promise<MeanDistanceResult>;

export class StudioMeanDistanceService {
  private snapshot: MeanDistanceSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  private readonly evaluate: Evaluate;

  constructor(
    // Loaded on first use: the list's derived state imports this module, and
    // must not pull the sampling transport into every Studio import.
    evaluate: Evaluate = (request, signal) =>
      import('./PopulationExportService').then(({ invokeCancelable }) =>
        invokeCancelable<MeanDistanceResult>('population_mean_distance', { request }, signal),
      ),
  ) {
    this.evaluate = evaluate;
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(next: MeanDistanceSnapshot) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Compute the distances of `members` (the listed members with a usable
   * source; `key` identifies exactly them) for the list `listKey`, unless
   * they are known or in flight.
   */
  request(args: {
    listKey: string;
    listSize: number;
    key: string;
    members: PopulationMemberSource[];
    mask: PopulationMask | null;
  }): void {
    const { listKey, listSize, key, members, mask } = args;
    const current = this.snapshot;
    if (current.key === key && current.listKey === listKey && current.status !== 'failed') return;
    this.abort?.abort();
    const base = { ...IDLE, key, listKey, listSize, groupSize: members.length };
    if (members.length < 2) {
      this.publish({
        ...base,
        status: 'failed',
        error: 'Distance to the group mean needs at least two listed observations with a source.',
      });
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    this.publish({ ...base, status: 'pending' });
    this.evaluate({ members, mask }, abort.signal).then(
      (result) => {
        if (this.abort !== abort) return;
        this.abort = null;
        this.publish({
          ...base,
          status: 'ready',
          byMember: new Map(
            result.members.map(({ memberId, euclidean, correlation }) => [
              memberId,
              { memberId, euclidean, correlation },
            ]),
          ),
          supportVoxels: result.supportVoxels,
        });
      },
      (error) => {
        if (this.abort !== abort) return;
        this.abort = null;
        this.publish({ ...base, status: 'failed', error: formatTauriError(error) });
      },
    );
  }

  /** Report why no calculation can run for `key` (e.g. no usable sources). */
  fail(listKey: string, listSize: number, error: string): void {
    this.abort?.abort();
    this.abort = null;
    if (this.snapshot.listKey === listKey && this.snapshot.error === error) return;
    this.publish({ ...IDLE, listKey, listSize, status: 'failed', error });
  }

  /** Stop and forget (the sort was turned off or the dataset changed). */
  clear(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.snapshot !== IDLE) this.publish(IDLE);
  }
}

let instance: StudioMeanDistanceService | null = null;

export function getStudioMeanDistanceService(): StudioMeanDistanceService {
  if (!instance) instance = new StudioMeanDistanceService();
  return instance;
}
