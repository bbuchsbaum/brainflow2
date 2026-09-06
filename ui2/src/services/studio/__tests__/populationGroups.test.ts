import { beforeEach, expect, it } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { partitionPopulation, validatePopulationPartition } from '../populationGroups';
import { buildPopulationSliceQuery } from '../PopulationSliceService';
import { resolvePopulation } from '../populationContext';
const store = () => useSetStudioStore.getState();
const ids = ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'];
const options = {
  crosshairMm: [1, 1, 1] as [number, number, number],
  orientation: 'axial' as const,
  dimPx: [3, 3] as [number, number],
  zoom: 1,
  summary: 'mean' as const,
};
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  store().loadDemoSession();
  const set = store().sets[store().selection.activeSetId!];
  useSetStudioStore.setState({
    sets: {
      ...store().sets,
      [set.id]: {
        ...set,
        designTablePreview: {
          columns: ['group'],
          rows: ids.map((id, i) => ({ id, cells: [['A', 'A', 'B', 'B', ' ', 'NA'][i]] })).reverse(),
        },
      },
    },
  });
});
it('partitions exact keyed observations including missing and literal NA levels', () => {
  const set = store().sets[store().selection.activeSetId!];
  const partition = partitionPopulation(set, ids, 'group');
  expect(partition.groups.map((g) => [g.value, g.memberIds])).toEqual([
    ['A', ids.slice(0, 2)],
    ['B', ids.slice(2, 4)],
    [null, [ids[4]]],
    ['NA', [ids[5]]],
  ]);
  expect(validatePopulationPartition(partition, set.id, ids)).toBeNull();
  expect(
    validatePopulationPartition(
      { ...partition, groups: [...partition.groups, partition.groups[0]] },
      set.id,
      ids,
    ),
  ).toBeTruthy();
  expect(validatePopulationPartition(partition, set.id, ids.slice(1))).toBeTruthy();
});
it('grouping and undo preserve working selection, focus, reference and probe', () => {
  store().selectPopulationMembers(ids.slice(0, 2));
  const before = store();
  const set = before.sets[before.selection.activeSetId!];
  const partition = partitionPopulation(set, ids, 'group');
  expect(store().setPopulationPartition(partition)).toEqual({ ok: true });
  expect(store().population.working).toBe(before.population.working);
  expect(store().selection).toBe(before.selection);
  expect(store().population.probe).toBe(before.population.probe);
  const request = buildPopulationSliceQuery(store(), 'workspace', options).query!.request;
  expect(request.groups?.map((g) => g.memberIds)).toEqual(partition.groups.map((g) => g.memberIds));
  store().undoPopulationPartition();
  expect(store().population.partition).toBeNull();
  expect(resolvePopulation(store()).workingMemberIds).toEqual(ids.slice(0, 2));
});
it('builds explicit overlapping A/B operands and a descriptive difference without changing focus', () => {
  store().selectPopulationMembers(ids.slice(0, 3));
  const id = store().createSavedCohort({ memberIds: ids.slice(2), label: 'B' })!;
  store().setPopulationReferenceMode('cohort');
  store().setCompareCohort(id);
  const focus = store().selection.activeMemberId;
  store().setPopulationPresentation({
    ...store().population.presentation,
    arrangement: 'difference',
  });
  const request = buildPopulationSliceQuery(store(), 'workspace', options).query!.request;
  expect(request.workingMemberIds).toEqual(ids.slice(0, 3));
  expect(request.reference?.memberIds).toEqual(ids.slice(2));
  expect(request.difference).toBe(true);
  expect(store().selection.activeMemberId).toBe(focus);
  expect(request.groups).toBeUndefined();
});
it('previews a named subset without mutating A, B, focus or grouping and rejects foreign IDs', () => {
  const before = store();
  const preview = buildPopulationSliceQuery(before, 'workspace', {
    ...options,
    withoutMembers: ids.slice(0, 2),
  }).query!;
  expect(preview.request.workingMemberIds).toEqual(ids.slice(2));
  expect(store()).toBe(before);
  expect(
    buildPopulationSliceQuery(before, 'workspace', options).query!.request.workingMemberIds,
  ).toEqual(ids);
  expect(
    buildPopulationSliceQuery(before, 'workspace', { ...options, withoutMembers: ['unknown'] }),
  ).toMatchObject({ query: null, issue: expect.any(String) });
});
it('partitions two factors as collision-safe keyed cells without dropping missing values', () => {
  const set = store().sets[store().selection.activeSetId!];
  const crossed = {
    ...set,
    designTablePreview: {
      columns: ['group', 'site'],
      rows: ids.map((id, i) => ({
        id,
        cells: [['A', 'A', 'A', 'B', 'B', 'B'][i], ['one', 'two', '', 'one', 'two', ''][i]],
      })),
    },
  };
  const partition = partitionPopulation(crossed, ids, 'group', 'site');
  expect(partition.groups).toHaveLength(6);
  expect(partition.groups.flatMap((g) => g.memberIds)).toEqual(ids);
  expect(partition.groups[2].label).toContain('Missing value');
  expect(validatePopulationPartition(partition, set.id, ids)).toBeNull();
  expect(() => partitionPopulation(crossed, ids, 'group', 'group')).toThrow(/distinct/);
});

it('computes crossed-factor probe cells with explicit missingness and rejects ambiguous restored levels', async () => {
  const { populationPivot } = await import('../populationPivot');
  const set = store().sets[store().selection.activeSetId!];
  const crossed = {
    ...set,
    designTablePreview: {
      columns: ['group', 'site'],
      rows: ids.map((id, i) => ({ id, cells: [i < 3 ? 'A' : 'B', i === 5 ? '' : 'one'] })),
    },
  };
  const partition = partitionPopulation(crossed, ids, 'group', 'site');
  const sampled = {
    columns: [
      { name: 'member', role: 'nominal' as const },
      { name: 'value', role: 'quantitative' as const },
    ],
    rows: ids.map((member, i) => ({ member, value: [1, 3, null, 8, 10, null][i] })),
  };
  const pivot = populationPivot(partition, sampled);
  expect(pivot.rows).toEqual(['A', 'B']);
  expect(pivot.columns).toEqual(['one', null]);
  expect(pivot.cells.map((c) => [c.count, c.valid, c.mean])).toEqual([
    [3, 2, 2],
    [2, 2, 9],
    [1, 0, null],
  ]);
  expect(() => populationPivot(partition, { ...sampled, rows: sampled.rows.slice(1) })).toThrow(
    /cover/,
  );
  for (const value of ['bad', '[1,2]', '["A"]']) {
    const bad = structuredClone(partition);
    bad.groups[0].value = value;
    expect(validatePopulationPartition(bad, set.id, ids)).toMatch(/levels/);
  }
  const duplicate = structuredClone(partition);
  duplicate.groups[1].value = duplicate.groups[0].value;
  expect(validatePopulationPartition(duplicate, set.id, ids)).toMatch(/unique level/);
});
