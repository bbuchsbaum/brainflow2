import { getEventBus } from '@/events/EventBus';
import { computeStudioDerivedSnapshot, buildDeckArtifact } from '@/hooks/useStudioDerivedState';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type {
  StudioArtifactSummary,
  StudioComparePaneSpec,
  StudioFieldExpressionSummary,
  StudioMemberSummary,
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioMaterializationJobDescriptor,
} from '@/types/studio';
import { getStudioCompareService } from './StudioCompareService';
import { getStudioDisplayService } from './StudioDisplayService';

function buildCompareArtifact(args: {
  pane: StudioComparePaneSpec | null;
  activeSet: SpatialFieldSetSummary | null;
  compareCohort: StudioCohortSummary | null;
  scopeCohort: StudioCohortSummary | null;
  activeMemberId: string | null;
  activeExpressionId: string | null;
}): StudioArtifactSummary | null {
  const { pane, activeSet, compareCohort, scopeCohort, activeMemberId, activeExpressionId } = args;
  if (!pane || !activeSet) {
    return null;
  }

  return {
    id: `compare:${pane.id}:${compareCohort?.id ?? 'none'}`,
    kind: 'compare-pane' as const,
    lens: 'compare' as const,
    title: pane.title,
    subtitle: pane.subtitle,
    recipe: pane.recipe,
    sourcePath: pane.binding?.sourcePath ?? null,
    materializationKey: pane.binding?.materializationKey ?? null,
    materializedAtMs: pane.binding?.materializedAtMs ?? null,
    cacheStatus: pane.binding?.cacheStatus ?? null,
    cacheMessage: pane.binding?.cacheMessage ?? null,
    provenancePath: pane.binding?.provenancePath ?? null,
    supportLabel: activeSet.supportLabel,
    alignmentClass: activeSet.alignmentClass,
    activeMemberId,
    cohortId: compareCohort?.id ?? null,
    cohortLabel: compareCohort?.label ?? null,
    cohortOriginKind: compareCohort?.originKind ?? null,
    cohortOriginLabel: compareCohort?.originLabel ?? null,
    scopeCohortId: scopeCohort?.id ?? null,
    scopeCohortLabel: scopeCohort?.label ?? null,
    scopeCohortOriginKind: scopeCohort?.originKind ?? null,
    scopeCohortOriginLabel: scopeCohort?.originLabel ?? null,
    activeExpressionId,
    paneId: pane.id,
    bindingKind: pane.binding?.kind ?? null,
    status: pane.status,
    capturedAtMs: 0,
  };
}

type StoreState = ReturnType<typeof useSetStudioStore.getState>;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return 'Unknown materialization error.';
}

function compareRequestKey(args: {
  activeSet: SpatialFieldSetSummary | null;
  activeMember: StudioMemberSummary | null;
  compareCohort: StudioCohortSummary | null;
  activeExpression: StudioFieldExpressionSummary | null;
  forceRematerialize: boolean;
}): string {
  return JSON.stringify({
    setId: args.activeSet?.id ?? null,
    setSupport: args.activeSet?.supportLabel ?? null,
    memberId: args.activeMember?.id ?? null,
    memberPath: args.activeMember?.sourcePath ?? null,
    cohortId: args.compareCohort?.id ?? null,
    cohortMembers: args.compareCohort?.memberIds ?? [],
    expressionId: args.activeExpression?.id ?? null,
    recipe: args.activeExpression?.recipe ?? null,
    forceRematerialize: args.forceRematerialize,
  });
}

function buildMaterializationJob(args: {
  id: string;
  activeSet: SpatialFieldSetSummary | null;
  activeMember: StudioMemberSummary | null;
  compareCohort: StudioCohortSummary | null;
  activeExpression: StudioFieldExpressionSummary | null;
  forceRematerialize: boolean;
  refreshingPaneIds?: string[];
  notifyLabel?: string | null;
}): StudioMaterializationJobDescriptor {
  const paneIds = args.refreshingPaneIds?.length
    ? args.refreshingPaneIds
    : ['cohort-mean', 'residual', 'zscore'];
  const label =
    args.notifyLabel ??
    (args.compareCohort
      ? `Materializing ${args.compareCohort.label}`
      : 'Materializing compare panes');

  return {
    id: args.id,
    kind: 'compare-panes',
    label,
    requestKey: compareRequestKey(args),
    setId: args.activeSet?.id ?? null,
    memberId: args.activeMember?.id ?? null,
    cohortId: args.compareCohort?.id ?? null,
    expressionId: args.activeExpression?.id ?? null,
    paneIds,
    forceRematerialize: args.forceRematerialize,
  };
}

export class StudioCoordinationService {
  private unsubscribe: (() => void) | null = null;
  private requestVersion = 0;
  private active = false;
  private lastAutoCompareKey: string | null = null;
  private activeAbortController: AbortController | null = null;

  start() {
    if (this.active) {
      return;
    }
    this.active = true;

    // Subscribe before reconciliation: it can update focus synchronously.
    this.unsubscribe = useSetStudioStore.subscribe((state) => {
      this.processStoreState(state);
    });

    // Process the current state once so an already-populated store
    // (e.g. demo loaded before /set-studio mounts) gets initial
    // member display, deck artifact wiring, and compare materialization.
    this.processStoreState(useSetStudioStore.getState());
  }

  private processStoreState(state: StoreState) {
    const derived = computeStudioDerivedSnapshot({
      populationState: state.population,
      activeSetId: state.selection.activeSetId,
      activeFeatureId: state.selection.activeFeatureId,
      activeLens: state.selection.activeLens,
      activeMemberId: state.selection.activeMemberId,
      compareCohortId: state.selection.compareCohortId,
      activeScopeCohortId: state.selection.activeScopeCohortId,
      activeExpressionId: state.selection.activeExpressionId,
      sets: state.sets,
      features: state.features,
      cohorts: state.cohorts,
      expressions: state.expressions,
      materialization: state.materialization,
      comparePaneSpecs: state.comparePaneSpecs,
      comparePaneLoading: state.comparePaneLoading,
      compareRefreshingPaneIds: state.compareRefreshingPaneIds,
      activeArtifact: state.activeArtifact,
      artifactHistory: state.artifactHistory,
      savedRecipes: state.savedRecipes,
      activeIssueMemberIds: state.activeIssueMemberIds,
      activeIssueLabel: state.activeIssueLabel,
      designSearch: state.designSearch,
      sortColumn: state.sortColumn,
      sortDirection: state.sortDirection,
      activeDesignFilters: state.activeDesignFilters,
    });

    // Search and display ordering must not move the focused observation. Only
    // a genuine eligibility change can replace focus, including an empty context.
    const context = derived.population.context;
    if (
      !context.issue &&
      (!derived.activeMemberId || !context.memberIds.includes(derived.activeMemberId))
    ) {
      const nextFocus = context.memberIds[0] ?? null;
      if (nextFocus !== derived.activeMemberId) {
        useSetStudioStore.getState().setActiveMember(nextFocus);
        return;
      }
    }

    void this.ensureMemberDisplayed(derived.activeSet, derived.activeMemberId);

    // Dataset bootstrap owns filter reset atomically. Mounting this service
    // must preserve a population definition that already exists in the store.

    // Quick-filter suggestions are a small presentation sample, not authority
    // to remove a user's filter. Missing metadata is reported by the context.

    if (derived.activeLens === 'deck') {
      useSetStudioStore.getState().setActiveArtifact(
        buildDeckArtifact({
          activeSet: derived.activeSet,
          activeMember: derived.activeMember,
          activeFeatureLabel: derived.activeFeature?.label ?? null,
          scopeCohort: derived.scopeCohort,
          activeExpressionId: derived.activeExpressionId,
        }),
      );
      return;
    }

    if (derived.activeLens === 'compare') {
      const compareKey = JSON.stringify({
        setId: derived.activeSet?.id ?? null,
        memberId: derived.activeMember?.id ?? null,
        memberPath: derived.activeMember?.sourcePath ?? null,
        cohortId: derived.compareCohort?.id ?? null,
        expressionId: derived.activeExpression?.id ?? null,
      });

      const compareCoordinatesChanged = compareKey !== this.lastAutoCompareKey;
      if (compareCoordinatesChanged) {
        this.lastAutoCompareKey = compareKey;
        void this.refreshComparePanes({
          activeSet: derived.activeSet,
          activeMember: derived.activeMember,
          compareCohort: derived.compareCohort,
          activeExpression: derived.activeExpression,
          forceRematerialize: false,
        });
      }

      // Only override the active artifact when the compare coordinates change,
      // when the user has not selected a compare artifact yet, or when the
      // currently selected pane is no longer present (e.g. after recompute).
      // Otherwise preserve the user's explicit selection so inspecting Pane A
      // or Pane B is not immediately overwritten.
      const currentArtifact = derived.activeArtifact;
      const userHasComparePick =
        currentArtifact?.lens === 'compare' &&
        currentArtifact.paneId != null &&
        derived.comparePaneSpecs.some((pane) => pane.id === currentArtifact.paneId);

      if (!compareCoordinatesChanged && userHasComparePick) {
        return;
      }

      const preferredPane =
        derived.comparePaneSpecs.find((pane) => pane.id === 'zscore' && pane.binding?.ready) ??
        derived.comparePaneSpecs.find((pane) => pane.id === 'residual' && pane.binding?.ready) ??
        derived.comparePaneSpecs.find((pane) => pane.id === 'cohort-mean' && pane.binding?.ready) ??
        derived.comparePaneSpecs.find((pane) => pane.id === 'current') ??
        null;

      useSetStudioStore.getState().setActiveArtifact(
        buildCompareArtifact({
          pane: preferredPane,
          activeSet: derived.activeSet,
          compareCohort: derived.compareCohort,
          scopeCohort: derived.scopeCohort,
          activeMemberId: derived.activeMemberId,
          activeExpressionId: derived.activeExpressionId,
        }),
      );
    }
  }

  stop() {
    this.activeAbortController?.abort();
    this.activeAbortController = null;

    const store = useSetStudioStore.getState();
    const activeJobId = store.activeMaterializationJobId;
    if (activeJobId) {
      store.cancelMaterializationJob(activeJobId);
    }

    this.active = false;
    this.requestVersion += 1;
    this.lastAutoCompareKey = null;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  cancelActiveMaterialization(): boolean {
    const store = useSetStudioStore.getState();
    const activeJobId = store.activeMaterializationJobId;
    if (!activeJobId || !store.isMaterializationJobActive(activeJobId)) {
      return false;
    }

    this.requestVersion += 1;
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    store.cancelMaterializationJob(activeJobId);
    return true;
  }

  async refreshComparePanes(args: {
    activeSet: SpatialFieldSetSummary | null;
    activeMember: StudioMemberSummary | null;
    compareCohort: StudioCohortSummary | null;
    activeExpression: StudioFieldExpressionSummary | null;
    forceRematerialize: boolean;
    refreshingPaneIds?: string[];
    notifyLabel?: string | null;
  }) {
    const {
      activeSet,
      activeMember,
      compareCohort,
      activeExpression,
      forceRematerialize,
      refreshingPaneIds,
      notifyLabel,
    } = args;

    const store = useSetStudioStore.getState();
    const requestId = ++this.requestVersion;
    this.activeAbortController?.abort();
    const abortController = new AbortController();
    this.activeAbortController = abortController;
    const jobId = `compare:${requestId}:${Date.now()}`;
    store.beginMaterializationJob(
      buildMaterializationJob({
        id: jobId,
        activeSet,
        activeMember,
        compareCohort,
        activeExpression,
        forceRematerialize,
        refreshingPaneIds,
        notifyLabel,
      }),
    );

    try {
      const specs = await getStudioCompareService().materializeComparePanes(
        {
          activeSet,
          activeMember,
          compareCohort,
          activeExpression,
          forceRematerialize,
        },
        {
          signal: abortController.signal,
        },
      );
      const liveStore = useSetStudioStore.getState();
      if (!this.canApplyMaterializationResult(requestId, jobId, liveStore)) {
        return;
      }
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
      liveStore.completeMaterializationJob(jobId, specs);
      if (forceRematerialize && notifyLabel) {
        getEventBus().emit('ui.notification', {
          type: 'success',
          message: `${notifyLabel} recomputed.`,
        });
      }
    } catch (error) {
      const liveStore = useSetStudioStore.getState();
      if (!this.canApplyMaterializationResult(requestId, jobId, liveStore)) {
        return;
      }
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        liveStore.cancelMaterializationJob(jobId);
        return;
      }
      liveStore.failMaterializationJob(jobId, errorMessage(error));
      if (forceRematerialize && notifyLabel) {
        getEventBus().emit('ui.notification', {
          type: 'error',
          message: `Failed to recompute ${notifyLabel.toLowerCase()}.`,
        });
      }
      console.warn('[StudioCoordinationService] Failed to refresh compare panes:', error);
    }
  }

  private canApplyMaterializationResult(
    requestId: number,
    jobId: string,
    store: StoreState,
  ): boolean {
    if (
      !this.active ||
      requestId !== this.requestVersion ||
      !store.isMaterializationJobActive(jobId)
    ) {
      store.markMaterializationJobStale(jobId);
      return false;
    }
    return true;
  }

  private async ensureMemberDisplayed(
    activeSet: SpatialFieldSetSummary | null,
    activeMemberId: string | null,
  ) {
    await getStudioDisplayService().ensureMemberDisplayed(activeSet, activeMemberId);
  }
}

let instance: StudioCoordinationService | null = null;

export function getStudioCoordinationService(): StudioCoordinationService {
  if (!instance) {
    instance = new StudioCoordinationService();
  }
  return instance;
}
