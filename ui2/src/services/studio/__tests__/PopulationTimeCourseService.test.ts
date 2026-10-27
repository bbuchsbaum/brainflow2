import { expect, it, vi } from 'vitest';
import {
  samplePopulationTimeCourse,
  validatePopulationTrace,
} from '../PopulationTimeCourseService';
import { defaultPopulationPlotRecipe } from '../populationPlot';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { buildPopulationSliceQuery } from '../PopulationSliceService';
import type { PinnedPopulationPlot } from '../PopulationPlotService';
import type { SampleRequest } from '@/plotting';
const hash = 'a'.repeat(64);
const plot: PinnedPopulationPlot = {
  id: 'p',
  label: 'Probe',
  datasetKey: 'd',
  setId: 's',
  sessionRevision: 1,
  recipe: defaultPopulationPlotRecipe,
  frame: {
    columns: [
      { name: 'member', role: 'nominal' },
      { name: 'value', role: 'quantitative', unit: 'beta' },
      { name: 'group', role: 'nominal' },
    ],
    rows: [
      { member: 'a', value: 1, group: 'A' },
      { member: 'b', value: 2, group: 'B' },
    ],
    meta: {
      sources: ['a', 'b'].map((memberId) => ({
        memberId,
        sourceRevision: { sha256: hash, sourceBytes: 100 },
        stackIndex: 0,
        validCount: 1,
        error: null,
      })),
    },
  },
  query: {
    key: 'q',
    datasetKey: 'd',
    probe: { worldMm: [0, 0, 0], radiusMm: 0, reduce: 'mean', supportKey: 's' },
    request: {
      locus: {
        kind: 'set',
        worldMm: [0, 0, 0],
        radiusMm: 0,
        members: ['a', 'b'].map((memberId) => ({
          memberId,
          sourcePath: `/${memberId}.nii`,
          stackIndex: 0,
        })),
      },
    },
  },
};
const axis = {
  firstFrame: 3,
  count: 3,
  start: -2,
  step: 0.5,
  unit: 's',
  alignment: 'declared-common-axis' as const,
};
const sample = async (request: SampleRequest) => {
  if (request.locus.kind !== 'set') throw new Error('set required');
  return {
    columns: plot.frame.columns,
    rows: request.locus.members.map((m) => ({
      member: m.memberId,
      value: m.stackIndex === 4 ? null : m.stackIndex!,
    })),
    meta: {
      sources: request.locus.members.map((m) => ({
        memberId: m.memberId,
        sourceRevision: { sha256: m.expectedSha256!, sourceBytes: 100 },
        stackIndex: m.stackIndex!,
        validCount: 1,
        error: null,
      })),
    },
  };
};
it('samples real frames with frozen source hashes and keeps missing samples and explicit time', async () => {
  const spy = vi.fn(sample),
    signal = new AbortController().signal;
  const result = await samplePopulationTimeCourse(plot, axis, signal, spy);
  expect(
    result.frame.rows.map((r) => [r.__traceObservation, r.__traceFrame, r.__traceTime, r.value]),
  ).toEqual([
    ['a', 3, -2, 3],
    ['a', 4, -1.5, null],
    ['a', 5, -1, 5],
    ['b', 3, -2, 3],
    ['b', 4, -1.5, null],
    ['b', 5, -1, 5],
  ]);
  expect(result.frame.rows[3].group).toBe('B');
  expect(result.recipe).toMatchObject({
    axis: 'time',
    axisUnit: 's',
    detail: '__traceObservation',
    mark: 'line',
  });
  expect(() => validatePopulationTrace({ ...plot, ...result })).not.toThrow();
  expect(plot.query.request.locus).toMatchObject({
    members: [{ stackIndex: 0 }, { stackIndex: 0 }],
  });
});
it('bounds extraction, refuses changed revisions and cancels without partial publication', async () => {
  const spy = vi.fn(sample);
  await expect(
    samplePopulationTimeCourse(plot, { ...axis, count: 513 }, new AbortController().signal, spy),
  ).rejects.toThrow(/512/);
  expect(spy).not.toHaveBeenCalled();
  await expect(
    samplePopulationTimeCourse(plot, axis, new AbortController().signal, async (r) => {
      const result = await sample(r);
      result.meta.sources[0].sourceRevision.sha256 = 'b'.repeat(64);
      return result;
    }),
  ).rejects.toThrow(/revisions/);
  const abort = new AbortController();
  await expect(
    samplePopulationTimeCourse(plot, axis, abort.signal, async (r) => {
      abort.abort();
      return sample(r);
    }),
  ).rejects.toThrow();
});
it('switches the focused image frame without changing cohort inputs and restores canonical focus', () => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  const before = useSetStudioStore.getState(),
    id = before.selection.activeMemberId!;
  expect(before.setPopulationFocusedFrame(id, 7)).toEqual({ ok: true });
  const state = useSetStudioStore.getState();
  expect(state.population.working).toBe(before.population.working);
  const query = buildPopulationSliceQuery(state, 'workspace', {
    crosshairMm: [1, 1, 1],
    orientation: 'axial',
    dimPx: [3, 3],
    zoom: 1,
    summary: 'mean',
  }).query!;
  expect(query.request.focusStackIndex).toBe(7);
  expect(query.request.members.every((m) => m.stackIndex === undefined)).toBe(true);
  state.setActiveMember(id);
  expect(useSetStudioStore.getState().population.focusedFrame).toBeNull();
});

it('refuses edited temporal coordinates or duplicated observation/frame identities in saved traces', async () => {
  const result = await samplePopulationTimeCourse(plot, axis, new AbortController().signal, sample);
  const changed = structuredClone({ ...plot, ...result });
  (changed.frame.rows[0] as Record<string, unknown>).__traceTime = 999;
  expect(() => validatePopulationTrace(changed)).toThrow(/identities/);
  const alias = structuredClone({ ...plot, ...result });
  alias.trace.samples[0].sampleId = 'arbitrary';
  expect(() => validatePopulationTrace(alias)).toThrow(/identities/);
});
