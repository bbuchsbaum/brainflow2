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
import { isSetCompareReady } from './importContract';
import { setNeedsGridCheck } from './studioReadiness';
import { selectStudioBackgroundPath, studioGridEvidence } from './studioBackground';
import { readMemberGridHeader } from './studioMemberGrid';

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
  /** The set and background last handed to the display service. */
  private lastBackgroundKey: string | null = null;
  /**
   * The member whose header was asked for last: whether the answer is still
   * out, and whether a header was read (`read`) and said something (`found`).
   */
  private gridProbe: { key: string; pending: boolean; read: boolean; found: boolean } | null =
    null;
  private autoCheckGrids: (() => void) | null = null;

  /**
   * `autoCheckGrids`: starts the active set's header check when nobody has
   * read its headers (SetIngestionService.autoCheckActiveSetGrids, wired by
   * useStudioCoordination). Passed in so this service does not import the
   * ingestion service and its stores.
   */
  start(options: { autoCheckGrids?: () => void } = {}) {
    if (this.active) {
      return;
    }
    this.active = true;
    this.autoCheckGrids = options.autoCheckGrids ?? null;

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

    if (derived.activeLens === 'population') {
      // No member image is loaded here, so nothing waits behind the headers.
      this.startGridCheckIfNeeded();
      // The live population service owns visible slices and actual-member samples.
      // Focus changes here must not create file-backed GPU layers or exports.
      this.cancelActiveMaterialization();
      this.lastAutoCompareKey = null;
      if (state.activeArtifact) useSetStudioStore.getState().setActiveArtifact(null);
      return;
    }
    void this.ensureMemberDisplayed(derived.activeSet, derived.activeMemberId);
    this.syncBackground(state);

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
        // A grid check that lands makes the set comparable: compute the
        // panes then, with no action from the user.
        ready: isSetCompareReady(derived.activeSet),
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
    this.lastBackgroundKey = null;
    this.gridProbe = null;
    this.autoCheckGrids = null;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** Compute the Compare panes again for the same member and group. */
  retryComparePanes(): void {
    if (!this.active) return;
    this.lastAutoCompareKey = null;
    this.processStoreState(useSetStudioStore.getState());
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

  /**
   * Keep the template under the Deck and Compare member views in step with
   * the active set's background. Only a change is handed on, so paging
   * members does not touch the template. The set is captured before the
   * load: a result that arrives for another set or choice is dropped.
   */
  private syncBackground(state: StoreState, retry = false) {
    const sourcePath = selectStudioBackgroundPath(state);
    const setId = state.selection.activeSetId;
    const key = JSON.stringify([setId, sourcePath]);
    if (key === this.lastBackgroundKey && !retry) return;
    this.lastBackgroundKey = key;
    const display = getStudioDisplayService();
    const owns = () => {
      const live = useSetStudioStore.getState();
      return (
        this.active &&
        this.lastBackgroundKey === key &&
        live.selection.activeSetId === setId &&
        selectStudioBackgroundPath(live) === sourcePath
      );
    };
    const report = (failed: boolean) => {
      if (!owns()) return;
      useSetStudioStore
        .getState()
        .setStudioBackgroundIssue(
          failed && sourcePath
            ? { sourcePath, message: 'This template could not be opened.' }
            : null,
        );
    };
    void (retry ? display.retryBackground(sourcePath) : display.syncBackground(sourcePath)).then(
      (result) => {
        if (result.status !== 'stale') report(result.status === 'failed');
      },
      (error) => {
        // The display service reports failures as results; a rejection is
        // unexpected, and must still reach the Background control.
        console.warn('[StudioCoordinationService] Background request failed:', error);
        report(true);
      },
    );
  }

  /**
   * The user's Background choice for the active set (null is "None"). The
   * same template chosen again after it failed to open is tried again.
   */
  chooseBackground(sourcePath: string | null): void {
    const before = useSetStudioStore.getState();
    const current = selectStudioBackgroundPath(before);
    const failed = !!sourcePath && before.studioBackgroundIssue?.sourcePath === sourcePath;
    before.setStudioBackground(sourcePath);
    const after = useSetStudioStore.getState();
    if (this.active && failed && current === sourcePath && after.selection.activeLens !== 'population') {
      after.setStudioBackgroundIssue(null);
      this.syncBackground(useSetStudioStore.getState(), true);
    }
  }

  /** Ask again for the active member's image (the Deck's Retry after a failed load). */
  retryActiveMember(): void {
    const state = useSetStudioStore.getState();
    const setId = state.selection.activeSetId;
    if (!this.active || !setId) return;
    void this.ensureMemberDisplayed(state.sets[setId] ?? null, state.selection.activeMemberId);
  }

  private async ensureMemberDisplayed(
    activeSet: SpatialFieldSetSummary | null,
    activeMemberId: string | null,
  ) {
    try {
      await getStudioDisplayService().ensureMemberDisplayed(activeSet, activeMemberId);
    } catch (error) {
      // The load queue records why; the Deck shows it (StudioMemberLoadOverlay).
      console.warn('[StudioCoordinationService] Could not display the member:', error);
    }
    // After the member, never before it: on a remote mount the header reads
    // share the connection with the member's download, and the first image
    // on screen comes first.
    this.startGridCheckIfNeeded();
    await this.readMemberGrid(activeSet, activeMemberId);
  }

  /**
   * Start the active set's header check in the background when nobody has
   * read its headers (SetIngestionService.autoCheckActiveSetGrids: once per
   * opened set, cancelled when the set or the Studio goes away). It is
   * started after the member on display has loaded or failed, never before:
   * it must not hold up the first image. Population
   * and Compare become ready when it lands (`applySetAudit`), and the
   * background default gains whole-set evidence.
   */
  private startGridCheckIfNeeded(): void {
    if (!this.active || !this.autoCheckGrids) return;
    const state = useSetStudioStore.getState();
    const setId = state.selection.activeSetId;
    if (!setId || state.gridCheck.status !== 'idle' || !setNeedsGridCheck(state.sets[setId])) return;
    this.autoCheckGrids();
  }

  /**
   * Record what the header of the member now on display says about the set's
   * space: the evidence an unchosen background rests on (studioBackground.ts).
   * The evidence of the member shown before stays until this one's is known,
   * as that member's image stays on screen until this one has loaded. The set
   * and member are captured before the read: an answer for a member paged
   * away from, or for another set, is dropped. A member that did not load
   * leaves no evidence.
   */
  private async readMemberGrid(
    activeSet: SpatialFieldSetSummary | null,
    memberId: string | null,
  ): Promise<void> {
    if (!activeSet || !memberId || activeSet.supportKind !== 'volume') {
      this.dropMemberGridEvidence(activeSet);
      return;
    }
    const setId = activeSet.id;
    const owns = () => {
      const live = useSetStudioStore.getState();
      return (
        this.active &&
        live.selection.activeSetId === setId &&
        live.selection.activeMemberId === memberId
      );
    };
    if (!owns()) return;
    const sourcePath = activeSet.memberSummaries
      .find((candidate) => candidate.id === memberId)
      ?.sourcePath?.trim();
    if (!sourcePath) {
      // No file to read a header from: the member shown before is not this one.
      this.dropMemberGridEvidence(activeSet);
      return;
    }
    const key = JSON.stringify([setId, memberId, sourcePath]);
    const known = useSetStudioStore.getState().studioGridEvidence;
    // Asked already, and the answer is out or still stands. A member that had
    // no layer yet (its load failed) is asked about again: a retry may load it.
    const last = this.gridProbe?.key === key ? this.gridProbe : null;
    if (
      last &&
      (last.pending ||
        (last.read && (!last.found || (known?.setId === setId && known.memberId === memberId))))
    )
      return;
    const probe = { key, pending: true, read: false, found: false };
    this.gridProbe = probe;
    let evidence: ReturnType<typeof studioGridEvidence> = null;
    try {
      const header = await readMemberGridHeader(sourcePath);
      evidence = header ? studioGridEvidence(setId, memberId, header) : null;
      probe.read = header !== null;
      probe.found = evidence !== null;
    } catch (error) {
      // Not asked again for this member: the default stays "None".
      probe.read = true;
      console.warn('[StudioCoordinationService] Could not read the member header:', error);
    }
    probe.pending = false;
    if (this.gridProbe !== probe || !owns()) return;
    useSetStudioStore.getState().setStudioGridEvidence(evidence);
  }

  /**
   * Forget the header evidence when the member now on display has none of
   * its own to read. It was another member's, and the resolver would not use
   * it for this one. The exception is a set audited to be on one grid: there
   * any member's header is the set's, and keeping it keeps the template on
   * while paging.
   */
  private dropMemberGridEvidence(activeSet: SpatialFieldSetSummary | null): void {
    const state = useSetStudioStore.getState();
    const known = state.studioGridEvidence;
    if (!known) return;
    const wholeSet =
      !!activeSet &&
      activeSet.supportKind === 'volume' &&
      known.setId === activeSet.id &&
      state.selection.activeSetId === activeSet.id &&
      (state.sets[activeSet.id]?.alignmentClass ?? activeSet.alignmentClass) === 'same-grid';
    if (!wholeSet) state.setStudioGridEvidence(null);
  }
}

let instance: StudioCoordinationService | null = null;

export function getStudioCoordinationService(): StudioCoordinationService {
  if (!instance) {
    instance = new StudioCoordinationService();
  }
  return instance;
}
