import { beforeEach, describe, expect, it } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { buildPopulationSliceQuery } from '../PopulationSliceService';
import { buildPopulationProbeQuery, describePopulationProbe } from '../PopulationProbeController';
import {
  groupParticipantMembers,
  participantIdentity,
  participantProbeFrame,
  resolvePopulationParticipants,
} from '../populationParticipants';
import type { PopulationParticipantDefinition } from '@/types/population';
import type { SampleFrame } from '@/plotting';

const store = () => useSetStudioStore.getState();
const ids = ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'];
const people = ['A', 'A', 'A', 'B', 'C', 'C'];
const options = {
  crosshairMm: [1, 1, 1] as [number, number, number],
  orientation: 'axial' as const,
  dimPx: [3, 3] as [number, number],
  zoom: 1,
  summary: 'mean' as const,
};
const definition = (
  reduction: PopulationParticipantDefinition['reduction'] = 'mean',
): PopulationParticipantDefinition => ({
  setId: store().selection.activeSetId!,
  identity: { kind: 'column', column: 'participant' },
  reduction,
});
function setFixture() {
  const state = store(),
    set = state.sets[state.selection.activeSetId!];
  return {
    ...set,
    designTablePreview: {
      columns: ['participant'],
      rows: ids.map((id, i) => ({ id, cells: [people[i]] })),
    },
  };
}
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  store().loadDemoSession();
  store().setActiveMember(ids[0]);
  const set = setFixture();
  useSetStudioStore.setState({ sets: { ...store().sets, [set.id]: set } });
});

describe('explicit participant identity and reduction', () => {
  it('joins keyed metadata independently of row order and never infers identity', () => {
    const set = setFixture();
    set.designTablePreview.rows.reverse();
    expect([...participantIdentity(set, definition())]).toEqual(
      ids.map((id, i) => [id, people[i]]),
    );
    expect(resolvePopulationParticipants(store(), ids).identity).toBeNull();
    expect(
      buildPopulationSliceQuery(store(), 'workspace', {
        ...options,
        withoutFocused: true,
        withoutParticipant: true,
      }),
    ).toMatchObject({ query: null, issue: expect.stringMatching(/declared identity/) });
    expect([
      ...participantIdentity(set, { ...definition(), identity: { kind: 'observationIds' } }),
    ]).toEqual(ids.map((id) => [id, id]));
    expect(() => participantIdentity(set, { ...definition(), setId: 'foreign' })).toThrow(
      /another dataset/,
    );
    set.designTablePreview.rows.pop();
    expect(() => participantIdentity(set, definition())).toThrow(/complete/);
  });
  it('refuses ambiguous columns, duplicate row keys and blank or padded identities', () => {
    for (const mutate of [
      (set: ReturnType<typeof setFixture>) => {
        set.designTablePreview.columns.push('participant');
      },
      (set: ReturnType<typeof setFixture>) => {
        set.designTablePreview.rows[1].id = ids[0];
      },
      (set: ReturnType<typeof setFixture>) => {
        set.designTablePreview.rows[0].cells = [''];
      },
      (set: ReturnType<typeof setFixture>) => {
        set.designTablePreview.rows[0].cells = [' A'];
      },
    ]) {
      const set = setFixture();
      mutate(set);
      expect(() => participantIdentity(set, definition())).toThrow();
    }
  });
  it('weights people equally, retains missingness and lineage, and keeps precision', () => {
    const frame: SampleFrame = {
      columns: [
        { name: 'member', role: 'nominal' },
        { name: 'value', role: 'quantitative' },
      ],
      rows: ids.map((member, i) => ({ member, value: [0, 0, 0, 8, null, NaN][i] })),
    };
    const groups = groupParticipantMembers(participantIdentity(setFixture(), definition()), ids);
    const reduced = participantProbeFrame(frame, { within: 'mean', groups });
    expect(reduced.rows).toEqual([
      { member: 'A', value: 0, observationCount: 3, validCount: 3 },
      { member: 'B', value: 8, observationCount: 1, validCount: 1 },
      { member: 'C', value: null, observationCount: 2, validCount: 0 },
    ]);
    expect(describePopulationProbe(reduced, new Set(['A', 'B', 'C']), 0)).toMatchObject({
      mean: 4,
      count: 2,
      unavailable: 1,
    });
    expect(describePopulationProbe(frame, new Set(ids), 0).mean).toBe(2);
    expect(reduced.meta?.participantGroups).toEqual(groups);
    expect(frame.rows[0].value).toBe(0);
    const huge = {
      ...frame,
      rows: [
        { member: 'x', value: -Number.MAX_VALUE },
        { member: 'y', value: Number.MAX_VALUE },
      ],
    };
    expect(
      participantProbeFrame(huge, {
        within: 'mean',
        groups: [{ participantId: 'P', memberIds: ['x', 'y'] }],
      }).rows[0].value,
    ).toBe(0);
    const precise = {
      ...frame,
      rows: [
        { member: 'x', value: 16777216 },
        { member: 'y', value: 16777218 },
      ],
    };
    expect(
      participantProbeFrame(precise, {
        within: 'mean',
        groups: [{ participantId: 'P', memberIds: ['x', 'y'] }],
      }).rows[0].value,
    ).toBe(16777217);
  });
  it('rejects invalid groups and unavailable source rows without returning a partial summary', () => {
    const frame: SampleFrame = {
      columns: [],
      rows: [
        { member: 'x', value: 1 },
        { member: 'y', value: 2 },
      ],
    };
    const a = { participantId: 'A', memberIds: ['x'] };
    for (const groups of [
      [a, a],
      [{ ...a, memberIds: [] }],
      [a, { participantId: 'B', memberIds: ['x'] }],
      [{ ...a, memberIds: ['absent'] }],
    ]) {
      expect(() => participantProbeFrame(frame, { within: 'mean', groups })).toThrow();
    }
    expect(() =>
      participantProbeFrame(frame, { within: 'single', groups: [{ ...a, memberIds: ['x', 'y'] }] }),
    ).toThrow(/repeated/);
    expect(() =>
      participantProbeFrame(
        { ...frame, rows: [frame.rows[0], frame.rows[0]] },
        { within: 'mean', groups: [a] },
      ),
    ).toThrow(/unique/);
    expect(participantProbeFrame(frame, { within: 'mean', groups: [] }).rows).toEqual([]);
  });
  it('changes only the field reduction, reuses the probe, and excludes every row of the focused person', () => {
    store().setPopulationProbe(
      { supportKey: 'native', worldMm: [1, 1, 1], radiusMm: 0, reduce: 'mean' },
      'pin',
    );
    const probe = buildPopulationProbeQuery(store(), 'workspace');
    const before = store();
    expect(store().configurePopulationParticipants(definition()).ok).toBe(true);
    expect(store().selection).toBe(before.selection);
    expect(store().population.working).toBe(before.population.working);
    expect(store().population.pinnedProbe).toBe(before.population.pinnedProbe);
    expect(buildPopulationProbeQuery(store(), 'workspace').query?.key).toBe(probe.query?.key);
    const full = buildPopulationSliceQuery(store(), 'workspace', options).query!;
    expect(full.request.aggregation?.groups.map((g) => g.memberIds.length)).toEqual([3, 1, 2]);
    const without = buildPopulationSliceQuery(store(), 'workspace', {
      ...options,
      withoutFocused: true,
      withoutParticipant: true,
    }).query!;
    expect(without.datasetKey).toBe(full.datasetKey);
    expect(without.request.workingMemberIds).toEqual(ids.slice(3));
    expect(without.request.aggregation?.groups.map((g) => g.participantId)).toEqual(['B', 'C']);
    expect(without.request.focusMemberId).toBe(ids[0]);
    expect(
      buildPopulationSliceQuery(store(), 'workspace', { ...options, withoutFocused: true }).query
        ?.request.workingMemberIds,
    ).toEqual(ids.slice(1));
    expect(store().population.working).toBe(before.population.working);
    expect(buildPopulationSliceQuery(store(), 'workspace', options).query?.key).toBe(full.key);
  });
  it('refuses repeated selections in single-row mode and recovers with a valid subset', () => {
    store().configurePopulationParticipants(definition('single'));
    expect(buildPopulationSliceQuery(store(), 'workspace', options)).toMatchObject({
      query: null,
      issue: expect.stringMatching(/one selected observation/),
    });
    store().selectPopulationMembers([ids[0], ids[3], ids[4]]);
    expect(
      buildPopulationSliceQuery(store(), 'workspace', options).query?.request.aggregation?.groups,
    ).toHaveLength(3);
    const before = store().population;
    expect(store().configurePopulationParticipants({ ...definition(), setId: 'foreign' }).ok).toBe(
      false,
    );
    expect(store().population).toBe(before);
    store().loadDemoSession();
    expect(store().population.participants).toBeNull();
  });
});
