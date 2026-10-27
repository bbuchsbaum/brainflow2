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
import {
  explainRelationship,
  populationRelationshipService,
  relationshipPartition,
  type RelationshipFit,
} from '../PopulationRelationshipService';
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

it('reopens a frozen order and montage, but refuses a fitted order with changed frame bindings', () => {
  const record = opened();
  const order = {
    featureId: 'old-feature',
    rule: 'response',
    tieRule: 'source',
    orderedIds: ['c', 'b', 'a'],
    unavailableIds: ['a'],
    label: 'Response order at pinned point',
    probe: { supportKey: 'old', worldMm: [1, 2, 3], radiusMm: 0, reduce: 'mean' },
    bindings: structuredClone(record.calculation.members),
    mask: record.calculation.mask,
  };
  record.context = {
    ...(record.context as object),
    presentation: { arrangement: 'montage', order },
  };
  const restored = preparePopulationRestore(record, 'w', 7);
  expect(restored.population.presentation).toMatchObject({
    arrangement: 'montage',
    order: { orderedIds: ['c', 'b', 'a'], featureId: restored.features[0].id },
  });
  expect(restored.selection.activeMemberId).toBe('c');
  expect(restored.population.working).toMatchObject({ memberIds: ['a', 'b'] });
  order.bindings[0].stackIndex = 99;
  const invalid = preparePopulationRestore(record, 'w', 8);
  expect(invalid.population.presentation?.order).toBeNull();
  expect(invalid.set.savedPopulation?.notices.join(' ')).toMatch(/order could not be verified/);
});

it('restores factor membership and authoritative A/B operands for continued exploration', () => {
  const record = opened();
  record.calculation.summary = 'mean';
  record.calculation.aggregation = null;
  record.calculation.reference = { id: 'B', memberIds: ['b', 'c'] };
  record.calculation.difference = true;
  record.context = {
    ...record.context,
    metadata: { a: { site: 'A' }, b: { site: 'B' }, c: { site: 'B' } },
    exploration: {
      version: 1,
      cohorts: [{ id: 'old-cohort', label: 'Other set', memberIds: ['a'] }],
      partition: {
        setId: 'old',
        column: 'site',
        contextIds: ['a', 'b', 'c'],
        origin: 'metadata',
        groups: [
          { id: 'A', label: 'Site A', value: 'A', memberIds: ['a'] },
          { id: 'B', label: 'Site B', value: 'B', memberIds: ['b', 'c'] },
        ],
      },
      partitionPast: [null],
    },
  };
  const payload = preparePopulationRestore(record, 'workspace', 2);
  useSetStudioStore.getState().bootstrapStudio(payload);
  const state = useSetStudioStore.getState();
  expect(state.population.presentation.arrangement).toBe('difference');
  expect(state.cohorts[state.selection.compareCohortId!].memberIds).toEqual(['b', 'c']);
  expect(state.population.partition?.groups[1].memberIds).toEqual(['b', 'c']);
  expect(state.population.partitionPast).toEqual([null]);
  expect(studioMetadata(payload.set, ['a', 'b', 'c']).issue).toBeNull();
  const result = buildPopulationSliceQuery(state, 'workspace', {
    crosshairMm: [3, 4, 5],
    orientation: 'coronal',
    dimPx: [10, 10],
    zoom: 2,
    summary: 'mean',
  }).query!;
  expect(result.request.reference?.memberIds).toEqual(['b', 'c']);
  expect(result.request.workingMemberIds).toEqual(['a', 'b']);
  expect(result.request.difference).toBe(true);
});

it('restores the executable null, units, channel and exploratory origin ahead of descriptive context', () => {
  const record = opened();
  record.calculation.aggregation = {
    within: 'single',
    groups: record.calculation.members
      .map((m) => ({ participantId: m.memberId, memberIds: [m.memberId] }))
      .filter((g) => record.calculation.workingMemberIds.includes(g.participantId)),
  };
  record.calculation.inference = {
    method: 'oneSample',
    role: 'effect',
    units: '% signal change',
    nullValue: 2,
    independentParticipants: true,
    selectionOrigin: 'map-derived',
    channel: 't',
  };
  record.context = { selectionContext: { working: { origin: 'manual' } } };
  const payload = preparePopulationRestore(record, 'workspace', 2);
  useSetStudioStore.getState().bootstrapStudio(payload);
  const state = useSetStudioStore.getState();
  expect(state.population.inference).toMatchObject({
    ...record.calculation.inference,
    featureId: state.selection.activeFeatureId,
    setId: state.selection.activeSetId,
  });
  expect(state.population.working).toMatchObject({ origin: 'map-derived', memberIds: ['a', 'b'] });
  const q = buildPopulationSliceQuery(state, 'workspace', {
    crosshairMm: [0, 0, 0],
    orientation: 'axial',
    dimPx: [2, 2],
    zoom: 1,
    summary: 'mean',
  }).query!;
  expect(q.request.inference).toEqual(record.calculation.inference);
});

it('reopens independent-group inference in Inspect with both participant partitions and channel intact', () => {
  const record = opened();
  record.calculation.members.push({
    ...record.calculation.members[2],
    memberId: 'd',
    stackIndex: 3,
  });
  const aggregation = (ids: string[]) => ({
    within: 'single' as const,
    groups: ids.map((id) => ({ participantId: id, memberIds: [id] })),
  });
  record.calculation.summary = 'mean';
  record.calculation.aggregation = aggregation(['a', 'b']);
  record.calculation.reference = {
    id: 'B',
    memberIds: ['c', 'd'],
    aggregation: aggregation(['c', 'd']),
  };
  record.calculation.inference = {
    method: 'welch',
    role: 'effect',
    units: 'a.u.',
    nullValue: 1,
    independentParticipants: true,
    selectionOrigin: 'map-derived',
    channel: 'countB',
  };
  const payload = preparePopulationRestore(record, 'workspace', 2);
  useSetStudioStore.getState().bootstrapStudio(payload);
  const state = useSetStudioStore.getState();
  expect(state.population.presentation.arrangement).toBe('inspect');
  expect(state.selection.activeMemberId).toBe('c');
  expect(state.population.inference).toMatchObject({
    method: 'welch',
    channel: 'countB',
    setId: state.selection.activeSetId,
  });
  const built = buildPopulationSliceQuery(state, 'workspace', {
    crosshairMm: [3, 4, 5],
    orientation: 'coronal',
    dimPx: [10, 10],
    zoom: 2,
    summary: 'mean',
  });
  expect(built.issue).toBeNull();
  expect(built.query!.request.reference?.aggregation).toEqual(
    record.calculation.reference.aggregation,
  );
  expect(built.query!.request.aggregation).toEqual(record.calculation.aggregation);
  expect(built.query!.request.inference).toEqual(record.calculation.inference);
});

it('reopens paired inference in Inspect with both participant partitions and channel intact', () => {
  const record = opened();
  record.calculation.members.push({
    ...record.calculation.members[2],
    memberId: 'd',
    stackIndex: 3,
  });
  const aggregation = (ids: string[]) => ({
    within: 'single' as const,
    groups: ids.map((id) => ({ participantId: id, memberIds: [id] })),
  });
  record.calculation.summary = 'mean';
  record.calculation.aggregation = aggregation(['a', 'b']);
  record.calculation.reference = {
    id: 'B',
    memberIds: ['c', 'd'],
    aggregation: {
      within: 'single',
      groups: [
        { participantId: 'b', memberIds: ['d'] },
        { participantId: 'a', memberIds: ['c'] },
      ],
    },
  };
  record.calculation.inference = {
    method: 'paired',
    role: 'effect',
    units: 'a.u.',
    nullValue: 1,
    independentParticipants: true,
    selectionOrigin: 'map-derived',
    channel: 'count',
  };
  const payload = preparePopulationRestore(record, 'workspace', 2);
  useSetStudioStore.getState().bootstrapStudio(payload);
  const state = useSetStudioStore.getState();
  expect(state.population.presentation.arrangement).toBe('inspect');
  expect(state.selection.activeMemberId).toBe('c');
  expect(state.population.inference).toMatchObject({
    method: 'paired',
    channel: 'count',
    setId: state.selection.activeSetId,
  });
  const built = buildPopulationSliceQuery(state, 'workspace', {
    crosshairMm: [3, 4, 5],
    orientation: 'coronal',
    dimPx: [10, 10],
    zoom: 2,
    summary: 'mean',
  });
  expect(built.issue).toBeNull();
  expect(built.query!.request.reference?.aggregation?.within).toBe('single');
  expect(built.query!.request.reference?.aggregation?.groups).toEqual(
    expect.arrayContaining(record.calculation.reference.aggregation!.groups),
  );
  expect(built.query!.request.reference?.aggregation?.groups).toHaveLength(2);
  expect(built.query!.request.aggregation).toEqual(record.calculation.aggregation);
  expect(built.query!.request.inference).toEqual(record.calculation.inference);
});
it('retains descriptive imported feature semantics and refuses unknown saved roles', () => {
  const record = opened();
  record.context = {
    ...(record.context as object),
    featureContract: { valueRole: 'effect', units: 'percent signal change' },
  };
  const restored = preparePopulationRestore(record, 'workspace', 2);
  expect(restored.features[0]).toMatchObject({
    valueRole: 'effect',
    units: 'percent signal change',
  });
  record.context = { featureContract: { valueRole: 'unknownStatistic' } };
  expect(() => preparePopulationRestore(record, 'workspace', 2)).toThrow('Unknown saved feature');
});

/** A fit as saved before eligibility existed (the v1 Rust result shape): no
 * `eligibility`, `fittedMemberIds` or `unassigned`. */
function savedV1Fit(record: OpenedPopulationCalculation): RelationshipFit {
  return JSON.parse(
    JSON.stringify({
      fitId: 'e'.repeat(64),
      request: {
        members: record.calculation.members,
        mask: record.calculation.mask,
        region: null,
        distance: 'effect',
      },
      supportSha256: 'd'.repeat(64),
      candidateVoxels: 100,
      commonVoxels: 90,
      finiteCounts: [95, 96, 97],
      dimensions: [5, 5, 4],
      affine: [
        [2, 0, 0, -4],
        [0, 2, 0, -4],
        [0, 0, 2, -3],
        [0, 0, 0, 1],
      ],
      geometry: {
        coordinates: [
          [-1.25, 0.5],
          [0.25, -0.75],
          [1, 0.25],
        ],
        componentScores: [
          [-1.25, 0.5],
          [0.25, -0.75],
          [1, 0.25],
        ],
        distances: [
          [0, 2.0155644370746373, 2.2638462845343543],
          [2.0155644370746373, 0, 1.25],
          [2.2638462845343543, 1.25, 0],
        ],
        eigenvalues: [2.6875, 0.875, 0],
        explainedFraction: 1,
        stress: 0,
        orderable: true,
        merges: [
          { left: 1, right: 2, distance: 1.25, count: 2 },
          { left: 0, right: 3, distance: 2.1397053608044958, count: 3 },
        ],
      },
    }),
  );
}
/** A v2 fit over the same context in which `c` has no finite values. */
function savedV2Fit(record: OpenedPopulationCalculation): RelationshipFit {
  const v1 = savedV1Fit(record);
  return {
    ...v1,
    fitId: '7'.repeat(64),
    request: { ...v1.request, eligibility: { lowCoverageTau: 0.9 } },
    finiteCounts: [95, 96, 0],
    fittedMemberIds: ['a', 'b'],
    unassigned: [
      { memberId: 'c', reason: { kind: 'allMissing' }, finiteCount: 0, supportLossVoxels: 90 },
    ],
    geometry: {
      coordinates: [
        [-1, 0],
        [1, 0],
      ],
      componentScores: [[-1], [1]],
      distances: [
        [0, 2],
        [2, 0],
      ],
      eigenvalues: [2, 0],
      explainedFraction: 1,
      stress: 0,
      orderable: true,
      merges: [{ left: 0, right: 1, distance: 2, count: 2 }],
    },
  };
}
function similarityOrder(
  record: OpenedPopulationCalculation,
  fit: RelationshipFit,
  orderedIds: string[],
  unavailableIds: string[],
) {
  return {
    featureId: 'old-feature',
    rule: 'similarity',
    fitId: fit.fitId,
    tieRule: 'source',
    orderedIds,
    unavailableIds,
    label: 'MDS axis 1 · effect',
    probe: null,
    bindings: structuredClone(record.calculation.members),
    mask: record.calculation.mask,
  };
}
it('restores a saved v1 similarity order, fit and re-explanation unchanged', async () => {
  const record = opened();
  const fit = savedV1Fit(record);
  const saved = JSON.stringify(fit);
  record.context = {
    ...(record.context as object),
    presentation: { order: similarityOrder(record, fit, ['a', 'b', 'c'], []) },
    relationship: fit,
  };
  const prepared = preparePopulationRestore(record, 'w', 3);
  expect(prepared.population.presentation?.order).toMatchObject({
    rule: 'similarity',
    orderedIds: ['a', 'b', 'c'],
    unavailableIds: [],
  });
  invoke.mockResolvedValueOnce('/bundle/provenance.json').mockResolvedValueOnce(record);
  expect(await populationRestoreService.chooseAndOpen(new AbortController().signal)).toBe(true);
  const restored = populationRelationshipService.getSnapshot().fit!;
  expect(JSON.stringify(restored)).toBe(saved);
  expect(useSetStudioStore.getState().population.presentation.order?.fitId).toBe(fit.fitId);
  // Current Rust v1 results also report every member as fitted and none unassigned.
  invoke.mockImplementationOnce(async (_command: string, args: { request: RelationshipFit }) => ({
    ...JSON.parse(saved),
    fittedMemberIds: ['a', 'b', 'c'],
    unassigned: [],
    request: args.request,
    explanation: {
      values: Array(128 * 128).fill(0.5),
      total: 4,
      label: 'Squared distance contribution',
      plane: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [128, 128] },
    },
  }));
  const shown = await explainRelationship(
    restored,
    { field: { kind: 'pair', a: 'a', b: 'c' }, crosshairMm: [3, 4, 5], orientation: 'axial' },
    new AbortController().signal,
  );
  expect(shown.total).toBe(4);
  const [command, args] = invoke.mock.calls.at(-1)!;
  expect(command).toBe('fit_population_relationship');
  // The re-run is the v1 request: no eligibility, identical frozen bindings.
  const { explanation, ...request } = args.request;
  expect(explanation.field).toEqual({ kind: 'pair', a: 'a', b: 'c' });
  expect('eligibility' in request).toBe(false);
  expect(request).toEqual(JSON.parse(saved).request);
});
it('restores a v2 similarity order, partition and fit with unassigned members', async () => {
  const record = opened();
  const fit = savedV2Fit(record);
  const partition = relationshipPartition(fit, 2, 'old-set');
  expect(partition.groups.map((g) => g.label)).toEqual([
    'Similarity group 1',
    'Similarity group 2',
    'Unassigned',
  ]);
  record.context = {
    ...(record.context as object),
    presentation: {
      arrangement: 'groups',
      order: similarityOrder(record, fit, ['b', 'a', 'c'], ['c']),
    },
    relationship: fit,
    exploration: { version: 1, partition },
  };
  const prepared = preparePopulationRestore(record, 'w', 3);
  expect(prepared.population.presentation?.order).toMatchObject({
    orderedIds: ['b', 'a', 'c'],
    unavailableIds: ['c'],
  });
  expect(prepared.population.partition?.groups.at(-1)).toMatchObject({
    id: 'unassigned',
    memberIds: ['c'],
    origin: 'unassigned',
  });
  expect(prepared.population.presentation?.arrangement).toBe('groups');
  invoke.mockResolvedValueOnce('/bundle/provenance.json').mockResolvedValueOnce(record);
  expect(await populationRestoreService.chooseAndOpen(new AbortController().signal)).toBe(true);
  expect(populationRelationshipService.getSnapshot().fit).toEqual(fit);
  await expect(
    explainRelationship(
      populationRelationshipService.getSnapshot().fit!,
      { field: { kind: 'pair', a: 'a', b: 'c' }, crosshairMm: [3, 4, 5], orientation: 'axial' },
      new AbortController().signal,
    ),
  ).rejects.toThrow(/unassigned/);
  // An order whose unavailable members disagree with the fit is refused.
  for (const [ordered, unavailable] of [
    [['b', 'a', 'c'], []],
    [['c', 'b', 'a'], ['c']],
  ] as const) {
    const wrong = opened();
    wrong.context = {
      ...(wrong.context as object),
      presentation: { order: similarityOrder(wrong, fit, [...ordered], [...unavailable]) },
      relationship: fit,
    };
    const refused = preparePopulationRestore(wrong, 'w', 4);
    expect(refused.population.presentation?.order).toBeNull();
    expect(refused.set.savedPopulation?.notices.join(' ')).toMatch(/order could not be verified/);
  }
});
