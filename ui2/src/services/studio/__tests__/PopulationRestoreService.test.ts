import { beforeEach, expect, it, vi } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import {
  populationRestoreService,
  preparePopulationRestore,
  type OpenedPopulationCalculation,
} from '../PopulationRestoreService';
import { buildPopulationProbeQuery, buildPopulationSource } from '../PopulationProbeController';
import { buildPopulationSliceQuery } from '../PopulationSliceService';
import { resolvePopulationParticipants } from '../populationParticipants';
import { studioMetadata } from '../studioMetadata';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));
function opened(): OpenedPopulationCalculation {
  return {
    recordPath: '/bundle/provenance.json',
    recordSha256: 'c'.repeat(64),
    calculation: {
      contextKey: 'old',
      members: ['a', 'b', 'c'].map((memberId, stackIndex) => ({
        memberId,
        sourcePath: '/frames.nii',
        stackIndex,
        expectedSha256: 'a'.repeat(64),
      })),
      workingMemberIds: ['a', 'b'],
      focusMemberId: 'c',
      crosshairMm: [3, 4, 5],
      orientation: 'coronal',
      dimPx: [10, 10],
      zoom: 2,
      summary: 'sampleSd',
      mask: { sourcePath: '/mask.nii', expectedSha256: 'b'.repeat(64) },
      aggregation: { within: 'mean', groups: [{ participantId: 'person', memberIds: ['a', 'b'] }] },
    },
    context: {
      datasetName: 'Saved study',
      featureLabel: 'Contrast',
      metadata: { a: { site: 'A' }, b: { site: 'B' } },
      participantDefinition: { identity: { kind: 'observationIds' }, reduction: 'observations' },
      selectionContext: {
        working: { kind: 'context', origin: 'map-derived' },
        compareCohortId: 'old-cohort',
        pinnedProbe: { supportKey: 'old', worldMm: [1, 2, 3], radiusMm: 2, reduce: 'mean' },
      },
      displayScale: { effectLimit: 9, summaryLimit: 4 },
    },
  };
}
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  invoke.mockReset();
});
it('restores executable operands atomically, preserving frames/hashes in both probes and images', async () => {
  const snapshot = opened();
  invoke.mockResolvedValueOnce('/bundle/provenance.json').mockResolvedValueOnce(snapshot);
  const workspace = useViewStateStore.getState().activeWorkspaceKey;
  const revision = useSetStudioStore.getState().population.sessionRevision;
  expect(await populationRestoreService.chooseAndOpen(new AbortController().signal)).toBe(true);
  const state = useSetStudioStore.getState();
  expect(state.selection.activeLens).toBe('population');
  expect(state.selection.activeMemberId).toBe('c');
  expect(state.selection.compareCohortId).toBeNull();
  expect(state.population.sessionRevision).toBe(revision + 1);
  expect(state.population.working).toMatchObject({
    kind: 'members',
    memberIds: ['a', 'b'],
    origin: 'map-derived',
  });
  expect(state.population.participants).toMatchObject({
    identity: { kind: 'saved' },
    reduction: 'mean',
  });
  expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([3, 4, 5]);
  const source = buildPopulationSource(state, workspace).source!;
  expect(source.members).toEqual(snapshot.calculation.members);
  expect(source.mask).toEqual(snapshot.calculation.mask);
  const probe = buildPopulationProbeQuery(state, workspace).query!;
  expect(probe.request.locus).toMatchObject({
    members: snapshot.calculation.members,
    worldMm: [1, 2, 3],
  });
  const query = buildPopulationSliceQuery(state, workspace, {
    crosshairMm: [3, 4, 5],
    orientation: 'coronal',
    dimPx: [10, 10],
    zoom: 2,
    summary: 'sampleSd',
  }).query!;
  expect(query.request.aggregation).toEqual(snapshot.calculation.aggregation);
  expect(query.initialScale).toMatchObject({ effectLimit: 9, summaryLimit: 4 });
  // Descriptive participant/context fields did not override the saved calculation.
  snapshot.calculation.aggregation!.groups[0].memberIds.length = 0;
  expect(state.population.participants?.identity).toMatchObject({
    groups: [{ memberIds: ['a', 'b'] }],
  });
  expect(
    state.sets[state.selection.activeSetId!].memberSummaries.every((m) => m.sourcePath === null),
  ).toBe(true);
});
it('allows saved-subset participant summaries but refuses unknown participant identities and missing metadata', () => {
  const payload = preparePopulationRestore(opened(), 'workspace', 2);
  useSetStudioStore.getState().bootstrapStudio(payload);
  let state = useSetStudioStore.getState();
  expect(resolvePopulationParticipants(state, ['a']).aggregation?.groups).toEqual([
    { participantId: 'person', memberIds: ['a'] },
  ]);
  expect(studioMetadata(payload.set, ['a', 'b']).issue).toBeNull();
  expect(studioMetadata(payload.set).issue).toMatch(/complete/);
  expect(resolvePopulationParticipants(state, ['a', 'c']).issue).toMatch(
    /no saved participant identity/,
  );
  state.selectPopulationMembers(['a', 'c']);
  state = useSetStudioStore.getState();
  expect(
    buildPopulationSliceQuery(state, 'workspace', {
      crosshairMm: [0, 0, 0],
      orientation: 'axial',
      dimPx: [1, 1],
      zoom: 1,
      summary: 'mean',
    }).query,
  ).toBeNull();
  expect(
    state.configurePopulationParticipants({
      setId: payload.set.id,
      identity: { kind: 'observationIds' },
      reduction: 'single',
    }).ok,
  ).toBe(true);
  expect(
    resolvePopulationParticipants(useSetStudioStore.getState(), ['a', 'c']).groups,
  ).toHaveLength(2);
});
it('preserves null focus and declines malformed cosmetic settings without losing the calculation', () => {
  const data = opened();
  data.calculation.focusMemberId = null;
  data.context = {
    displayScale: { effectLimit: -3, summaryLimit: '4' },
    selectionContext: { pinnedProbe: { worldMm: [NaN, 2, 3] } },
  };
  useSetStudioStore.getState().bootstrapStudio(preparePopulationRestore(data, 'w', 4));
  const state = useSetStudioStore.getState();
  expect(state.selection.activeMemberId).toBeNull();
  expect(state.population.pinnedProbe).toBeNull();
  expect(state.population.restoredView?.effectLimit).toBeUndefined();
});
it('keeps the live dataset untouched when the chooser is canceled or source verification fails', async () => {
  const original = useSetStudioStore.getState();
  invoke.mockResolvedValueOnce(null);
  expect(await populationRestoreService.chooseAndOpen(new AbortController().signal)).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
  invoke
    .mockResolvedValueOnce('/bundle/provenance.json')
    .mockRejectedValueOnce(new Error('Source hash changed'));
  await expect(
    populationRestoreService.chooseAndOpen(new AbortController().signal),
  ).rejects.toThrow('Source hash changed');
  expect(useSetStudioStore.getState()).toBe(original);
});
it('discards a completion after another import and forwards cancellation without publishing', async () => {
  let complete!: (value: OpenedPopulationCalculation) => void;
  invoke.mockResolvedValueOnce('/bundle/provenance.json').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = populationRestoreService.chooseAndOpen(new AbortController().signal);
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  useSetStudioStore.getState().loadDemoSession();
  const latest = useSetStudioStore.getState();
  complete(opened());
  await expect(pending).rejects.toThrow(/destination workspace or dataset changed/);
  expect(useSetStudioStore.getState()).toBe(latest);
  const controller = new AbortController();
  invoke
    .mockResolvedValueOnce('/bundle/provenance.json')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const canceled = populationRestoreService.chooseAndOpen(controller.signal);
  await vi.waitFor(() =>
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'open_population_summary')).toHaveLength(2),
  );
  controller.abort();
  complete(opened());
  await expect(canceled).rejects.toThrow();
  expect(invoke).toHaveBeenCalledWith(
    'cancel_population_sample',
    expect.objectContaining({ ticket: expect.any(Object) }),
  );
  expect(useSetStudioStore.getState()).toBe(latest);
});
