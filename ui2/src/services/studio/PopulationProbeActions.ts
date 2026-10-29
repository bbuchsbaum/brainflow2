import { getTransport } from '@/services/transport';
import type {
  PopulationMask,
  PopulationParticipantDefinition,
  PopulationPreviewTarget,
  PopulationProbe,
} from '@/types/population';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { resolvePopulation } from './populationContext';
import { populationSupportKey } from './PopulationProbeController';
import { useClusterStore, type ClusterResult } from '@/stores/clusterStore';
import { shortLayerLabel } from '@/components/views/viewportFrame/frameFormat';

/**
 * A pinned cluster probe after the cluster table changes (REVIEW M2): the
 * label volume it samples is replaced by every Compute, and ids re-rank. The
 * same cluster (same peak voxel and sign) is re-pinned on the new table;
 * otherwise the probe returns to a point and `onIssue` says why. A probe never
 * samples an old label volume under a new table's caption.
 */
function syncClusterProbe(
  previous: ClusterResult | null,
  next: ClusterResult | null,
  onIssue: (message: string) => void,
): void {
  const state = useSetStudioStore.getState();
  const region = state.population.pinnedProbe?.region;
  const source = region?.locus.labelSource;
  if (!region || source?.type !== 'volume') return;
  if (next?.table.labelVolumeId && source.volumeId === next.table.labelVolumeId) return;
  const old =
    previous && previous.table.labelVolumeId === source.volumeId
      ? previous.table.clusters.find((c) => c.id === region.locus.labelIds[0])
      : undefined;
  const same =
    old && next?.table.labelVolumeId
      ? next.table.clusters.find(
          (c) => c.sign === old.sign && c.peakMm.every((v, i) => Math.abs(v - old.peakMm[i]) < 1e-3),
        )
      : undefined;
  if (same && next?.table.labelVolumeId) {
    populationProbeActions.pinRegion({
      locus: { labelSource: { type: 'volume', volumeId: next.table.labelVolumeId }, labelIds: [same.id] },
      label: `cluster ${same.id} of ${shortLayerLabel(next.layerName)}`,
    });
    return;
  }
  populationProbeActions.clearRegion();
  onIssue('The cluster table changed and the pinned cluster is not in it. Select a cluster row and choose Cluster again.');
}

/** UI commands share the canonical Studio selection/probe state. Sample frames
 * remain owned by the panel's controller, outside the global stores. */
export const populationProbeActions = {
  select(
    ids: readonly string[],
    operation: 'replace' | 'union' | 'intersection' | 'difference' = 'replace',
    origin: 'manual' | 'metadata' | 'map-derived' = 'manual',
    label = 'Selected observations',
  ) {
    const state = useSetStudioStore.getState();
    return operation === 'replace'
      ? state.selectPopulationMembers(ids, origin, label)
      : state.combinePopulationMembers(operation, ids, origin);
  },
  configureMask(mask: PopulationMask | null) {
    const state = useSetStudioStore.getState();
    return state.configurePopulationMask(
      mask ? { ...mask, setId: state.selection.activeSetId ?? '' } : null,
    );
  },
  async chooseMask() {
    const initial = useSetStudioStore.getState();
    const setId = initial.selection.activeSetId;
    const revision = initial.population.sessionRevision;
    const path = await getTransport().invoke<string | null>('plugin:dialog|open', {
      options: {
        multiple: false,
        directory: false,
        filters: [{ name: 'Binary NIfTI mask', extensions: ['nii', 'nii.gz'] }],
      },
    });
    if (typeof path !== 'string') return { ok: true } as const;
    const current = useSetStudioStore.getState();
    if (current.selection.activeSetId !== setId || current.population.sessionRevision !== revision)
      return { ok: false, reason: 'The dataset changed while choosing a mask.' } as const;
    return populationProbeActions.configureMask({ sourcePath: path });
  },
  configureParticipants(definition: PopulationParticipantDefinition | null) {
    return useSetStudioStore.getState().configurePopulationParticipants(definition);
  },
  /** Hold-to-preview is presentation state: it never changes the working
   * selection, summaries or exports; the lens applies it to its own request. */
  choosePreviewTarget(target: PopulationPreviewTarget | null) {
    return useSetStudioStore.getState().setPopulationPreviewTarget(target);
  },
  holdPreview() {
    useSetStudioStore.getState().setPopulationPreviewHolding(true);
  },
  releasePreview() {
    useSetStudioStore.getState().setPopulationPreviewHolding(false);
  },
  focus(id: string) {
    const state = useSetStudioStore.getState();
    if (resolvePopulation(state).context.memberIds.includes(id)) state.setActiveMember(id);
  },
  toggle(id: string) {
    const state = useSetStudioStore.getState();
    const population = resolvePopulation(state);
    if (!population.context.memberIds.includes(id)) return;
    const members = population.workingMemberIds;
    state.selectPopulationMembers(
      members.includes(id) ? members.filter((member) => member !== id) : [...members, id],
    );
  },
  selectAll() {
    useSetStudioStore.getState().selectPopulationContext();
  },
  selectNone() {
    useSetStudioStore.getState().selectPopulationMembers([]);
  },
  selectFocused() {
    const state = useSetStudioStore.getState();
    const id = state.selection.activeMemberId;
    if (id && resolvePopulation(state).context.memberIds.includes(id))
      state.selectPopulationMembers([id]);
  },
  undoSelection() {
    useSetStudioStore.getState().undoPopulationSelection();
  },
  pin(radiusMm: number, previewHover: boolean) {
    const state = useSetStudioStore.getState();
    const view = useViewStateStore.getState();
    const supportKey = populationSupportKey(state, view.activeWorkspaceKey);
    const candidate = previewHover ? state.population.hoverProbe : null;
    const hover = candidate?.supportKey === supportKey ? candidate : null;
    state.setPopulationProbe(
      {
        supportKey,
        worldMm: hover?.worldMm ?? [...view.viewState.crosshair.world_mm],
        radiusMm,
        reduce: 'mean',
      },
      'pin',
    );
  },
  /** Pin a region probe (E2/E3) at the crosshair: each observation is reduced over the region. */
  pinRegion(region: NonNullable<PopulationProbe['region']>) {
    const state = useSetStudioStore.getState();
    const view = useViewStateStore.getState();
    return state.setPopulationProbe(
      {
        supportKey: populationSupportKey(state, view.activeWorkspaceKey),
        worldMm: [...view.viewState.crosshair.world_mm],
        radiusMm: 0,
        reduce: 'mean',
        region,
      },
      'pin',
    );
  },
  /**
   * Keep a pinned cluster probe on the current cluster table (REVIEW M2). The
   * caller owns the subscription; a probe already stale when it starts (the
   * table changed while no panel listened) is resolved at once.
   */
  followClusterTable(onIssue: (message: string) => void): () => void {
    syncClusterProbe(null, useClusterStore.getState().result, onIssue);
    return useClusterStore.subscribe((now, before) => {
      if (now.result !== before.result) syncClusterProbe(before.result, now.result, onIssue);
    });
  },
  /** Back to a point probe at the pinned location (no region). */
  clearRegion() {
    const state = useSetStudioStore.getState();
    const pinned = state.population.pinnedProbe;
    if (!pinned?.region) return;
    state.setPopulationProbe({ ...pinned, region: null }, 'pin');
  },
  unpin() {
    useSetStudioStore.getState().setPopulationProbe(null, 'pin');
  },
  setRadius(radiusMm: number) {
    if (!Number.isFinite(radiusMm) || radiusMm < 0) return;
    const state = useSetStudioStore.getState();
    if (state.population.pinnedProbe)
      state.setPopulationProbe({ ...state.population.pinnedProbe, radiusMm }, 'pin');
    else if (state.population.hoverProbe)
      state.setPopulationProbe({ ...state.population.hoverProbe, radiusMm }, 'hover');
  },
  /** The caller owns and disposes this subscription when its panel changes. */
  followHover(radiusMm: number, workspaceId: string) {
    return useMouseCoordinateStore.subscribe((mouse) => {
      if (!mouse.worldCoordinates || !mouse.activeView) return;
      if (useViewStateStore.getState().activeWorkspaceKey !== workspaceId) return;
      const state = useSetStudioStore.getState();
      state.setPopulationProbe(
        {
          supportKey: populationSupportKey(state, workspaceId),
          worldMm: [...mouse.worldCoordinates],
          radiusMm,
          reduce: 'mean',
        },
        'hover',
      );
    });
  },
};
