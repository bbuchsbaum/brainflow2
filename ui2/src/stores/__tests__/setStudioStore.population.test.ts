import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetStudioStore } from '../setStudioStore';
import { resolvePopulation, resolvePopulationContext } from '@/services/studio/populationContext';
import type { PopulationProbe, PopulationRelationship } from '@/types/population';

const store = () => useSetStudioStore.getState();
const snapshot = () => resolvePopulation(store());
const ids = ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'];
const probe: PopulationProbe = {
  supportKey: 'support:v1',
  worldMm: [12, -18, 6],
  radiusMm: 0,
  reduce: 'mean',
};
const fit = (): PopulationRelationship => ({
  fitId: 'fit-1',
  sessionRevision: store().population.sessionRevision,
  featureId: store().selection.activeFeatureId!,
  supportKey: 'support:v1',
  contextMemberIds: ids,
  distance: 'effect',
});

function bootstrap() {
  store().loadDemoSession();
  const state = store();
  const set = state.sets[state.selection.activeSetId!];
  state.bootstrapStudio({
    set: {
      ...set,
      memberCount: ids.length,
      savedCohortIds: ['reference'],
      designTablePreview: {
        columns: ['subject', 'group'],
        rows: ids.map((id, i) => ({ id, cells: [id, i < 3 ? 'A' : 'B'] })),
      },
    },
    features: Object.values(state.features),
    expressions: [],
    cohorts: [
      {
        id: 'reference',
        label: 'Reference',
        description: '',
        memberCount: 2,
        memberIds: ids.slice(0, 2),
        originKind: 'imported',
        originLabel: 'Fixture',
      },
    ],
    selection: { activeMemberId: ids[0], compareCohortId: 'reference' },
  });
}

beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  bootstrap();
});

describe('population state independence', () => {
  it('keeps an explicit empty selection distinct from the full context', () => {
    expect(snapshot().workingMemberIds).toEqual(ids);
    expect(store().selectPopulationMembers([])).toEqual({ ok: true });
    expect(snapshot().workingMemberIds).toEqual([]);
    store().setPopulationReferenceMode('complement');
    expect(snapshot().referenceMemberIds).toEqual(ids);
    store().selectPopulationContext();
    expect(snapshot().workingMemberIds).toEqual(ids);
    expect(snapshot().referenceMemberIds).toEqual([]);
  });

  it('canonicalizes selection IDs and rejects duplicate/foreign IDs atomically', () => {
    const input = [ids[3], ids[0]];
    store().selectPopulationMembers(input);
    input.push(ids[5]);
    expect(snapshot().workingMemberIds).toEqual([ids[0], ids[3]]);
    const before = store().population;
    expect(store().selectPopulationMembers([ids[0], ids[0]]).ok).toBe(false);
    expect(store().selectPopulationMembers(['absent']).ok).toBe(false);
    expect(store().population).toBe(before);
  });

  it('changes focus without changing selection, reference, probe or relationship', () => {
    store().selectPopulationMembers(ids.slice(0, 3));
    store().setPopulationProbe(probe, 'pin');
    store().setPopulationRelationship(fit());
    const population = store().population;
    store().setActiveMember(ids[4]);
    expect(store().selection.activeMemberId).toBe(ids[4]);
    expect(store().population).toBe(population);
    store().setActiveMember('absent');
    expect(store().selection.activeMemberId).toBe(ids[4]);
  });

  it('keeps presentation search, issue focus and ordering out of eligibility', () => {
    useSetStudioStore.setState({
      designSearch: 'missing',
      activeIssueMemberIds: [ids[5]],
      sortColumn: 'group',
      sortDirection: 'desc',
    });
    expect(snapshot().context.memberIds).toEqual(ids);
    expect(snapshot().workingMemberIds).toEqual(ids);
  });

  it('computes complement in context and never silently shrinks a fixed reference', () => {
    store().selectPopulationMembers([ids[4]]);
    useSetStudioStore.setState({ activeDesignFilters: [{ column: 'group', value: 'B' }] });
    expect(snapshot().referenceMemberIds).toEqual(ids.slice(0, 2));
    expect(snapshot().referenceIssue).toMatch(/ineligible/);
    store().setPopulationReferenceMode('complement');
    expect(snapshot().referenceMemberIds).toEqual([ids[3], ids[5]]);
    expect(snapshot().referenceIssue).toBeNull();
    store().setCompareCohort('reference');
    expect(store().population.referenceMode).toBe('cohort');
  });

  it('preserves out-of-context selections for restoration and reports them', () => {
    store().selectPopulationMembers([ids[0], ids[4]]);
    useSetStudioStore.setState({ activeDesignFilters: [{ column: 'group', value: 'B' }] });
    expect(snapshot().workingMemberIds).toEqual([ids[4]]);
    expect(snapshot().selectionOutsideContext).toEqual([ids[0]]);
    store().clearDesignFilters();
    expect(snapshot().workingMemberIds).toEqual([ids[0], ids[4]]);
  });

  it('supports set algebra with exploratory origin and independent undo/redo', () => {
    store().selectPopulationMembers([ids[0], ids[1]], 'map-derived');
    store().combinePopulationMembers('union', [ids[2]]);
    expect(snapshot().workingMemberIds).toEqual(ids.slice(0, 3));
    store().combinePopulationMembers('intersection', [ids[1], ids[2], ids[3]]);
    expect(snapshot().workingMemberIds).toEqual([ids[1], ids[2]]);
    store().combinePopulationMembers('difference', [ids[2]]);
    expect(snapshot().workingMemberIds).toEqual([ids[1]]);
    expect(store().population.working).toMatchObject({ origin: 'map-derived' });
    store().setActiveMember(ids[5]);
    store().setPopulationProbe(probe, 'pin');
    store().undoPopulationSelection();
    expect(snapshot().workingMemberIds).toEqual([ids[1], ids[2]]);
    store().redoPopulationSelection();
    expect(snapshot().workingMemberIds).toEqual([ids[1]]);
    expect(store().selection.activeMemberId).toBe(ids[5]);
    expect(snapshot().probe).toEqual(probe);
    store().undoPopulationSelection();
    store().selectPopulationMembers([]);
    expect(store().population.selectionFuture).toEqual([]);
    for (let i = 0; i < 50; i++) store().selectPopulationMembers([ids[i % ids.length]]);
    expect(store().population.selectionPast).toHaveLength(40);
  });

  it('pins a copied probe, suppresses identical updates and rejects invalid geometry', () => {
    const input: PopulationProbe = { ...probe, worldMm: [...probe.worldMm] };
    store().setPopulationProbe(input, 'pin');
    expect(store().population.pinnedProbe?.worldMm).not.toBe(input.worldMm);
    const listener = vi.fn();
    const unsubscribe = useSetStudioStore.subscribe(listener);
    store().setPopulationProbe(probe, 'pin');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    store().setPopulationProbe({ ...probe, worldMm: [0, 0, 0] }, 'hover');
    expect(snapshot().probe).toEqual(probe);
    const before = store().population;
    expect(store().setPopulationProbe({ ...probe, worldMm: [NaN, 0, 0] }, 'pin').ok).toBe(false);
    expect(store().setPopulationProbe({ ...probe, radiusMm: -1 }, 'pin').ok).toBe(false);
    expect(store().population).toBe(before);
    store().setPopulationProbe(null, 'pin');
    expect(snapshot().probe?.worldMm).toEqual([0, 0, 0]);
  });

  it('keeps fit geometry fixed during selection/probing and rejects stale fits on reimport', () => {
    const relationship = fit();
    expect(store().setPopulationRelationship(relationship).ok).toBe(true);
    const stored = store().population.relationship;
    store().selectPopulationMembers([ids[3]]);
    store().setPopulationProbe(probe, 'hover');
    expect(store().population.relationship).toBe(stored);
    expect(
      store().setPopulationRelationship({ ...relationship, contextMemberIds: ids.slice(1) }).ok,
    ).toBe(false);
    expect(store().setPopulationRelationship({ ...relationship, featureId: 'wrong' }).ok).toBe(
      false,
    );
    const generation = store().population.sessionRevision;
    bootstrap();
    expect(store().population.sessionRevision).toBeGreaterThan(generation);
    expect(store().population.relationship).toBeNull();
    expect(store().population.selectionPast).toEqual([]);
    expect(store().population.hoverProbe).toBeNull();
    expect(store().setPopulationRelationship(relationship).ok).toBe(false);
  });
});

describe('population metadata contract', () => {
  it.each(['missing-column', 'missing-row', 'duplicate-row', 'duplicate-column', 'ragged-row'])(
    'refuses ambiguous/incomplete metadata: %s',
    (problem) => {
      const state = store();
      const id = state.selection.activeSetId!;
      const set = structuredClone(state.sets[id]);
      const table = set.designTablePreview!;
      if (problem === 'missing-row') table.rows.pop();
      if (problem === 'duplicate-row') table.rows.push(table.rows[0]);
      if (problem === 'duplicate-column') table.columns[0] = 'group';
      if (problem === 'ragged-row') table.rows[0].cells.pop();
      useSetStudioStore.setState({
        sets: { ...state.sets, [id]: set },
        activeDesignFilters: [
          { column: problem === 'missing-column' ? 'absent' : 'group', value: 'A' },
        ],
      });
      expect(resolvePopulationContext(store()).issue).not.toBeNull();
      expect(snapshot().workingMemberIds).toEqual([]);
      expect(store().activeDesignFilters).toHaveLength(1);
    },
  );
});
