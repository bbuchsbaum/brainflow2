import { describe, expect, it } from 'vitest';
import {
  describePopulationExclusion,
  resolvePopulationContext,
  resolvePopulationContextDetail,
  type PopulationContextHost,
} from '../populationContext';
import {
  probeUnavailableIds,
  resolveObservationStatuses,
  resolvePopulationPreview,
  type PopulationPreviewInput,
} from '../observationStatus';
import type { SpatialFieldSetSummary, StudioCohortSummary, StudioSelection } from '@/types/studio';

const ids = ['s1', 's2', 's3', 's4', 's5', 's6'];
const cohort = (id: string, memberIds: string[]): StudioCohortSummary => ({
  id,
  label: id === 'young' ? 'Young controls' : id,
  description: '',
  memberCount: memberIds.length,
  memberIds,
  originKind: 'imported',
  originLabel: 'Fixture',
});

function host(
  overrides: Partial<PopulationContextHost> = {},
  setPatch = {},
): PopulationContextHost {
  const set = {
    id: 'set',
    memberIds: ids,
    savedCohortIds: ['young', 'bad'],
    designColumns: ['group', 'site'],
    memberSummaries: ids.map((id) => ({ id, sourcePath: `/${id}.nii` })),
    designTablePreview: {
      columns: ['group', 'site'],
      rows: ids.map((id, i) => ({ id, cells: [i < 3 ? 'A' : 'B', i % 2 ? 'x' : 'y'] })),
    },
    ...setPatch,
  } as unknown as SpatialFieldSetSummary;
  return {
    sets: { set },
    cohorts: { young: cohort('young', ['s1', 's2', 's4']), bad: cohort('bad', ['s1', 'zz']) },
    selection: { activeSetId: 'set', activeScopeCohortId: null } as StudioSelection,
    activeDesignFilters: [],
    ...overrides,
  };
}

describe('context exclusion reasons', () => {
  it('names the scope cohort for observations outside it, in dataset order', () => {
    const h = host({
      selection: { activeSetId: 'set', activeScopeCohortId: 'young' } as StudioSelection,
    });
    const detail = resolvePopulationContextDetail(h);
    expect(detail.memberIds).toEqual(['s1', 's2', 's4']);
    expect(detail.excluded.map((e) => e.memberId)).toEqual(['s3', 's5', 's6']);
    expect(detail.excluded[0].reason).toEqual({
      kind: 'scope',
      cohortId: 'young',
      cohortLabel: 'Young controls',
    });
    expect(describePopulationExclusion(detail.excluded[0].reason)).toBe(
      'Outside the scope cohort Young controls',
    );
  });

  it('names the failing filter column, value and the observed value', () => {
    const detail = resolvePopulationContextDetail(
      host({ activeDesignFilters: [{ column: 'group', value: 'A' }] }),
    );
    expect(detail.memberIds).toEqual(['s1', 's2', 's3']);
    expect(detail.excluded).toEqual(
      ['s4', 's5', 's6'].map((memberId) => ({
        memberId,
        reason: { kind: 'filter', column: 'group', value: 'A', observed: 'B' },
      })),
    );
    expect(describePopulationExclusion(detail.excluded[0].reason)).toBe('Filter group = A (has B)');
  });

  it('gives scope precedence and reports the first failing filter', () => {
    const detail = resolvePopulationContextDetail(
      host({
        selection: { activeSetId: 'set', activeScopeCohortId: 'young' } as StudioSelection,
        activeDesignFilters: [
          { column: 'group', value: 'A' },
          { column: 'site', value: 'y' },
        ],
      }),
    );
    // Scope keeps s1, s2, s4; group=A drops s4; site=y drops s2.
    expect(detail.memberIds).toEqual(['s1']);
    expect(detail.excluded.map((e) => [e.memberId, e.reason.kind])).toEqual([
      ['s2', 'filter'],
      ['s3', 'scope'],
      ['s4', 'filter'],
      ['s5', 'scope'],
      ['s6', 'scope'],
    ]);
    expect(detail.excluded[0].reason).toMatchObject({ column: 'site', value: 'y', observed: 'x' });
    expect(detail.excluded[2].reason).toMatchObject({ column: 'group', value: 'A' });
  });

  it('reports a whole-context issue once, with no per-member exclusions', () => {
    for (const h of [
      host({ selection: { activeSetId: 'set', activeScopeCohortId: 'bad' } as StudioSelection }),
      host({ activeDesignFilters: [{ column: 'missing', value: 'A' }] }),
      host({}, { memberIds: ['s1', 's1'] }),
    ]) {
      const detail = resolvePopulationContextDetail(h);
      expect(detail.issue).toBeTruthy();
      expect(detail.memberIds).toEqual([]);
      expect(detail.excluded).toEqual([]);
      const statuses = resolveObservationStatuses({
        memberIds: ids,
        context: detail,
        workingMemberIds: [],
      });
      expect(statuses.issue).toBe(detail.issue);
      expect(statuses.outside).toEqual([]);
      expect([...statuses.byId.values()].every((s) => !s.inContext && s.exclusion === null)).toBe(
        true,
      );
    }
  });

  it('keeps the existing context result shape for current callers', () => {
    const h = host({ activeDesignFilters: [{ column: 'group', value: 'B' }] });
    expect(resolvePopulationContext(h)).toEqual({ memberIds: ['s4', 's5', 's6'], issue: null });
    expect(resolvePopulationContextDetail(host()).excluded).toEqual([]);
  });
});

describe('observation facets', () => {
  const context = resolvePopulationContextDetail(
    host({ activeDesignFilters: [{ column: 'group', value: 'A' }] }),
  );

  it('returns co-occurring flags rather than one label', () => {
    const statuses = resolveObservationStatuses({
      memberIds: ids,
      context,
      workingMemberIds: ['s1', 's2'],
      preview: { holding: true, memberIds: ['s1', 's3'] },
      unavailableAtProbe: ['s1', 's5'],
      unassigned: [{ memberId: 's1', reason: { kind: 'lowCoverage', fraction: 0.5 } }],
    });
    expect(statuses.byId.get('s1')).toEqual({
      memberId: 's1',
      inContext: true,
      exclusion: null,
      selected: true,
      previewedOut: true,
      unavailableAtProbe: true,
      unassigned: { kind: 'lowCoverage', fraction: 0.5 },
    });
    expect(statuses.byId.get('s2')).toMatchObject({
      selected: true,
      previewedOut: false,
      unavailableAtProbe: false,
      unassigned: null,
    });
    expect(statuses.byId.get('s3')).toMatchObject({ selected: false, previewedOut: true });
    // Outside the context: only the exclusion applies, never a probe or fit facet.
    expect(statuses.byId.get('s5')).toEqual({
      memberId: 's5',
      inContext: false,
      exclusion: { kind: 'filter', column: 'group', value: 'A', observed: 'B' },
      selected: false,
      previewedOut: false,
      unavailableAtProbe: false,
      unassigned: null,
    });
    expect(statuses.outside.map((s) => s.memberId)).toEqual(['s4', 's5', 's6']);
  });

  it('marks nothing previewed out unless the preview is held', () => {
    const statuses = resolveObservationStatuses({
      memberIds: ids,
      context,
      workingMemberIds: ['s1'],
      preview: { holding: false, memberIds: ['s1'] },
    });
    expect([...statuses.byId.values()].some((s) => s.previewedOut)).toBe(false);
  });

  it('treats missing and non-finite probe values as unavailable', () => {
    expect(
      probeUnavailableIds([
        { member: 'a', value: 1 },
        { member: 'b', value: null },
        { member: 'c', value: Number.NaN },
        { member: 'd' },
      ]),
    ).toEqual(['b', 'c', 'd']);
  });
});

describe('preview target expansion', () => {
  const base: PopulationPreviewInput = {
    preview: { target: null, holding: true },
    contextMemberIds: ['s1', 's2', 's3', 's4'],
    focusedId: 's2',
    participantIdentity: null,
    participantReduction: null,
    partition: null,
    cohorts: { young: cohort('young', ['s1', 's4', 's6']) },
  };
  const identity = new Map([
    ['s1', 'p1'],
    ['s2', 'p1'],
    ['s3', 'p2'],
    ['s4', 'p1'],
  ]);

  it('defaults to the focused observation', () => {
    const preview = resolvePopulationPreview(base);
    expect(preview).toMatchObject({
      kind: 'observation',
      participant: false,
      members: null,
      label: 'focused observation',
      memberIds: ['s2'],
    });
  });

  it('defaults to the focused participant under a participant reduction', () => {
    const preview = resolvePopulationPreview({
      ...base,
      participantIdentity: identity,
      participantReduction: 'mean',
    });
    expect(preview).toMatchObject({ kind: 'participant', memberIds: ['s1', 's2', 's4'] });
    expect(
      resolvePopulationPreview({
        ...base,
        participantIdentity: identity,
        participantReduction: 'observations',
      }).kind,
    ).toBe('observation');
  });

  it('expands a saved set within the context and keeps its full members for the request', () => {
    const preview = resolvePopulationPreview({
      ...base,
      preview: { target: { kind: 'set', cohortId: 'young' }, holding: true },
    });
    expect(preview.kind).toBe('set');
    expect(preview.members?.memberIds).toEqual(['s1', 's4', 's6']);
    expect(preview.memberIds).toEqual(['s1', 's4']);
    expect(preview.label).toBe('Young controls (3 observations)');
  });

  it('expands a group and falls back to the focused observation when it is gone', () => {
    const partition = {
      setId: 'set',
      column: 'g',
      contextIds: base.contextMemberIds,
      origin: 'metadata' as const,
      groups: [{ id: 'g1', label: 'Group one', value: 'x', memberIds: ['s3'] }],
    };
    const target = { kind: 'group' as const, groupId: 'g1' };
    expect(
      resolvePopulationPreview({ ...base, partition, preview: { target, holding: false } }),
    ).toMatchObject({ kind: 'group', memberIds: ['s3'], holding: false });
    expect(
      resolvePopulationPreview({ ...base, preview: { target, holding: false } }),
    ).toMatchObject({ kind: 'observation', memberIds: ['s2'] });
  });
});
