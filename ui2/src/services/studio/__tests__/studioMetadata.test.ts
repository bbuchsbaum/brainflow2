import { beforeEach, expect, it } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { studioMetadata } from '../studioMetadata';
import { participantIdentity } from '../populationParticipants';
import { resolvePopulationContext } from '../populationContext';
import { buildPopulationProbeQuery, populationSupportKey } from '../PopulationProbeController';
import { attachObservationMetadata } from '@/plotting/attachObservationMetadata';

beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
});
function fixture() {
  const state = useSetStudioStore.getState(),
    base = state.sets[state.selection.activeSetId!];
  const ids = Array.from({ length: 160 }, (_, i) => `row-${i + 1}`);
  return {
    ...base,
    memberIds: ids,
    memberCount: ids.length,
    designColumns: ['participant', 'site', 'condition'],
    designTablePreview: {
      columns: ['participant'],
      rows: [{ id: ids[0], cells: ['wrong-preview'] }],
    },
    memberSummaries: ids.map((id, i) => ({
      id,
      sourcePath: `/synthetic/${id}.nii`,
      designValues: {
        participant: `person-${Math.floor(i / 2) + 1}`,
        site: i < 80 ? 'A' : 'B',
        condition: i % 2 ? 'post' : 'pre',
      },
    })),
  };
}
it('retains all observations and columns independently of the compact preview', () => {
  const set = fixture(),
    metadata = studioMetadata(set);
  expect(metadata.issue).toBeNull();
  expect(metadata.rows.size).toBe(160);
  expect(metadata.rows.get('row-160')).toEqual({
    participant: 'person-80',
    site: 'B',
    condition: 'post',
  });
  expect(
    participantIdentity(set, {
      setId: set.id,
      identity: { kind: 'column', column: 'participant' },
      reduction: 'mean',
    }).get('row-1'),
  ).toBe('person-1');
  const state = useSetStudioStore.getState();
  useSetStudioStore.setState({
    sets: { ...state.sets, [set.id]: set },
    activeDesignFilters: [{ column: 'site', value: 'B' }],
  });
  expect(resolvePopulationContext(useSetStudioStore.getState()).memberIds).toEqual(
    set.memberIds.slice(80),
  );
  const supportKey = populationSupportKey(useSetStudioStore.getState(), 'workspace');
  useSetStudioStore
    .getState()
    .setPopulationProbe({ supportKey, worldMm: [0, 0, 0], radiusMm: 0, reduce: 'mean' }, 'pin');
  const query = buildPopulationProbeQuery(useSetStudioStore.getState(), 'workspace').query!;
  expect(query).not.toBeNull();
  if (query.request.locus.kind !== 'set') throw Error('Expected set');
  expect(query.request.locus.members.at(-1)?.designValues).toEqual([
    { column: 'participant', value: 'person-80' },
    { column: 'site', value: 'B' },
    { column: 'condition', value: 'post' },
  ]);
});
it('refuses incomplete or ambiguous authoritative metadata instead of repairing it from a preview', () => {
  const set = fixture();
  set.memberSummaries[0].designValues = undefined as never;
  expect(studioMetadata(set).issue).toMatch(/complete/);
  set.memberSummaries[0] = set.memberSummaries[1];
  expect(studioMetadata(set).issue).toMatch(/duplicate/);
  const invalid = fixture();
  delete (
    invalid.memberSummaries[100].designValues as Partial<
      (typeof invalid.memberSummaries)[number]['designValues']
    >
  ).site;
  expect(studioMetadata(invalid).issue).toMatch(/incomplete/);
});
it('joins plot metadata without changing grain, identity, values or uncertainty fields', () => {
  const original = {
    columns: [
      { name: 'member', role: 'nominal' as const },
      { name: 'value', role: 'quantitative' as const },
      { name: 'count', role: 'quantitative' as const },
    ],
    rows: [
      { member: 'a', value: 2, count: 4 },
      { member: 'a', value: 3, count: 5 },
      { member: 'b', value: null, count: 0 },
    ],
  };
  const frame = attachObservationMetadata(original, [
    {
      memberId: 'a',
      designValues: [
        { column: 'value', value: 'category' },
        { column: 'member', value: 'raw-id' },
        { column: 'count', value: 'metadata-count' },
        { column: 'design:value', value: 'another-category' },
        { column: 'condition', value: 'faces' },
      ],
    },
  ]);
  expect(frame.rows.map((row) => [row.member, row.value, row.count])).toEqual([
    ['a', 2, 4],
    ['a', 3, 5],
    ['b', null, 0],
  ]);
  expect(frame.rows[0]['design:value']).toBe('category');
  expect(frame.rows[0]['design:design:value']).toBe('another-category');
  expect(frame.rows[2].condition).toBeNull();
  expect(new Set(frame.columns.map((column) => column.name)).size).toBe(frame.columns.length);
  expect(frame.meta?.designColumnAliases).toMatchObject({
    value: 'design:value',
    member: 'design:member',
    count: 'design:count',
  });
  expect(original.rows[0]).toEqual({ member: 'a', value: 2, count: 4 });
  expect(() => attachObservationMetadata(original, [{ memberId: 'a' }, { memberId: 'a' }])).toThrow(
    /Duplicate/,
  );
});
