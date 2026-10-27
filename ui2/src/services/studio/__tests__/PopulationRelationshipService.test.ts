import { beforeEach, expect, it, vi } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import {
  PopulationRelationshipService,
  relationshipSource,
  relationshipPartition,
  validRelationshipFit,
  type RelationshipFit,
  type RelationshipRequest,
} from '../PopulationRelationshipService';
import { resolvePopulation } from '../populationContext';
const state = () => useSetStudioStore.getState();
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  state().loadDemoSession();
});
export function syntheticFit(request: RelationshipRequest): RelationshipFit {
  const n = request.members.length;
  return {
    fitId: 'f'.repeat(64),
    supportSha256: 'b'.repeat(64),
    request: {
      ...request,
      members: request.members.map((m) => ({ ...m, expectedSha256: 'a'.repeat(64) })),
      mask: request.mask ? { ...request.mask, expectedSha256: 'c'.repeat(64) } : null,
    },
    candidateVoxels: 100,
    commonVoxels: 90,
    finiteCounts: Array(n).fill(95),
    dimensions: [5, 5, 4],
    affine: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ],
    geometry: {
      coordinates: request.members.map((_, i) => [i, 0]),
      distances: request.members.map((_, i) => request.members.map((_, j) => Math.abs(i - j))),
      eigenvalues: [n, ...Array(n - 1).fill(0)],
      stress: 0,
      explainedFraction: 1,
      orderable: true,
      merges: Array.from({ length: n - 1 }, (_, i) => ({
        left: i === 0 ? 0 : n + i - 1,
        right: i + 1,
        count: i + 2,
        distance: i + 1,
      })),
    },
  };
}
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
