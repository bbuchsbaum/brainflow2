import { describe, expect, it, vi } from 'vitest';
import {
  StudioMeanDistanceService,
  meanDistanceKey,
  sortByMeanDistance,
  type MeanDistanceResult,
} from '../StudioMeanDistanceService';
import { computeStudioDerivedSnapshot } from '@/hooks/useStudioDerivedState';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { DISTANCE_TO_MEAN_SORT } from '../meanDistanceSort';

const members = ['a', 'b', 'c'].map((memberId) => ({ memberId, sourcePath: `/m/${memberId}.nii` }));
const result: MeanDistanceResult = {
  members: [
    { memberId: 'a', euclidean: 1.5, correlation: 0.2, sha256: 'x' },
    { memberId: 'b', euclidean: 4, correlation: 1.7, sha256: 'y' },
    { memberId: 'c', euclidean: 0.5, correlation: null, sha256: 'z' },
  ],
  supportVoxels: 4,
  candidateVoxels: 5,
};

describe('distance to the group mean (QA features §5)', () => {
  it('computes once per group, keyed by the group, and ignores a superseded answer', async () => {
    let resolveFirst!: (value: MeanDistanceResult) => void;
    const evaluate = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue(result);
    const service = new StudioMeanDistanceService(evaluate);
    const ask = (key: string, sent = members, mask: { sourcePath: string } | null = null) =>
      service.request({ listKey: `list-${key}`, listSize: 3, key, members: sent, mask });
    ask('k1');
    ask('k1');
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0][0]).toEqual({ members, mask: null });
    expect(service.getSnapshot()).toMatchObject({
      key: 'k1',
      listKey: 'list-k1',
      status: 'pending',
      groupSize: 3,
    });
    ask('k2', members.slice(0, 2), { sourcePath: '/mask.nii' });
    expect(evaluate.mock.calls[0][1].aborted).toBe(true);
    resolveFirst(result);
    await vi.waitFor(() => expect(service.getSnapshot().status).toBe('ready'));
    expect(service.getSnapshot()).toMatchObject({ key: 'k2', listSize: 3, groupSize: 2 });
    expect(service.getSnapshot().byMember.get('b')).toEqual({ memberId: 'b', euclidean: 4, correlation: 1.7 });
  });

  it('reports a failure and refuses fewer than two members without calling the backend', async () => {
    const evaluate = vi.fn().mockRejectedValue({ Input: { code: 1, details: 'grids differ' } });
    const service = new StudioMeanDistanceService(evaluate);
    service.request({ listKey: 'l', listSize: 3, key: 'k', members: members.slice(0, 1), mask: null });
    expect(evaluate).not.toHaveBeenCalled();
    expect(service.getSnapshot()).toMatchObject({ status: 'failed', error: expect.stringMatching(/at least two/) });
    service.request({ listKey: 'l', listSize: 3, key: 'k', members, mask: null });
    await vi.waitFor(() => expect(service.getSnapshot().error).toBe('grids differ'));
  });

  it('sorts farthest first by default, keeps unmeasured members last, and never applies a stale key', () => {
    const service = new StudioMeanDistanceService(vi.fn());
    const snapshot = {
      key: 'measured',
      listKey: 'k',
      listSize: 4,
      status: 'ready' as const,
      byMember: new Map(result.members.map((m) => [m.memberId, m])),
      supportVoxels: 4,
      groupSize: 3,
      error: null,
    };
    void service;
    expect(sortByMeanDistance(['a', 'x', 'b', 'c'], snapshot, 'k', 'desc')).toEqual(['b', 'a', 'c', 'x']);
    expect(sortByMeanDistance(['a', 'x', 'b', 'c'], snapshot, 'k', 'asc')).toEqual(['c', 'a', 'b', 'x']);
    expect(sortByMeanDistance(['a', 'b', 'c'], snapshot, 'other', 'desc')).toEqual(['a', 'b', 'c']);
    expect(meanDistanceKey('s', 'f', null, ['b', 'a'])).toBe(meanDistanceKey('s', 'f', null, ['a', 'b']));
    expect(meanDistanceKey('s', 'f', '/mask', ['a'])).not.toBe(meanDistanceKey('s', 'f', null, ['a']));
  });

  it('orders the Subjects list (and so the Deck) by distance once the result matches the listed group', () => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
    useSetStudioStore.getState().loadDemoSession();
    useSetStudioStore.getState().setSortColumn(DISTANCE_TO_MEAN_SORT);
    const state = useSetStudioStore.getState();
    expect(state.sortDirection).toBe('desc');
    const input = {
      populationState: state.population,
      activeSetId: state.selection.activeSetId,
      activeFeatureId: state.selection.activeFeatureId,
      activeLens: state.selection.activeLens,
      activeMemberId: state.selection.activeMemberId,
      compareCohortId: state.selection.compareCohortId,
      activeScopeCohortId: state.selection.activeScopeCohortId,
      activeExpressionId: state.selection.activeExpressionId,
      sets: state.sets,
      features: state.features,
      cohorts: state.cohorts,
      expressions: state.expressions,
      materialization: state.materialization,
      comparePaneSpecs: state.comparePaneSpecs,
      comparePaneLoading: state.comparePaneLoading,
      compareRefreshingPaneIds: state.compareRefreshingPaneIds,
      activeArtifact: state.activeArtifact,
      artifactHistory: state.artifactHistory,
      savedRecipes: state.savedRecipes,
      activeIssueMemberIds: state.activeIssueMemberIds,
      activeIssueLabel: state.activeIssueLabel,
      designSearch: state.designSearch,
      sortColumn: state.sortColumn,
      sortDirection: state.sortDirection,
      activeDesignFilters: state.activeDesignFilters,
    };
    const unsorted = computeStudioDerivedSnapshot(input);
    const ids = unsorted.distanceGroupMemberIds;
    expect(ids.length).toBeGreaterThan(2);
    const byMember = new Map(
      ids.map((memberId, i) => [memberId, { memberId, euclidean: i, correlation: null }]),
    );
    const ready = {
      status: 'ready' as const,
      key: 'measured',
      listSize: ids.length,
      byMember,
      supportVoxels: 9,
      groupSize: ids.length,
      error: null,
    };
    const sorted = computeStudioDerivedSnapshot({
      ...input,
      meanDistance: { ...ready, listKey: unsorted.distanceKey },
    });
    expect(sorted.visibleMemberIds).toEqual([...ids].reverse());
    expect(sorted.sortLabel).toBe('distance to mean desc');
    const stale = computeStudioDerivedSnapshot({ ...input, meanDistance: { ...ready, listKey: 'stale' } });
    expect(stale.visibleMemberIds).toEqual(ids);
  });
});
