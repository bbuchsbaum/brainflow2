import { beforeEach, expect, it } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { configureInference, inferenceIssue, selectInferenceChannel } from '../populationInference';
import { buildPopulationSliceQuery } from '../PopulationSliceService';
import type { PopulationInferenceSpec } from '@/types/population';
const spec: PopulationInferenceSpec = {
  method: 'oneSample',
  role: 'effect',
  units: '% signal change',
  nullValue: 0,
  independentParticipants: true,
  selectionOrigin: 'manual',
  channel: 'effect',
};
const state = () => useSetStudioStore.getState();
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  state().loadDemoSession();
});
it('requires explicit effects, units and independent participant identities', () => {
  expect(configureInference(spec)).toMatch(/participant/);
  expect(inferenceIssue({ ...spec, role: 't' }, null)).toMatch(/effect estimates/);
  expect(inferenceIssue({ ...spec, units: '' }, null)).toMatch(/units/);
  expect(inferenceIssue({ ...spec, independentParticipants: false }, null)).toMatch(/independent/);
});
it('keeps selection and focus while routing typed tests and retaining selection origin', () => {
  const setId = state().selection.activeSetId!;
  state().configurePopulationParticipants({
    setId,
    identity: { kind: 'observationIds' },
    reduction: 'single',
  });
  const before = state();
  expect(configureInference(spec)).toBeNull();
  expect(state().selection.activeMemberId).toBe(before.selection.activeMemberId);
  expect(state().population.working).toEqual(before.population.working);
  selectInferenceChannel('t');
  const options = {
    crosshairMm: [0, 0, 0] as [number, number, number],
    orientation: 'axial' as const,
    dimPx: [2, 2] as [number, number],
    zoom: 1,
    summary: 'sampleSd' as const,
  };
  const q = buildPopulationSliceQuery(state(), 'workspace', options).query!;
  expect(q.request.inference?.channel).toBe('t');
  expect(q.request.summary).toBe('mean');
  expect(q.request.aggregation?.groups.length).toBeGreaterThan(1);
  const ids = q.request.workingMemberIds.slice(0, 2);
  state().selectPopulationMembers(ids, 'map-derived', 'response lasso');
  expect(
    buildPopulationSliceQuery(state(), 'workspace', options).query?.request.inference
      ?.selectionOrigin,
  ).toBe('map-derived');
  state().selectPopulationMembers(ids.slice(0, 1));
  expect(buildPopulationSliceQuery(state(), 'workspace', options).issue).toMatch(/two/);
  configureInference(null);
  expect(
    buildPopulationSliceQuery(state(), 'workspace', options).query?.request.inference,
  ).toBeUndefined();
});

it('routes Welch through declared disjoint A/B participants without changing focus', () => {
  const setId = state().selection.activeSetId!;
  const ids = state().sets[setId].memberIds;
  state().configurePopulationParticipants({
    setId,
    identity: { kind: 'observationIds' },
    reduction: 'single',
  });
  state().selectPopulationMembers(ids.slice(0, 2));
  state().setPopulationReferenceMode('complement');
  const focus = state().selection.activeMemberId;
  expect(configureInference({ ...spec, method: 'welch' })).toBeNull();
  const options = {
    crosshairMm: [0, 0, 0] as [number, number, number],
    orientation: 'axial' as const,
    dimPx: [2, 2] as [number, number],
    zoom: 1,
    summary: 'mean' as const,
  };
  const q = buildPopulationSliceQuery(state(), 'workspace', options).query!.request;
  expect(q.inference?.method).toBe('welch');
  expect(q.reference?.memberIds).toEqual(ids.slice(2));
  expect(q.difference).toBe(false);
  expect(state().selection.activeMemberId).toBe(focus);
  selectInferenceChannel('countB');
  expect(() => selectInferenceChannel('count')).toThrow(/not produced/);
  const b = state().createSavedCohort({ memberIds: ids.slice(1), label: 'Overlapping B' })!;
  state().setCompareCohort(b);
  state().setPopulationReferenceMode('cohort');
  expect(buildPopulationSliceQuery(state(), 'workspace', options).issue).toMatch(
    /disjoint participant/,
  );
  state().setPopulationPresentation({
    ...state().population.presentation,
    arrangement: 'comparison',
  });
  const descriptive = buildPopulationSliceQuery(state(), 'workspace', options).query!;
  expect(descriptive.request.inference).toBeUndefined();
  expect(descriptive.request.reference).toBeTruthy();
});

it('uses method-specific channels and rejects the same participant behind different rows', async () => {
  const { inferenceMethods, inferenceMethod } = await import('../inferenceCatalog');
  expect(inferenceMethods.map((m) => m.id)).toEqual(['oneSample', 'welch']);
  expect(inferenceMethod('welch').channels.map((c) => c.id)).toEqual([
    'effect',
    'standardError',
    't',
    'df',
    'countA',
    'countB',
  ]);
  const a = {
    within: 'single' as const,
    groups: [
      { participantId: 'P1', memberIds: ['a'] },
      { participantId: 'P2', memberIds: ['b'] },
    ],
  };
  const b = {
    within: 'single' as const,
    groups: [
      { participantId: 'P1', memberIds: ['c'] },
      { participantId: 'P3', memberIds: ['d'] },
    ],
  };
  expect(inferenceIssue({ ...spec, method: 'welch' }, a, b)).toMatch(/disjoint participant/);
  expect(inferenceIssue({ ...spec, method: 'welch', channel: 'count' }, a, b)).toMatch(
    /not produced/,
  );
  expect(inferenceIssue({ ...spec, method: 'welch' }, a, null)).toMatch(/population B/);
  expect(inferenceIssue({ ...spec, method: 'missing' as never }, a)).toMatch(/Unsupported/);
});
