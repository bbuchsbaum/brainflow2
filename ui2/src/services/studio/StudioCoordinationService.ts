import { getEventBus } from '@/events/EventBus';
import { computeStudioDerivedSnapshot, buildDeckArtifact } from '@/hooks/useStudioDerivedState';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type {
  StudioComparePaneSpec,
  StudioFieldExpressionSummary,
  StudioMemberSummary,
  SpatialFieldSetSummary,
  StudioCohortSummary,
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
}) {
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

export class StudioCoordinationService {
  private unsubscribe: (() => void) | null = null;
  private requestVersion = 0;
  private active = false;
  private lastAutoCompareKey: string | null = null;

  start() {
    if (this.active) {
      return;
    }
    this.active = true;
    let previousActiveSetId: string | null = null;

    this.unsubscribe = useSetStudioStore.subscribe((state) => {
      const derived = computeStudioDerivedSnapshot({
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

      void this.ensureMemberDisplayed(derived.activeSet, derived.activeMemberId);

      if (
        derived.visibleMemberIds.length > 0 &&
        (!derived.activeMemberId || !derived.visibleMemberIds.includes(derived.activeMemberId))
      ) {
        useSetStudioStore.getState().setActiveMember(derived.visibleMemberIds[0]);
      }

      if (derived.activeSetId !== previousActiveSetId) {
        previousActiveSetId = derived.activeSetId;
        const store = useSetStudioStore.getState();
        store.clearActiveIssueFocus();
        store.setDesignSearch('');
        store.setSortColumn(null);
        if (store.sortDirection !== 'asc') {
          store.toggleSortDirection();
        }
        store.clearDesignFilters();
      }

      if (derived.activeDesignFilters.length > 0 && derived.activeSet?.designTablePreview) {
        derived.activeDesignFilters.forEach((filter) => {
          const hasColumn = derived.activeSet?.designTablePreview?.columns.includes(filter.column);
          const hasValue = derived.quickFilterOptions.some(
            (option) => option.column === filter.column && option.values.includes(filter.value)
          );
          if (!hasColumn || !hasValue) {
            useSetStudioStore.getState().removeDesignFilter(filter);
          }
        });
      }

      if (derived.activeLens === 'deck') {
        useSetStudioStore.getState().setActiveArtifact(
          buildDeckArtifact({
            activeSet: derived.activeSet,
            activeMember: derived.activeMember,
            activeFeatureLabel: derived.activeFeature?.label ?? null,
            scopeCohort: derived.scopeCohort,
            activeExpressionId: derived.activeExpressionId,
          })
        );
      }

      if (derived.activeLens === 'compare') {
        const compareKey = JSON.stringify({
          setId: derived.activeSet?.id ?? null,
          memberId: derived.activeMember?.id ?? null,
          memberPath: derived.activeMember?.sourcePath ?? null,
          cohortId: derived.compareCohort?.id ?? null,
          expressionId: derived.activeExpression?.id ?? null,
        });
        if (compareKey !== this.lastAutoCompareKey) {
          this.lastAutoCompareKey = compareKey;
          void this.refreshComparePanes({
            activeSet: derived.activeSet,
            activeMember: derived.activeMember,
            compareCohort: derived.compareCohort,
            activeExpression: derived.activeExpression,
            forceRematerialize: false,
          });
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
          })
        );
      }
    });
  }

  stop() {
    this.active = false;
    this.requestVersion += 1;
    this.lastAutoCompareKey = null;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
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
    store.setComparePaneLoading(true);
    store.setCompareRefreshingPaneIds(refreshingPaneIds ?? []);
    const requestId = ++this.requestVersion;

    try {
      const specs = await getStudioCompareService().materializeComparePanes({
        activeSet,
        activeMember,
        compareCohort,
        activeExpression,
        forceRematerialize,
      });
      if (!this.active || requestId !== this.requestVersion) {
        return;
      }
      const liveStore = useSetStudioStore.getState();
      liveStore.setComparePaneSpecs(specs);
      if (forceRematerialize && notifyLabel) {
        getEventBus().emit('ui.notification', {
          type: 'success',
          message: `${notifyLabel} recomputed.`,
        });
      }
    } catch (error) {
      if (forceRematerialize && notifyLabel) {
        getEventBus().emit('ui.notification', {
          type: 'error',
          message: `Failed to recompute ${notifyLabel.toLowerCase()}.`,
        });
      }
      console.warn('[StudioCoordinationService] Failed to refresh compare panes:', error);
    } finally {
      if (!this.active || requestId !== this.requestVersion) {
        return;
      }
      const liveStore = useSetStudioStore.getState();
      liveStore.setComparePaneLoading(false);
      liveStore.setCompareRefreshingPaneIds([]);
    }
  }

  private async ensureMemberDisplayed(
    activeSet: SpatialFieldSetSummary | null,
    activeMemberId: string | null
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
