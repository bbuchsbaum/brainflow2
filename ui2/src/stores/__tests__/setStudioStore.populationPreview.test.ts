import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetStudioStore } from '../setStudioStore';
import { useViewStateStore } from '../viewStateStore';
import { resolvePopulation } from '@/services/studio/populationContext';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { buildPopulationProbeQuery } from '@/services/studio/PopulationProbeController';
import {
  buildPopulationSliceQuery,
  PopulationImages,
  type PopulationSliceDisplay,
} from '@/services/studio/PopulationSliceService';
import { freezePopulationExport } from '@/services/studio/PopulationExportService';
import { resolveStudioObservationStatuses } from '@/services/studio/observationStatus';

vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke: vi.fn() }) }));

const store = () => useSetStudioStore.getState();
const ids = ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'];
const workspace = () => useViewStateStore.getState().activeWorkspaceKey;
const sliceOptions = {
  crosshairMm: [0, 0, 0] as [number, number, number],
  orientation: 'axial' as const,
  dimPx: [1, 1] as [number, number],
  zoom: 1,
  summary: 'mean' as const,
};

function bootstrap() {
  store().loadDemoSession();
  const state = store();
  const set = state.sets[state.selection.activeSetId!];
  state.bootstrapStudio({
    set: {
      ...set,
      memberCount: ids.length,
      savedCohortIds: ['reference', 'late'],
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
      {
        id: 'late',
        label: 'Late',
        description: '',
        memberCount: 3,
        memberIds: ids.slice(3),
        originKind: 'imported',
        originLabel: 'Fixture',
      },
    ],
    selection: { activeMemberId: ids[0], compareCohortId: 'reference' },
  });
}

function display(): PopulationSliceDisplay {
  const query = buildPopulationSliceQuery(store(), workspace(), sliceOptions).query!;
  return {
    query,
    data: {
      plane: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [1, 1] },
      centerWorld: [0, 0, 0],
      summary: [2],
      focused: [2],
      validCounts: [2],
      eligibleCount: query.request.workingMemberIds.length,
      unitCount: 2,
      contextRange: [0, 2],
      sources: query.request.members.map((m) => ({
        memberId: m.memberId,
        revision: { sha256: 'a'.repeat(64), sourceBytes: 300 },
      })),
      sourceCacheHit: true,
      cachedBytes: 0,
      sampling: 'nearest',
    },
    images: new PopulationImages({ close() {} } as ImageBitmap, { close() {} } as ImageBitmap),
    effectLimit: 3,
    summaryLimit: 2,
  };
}

/** Everything analytical a preview must leave untouched. */
function analytical() {
  const state = store();
  const exported = freezePopulationExport(display());
  return {
    population: state.population,
    selection: state.selection,
    resolved: resolvePopulation(state),
    probe: buildPopulationProbeQuery(state, workspace()).query?.key,
    slice: buildPopulationSliceQuery(state, workspace(), sliceOptions).query?.key,
    exported,
  };
}

beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  bootstrap();
  store().selectPopulationMembers(ids.slice(0, 4));
  store().setPopulationProbe(
    { supportKey: 'support:v1', worldMm: [1, 2, 3], radiusMm: 0, reduce: 'mean' },
    'pin',
  );
});

describe('lifted hold-to-preview target', () => {
  it('starts clear and guards no-op updates', () => {
    expect(store().populationPreview).toEqual({ target: null, holding: false });
    const listener = vi.fn();
    const unsubscribe = useSetStudioStore.subscribe(listener);
    populationProbeActions.releasePreview();
    store().clearPopulationPreview();
    populationProbeActions.choosePreviewTarget(null);
    expect(listener).not.toHaveBeenCalled();
    populationProbeActions.choosePreviewTarget({ kind: 'set', cohortId: 'late' });
    populationProbeActions.choosePreviewTarget({ kind: 'set', cohortId: 'late' });
    populationProbeActions.holdPreview();
    populationProbeActions.holdPreview();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(
      populationProbeActions.choosePreviewTarget({ kind: 'group', groupId: ' ' }),
    ).toMatchObject({ ok: false });
    expect(store().populationPreview).toEqual({
      target: { kind: 'set', cohortId: 'late' },
      holding: true,
    });
  });

  it('leaves membership, summaries, selection algebra and export payloads unchanged', () => {
    const before = analytical();
    populationProbeActions.choosePreviewTarget({ kind: 'set', cohortId: 'late' });
    populationProbeActions.holdPreview();
    const during = analytical();
    // The analytical state objects are the same references, not just equal.
    expect(during.population).toBe(before.population);
    expect(during.selection).toBe(before.selection);
    expect(during.resolved).toEqual(before.resolved);
    expect(during.probe).toBe(before.probe);
    expect(during.slice).toBe(before.slice);
    expect(during.exported).toEqual(before.exported);
    expect(JSON.stringify(during.exported)).not.toMatch(/holding|previewTarget|populationPreview/);
    // The preview is visible only as a facet.
    const statuses = resolveStudioObservationStatuses(store());
    expect(ids.filter((id) => statuses.byId.get(id)?.previewedOut)).toEqual(ids.slice(3));
    expect(ids.filter((id) => statuses.byId.get(id)?.selected)).toEqual(ids.slice(0, 4));
    // Selection algebra while previewing ignores the preview operand.
    store().combinePopulationMembers('difference', ['sub001']);
    expect(resolvePopulation(store()).workingMemberIds).toEqual(['sub002', 'sub003', 'sub004']);
    populationProbeActions.undoSelection();
    populationProbeActions.releasePreview();
    expect(analytical().exported).toEqual(before.exported);
  });

  it('survives focus and selection changes within the same context', () => {
    populationProbeActions.choosePreviewTarget({ kind: 'participant' });
    populationProbeActions.holdPreview();
    store().setActiveMember('sub002');
    store().selectPopulationMembers(['sub001']);
    store().setPopulationReferenceMode('complement');
    expect(store().populationPreview).toEqual({ target: { kind: 'participant' }, holding: true });
  });

  it.each([
    ['scope switch', () => store().setActiveScopeCohort('late')],
    ['filter toggle', () => store().toggleDesignFilter({ column: 'group', value: 'A' })],
    [
      'dataset membership change',
      () => {
        const state = store();
        const set = state.sets[state.selection.activeSetId!];
        useSetStudioStore.setState({
          sets: { ...state.sets, [set.id]: { ...set, memberIds: set.memberIds.slice(0, 5) } },
        });
      },
    ],
  ])('releases the hold on a %s but keeps a target that still resolves', (_label, change) => {
    populationProbeActions.choosePreviewTarget({ kind: 'set', cohortId: 'reference' });
    populationProbeActions.holdPreview();
    change();
    expect(store().populationPreview).toEqual({
      target: { kind: 'set', cohortId: 'reference' },
      holding: false,
    });
  });

  it.each([
    ['session reset', () => bootstrap()],
    ['store reset', () => useSetStudioStore.setState(useSetStudioStore.getInitialState(), true)],
  ])('clears target and hold on a %s', (_label, change) => {
    populationProbeActions.choosePreviewTarget({ kind: 'set', cohortId: 'reference' });
    populationProbeActions.holdPreview();
    change();
    expect(store().populationPreview).toEqual({ target: null, holding: false });
  });

  it('keeps a chosen target and hold when cohorts are saved or the scope cohort is renamed', () => {
    store().setActiveScopeCohort('late');
    populationProbeActions.choosePreviewTarget({ kind: 'set', cohortId: 'reference' });
    populationProbeActions.holdPreview();
    store().createSavedCohort({ memberIds: ['sub004'], label: 'Saved later' });
    store().renameSavedCohort('late', 'Late renamed');
    expect(store().populationPreview).toEqual({
      target: { kind: 'set', cohortId: 'reference' },
      holding: true,
    });
  });

  it('clears a target that stops resolving: a deleted set or a removed participant identity', () => {
    populationProbeActions.choosePreviewTarget({ kind: 'set', cohortId: 'reference' });
    populationProbeActions.holdPreview();
    store().deleteSavedCohort('reference');
    expect(store().populationPreview).toEqual({ target: null, holding: false });
    populationProbeActions.configureParticipants({
      setId: store().selection.activeSetId!,
      identity: { kind: 'observationIds' },
      reduction: 'observations',
    });
    populationProbeActions.choosePreviewTarget({ kind: 'participant' });
    populationProbeActions.configureParticipants(null);
    expect(store().populationPreview.target).toBeNull();
  });

  it('clears when the scope cohort membership changes', () => {
    store().setActiveScopeCohort('late');
    populationProbeActions.holdPreview();
    useSetStudioStore.setState({
      cohorts: {
        ...store().cohorts,
        late: { ...store().cohorts.late, memberIds: ids.slice(4) },
      },
    });
    expect(store().populationPreview.holding).toBe(false);
  });
});
