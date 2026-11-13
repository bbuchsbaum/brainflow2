import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type {
  PopulationRelationshipService,
  RelationshipFit,
} from '@/services/studio/PopulationRelationshipService';
import { StudioMeanDistanceService } from '@/services/studio/StudioMeanDistanceService';
import { useMontageArrangement } from '../useMontageArrangement';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';

const FIT_ID = 'f'.repeat(64);
const IDS = ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'];

beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  const state = useSetStudioStore.getState();
  const set = state.sets[state.selection.activeSetId!];
  // A design table: two factors and a numeric column with one value per subject.
  useSetStudioStore.setState({
    sets: {
      ...state.sets,
      [set.id]: {
        ...set,
        designTablePreview: {
          columns: ['site', 'age', 'sex'],
          rows: set.memberIds.map((id, i) => ({
            id,
            cells: [i < 4 ? 'X' : 'Y', String([30, 9, 41, 22, 60, 18][i]), i % 2 ? 'F' : 'M'],
          })),
        },
      },
    },
  });
  state.setPopulationPresentation({ ...state.population.presentation, arrangement: 'montage' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A relationship service whose fit resolves when the test says so. */
function fakeRelationship(
  initial: RelationshipFit | null = null,
  decorate: (fit: RelationshipFit) => void = () => undefined,
) {
  let snapshot = { fit: initial, scope: null, pending: false, error: null as string | null, stale: false };
  let usable = initial;
  // The distance the last fit was asked for; a fit already there is by correlation.
  let requested: 'effect' | 'pattern-shape' = 'pattern-shape';
  const listeners = new Set<() => void>();
  const publish = (next: Partial<typeof snapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };
  const makeFit = (distance: 'effect' | 'pattern-shape') =>
    ({
      fitId: distance === 'effect' ? 'e'.repeat(64) : FIT_ID,
      geometry: { orderable: true },
      fittedMemberIds: IDS,
      commonVoxels: 9919,
      // The backend echoes a grouping request (the montage always asks for one).
      request: {
        members: IDS.map((memberId) => ({ memberId })),
        mask: null,
        region: null,
        distance,
        grouping: { linkage: 'ward' },
      },
    }) as unknown as RelationshipFit;
  const made: RelationshipFit[] = [];
  const fitOf = (distance: 'effect' | 'pattern-shape') => {
    const next = makeFit(distance);
    decorate(next);
    made.push(next);
    return next;
  };
  const fit = makeFit('pattern-shape');
  const service = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    usableFit: () => usable,
    fitById: (fitId: string | null | undefined) =>
      [snapshot.fit, usable, ...made].find((f) => !!f && f.fitId === fitId) ?? null,
    fit: vi.fn(async (distance: 'effect' | 'pattern-shape') => {
      requested = distance;
      publish({ pending: true, error: null });
    }),
    order: vi.fn(() => {
      const state = useSetStudioStore.getState();
      const made = usable!;
      state.setPopulationPresentation({
        ...state.population.presentation,
        order: {
          rule: 'similarity',
          fitId: made.fitId,
          featureId: state.selection.activeFeatureId!,
          orderedIds: [...IDS].reverse(),
          unavailableIds: [],
          label: `MDS axis 1 · ${made.request.distance}`,
          probe: null,
          bindings: [],
          mask: null,
          tieRule: 'source',
        },
      });
    }),
    group: vi.fn((count: number) => {
      const state = useSetStudioStore.getState();
      state.setPopulationPartition({
        setId: state.selection.activeSetId!,
        column: 'Spatial similarity',
        origin: 'map-derived',
        fitId: usable!.fitId,
        contextIds: IDS,
        groups: Array.from({ length: count }, (_, i) => ({
          id: `similarity-${i}`,
          label: `Similarity group ${i + 1}`,
          value: String(i + 1),
          memberIds: IDS.filter((_, j) => j % count === i),
        })),
      });
    }),
  };
  return {
    service: service as unknown as PopulationRelationshipService,
    spies: service,
    fit,
    arrive: () => {
      usable = fitOf(requested);
      publish({ fit: usable, pending: false });
    },
    failWith: (error: string) => publish({ pending: false, error }),
    cancel: () => publish({ pending: false }),
  };
}

function mount(
  relationship: PopulationRelationshipService,
  extra: {
    responseReady?: boolean;
    responseAvailable?: boolean;
    distanceService?: StudioMeanDistanceService;
    active?: boolean;
    responseTimeoutMs?: number;
    contextIds?: string[];
  } = {},
) {
  const applyResponseOrder = vi.fn(),
    clearOrder = vi.fn();
  let props = { responseReady: false, responseAvailable: true, active: true, ...extra };
  const view = renderHook(() => {
    const studio = useSetStudioStore();
    const order = studio.population.presentation.order;
    return useMontageArrangement({
      active: props.active,
      studio,
      workspaceId: useViewStateStore.getState().activeWorkspaceKey,
      contextIds: extra.contextIds ?? IDS,
      sharedOrder: order?.orderedIds ?? extra.contextIds ?? IDS,
      savedOrder: order,
      hasResponseOrder: false,
      responseAvailable: props.responseAvailable,
      responseReady: props.responseReady,
      responseError: null,
      applyResponseOrder,
      clearOrder,
      relationship,
      distanceService: props.distanceService,
      responseTimeoutMs: props.responseTimeoutMs,
    });
  });
  return {
    ...view,
    applyResponseOrder,
    clearOrder,
    update: (next: Partial<typeof props>) => {
      props = { ...props, ...next };
      view.rerender();
    },
  };
}

it('Sort → Similarity with no fit requests one, waits quietly, then applies the order', async () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  expect(result.current.sort).toBe('source');
  act(() => result.current.chooseSort('similarity:pattern-shape'));
  expect(relationship.spies.fit).toHaveBeenCalledTimes(1);
  // Correlation (pattern shape) is the default measure.
  expect(relationship.spies.fit).toHaveBeenCalledWith('pattern-shape', false, { reuse: true, grouping: true });
  // Pending, not failed: the choice shows, marked busy.
  expect(result.current.sort).toBe('similarity');
  expect(result.current.sortValue).toBe('similarity:pattern-shape');
  expect(result.current.sortBusy).toBe(true);
  expect(result.current.computing).toBe('similarity');
  expect(result.current.error).toBeNull();
  expect(relationship.spies.order).not.toHaveBeenCalled();
  act(() => relationship.arrive());
  expect(relationship.spies.order).toHaveBeenCalledTimes(1);
  expect(result.current.sortBusy).toBe(false);
  expect(result.current.sort).toBe('similarity');
  expect(result.current.order).toEqual([...IDS].reverse());
});

it('orders at once from a fit that is already there, and says why a fit failed', () => {
  const ready = fakeRelationship();
  ready.arrive();
  const first = mount(ready.service);
  act(() => first.result.current.chooseSort('similarity:pattern-shape'));
  expect(ready.spies.fit).not.toHaveBeenCalled();
  expect(ready.spies.order).toHaveBeenCalledTimes(1);
  first.unmount();
  // Start the second case from the source order again.
  const state = useSetStudioStore.getState();
  state.setPopulationPresentation({ ...state.population.presentation, order: null });

  const failing = fakeRelationship();
  const second = mount(failing.service);
  act(() => second.result.current.chooseSort('similarity:pattern-shape'));
  act(() => failing.failWith('Too few shared voxels.'));
  expect(second.result.current.sortBusy).toBe(false);
  expect(second.result.current.error).toBe(
    'Similarity could not be computed: Too few shared voxels.',
  );
  expect(second.result.current.sort).toBe('source');
  expect(failing.spies.order).not.toHaveBeenCalled();
});

it('a different choice withdraws a pending similarity order', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() => result.current.chooseSort('similarity:pattern-shape'));
  act(() => result.current.chooseSort('column:age'));
  act(() => relationship.arrive());
  expect(relationship.spies.order).not.toHaveBeenCalled();
  expect(result.current.sort).toBe('column:age');
});

it('Group → Similarity fits when needed, then groups and stays in the montage', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() => result.current.chooseGroup('similarity:pattern-shape'));
  expect(relationship.spies.fit).toHaveBeenCalledWith('pattern-shape', false, { reuse: true, grouping: true });
  expect(result.current.group).toBe('similarity:pattern-shape');
  expect(result.current.groupBusy).toBe(true);
  act(() => relationship.arrive());
  expect(relationship.spies.group).toHaveBeenCalledWith(3);
  const population = useSetStudioStore.getState().population;
  expect(population.partition?.origin).toBe('map-derived');
  // The store moves to the group means on a new grouping; the montage takes it back.
  expect(population.presentation.arrangement).toBe('montage');
  expect(result.current.groupBusy).toBe(false);
  expect(result.current.group).toBe('similarity:pattern-shape');
});

it('Group by a factor and None use the existing grouping, without leaving the montage', () => {
  const { result } = mount(fakeRelationship().service);
  // C5: a column with one value per subject ("age" here, "member" in a
  // folder set) makes no groups and is not listed; nor is a restore with
  // nothing to restore.
  expect(result.current.groupOptions.map((o) => o.label)).toEqual([
    'None',
    'Similarity · correlation',
    'Similarity · amplitude',
    'site',
    'sex',
    // C′: the menu ends with two factors.
    'site × sex',
  ]);
  expect(result.current.groupOptions.some((o) => o.disabled)).toBe(false);
  act(() => result.current.chooseGroup('factor:site'));
  let population = useSetStudioStore.getState().population;
  expect(population.partition?.groups.map((g) => [g.label, g.memberIds.length])).toEqual([
    ['site: X', 4],
    ['site: Y', 2],
  ]);
  expect(population.presentation.arrangement).toBe('montage');
  expect(result.current.group).toBe('factor:site');
  act(() => result.current.chooseGroup('none'));
  population = useSetStudioStore.getState().population;
  expect(population.partition).toBeNull();
  expect(population.presentation.arrangement).toBe('montage');
  expect(result.current.group).toBe('none');
});

it('lists the columns that group the whole set, whatever subjects are in view', () => {
  // In view: sub001–sub003, all site X. Over the set, site is X or Y.
  const { result } = mount(fakeRelationship().service, { contextIds: IDS.slice(0, 3) });
  const labels = result.current.groupOptions.map((o) => o.label);
  expect(labels).toContain('site');
  expect(labels).toContain('sex');
  // Age has one value per subject over the six: an ID-like column, not offered.
  expect(labels).not.toContain('age');
});

it('orders by a design column and reverses, without touching the shared order', () => {
  const { result } = mount(fakeRelationship().service);
  act(() => result.current.chooseSort('column:age'));
  expect(result.current.sort).toBe('column:age');
  expect(result.current.order).toEqual([
    'sub002',
    'sub006',
    'sub004',
    'sub001',
    'sub003',
    'sub005',
  ]);
  act(() => result.current.toggleReversed());
  expect(result.current.reversed).toBe(true);
  expect(result.current.sort).toBe('column:age');
  expect(result.current.order[0]).toBe('sub005');
  expect(useSetStudioStore.getState().population.presentation.order).toBeNull();
});

it('Distance from mean asks for the distances and puts the most typical first', async () => {
  let resolve!: (value: unknown) => void;
  const evaluate = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const distanceService = new StudioMeanDistanceService(evaluate as never);
  const { result } = mount(fakeRelationship().service, { distanceService });
  act(() => result.current.chooseSort('distance'));
  expect(evaluate).toHaveBeenCalledTimes(1);
  expect((evaluate.mock.calls[0] as unknown as [{ members: { memberId: string }[] }])[0].members.map((m) => m.memberId)).toEqual(IDS);
  expect(result.current.sortBusy).toBe(true);
  expect(result.current.computing).toBe('distances from the mean');
  // Until they arrive the order shown does not change.
  expect(result.current.order).toEqual(IDS);
  await act(async () => {
    resolve({
      members: IDS.map((memberId, i) => ({
        memberId,
        euclidean: [5, 1, 4, 2, 6, 3][i],
        correlation: null,
        sha256: 'a'.repeat(64),
      })),
      supportVoxels: 10,
      candidateVoxels: 10,
    });
  });
  expect(result.current.sortBusy).toBe(false);
  expect(result.current.order).toEqual([
    'sub002',
    'sub004',
    'sub006',
    'sub003',
    'sub001',
    'sub005',
  ]);
});

it('Value at crosshair never pins silently, and orders once the pinned values are ready', () => {
  const view = mount(fakeRelationship().service);
  // C′: with nothing pinned it says what to do and pins nothing.
  act(() => view.result.current.chooseSort('crosshair'));
  expect(useSetStudioStore.getState().population.pinnedProbe).toBeNull();
  expect(view.result.current.error).toMatch(/^Pin a point first/);
  expect(view.result.current.sortBusy).toBe(false);
  act(() => populationProbeActions.pin(0, false));
  act(() => view.result.current.chooseSort('crosshair'));
  expect(view.result.current.sort).toBe('crosshair');
  expect(view.result.current.sortBusy).toBe(true);
  expect(view.applyResponseOrder).not.toHaveBeenCalled();
  act(() => view.update({ responseReady: true }));
  expect(view.applyResponseOrder).toHaveBeenCalledTimes(1);
  expect(view.applyResponseOrder).toHaveBeenCalledWith('all');
  expect(view.result.current.sortBusy).toBe(false);
});

it('Source order restores the source order', () => {
  const view = mount(fakeRelationship().service);
  act(() => view.result.current.chooseSort('column:age'));
  act(() => view.result.current.chooseSort('source'));
  expect(view.clearOrder).toHaveBeenCalledTimes(1);
  expect(view.result.current.sort).toBe('source');
});

it('the arranged order keeps its identity until what it depends on changes', () => {
  const { result, rerender } = mount(fakeRelationship().service);
  act(() => result.current.chooseSort('column:age'));
  const first = result.current.order;
  // An unrelated store update (hover, focus) re-renders the lens: no re-sort.
  act(() => useSetStudioStore.getState().setActiveMember('sub004'));
  rerender();
  expect(result.current.order).toBe(first);
  act(() => result.current.toggleReversed());
  expect(result.current.order).not.toBe(first);
});

it('a similarity result that arrives after leaving the montage changes nothing', () => {
  for (const choose of ['sort', 'group'] as const) {
    const relationship = fakeRelationship();
    const view = mount(relationship.service);
    act(() =>
      choose === 'sort'
        ? view.result.current.chooseSort('similarity:pattern-shape')
        : view.result.current.chooseGroup('similarity:pattern-shape'),
    );
    expect(relationship.spies.fit).toHaveBeenCalledTimes(1);
    // The user switches to Summary while the fit runs.
    act(() => {
      const state = useSetStudioStore.getState();
      state.setPopulationPresentation({ ...state.population.presentation, arrangement: 'inspect' });
      view.update({ active: false });
    });
    expect(view.result.current.sortBusy).toBe(false);
    expect(view.result.current.groupBusy).toBe(false);
    act(() => relationship.arrive());
    expect(relationship.spies.order).not.toHaveBeenCalled();
    expect(relationship.spies.group).not.toHaveBeenCalled();
    const population = useSetStudioStore.getState().population;
    expect(population.partition).toBeNull();
    expect(population.presentation.order).toBeNull();
    expect(population.presentation.arrangement).toBe('inspect');
    // Coming back does not replay the abandoned choice.
    act(() => view.update({ active: true }));
    expect(relationship.spies.order).not.toHaveBeenCalled();
    expect(relationship.spies.group).not.toHaveBeenCalled();
    view.unmount();
  }
});

it('says so when a pending similarity fit is cancelled', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() => result.current.chooseSort('similarity:pattern-shape'));
  // Cancel fit: no longer pending, no fit, no error.
  act(() => relationship.cancel());
  expect(result.current.sortBusy).toBe(false);
  expect(result.current.error).toBe('The similarity calculation was cancelled.');
  expect(result.current.sort).toBe('source');
});

it('Value at crosshair stops waiting with a plain message when no values arrive', () => {
  vi.useFakeTimers();
  try {
    const view = mount(fakeRelationship().service, { responseTimeoutMs: 1000 });
    act(() => populationProbeActions.pin(0, false));
    act(() => view.result.current.chooseSort('crosshair'));
    expect(view.result.current.sortBusy).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(view.result.current.sortBusy).toBe(false);
    expect(view.result.current.error).toBe(
      'No values arrived for the pinned point. Pin it again in the Values tab.',
    );
    expect(view.applyResponseOrder).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('Value at crosshair is not offered, and starts nothing, without a values table', () => {
  const view = mount(fakeRelationship().service, { responseAvailable: false });
  expect(view.result.current.sortOptions.orders.find((o) => o.value === 'crosshair')?.disabled).toBe(
    true,
  );
  act(() => view.result.current.chooseSort('crosshair'));
  expect(useSetStudioStore.getState().population.pinnedProbe).toBeNull();
  expect(view.result.current.sortBusy).toBe(false);
});

it('changing the sort abandons a distance calculation in flight', () => {
  const signals: AbortSignal[] = [];
  const evaluate = vi.fn((_request: unknown, signal: AbortSignal) => {
    signals.push(signal);
    return new Promise(() => {});
  });
  const distanceService = new StudioMeanDistanceService(evaluate as never);
  const { result } = mount(fakeRelationship().service, { distanceService });
  act(() => result.current.chooseSort('distance'));
  expect(signals).toHaveLength(1);
  expect(signals[0].aborted).toBe(false);
  act(() => result.current.chooseSort('column:age'));
  expect(signals[0].aborted).toBe(true);
  expect(distanceService.getSnapshot().status).toBe('idle');
});

it('the chosen measure reaches the fit request: amplitude asks for the effect distance', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() => result.current.chooseSort('similarity:effect'));
  expect(relationship.spies.fit).toHaveBeenCalledTimes(1);
  expect(relationship.spies.fit).toHaveBeenCalledWith('effect', false, { reuse: true, grouping: true });
  act(() => relationship.arrive());
  expect(relationship.spies.order).toHaveBeenCalledTimes(1);
  expect(result.current.sortValue).toBe('similarity:effect');
  expect(result.current.sortSimilarity).toBe(
    'RMS difference · whole volume, unthresholded · 9,919 shared voxels',
  );
});

it('a correlation refusal is said plainly and offers amplitude, which fits by effect', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() => result.current.chooseGroup('similarity:pattern-shape'));
  act(() =>
    relationship.failWith(
      'sub003 is constant on common support; pattern shape is undefined. Use effect distance or change context/support.',
    ),
  );
  expect(result.current.groupBusy).toBe(false);
  expect(result.current.error).toBe(
    'Correlation cannot be computed: at least one map is constant on the voxels every subject shares. Amplitude can still be compared.',
  );
  expect(result.current.retryWithAmplitude).not.toBeNull();
  act(() => result.current.retryWithAmplitude!());
  expect(relationship.spies.fit).toHaveBeenLastCalledWith('effect', false, { reuse: true, grouping: true });
  expect(result.current.error).toBeNull();
  expect(result.current.retryWithAmplitude).toBeNull();
  act(() => relationship.arrive());
  expect(relationship.spies.group).toHaveBeenCalledWith(3);
  expect(result.current.group).toBe('similarity:effect');
});

it('any other failure keeps its own message and offers no amplitude', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() => result.current.chooseSort('similarity:pattern-shape'));
  act(() => relationship.failWith('Too few shared voxels.'));
  expect(result.current.error).toBe('Similarity could not be computed: Too few shared voxels.');
  expect(result.current.retryWithAmplitude).toBeNull();
});

it('keeps the fit for the session: Sort and Group by the same measure reuse it, another measure refits', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() => result.current.chooseGroup('similarity:pattern-shape'));
  act(() => relationship.arrive());
  expect(relationship.spies.fit).toHaveBeenCalledTimes(1);
  // Sort by the same measure, back to source, and by similarity again: no new fit.
  act(() => result.current.chooseSort('similarity:pattern-shape'));
  act(() => result.current.chooseSort('source'));
  act(() => result.current.chooseSort('similarity:pattern-shape'));
  act(() => result.current.chooseGroup('none'));
  act(() => result.current.chooseGroup('similarity:pattern-shape'));
  expect(relationship.spies.fit).toHaveBeenCalledTimes(1);
  expect(relationship.spies.order).toHaveBeenCalledTimes(2);
  expect(relationship.spies.group).toHaveBeenCalledTimes(2);
  // Changing the measure computes again, shown as pending.
  act(() => result.current.chooseSort('similarity:effect'));
  expect(relationship.spies.fit).toHaveBeenCalledTimes(2);
  expect(relationship.spies.fit).toHaveBeenLastCalledWith('effect', false, { reuse: true, grouping: true });
  expect(result.current.sortBusy).toBe(true);
  expect(result.current.computing).toBe('similarity');
  act(() => relationship.arrive());
  // The correlation grouping still names its own measure.
  expect(result.current.group).toBe('similarity:pattern-shape');
  expect(result.current.sortValue).toBe('similarity:effect');
});

it('the group count cuts the same fit again and follows a grouping made elsewhere', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() => result.current.chooseGroup('similarity:pattern-shape'));
  act(() => relationship.arrive());
  expect(result.current.groupedBySimilarity).toBe(true);
  expect(result.current.groupCount).toBe(3);
  expect(result.current.groupCountMax).toBe(IDS.length);
  act(() => result.current.chooseGroupCount(4));
  expect(relationship.spies.group).toHaveBeenLastCalledWith(4);
  expect(relationship.spies.fit).toHaveBeenCalledTimes(1);
  expect(result.current.groupCount).toBe(4);
  // The Spatial relationships panel groups the same fit into 2: the montage reads 2.
  act(() => relationship.spies.group(2));
  expect(result.current.groupCount).toBe(2);
  // Out of range: ignored.
  act(() => result.current.chooseGroupCount(1));
  act(() => result.current.chooseGroupCount(IDS.length + 1));
  expect(relationship.spies.group).toHaveBeenCalledTimes(3);
  expect(result.current.groupSimilarity).toBe(
    'correlation distance · whole volume, unthresholded · 9,919 shared voxels',
  );
});

it('the group count reads the grouping\'s own fit, counts outliers apart, and Auto returns to its suggestion', () => {
  /** Cuts 2..max; each cut past 2 leaves one member alone (an outlier). */
  const grouping = (max: number, best: number) => ({
    linkage: 'ward',
    cuts: Array.from({ length: max - 1 }, (_, i) => ({
      groups: i + 2,
      silhouette: 0.5,
      assignment: [],
      singletons: i === 0 ? [] : [0],
    })),
    bestGroups: best,
    clearGrouping: true,
    silhouetteThreshold: 0.25,
  });
  const relationship = fakeRelationship(null, (fit) => {
    (fit.geometry as { grouping?: unknown }).grouping =
      fit.request.distance === 'effect' ? grouping(5, 2) : grouping(4, 3);
  });
  const { result } = mount(relationship.service);
  act(() => result.current.chooseGroup('similarity:pattern-shape'));
  act(() => relationship.arrive());
  expect(relationship.spies.group).toHaveBeenLastCalledWith(3);
  expect(result.current.groupCountMax).toBe(4);
  expect(result.current.groupCountSuggested).toBe(3);
  expect(result.current.groupCountAuto).toBe(true);
  expect(result.current.groupCountCuts).toEqual([
    { count: 2, groups: 2, outliers: 0 },
    { count: 3, groups: 2, outliers: 1 },
    { count: 4, groups: 3, outliers: 1 },
  ]);
  // A chosen count, then Auto: back to the fit's suggestion, said as "auto".
  act(() => result.current.chooseGroupCount(2));
  expect(relationship.spies.group).toHaveBeenLastCalledWith(2);
  expect(result.current.groupCountAuto).toBe(false);
  act(() => result.current.chooseAutoGroupCount());
  expect(relationship.spies.group).toHaveBeenLastCalledWith(3);
  expect(result.current.groupCountAuto).toBe(true);
  // Sorted by amplitude: the current fit is now another, but the groups on
  // screen are still the correlation fit's, and so are their range and suggestion.
  act(() => result.current.chooseSort('similarity:effect'));
  act(() => relationship.arrive());
  expect(relationship.service.usableFit()!.request.distance).toBe('effect');
  expect(result.current.group).toBe('similarity:pattern-shape');
  expect(result.current.groupCountMax).toBe(4);
  expect(result.current.groupCountSuggested).toBe(3);
  expect(result.current.groupCountCuts?.at(-1)).toEqual({ count: 4, groups: 3, outliers: 1 });
});

it('the measure is one store choice: the montage writes it, and reads what the panel chose', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  expect(useSetStudioStore.getState().population.similarityMeasure).toBeUndefined();
  act(() => result.current.chooseSort('similarity:effect'));
  expect(useSetStudioStore.getState().population.similarityMeasure).toBe('effect');
  act(() => relationship.arrive());
  // The relationship panel chooses correlation: the montage's next group uses it.
  act(() => useSetStudioStore.getState().setPopulationSimilarityMeasure('pattern-shape'));
  act(() => result.current.chooseGroup('none'));
  expect(result.current.group).toBe('none');
  act(() => result.current.chooseGroupCount(4));
  act(() => result.current.chooseGroup('similarity:pattern-shape'));
  expect(relationship.spies.fit).toHaveBeenLastCalledWith('pattern-shape', false, { reuse: true, grouping: true });
});

it('describes a restored masked order from the order itself, not as the whole volume', () => {
  const state = useSetStudioStore.getState();
  state.setPopulationPresentation({
    ...state.population.presentation,
    order: {
      rule: 'similarity',
      fitId: 'r'.repeat(64),
      featureId: state.selection.activeFeatureId!,
      orderedIds: [...IDS].reverse(),
      unavailableIds: [],
      label: `MDS axis 1 · pattern-shape · fit rrrrrrrr`,
      probe: null,
      bindings: [],
      mask: { sourcePath: '/data/masks/gm_mask.nii.gz' },
      tieRule: 'source',
    },
  });
  // No fit of this session made it (a saved calculation, restored).
  const { result } = mount(fakeRelationship().service);
  expect(result.current.sort).toBe('similarity');
  expect(result.current.sortValue).toBe('similarity:pattern-shape');
  expect(result.current.sortSimilarity).toBe(
    'correlation distance · within mask gm_mask.nii.gz, unthresholded',
  );
});

it('a fit replaced by another keeps describing the order it made', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() => result.current.chooseSort('similarity:pattern-shape'));
  act(() => relationship.arrive());
  const before = result.current.sortSimilarity;
  expect(before).toBe('correlation distance · whole volume, unthresholded · 9,919 shared voxels');
  // A grouping by amplitude replaces the session's fit; the order is unchanged.
  act(() => result.current.chooseGroup('similarity:effect'));
  act(() => relationship.arrive());
  expect(result.current.sortValue).toBe('similarity:pattern-shape');
  expect(result.current.sortSimilarity).toBe(before);
  expect(result.current.groupSimilarity).toBe(
    'RMS difference · whole volume, unthresholded · 9,919 shared voxels',
  );
});

it('forgets a correlation refusal once its message is gone or the scope changes', () => {
  const REFUSAL =
    'sub003 is constant on common support; pattern shape is undefined. Use effect distance or change context/support.';
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() => result.current.chooseSort('similarity:pattern-shape'));
  act(() => relationship.failWith(REFUSAL));
  expect(result.current.retryWithAmplitude).not.toBeNull();
  // A later, different failure does not offer amplitude or replay the old sort.
  act(() => result.current.chooseGroup('similarity:pattern-shape'));
  act(() => relationship.failWith('Too few shared voxels.'));
  expect(result.current.error).toBe('Similarity could not be computed: Too few shared voxels.');
  expect(result.current.retryWithAmplitude).toBeNull();
  // Refused again, then another session: nothing is left over.
  act(() => result.current.chooseSort('similarity:pattern-shape'));
  act(() => relationship.failWith(REFUSAL));
  expect(result.current.retryWithAmplitude).not.toBeNull();
  act(() => useSetStudioStore.getState().loadDemoSession());
  expect(result.current.error).toBeNull();
  expect(result.current.retryWithAmplitude).toBeNull();
});

it('C′: "Restore previous grouping" ends the Group menu and brings the last grouping back', () => {
  const { result } = mount(fakeRelationship().service);
  const restore = () => result.current.groupOptions.find((o) => o.value === 'restore')!;
  // Nothing to restore yet: not listed (C5).
  expect(result.current.groupOptions.find((o) => o.value === 'restore')).toBeUndefined();
  act(() => result.current.chooseGroup('factor:site'));
  act(() => result.current.chooseGroup('factor:sex'));
  expect(useSetStudioStore.getState().population.partition?.column).toBe('sex');
  expect(restore().label).toBe('Restore previous grouping');
  expect(result.current.groupOptions.at(-1)).toBe(restore());
  expect(restore().disabled).toBeFalsy();
  act(() => result.current.chooseGroup('restore'));
  expect(useSetStudioStore.getState().population.partition?.column).toBe('site');
  // It stays in the montage.
  expect(useSetStudioStore.getState().population.presentation.arrangement).toBe('montage');
});

it('C′: "Two factors" in the Group menu crosses two columns', () => {
  const { result } = mount(fakeRelationship().service);
  const option = result.current.groupOptions.find((o) => o.group === 'Two factors')!;
  expect(option.label).toBe('site × sex');
  act(() => result.current.chooseGroup(option.value));
  const partition = useSetStudioStore.getState().population.partition!;
  expect(partition.factorColumns).toEqual(['site', 'sex']);
  expect(result.current.group).toBe(option.value);
});

it('C′: similarity is compared within the pinned region when Analysis setup says so', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() =>
    useSetStudioStore.getState().setPopulationProbe(
      { supportKey: 'k', worldMm: [1, 2, 3], radiusMm: 6, reduce: 'mean' },
      'pin',
    ),
  );
  act(() => useSetStudioStore.getState().setPopulationSimilarityRegion('probe'));
  act(() => result.current.chooseSort('similarity:pattern-shape'));
  expect(relationship.spies.fit).toHaveBeenLastCalledWith('pattern-shape', true, {
    reuse: true,
    grouping: true,
  });
});

it('C′: the group count starts at the fit\'s suggestion until the stepper is used', () => {
  const relationship = fakeRelationship();
  const { result } = mount(relationship.service);
  act(() => result.current.chooseGroup('similarity:pattern-shape'));
  // The fit arrives suggesting four groups.
  act(() => relationship.arrive());
  const arrived = relationship.service.usableFit()!;
  (arrived.geometry as { grouping?: unknown }).grouping = {
    linkage: 'ward',
    cuts: [],
    bestGroups: 4,
    clearGrouping: true,
    silhouetteThreshold: 0.25,
  };
  act(() => result.current.chooseGroup('none'));
  act(() => result.current.chooseGroup('similarity:pattern-shape'));
  expect(relationship.spies.group).toHaveBeenLastCalledWith(4);
  // The toolbar says "auto" while the count is the fit's suggestion…
  expect(result.current.groupCount).toBe(4);
  expect(result.current.groupCountAuto).toBe(true);
  act(() => result.current.chooseGroupCount(2));
  expect(relationship.spies.group).toHaveBeenLastCalledWith(2);
  // …and not once the stepper has chosen.
  expect(result.current.groupCountAuto).toBe(false);
  act(() => result.current.chooseGroup('none'));
  act(() => result.current.chooseGroup('similarity:pattern-shape'));
  expect(relationship.spies.group).toHaveBeenLastCalledWith(2);
});

it('C′: Group works in the Summary too, and keeps the Summary (the groups\' means)', () => {
  const studioMount = renderHook(() => {
    const studio = useSetStudioStore();
    return useMontageArrangement({
      active: false,
      summary: true,
      studio,
      workspaceId: useViewStateStore.getState().activeWorkspaceKey,
      contextIds: IDS,
      sharedOrder: IDS,
      savedOrder: null,
      hasResponseOrder: false,
      responseAvailable: true,
      responseReady: false,
      responseError: null,
      applyResponseOrder: vi.fn(),
      clearOrder: vi.fn(),
      relationship: fakeRelationship().service,
    });
  });
  act(() =>
    useSetStudioStore.getState().setPopulationPresentation({
      ...useSetStudioStore.getState().population.presentation,
      arrangement: 'inspect',
    }),
  );
  act(() => studioMount.result.current.chooseGroup('factor:site'));
  expect(useSetStudioStore.getState().population.presentation.arrangement).toBe('groups');
  act(() => studioMount.result.current.chooseGroup('none'));
  expect(useSetStudioStore.getState().population.presentation.arrangement).toBe('inspect');
});
