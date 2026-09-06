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
  expect(inferenceMethods.map((m) => m.id)).toEqual([
    'oneSample',
    'welch',
    'paired',
    'linearModel',
  ]);
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

it('pairs by exact participant identity and refuses unmatched or reused observations', () => {
  const a = {
    within: 'single' as const,
    groups: [
      { participantId: 'P1', memberIds: ['a1'] },
      { participantId: 'P2', memberIds: ['a2'] },
    ],
  };
  const b = {
    within: 'single' as const,
    groups: [
      { participantId: 'P2', memberIds: ['b2'] },
      { participantId: 'P1', memberIds: ['b1'] },
    ],
  };
  const paired = { ...spec, method: 'paired' as const };
  expect(inferenceIssue(paired, a, b)).toBeNull();
  expect(inferenceIssue(paired, a, a)).toMatch(/distinct observations/);
  expect(
    inferenceIssue(paired, a, {
      ...b,
      groups: [b.groups[0], { participantId: 'P3', memberIds: ['b3'] }],
    }),
  ).toMatch(/same participant IDs/);
  expect(inferenceIssue({ ...paired, channel: 'countA' }, a, b)).toMatch(/not produced/);
});

it('honors imported feature roles and units instead of allowing a question to relabel data', () => {
  const s = state();
  const id = s.selection.activeFeatureId!;
  useSetStudioStore.setState({
    features: { ...s.features, [id]: { ...s.features[id], valueRole: 't', units: 'unitless' } },
  });
  expect(configureInference(spec)).toMatch(/Imported feature role/);
  useSetStudioStore.setState({
    features: { ...s.features, [id]: { ...s.features[id], valueRole: 'effect', units: 'percent' } },
  });
  expect(configureInference(spec)).toMatch(/imported feature units/);
});
it('refuses relabeling imported roles or units without transformed data', () => {
  const featureId = state().selection.activeFeatureId!;
  const setId = state().selection.activeSetId!;
  state().configurePopulationParticipants({
    setId,
    identity: { kind: 'observationIds' },
    reduction: 'single',
  });
  useSetStudioStore.setState({
    features: {
      ...state().features,
      [featureId]: { ...state().features[featureId], valueRole: 't', units: 'statistic' },
    },
  });
  expect(configureInference(spec)).toMatch(/Imported feature role/);
  useSetStudioStore.setState({
    features: {
      ...state().features,
      [featureId]: { ...state().features[featureId], valueRole: 'effect', units: 'beta' },
    },
  });
  expect(configureInference(spec)).toMatch(/imported feature units/);
  expect(configureInference({ ...spec, units: 'beta' })).toBeNull();
});

it('routes an explicit OLS design without inventing population B and rejects membership drift', () => {
  state().configurePopulationParticipants({
    setId: state().selection.activeSetId!,
    identity: { kind: 'observationIds' },
    reduction: 'single',
  });
  const ids = state().sets[state().selection.activeSetId!].memberIds;
  const model: PopulationInferenceSpec = {
    ...spec,
    method: 'linearModel',
    design: {
      participantIds: [...ids],
      columns: ['intercept', 'x'],
      values: ids.map((_, i) => [1, i]),
      contrast: [0, 1],
      contrastUnits: 'effect / x',
    },
  };
  expect(configureInference(model)).toBeNull();
  const result = buildPopulationSliceQuery(state(), 'workspace', {
    crosshairMm: [0, 0, 0],
    orientation: 'axial',
    dimPx: [2, 2],
    zoom: 1,
    summary: 'mean',
  });
  expect(result.issue).toBeNull();
  expect(result.query!.request.inference!.design).toEqual(model.design);
  expect(result.query!.request.reference).toBeUndefined();
  state().selectPopulationMembers(ids.slice(0, 3), 'manual');
  expect(
    buildPopulationSliceQuery(state(), 'workspace', {
      crosshairMm: [0, 0, 0],
      orientation: 'axial',
      dimPx: [2, 2],
      zoom: 1,
      summary: 'mean',
    }).issue,
  ).toMatch(/participant-keyed/);
});
