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
