import { describe, expect, it, vi } from 'vitest';
import {
  buildStudioComparePaneSpecs,
  presentComparePaneSpecs,
  StudioCompareService,
} from '../StudioCompareService';
import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioComparePaneSpec,
  StudioFieldExpressionSummary,
  StudioMemberSummary,
} from '@/types/studio';
import { folderCandidate } from './studioFixtures';

function folderSet(checked: boolean): SpatialFieldSetSummary {
  const candidate = folderCandidate({ checked });
  return {
    ...candidate.set,
    importContract: candidate.contract,
    discoveryRequest: {
      root: candidate.discovery!.root,
      filePattern: candidate.discovery!.filePattern,
      includePatterns: [],
      excludePatterns: [],
      rolePatterns: [],
      requiredRoles: [],
      maxDepth: 4,
      maxFiles: 500,
    },
  };
}

const unchecked = folderSet(false);
const ready = folderSet(true);
const member: StudioMemberSummary = {
  id: 'sub-1006',
  sourcePath: '/cache/mount-a/pcmri/derivatives/enc_rep_rsa/sub-1006/enc_rep/maps/same_item.nii.gz',
};
const group: StudioCohortSummary = {
  id: 'all-members',
  label: 'All members',
  memberCount: 3,
  description: '',
  memberIds: ['sub-1006', 'sub-1007', 'sub-1008'],
  originKind: 'imported',
  originLabel: null,
};
const comparison: StudioFieldExpressionSummary = {
  id: 'z',
  label: 'Z-score',
  kind: 'comparison',
  recipe: 'zscore(current, cohort:all-members)',
  cohortId: 'all-members',
};

const JARGON = /ingest|audit|compare-safe|cohort|bound\b|reducer|materializ|expression|binding/i;
const pane = (specs: StudioComparePaneSpec[], id: string) => specs.find((spec) => spec.id === id)!;

/** What the backend answers for a set whose grids it was told are not confirmed. */
function backendBlocked(): StudioComparePaneSpec[] {
  const derived = (id: string, title: string, reason: string): StudioComparePaneSpec => ({
    id,
    title,
    subtitle: '35 members',
    status: 'blocked',
    reason,
    recipe: null,
    binding: {
      kind: 'derived_field',
      ready: false,
      sourcePath: null,
      materializationKey: null,
      materializedAtMs: null,
      cacheStatus: 'unavailable',
      cacheMessage: '',
      provenancePath: null,
    },
  });
  return [
    {
      id: 'current',
      title: 'sub-1006',
      subtitle: 'headers not sampled',
      status: 'live',
      reason: 'Bound to a concrete member source path.',
      recipe: 'member(sub-1006)',
      binding: {
        kind: 'member_source',
        ready: true,
        sourcePath: member.sourcePath ?? null,
        materializationKey: null,
        materializedAtMs: null,
        cacheStatus: 'source',
        cacheMessage: '',
        provenancePath: null,
      },
    },
    derived('cohort-mean', 'All members', 'Set ingest audit does not yet permit compare-safe reductions.'),
    derived('residual', 'Residual', 'Needs a bound current member and compare-safe cohort.'),
    derived('zscore', 'Z-score', 'Needs an active comparison expression and compare-safe cohort.'),
  ];
}

describe('Compare panes that are not ready are not failed', () => {
  it('marks panes waiting on the grid check, in plain words, whoever built them', async () => {
    const args = {
      activeSet: unchecked,
      activeMember: member,
      compareCohort: group,
      activeExpression: comparison,
    };
    const local = buildStudioComparePaneSpecs(args);
    // The backend's own wording never reaches the pane.
    const service = new StudioCompareService({
      invoke: vi.fn(async (command: string) =>
        command === 'start_set_studio_compare_materialization'
          ? 'job-1'
          : { state: 'completed', result: backendBlocked() },
      ),
    } as never);
    const remote = await service.materializeComparePanes(args);

    for (const specs of [local, remote]) {
      for (const id of ['cohort-mean', 'residual', 'zscore']) {
        expect(pane(specs, id).notReady).toEqual({
          kind: 'grid-check',
          message: 'Image grids have not been checked yet.',
        });
        expect(pane(specs, id).reason).toBe('Image grids have not been checked yet.');
      }
      expect(pane(specs, 'current').notReady).toBeNull();
      for (const spec of specs)
        expect(`${spec.title} ${spec.subtitle} ${spec.reason}`).not.toMatch(JARGON);
    }
  });

  it('says each fact once: the member in the title, the set-wide grid nowhere in a pane', () => {
    const specs = buildStudioComparePaneSpecs({
      activeSet: unchecked,
      activeMember: member,
      compareCohort: group,
      activeExpression: comparison,
    });
    expect(pane(specs, 'current')).toMatchObject({ title: 'sub-1006', subtitle: 'Current member' });
    expect(pane(specs, 'cohort-mean')).toMatchObject({ title: 'All members', subtitle: 'Mean' });
    expect(pane(specs, 'residual')).toMatchObject({ title: 'Residual', subtitle: 'Current − mean' });
    expect(pane(specs, 'zscore').subtitle).toBe('(Current − mean) / SD');
    for (const spec of specs) expect(spec.subtitle).not.toContain('headers not sampled');
    for (const spec of specs.slice(1)) expect(spec.subtitle).not.toContain('sub-1006');
  });

  it('names the input that is missing: a group, a member, a comparison', () => {
    const noGroup = buildStudioComparePaneSpecs({
      activeSet: ready,
      activeMember: member,
      compareCohort: null,
      activeExpression: comparison,
    });
    for (const id of ['cohort-mean', 'residual', 'zscore'])
      expect(pane(noGroup, id).notReady).toEqual({
        kind: 'no-group',
        message: 'Choose what to compare the member with.',
      });

    const noMember = buildStudioComparePaneSpecs({
      activeSet: ready,
      activeMember: null,
      compareCohort: group,
      activeExpression: comparison,
    });
    expect(pane(noMember, 'residual').notReady).toEqual({
      kind: 'no-member',
      message: 'Choose a member to compare.',
    });
    // The mean needs no member: it is computing, not waiting.
    expect(pane(noMember, 'cohort-mean').notReady).toBeNull();

    const noComparison = buildStudioComparePaneSpecs({
      activeSet: ready,
      activeMember: member,
      compareCohort: group,
      activeExpression: null,
    });
    expect(pane(noComparison, 'zscore').notReady).toEqual({
      kind: 'no-comparison',
      message: 'Choose a comparison.',
    });
  });

  it('says different grids cannot be averaged', () => {
    const mixed: SpatialFieldSetSummary = {
      ...unchecked,
      alignmentClass: 'mixed',
      ingestAudit: {
        ...unchecked.ingestAudit,
        support: { ...unchecked.ingestAudit.support, alignmentClass: 'mixed', severity: 'warning' },
      },
    };
    const specs = buildStudioComparePaneSpecs({
      activeSet: mixed,
      activeMember: member,
      compareCohort: group,
      activeExpression: comparison,
    });
    expect(pane(specs, 'cohort-mean').notReady).toEqual({
      kind: 'different-grids',
      message: 'These images are on different grids, so they cannot be averaged.',
    });
  });

  it('keeps a real failure a failure, with its cause in plain words', () => {
    const args = {
      activeSet: ready,
      activeMember: member,
      compareCohort: group,
      activeExpression: comparison,
    };
    const failed = backendBlocked();
    failed[1].reason = 'Cohort mean materialization failed: cannot read sub-1007/same_item.nii.gz';
    failed[2].reason =
      'Residual materialization failed: Needs a materialized cohort mean before residuals can be computed.';
    const specs = presentComparePaneSpecs(args, failed);
    expect(pane(specs, 'cohort-mean')).toMatchObject({
      status: 'blocked',
      notReady: null,
      reason: 'The mean could not be computed: cannot read sub-1007/same_item.nii.gz',
    });
    // What depends on the failed mean is unavailable, not a second failure.
    expect(pane(specs, 'residual').notReady).toEqual({
      kind: 'no-mean',
      message: 'Needs the mean, which could not be computed.',
    });
  });

  it('leaves a ready pane alone', () => {
    const done = backendBlocked();
    done[1] = {
      ...done[1],
      status: 'live',
      reason: 'Derived cohort mean cache hit.',
      binding: { ...done[1].binding!, ready: true, sourcePath: '/cache/mean.nii.gz', cacheStatus: 'hit' },
    };
    const specs = presentComparePaneSpecs(
      { activeSet: ready, activeMember: member, compareCohort: group, activeExpression: comparison },
      done,
    );
    expect(pane(specs, 'cohort-mean')).toMatchObject({ status: 'live', notReady: null });
    expect(pane(specs, 'cohort-mean').binding?.sourcePath).toBe('/cache/mean.nii.gz');
  });
});
