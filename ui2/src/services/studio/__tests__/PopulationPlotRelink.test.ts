import { beforeEach, expect, it, vi } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { populationPlotService as service } from '../PopulationPlotService';
import { populationProbeActions } from '../PopulationProbeActions';
import { buildPopulationProbeQuery } from '../PopulationProbeController';
import type { SampleFrame } from '@/plotting';
const { sample } = vi.hoisted(() => ({ sample: vi.fn() }));
vi.mock('@/services/SampleProvider', () => ({ sampleProvider: { sample } }));
function saved() {
  populationProbeActions.pin(0, false);
  const state = useSetStudioStore.getState();
  const query = buildPopulationProbeQuery(
    state,
    useViewStateStore.getState().activeWorkspaceKey,
  ).query!;
  if (query.request.locus.kind !== 'set') throw new Error('Expected set');
  const frame: SampleFrame = {
    columns: [
      { name: 'member', role: 'nominal' },
      { name: 'value', role: 'quantitative', unit: 'beta' },
    ],
    rows: query.request.locus.members.map((m, i) => ({ member: m.memberId, value: i })),
    meta: {
      sources: query.request.locus.members.map((m) => ({
        memberId: m.memberId,
        stackIndex: m.stackIndex ?? null,
        sourceRevision: { sha256: 'a'.repeat(64), sourceBytes: 100 },
        validCount: 1,
        error: null,
      })),
    },
  };
  const id = service.pin({ query, frame }, frame);
  service.reopen(service.serialize(id));
  service.close(id);
  return { plot: service.getSnapshot()[0], frame };
}
beforeEach(() => {
  for (const p of service.getSnapshot()) service.close(p.id);
  sample.mockReset();
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
});
it('links a saved plot only after digest-bound resampling of its exact observations', async () => {
  const { plot, frame } = saved();
  expect(service.canLink(plot)).toBe(false);
  sample.mockResolvedValue(frame);
  await service.verifyAndLink(plot.id, new AbortController().signal);
  expect(service.canLink(service.getSnapshot()[0])).toBe(true);
  service.reopen(service.serialize(plot.id));
  const second = service.getSnapshot()[1];
  await service.verifyAndLink(second.id, new AbortController().signal);
  const combinedId = service.combine([plot.id, second.id]);
  const combined = service.getSnapshot().find((p) => p.id === combinedId)!;
  expect(service.canLink(combined)).toBe(true);
  expect(service.linkedMember(combined, String(combined.frame.rows[0].member))).toBe(
    frame.rows[0].member,
  );

  expect(
    sample.mock.calls[0][0].locus.members.every(
      (m: { expectedSha256: string }) => m.expectedSha256 === 'a'.repeat(64),
    ),
  ).toBe(true);
});
it('keeps changed measurements, hashes and duplicate returned identities detached', async () => {
  const { plot, frame } = saved();
  for (const changed of [
    { ...frame, rows: frame.rows.map((r, i) => (i ? r : { ...r, value: 999 })) },
    { ...frame, rows: frame.rows.map(() => frame.rows[0]) },
    {
      ...frame,
      meta: {
        ...frame.meta,
        sources: frame.meta!.sources!.map((s) => ({
          ...s,
          sourceRevision: { sha256: 'b'.repeat(64), sourceBytes: 100 },
        })),
      },
    },
  ]) {
    sample.mockResolvedValue(changed);
    await expect(service.verifyAndLink(plot.id, new AbortController().signal)).rejects.toThrow();
    expect(service.canLink(service.getSnapshot()[0])).toBe(false);
  }
});
it('does not publish a verified result into a changed import generation', async () => {
  const { plot, frame } = saved();
  sample.mockImplementation(async () => {
    useSetStudioStore.getState().loadDemoSession();
    return frame;
  });
  await expect(service.verifyAndLink(plot.id, new AbortController().signal)).rejects.toThrow(
    /destination/,
  );
  expect(service.canLink(service.getSnapshot()[0])).toBe(false);
});

it('follows live membership locally while preserving pinned samples and suspends detached recipes', async () => {
  const { plot, frame } = saved();
  sample.mockResolvedValue(frame);
  await service.verifyAndLink(plot.id, new AbortController().signal);
  service.bindSelection(plot.id, 'working');
  useSetStudioStore.getState().selectPopulationMembers([String(frame.rows[1].member)]);
  const current = service.getSnapshot()[0];
  expect(service.frameForView(current)?.rows.map((r) => r.member)).toEqual([frame.rows[1].member]);
  expect(current.frame.rows).toHaveLength(frame.rows.length);
  expect(sample).toHaveBeenCalledTimes(1);
  service.reopen(service.serialize(current.id));
  const detached = service.getSnapshot()[1];
  expect(service.frameForView(detached)).toBeNull();
  service.bindSelection(detached.id, 'snapshot');
  expect(service.frameForView(service.getSnapshot()[1])?.rows).toHaveLength(frame.rows.length);
});

it('does not link an observation to a different active feature with the same row IDs', async () => {
  const { plot, frame } = saved();
  sample.mockResolvedValue(frame);
  await service.verifyAndLink(plot.id, new AbortController().signal);
  const current = service.getSnapshot()[0];
  expect(service.canLink(current)).toBe(true);
  const state = useSetStudioStore.getState();
  useSetStudioStore.setState({
    selection: { ...state.selection, activeFeatureId: 'another-feature' },
  });
  expect(service.canLink(current)).toBe(false);
  expect(service.linkedMember(current, String(frame.rows[0].member))).toBeNull();
});
