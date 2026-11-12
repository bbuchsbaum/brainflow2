import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import {
  populationRelationshipService,
  relationshipPartition,
  validRelationshipFit,
  type RelationshipRequest,
} from '../PopulationRelationshipService';
import { comparableGroups, isOutlierGroup, validatePopulationPartition } from '../populationGroups';
import { similarityGroupingView, suggestionText } from '../similarityGroupingView';
import { syntheticFit, syntheticGroupingFit } from './relationshipFixtures';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));

const state = () => useSetStudioStore.getState();
const request = (): RelationshipRequest => ({
  members: ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'].map((memberId) => ({
    memberId,
    sourcePath: `/${memberId}.nii`,
  })),
  mask: null,
  region: null,
  distance: 'pattern-shape',
});
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  state().loadDemoSession();
  invoke.mockReset();
});
afterEach(() => populationRelationshipService.resetScope(null));

describe('grouping fits (backend v3)', () => {
  it('asks for a grouping fit only when told to, and checks the answer is one', async () => {
    invoke.mockImplementation(async (_command: string, args: { request: RelationshipRequest }) =>
      args.request.grouping ? syntheticGroupingFit(args.request) : syntheticFit(args.request),
    );
    await populationRelationshipService.fit('pattern-shape');
    expect(invoke.mock.calls.at(-1)![1].request.grouping).toBeUndefined();
    await populationRelationshipService.fit('pattern-shape', false, { grouping: true });
    expect(invoke.mock.calls.at(-1)![1].request.grouping).toEqual({});
    expect(populationRelationshipService.getSnapshot().fit?.geometry.grouping?.linkage).toBe('ward');
    // A fit kept from earlier without grouping evidence cannot serve a grouping.
    invoke.mockClear();
    await populationRelationshipService.fit('effect');
    await populationRelationshipService.fit('effect', false, { reuse: true, grouping: true });
    expect(invoke).toHaveBeenCalledTimes(2);
    // …but a grouping fit serves a plain request (an order).
    await populationRelationshipService.fit('effect', false, { reuse: true });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('refuses an answer that drops the grouping it was asked for', async () => {
    invoke.mockImplementation(async (_command: string, args: { request: RelationshipRequest }) =>
      syntheticFit({ ...args.request, grouping: undefined }),
    );
    await populationRelationshipService.fit('pattern-shape', false, { grouping: true });
    expect(populationRelationshipService.getSnapshot().error).toMatch(/does not match/);
  });

  it('validates the grouping evidence', () => {
    const fit = syntheticGroupingFit(request());
    expect(validRelationshipFit(fit)).toBe(true);
    const broken = structuredClone(fit);
    broken.geometry.grouping!.cuts[0].assignment = [0, 0, 9, 0, 0, 0];
    expect(validRelationshipFit(broken)).toBe(false);
    const wrongLinkage = structuredClone(fit);
    (wrongLinkage.request as { grouping: unknown }).grouping = { linkage: 'single' };
    expect(validRelationshipFit(wrongLinkage)).toBe(false);
  });
});

describe('cutting a grouping fit', () => {
  it('uses the backend cut and puts its singletons in Outliers, never a group', () => {
    const fit = syntheticGroupingFit(request());
    const partition = relationshipPartition(fit, 3, state().selection.activeSetId!);
    expect(partition.groups.map((g) => [g.label, g.memberIds])).toEqual([
      ['Similarity group 1', ['sub001', 'sub002']],
      ['Similarity group 2', ['sub003', 'sub004', 'sub005']],
      ['Outliers', ['sub006']],
    ]);
    const outliers = partition.groups.at(-1)!;
    expect(isOutlierGroup(partition, outliers)).toBe(true);
    // Outliers are not a comparison operand or a group mean.
    expect(comparableGroups(partition).map((g) => g.id)).toEqual(['similarity-0', 'similarity-1']);
    expect(
      validatePopulationPartition(partition, partition.setId, partition.contextIds),
    ).toBeNull();
  });

  it('keeps a saved fit without grouping evidence as it was: one-member clusters stay groups', () => {
    const fit = syntheticFit(request());
    const partition = relationshipPartition(fit, 5, state().selection.activeSetId!);
    expect(partition.groups.some((g) => g.id === 'outliers')).toBe(false);
    expect(partition.groups).toHaveLength(5);
  });
});

describe('the strip\'s grouping view (adapter)', () => {
  it('reads classes, shapes, outliers, the suggestion and the chosen cut\'s silhouette', () => {
    const fit = syntheticGroupingFit(request());
    const partition = relationshipPartition(fit, 3, state().selection.activeSetId!);
    const view = similarityGroupingView(fit, partition);
    expect(view.linkage).toBe('ward');
    expect(view.linkageName).toBe('Ward linkage clustering');
    expect(view.classes.map((c) => [c.label, c.shape, c.memberIds.length])).toEqual([
      ['Group 1', 'circle', 2],
      ['Group 2', 'square', 3],
      ['Outliers', 'diamond-hollow', 1],
    ]);
    expect(view.shapeOf.get('sub006')).toBe('diamond-hollow');
    expect(view.shownGroups).toBe(3);
    expect(view.silhouette).toBe(0.61);
    expect(view.suggestedGroups).toBe(3);
    expect(suggestionText(view)).toBe('Suggested: 3 groups');
  });

  it('says "No clear grouping" instead of a suggestion when the backend finds none', () => {
    const fit = syntheticGroupingFit(request(), { clearGrouping: false });
    const view = similarityGroupingView(fit, null);
    expect(suggestionText(view)).toBe('No clear grouping');
  });

  it('invents nothing for a fit without grouping evidence; a one-member group reads as an outlier', () => {
    const fit = syntheticFit(request());
    const partition = relationshipPartition(fit, 5, state().selection.activeSetId!);
    const view = similarityGroupingView(fit, partition);
    expect(view.linkage).toBe('average');
    expect(view.linkageName).toBe('average-linkage clustering');
    expect(view.suggestedGroups).toBeNull();
    expect(view.clearGrouping).toBeNull();
    expect(view.silhouette).toBeNull();
    expect(suggestionText(view)).toBeNull();
    expect(view.classes.at(-1)).toMatchObject({ label: 'Outliers', outliers: true });
    expect(view.shownGroups).toBe(5);
  });
});
