import { beforeEach, expect, it, vi } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import {
  PopulationRelationshipService,
  relationshipSource,
  relationshipPartition,
  relationshipFittedIds,
  explainRelationship,
  RELATIONSHIP_UNASSIGNED_GROUP_ID,
  relationshipUnassignedSummary,
  relationshipUnassignedReasonLabel,
  relationshipCoverageMedian,
  relationshipUsable,
  validRelationshipFit,
  type RelationshipFit,
  type RelationshipRequest,
} from '../PopulationRelationshipService';
import { resolvePopulation } from '../populationContext';
import { comparableGroups, unassignedGroup, validatePopulationPartition } from '../populationGroups';
import { buildPopulationSliceQuery } from '../PopulationSliceService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { syntheticFit, syntheticV2Fit } from './relationshipFixtures';
const state = () => useSetStudioStore.getState();
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  state().loadDemoSession();
});
it('fits only explicitly and keeps point geometry fixed through focus, selection and probe changes', async () => {
  const evaluate = vi.fn(async (q: RelationshipRequest) => syntheticFit(q));
  const service = new PopulationRelationshipService(evaluate);
  const before = state().population;
  await service.fit('effect');
  const fit = service.getSnapshot().fit!;
  expect(state().population.working).toBe(before.working);
  expect(state().population.pinnedProbe).toBe(before.pinnedProbe);
  const ids = fit.request.members.map((m) => m.memberId);
  state().setActiveMember(ids[2]);
  state().selectPopulationMembers(ids.slice(1, 3));
  state().setPopulationProbe(
    { supportKey: 'sphere', worldMm: [1, 2, 3], radiusMm: 5, reduce: 'mean' },
    'pin',
  );
  expect(service.getSnapshot().fit).toBe(fit);
  expect(evaluate).toHaveBeenCalledTimes(1);
  service.order();
  expect(state().population.presentation.order?.orderedIds).toEqual(ids);
  expect(resolvePopulation(state()).workingMemberIds).toEqual(ids.slice(1, 3));
  service.group(2);
  expect(state().population.partition?.origin).toBe('map-derived');
  expect(
    state()
      .population.partition?.groups.flatMap((g) => g.memberIds)
      .sort(),
  ).toEqual([...ids].sort());
  expect(service.getSnapshot().fit).toBe(fit);
});
it('discards canceled and late fits independently of transport cancellation', async () => {
  let finish!: (value: RelationshipFit) => void;
  const evaluate = vi.fn((request: RelationshipRequest) => {
    expect(request.members).toHaveLength(6);
    return new Promise<RelationshipFit>((resolve) => {
      finish = resolve;
    });
  });
  const service = new PopulationRelationshipService(evaluate);
  const pending = service.fit('effect');
  const request = evaluate.mock.calls[0][0];
  service.cancel();
  finish(syntheticFit(request));
  await pending;
  expect(service.getSnapshot().fit).toBeNull();
  expect(service.getSnapshot().pending).toBe(false);
});
it('marks changed source revisions stale and refuses to order, group or export them', async () => {
  const service = new PopulationRelationshipService(async (q) => syntheticFit(q));
  await service.fit('effect');
  const fit = service.getSnapshot().fit!;
  service.observeSources(
    fit.request.members.map((m) => ({
      memberId: m.memberId,
      revision: { sha256: 'd'.repeat(64) },
    })),
  );
  service.order();
  service.group(2);
  expect(state().population.presentation.order).toBeNull();
  expect(state().population.partition).toBeNull();
  expect(service.exportFor(fit.request.members, null)).toBeNull();
});
it('refuses malformed geometry and merge trees and does not impose an order on tied axes', async () => {
  const source = relationshipSource().source!;
  const fit = syntheticFit({
    members: source.members,
    mask: null,
    region: null,
    distance: 'effect',
  });
  expect(validRelationshipFit(fit)).toBe(true);
  const invalid = structuredClone(fit);
  invalid.geometry.merges[0].right = 0;
  expect(validRelationshipFit(invalid)).toBe(false);
  expect(() => relationshipPartition(fit, 1, 'set')).toThrow();
  const service = new PopulationRelationshipService(async () => ({
    ...fit,
    geometry: { ...fit.geometry, orderable: false },
  }));
  await service.fit('effect');
  service.order();
  expect(state().population.presentation.order).toBeNull();
});

it('retains the order fit separately when a new spatial fit replaces the plot', async () => {
  let serial = 0;
  const service = new PopulationRelationshipService(async (q) => ({
    ...syntheticFit(q),
    fitId: (serial++ === 0 ? 'a' : 'b').repeat(64),
  }));
  await service.fit('effect');
  service.order();
  const oldOrder = state().population.presentation.order;
  await service.fit('effect');
  const current = service.getSnapshot().fit!;
  expect(current.fitId).toBe('b'.repeat(64));
  expect(state().population.presentation.order).toBe(oldOrder);
  expect(service.exportFor(current.request.members, null)?.fitId).toBe('b'.repeat(64));
  expect(service.exportOrderFor(current.request.members, null)?.fitId).toBe('a'.repeat(64));
  const changed = current.request.members.map((m) => ({ ...m, expectedSha256: 'c'.repeat(64) }));
  expect(service.exportOrderFor(changed, null)).toBeNull();
  service.resetScope(null);
  expect(service.exportOrderFor(current.request.members, null)).toBeNull();
});

it('requests v2 eligibility for new fits and checks it is echoed', async () => {
  const evaluate = vi.fn(async (q: RelationshipRequest) => syntheticFit(q));
  const service = new PopulationRelationshipService(evaluate);
  await service.fit('effect');
  expect(evaluate.mock.calls[0][0].eligibility).toEqual({ lowCoverageTau: 0.9 });
  expect(service.getSnapshot().fit?.request.eligibility).toEqual({ lowCoverageTau: 0.9 });
  const dropped = new PopulationRelationshipService(async (q) => {
    const fit = syntheticFit(q);
    delete fit.request.eligibility;
    return fit;
  });
  await dropped.fit('effect');
  expect(dropped.getSnapshot().fit).toBeNull();
  expect(dropped.getSnapshot().error).toMatch(/does not match/);
});
it('orders fitted members by axis with unassigned members unavailable last, and partitions them apart', async () => {
  const service = new PopulationRelationshipService(async (q) => syntheticV2Fit(q, [1, 4]));
  await service.fit('effect');
  const fit = service.getSnapshot().fit!;
  expect(validRelationshipFit(fit)).toBe(true);
  const ids = fit.request.members.map((m) => m.memberId);
  const fitted = ids.filter((_, i) => i !== 1 && i !== 4);
  expect(relationshipFittedIds(fit)).toEqual(fitted);
  service.order();
  const order = state().population.presentation.order!;
  expect(order.orderedIds).toEqual([...fitted, ids[1], ids[4]]);
  expect(order.unavailableIds).toEqual([ids[1], ids[4]]);
  expect(order.bindings).toEqual(fit.request.members);
  expect(order.label).toMatch(/2 unassigned last/);
  const partition = relationshipPartition(fit, fitted.length, state().selection.activeSetId!);
  expect(partition.contextIds).toEqual(ids);
  expect(partition.groups).toHaveLength(fitted.length + 1);
  const extra = partition.groups.at(-1)!;
  expect(extra).toEqual({
    id: RELATIONSHIP_UNASSIGNED_GROUP_ID,
    label: 'Unassigned',
    value: null,
    memberIds: [ids[1], ids[4]],
    origin: 'unassigned',
  });
  expect(partition.groups.slice(0, -1).every((g) => !('origin' in g))).toBe(true);
  // The requested count covers similarity groups only.
  expect(() => relationshipPartition(fit, fitted.length + 1, 'set')).toThrow();
  service.group(2);
  const stored = state().population.partition!;
  expect(stored.groups.map((g) => g.id)).toEqual(['similarity-0', 'similarity-1', 'unassigned']);
  expect(stored.groups.flatMap((g) => g.memberIds).sort()).toEqual([...ids].sort());
});
it('keeps v1 fits and partitions unchanged when the new fields are absent', () => {
  const source = relationshipSource().source!;
  const v1 = syntheticFit({ members: source.members, mask: null, region: null, distance: 'effect' });
  expect(v1.fittedMemberIds).toBeUndefined();
  expect(v1.request.eligibility).toBeUndefined();
  expect(validRelationshipFit(v1)).toBe(true);
  const ids = v1.request.members.map((m) => m.memberId);
  expect(relationshipFittedIds(v1)).toEqual(ids);
  const partition = relationshipPartition(v1, 2, 'set');
  expect(partition.groups.map((g) => g.id)).toEqual(['similarity-0', 'similarity-1']);
  expect(partition.groups.every((g) => !('origin' in g))).toBe(true);
});
it('refuses inconsistent fitted/unassigned shapes', () => {
  const source = relationshipSource().source!;
  const request: RelationshipRequest = {
    members: source.members,
    mask: null,
    region: null,
    distance: 'effect',
  };
  const fit = syntheticV2Fit(request, [2]);
  expect(validRelationshipFit(fit)).toBe(true);
  const broken = (edit: (f: RelationshipFit) => void) => {
    const copy = structuredClone(fit);
    edit(copy);
    return validRelationshipFit(copy);
  };
  expect(broken((f) => delete f.request.eligibility)).toBe(false);
  expect(broken((f) => f.fittedMemberIds!.push(f.unassigned![0].memberId))).toBe(false);
  expect(broken((f) => f.fittedMemberIds!.reverse())).toBe(false);
  expect(broken((f) => (f.unassigned = []))).toBe(false);
  expect(broken((f) => (f.unassigned![0].finiteCount = 3))).toBe(false);
  expect(broken((f) => (f.unassigned![0].supportLossVoxels = f.commonVoxels + 1))).toBe(false);
  expect(broken((f) => (f.unassigned![0].reason = { kind: 'other' } as never))).toBe(false);
  expect(broken((f) => (f.request.eligibility = { lowCoverageTau: 2 }))).toBe(false);
  // Geometry must be sized to fitted members, not the context.
  expect(broken((f) => (f.geometry = syntheticFit(request).geometry))).toBe(false);
  // Unassigned members may fall below the common support; fitted members may not.
  expect(broken((f) => (f.finiteCounts[0] = f.commonVoxels - 1))).toBe(false);
  const v2 = syntheticV2Fit(request, [1, 4]);
  expect(validRelationshipFit(v2)).toBe(true);
  const edited = (edit: (f: RelationshipFit) => void) => {
    const copy = structuredClone(v2);
    edit(copy);
    return validRelationshipFit(copy);
  };
  // Zero variance is a pattern-shape reason only.
  expect(edited((f) => (f.unassigned![0].reason = { kind: 'zeroVarianceOnSupport' }))).toBe(false);
  // A low-coverage member is below tau times the median.
  expect(edited((f) => (f.unassigned![1].reason = { kind: 'lowCoverage', fraction: 0.9 }))).toBe(false);
  // A member without finite values would remove the whole common support.
  expect(edited((f) => (f.unassigned![0].supportLossVoxels = 10))).toBe(false);
  expect(edited((f) => Object.assign(f.unassigned![0], { note: 'x' }))).toBe(false);
  expect(edited((f) => Object.assign(f.unassigned![0].reason, { fraction: 0.1 }))).toBe(false);
  const shape = syntheticV2Fit({ ...request, distance: 'pattern-shape' }, [2]);
  shape.unassigned![0].reason = { kind: 'zeroVarianceOnSupport' };
  expect(validRelationshipFit(shape)).toBe(true);
});
it('refuses to explain an unassigned member before calling the backend', async () => {
  const source = relationshipSource().source!;
  const fit = syntheticV2Fit({ members: source.members, mask: null, region: null, distance: 'effect' }, [2]);
  const id = fit.unassigned![0].memberId;
  await expect(
    explainRelationship(
      fit,
      { field: { kind: 'pair', a: fit.fittedMemberIds![0], b: id }, crosshairMm: [0, 0, 0], orientation: 'axial' },
      new AbortController().signal,
    ),
  ).rejects.toThrow(/unassigned/);
  await expect(
    explainRelationship(
      fit,
      { field: { kind: 'reconstruction', member: id, components: 0 }, crosshairMm: [0, 0, 0], orientation: 'axial' },
      new AbortController().signal,
    ),
  ).rejects.toThrow(/unassigned/);
});
it('keeps two saved n = 128 fits within the 1 MiB export context budget', () => {
  const n = 128;
  const members = Array.from({ length: n }, (_, i) => ({
    memberId: `sub-${String(i).padStart(3, '0')}_ses-01_task-memory_contrast`,
    sourcePath: `/data/derivatives/firstlevel/sub-${i}/ses-01/func/contrast_effect_size.nii.gz`,
    stackIndex: i,
  }));
  const fit = syntheticV2Fit({ members, mask: null, region: null, distance: 'effect' }, [5, 6]);
  const m = n - 2;
  // Full double-precision values, as Rust serializes them.
  const value = (i: number, j: number) => Math.abs(Math.sin(i * 12.9898 + j * 78.233)) * 1234.5678901234;
  fit.geometry.distances = Array.from({ length: m }, (_, i) =>
    Array.from({ length: m }, (_, j) => (i === j ? 0 : value(Math.min(i, j), Math.max(i, j)))),
  );
  fit.geometry.componentScores = Array.from({ length: m }, (_, i) =>
    Array.from({ length: 8 }, (_, a) => value(i, a) - 600),
  );
  fit.geometry.coordinates = fit.geometry.componentScores.map((r) => [r[0], r[1]]);
  fit.geometry.eigenvalues = Array.from({ length: m }, (_, i) => value(i, -1));
  fit.geometry.merges = fit.geometry.merges.map((merge, i) => ({ ...merge, distance: value(i, 3) }));
  const bytes = new TextEncoder().encode(
    JSON.stringify({ relationship: fit, orderRelationship: fit }),
  ).length;
  // About 0.72 MB for two fits; the rest of the context must fit in the remainder.
  expect(bytes).toBeLessThan(1024 * 1024);
});

it('summarizes unassigned members and toggles selection only for fitted members', async () => {
  const service = new PopulationRelationshipService(async (q) => syntheticV2Fit(q, [1, 4]));
  await service.fit('effect');
  const fit = service.getSnapshot().fit!;
  expect(relationshipUnassignedSummary(fit)).toBe(
    '2 observations unassigned (1 no finite values, 1 low coverage). Coverage is computed over the fitted maps.',
  );
  expect(relationshipUnassignedSummary(syntheticFit(fit.request))).toBeNull();
  const before = resolvePopulation(state()).workingMemberIds;
  service.toggle(fit.unassigned![0].memberId);
  expect(resolvePopulation(state()).workingMemberIds).toEqual(before);
  const fitted = fit.fittedMemberIds![0];
  service.toggle(fitted);
  expect(resolvePopulation(state()).workingMemberIds).not.toEqual(before);
});
it('keeps the unassigned group out of comparison operands and validates its origin', async () => {
  const service = new PopulationRelationshipService(async (q) => syntheticV2Fit(q, [1, 4]));
  await service.fit('effect');
  const fit = service.getSnapshot().fit!;
  service.group(2);
  const partition = state().population.partition!;
  expect(comparableGroups(partition).map((g) => g.id)).toEqual(['similarity-0', 'similarity-1']);
  expect(unassignedGroup(partition)?.memberIds).toEqual(fit.unassigned!.map((u) => u.memberId));
  const workspace = useViewStateStore.getState().activeWorkspaceKey;
  const query = buildPopulationSliceQuery(state(), workspace, {
    crosshairMm: [0, 0, 0],
    orientation: 'axial',
    dimPx: [16, 16],
    zoom: 1,
    summary: 'mean',
  }).query!;
  expect(query.request.groups?.map((g) => g.id)).toEqual(['similarity-0', 'similarity-1']);
  const context = partition.contextIds;
  const withOrigin = (edit: (p: typeof partition) => unknown) => {
    const copy = structuredClone(partition) as unknown as typeof partition;
    edit(copy);
    return validatePopulationPartition(copy, partition.setId, context);
  };
  expect(withOrigin(() => undefined)).toBeNull();
  // origin is accepted only on the unassigned group of a map-derived partition.
  expect(
    withOrigin((p) => Object.assign(p.groups[0], { origin: 'unassigned' })),
  ).not.toBeNull();
  expect(
    withOrigin((p) => Object.assign(p.groups.at(-1)!, { origin: 'similarity' })),
  ).not.toBeNull();
  expect(
    withOrigin((p) => Object.assign(p, { origin: 'metadata', fitId: undefined })),
  ).not.toBeNull();
});

it('labels unassigned reasons, reports the coverage median and exposes one usability predicate', async () => {
  const service = new PopulationRelationshipService(async (q) => syntheticV2Fit(q, [1, 4]));
  expect(relationshipUsable(service)).toBe(false);
  await service.fit('effect');
  const fit = service.getSnapshot().fit!;
  expect(fit.unassigned!.map((u) => relationshipUnassignedReasonLabel(u.reason))).toEqual([
    'No finite values',
    'Low coverage · 42% of the median',
  ]);
  expect(relationshipUnassignedReasonLabel({ kind: 'zeroVarianceOnSupport' })).toBe(
    'Constant on the shared voxels',
  );
  // Finite counts 95, 0, 95, 95, 40, 95: median over the non-missing five is 95.
  expect(relationshipCoverageMedian(fit)).toBe(95);
  expect(relationshipCoverageMedian({ ...fit, finiteCounts: [10, 0, 20, 30, 40, 0] })).toBe(25);
  expect(
    relationshipCoverageMedian(syntheticFit({ ...fit.request, eligibility: undefined })),
  ).toBeNull();
  expect(relationshipUsable(service)).toBe(true);
  expect(service.usableFit()).toBe(fit);
  service.observeSources(
    fit.request.members.map((m) => ({ memberId: m.memberId, revision: { sha256: 'd'.repeat(64) } })),
  );
  expect(relationshipUsable(service)).toBe(false);
  expect(service.currentUnassigned()).toBeNull();
});
