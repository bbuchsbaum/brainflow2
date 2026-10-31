import { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import { useCallback, useEffect, useState } from 'react';
import {
  STUDIO_MIN_VIEW_PX,
  StudioToolbarSlotContext,
  StudioViewportHeightContext,
} from './StudioToolbarSlot';
import { getStudioDisplayService } from '@/services/studio/StudioDisplayService';
import { getStudioCoordinationService } from '@/services/studio/StudioCoordinationService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { buildDeckArtifact, useStudioDerivedState } from '@/hooks/useStudioDerivedState';
import type {
  SpatialFieldSetSummary,
  StudioArtifactSummary,
  StudioComparePaneSpec,
  StudioCohortSummary,
} from '@/types/studio';
import { LensCanvas } from './LensCanvas';
import { StudioLensSwitcher } from './StudioLensSwitcher';
import { StudioStrip } from './StudioStrip';
import { StudioTimeRow } from './StudioTimeRow';
import { PopulationProbePanel } from './PopulationProbePanel';

function buildCompareArtifact(args: {
  pane: StudioComparePaneSpec | null;
  activeSet: SpatialFieldSetSummary | null;
  compareCohort: StudioCohortSummary | null;
  scopeCohort: StudioCohortSummary | null;
  activeMemberId: string | null;
  activeExpressionId: string | null;
}): StudioArtifactSummary | null {
  const { pane, activeSet, compareCohort, scopeCohort, activeMemberId, activeExpressionId } = args;
  if (!pane) {
    return null;
  }

  return {
    id: `compare:${pane.id}`,
    kind: pane.id === 'current' ? ('member' as const) : ('compare-pane' as const),
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
    supportLabel: activeSet?.supportLabel ?? null,
    alignmentClass: activeSet?.alignmentClass ?? null,
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

/** The Deck view's slice slider and border around its canvas (px). */
const DECK_VIEW_CHROME_PX = 40;
/** A Compare pane's one-line header and footer around its map (px). */
const COMPARE_PANE_CHROME_PX = 64;
/**
 * Smallest Compare map body: below it the grid scrolls rather than shrink
 * further (the four panes fit at 1372×887 with a 150 px dock; QA N13 c).
 */
const COMPARE_MIN_BODY_PX = 160;

export function StudioCenterPane() {
  const [populationProbeController] = useState(() => new PopulationProbeController());
  // The toolbar slot the active lens portals its controls into, and the
  // visible height under the toolbar its maps fill (QA N13).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [column, setColumn] = useState<HTMLElement | null>(null);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!column || !toolbar || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // 12 px: the column's gap between the toolbar and the lens.
      const next = Math.max(0, Math.floor(column.clientHeight - toolbar.offsetHeight - 12));
      setViewportHeight((previous) => (previous === next ? previous : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [column, toolbar]);
  const {
    activeSet,
    activeFeature,
    activeLens,
    activeMemberId,
    activeExpressionId,
    activeMember,
    compareCohort,
    scopeCohort,
    activeExpression,
    comparePaneSpecs,
    comparePaneLoading,
    compareRefreshingPaneIds,
    activeArtifact,
    cohortList,
    activeIssueLabel,
    designSearch,
    activeFilterLabels,
    sortLabel,
    visibleMemberIds,
    population,
  } = useStudioDerivedState();

  const activeDesignFilters = useSetStudioStore((state) => state.activeDesignFilters);
  const setActiveLens = useSetStudioStore((state) => state.setActiveLens);
  const setActiveMember = useSetStudioStore((state) => state.setActiveMember);
  const setCompareCohort = useSetStudioStore((state) => state.setCompareCohort);
  const setActiveScopeCohort = useSetStudioStore((state) => state.setActiveScopeCohort);
  const drillToCohort = useSetStudioStore((state) => state.drillToCohort);
  const setActiveArtifact = useSetStudioStore((state) => state.setActiveArtifact);
  const setDesignSearch = useSetStudioStore((state) => state.setDesignSearch);
  const removeDesignFilter = useSetStudioStore((state) => state.removeDesignFilter);

  // Pane-A-scoped frame index. The 4D detection / global frame integration is
  // tracked separately; until a member-level frameCount/TR exists on the
  // StudioMemberSummary contract, the time row stays disabled and this
  // local state acts only as a placeholder for UI affordance verification.
  const [paneAFrame, setPaneAFrame] = useState(0);
  const handlePaneAFrame = useCallback((frame: number) => {
    setPaneAFrame(frame);
  }, []);

  const handleOpenComparePane = (pane: StudioComparePaneSpec) => {
    setActiveArtifact(
      buildCompareArtifact({
        pane,
        activeSet,
        compareCohort,
        scopeCohort,
        activeMemberId,
        activeExpressionId,
      }),
    );

    const sourcePath = pane.binding?.ready ? (pane.binding.sourcePath?.trim() ?? null) : null;
    if (!sourcePath) {
      return;
    }

    void getStudioDisplayService().ensureSourcePathDisplayed(sourcePath, [sourcePath]);
  };

  const handleInspectComparePane = (pane: StudioComparePaneSpec) => {
    setActiveArtifact(
      buildCompareArtifact({
        pane,
        activeSet,
        compareCohort,
        scopeCohort,
        activeMemberId,
        activeExpressionId,
      }),
    );
  };

  const handleInspectCurrentArtifact = () => {
    if (activeLens === 'compare') {
      const currentPane = comparePaneSpecs.find((pane) => pane.id === 'current') ?? null;
      setActiveArtifact(
        buildCompareArtifact({
          pane: currentPane,
          activeSet,
          compareCohort,
          scopeCohort,
          activeMemberId,
          activeExpressionId,
        }),
      );
      return;
    }

    setActiveArtifact(
      buildDeckArtifact({
        activeSet,
        activeMember,
        activeFeatureLabel: activeFeature?.label ?? null,
        scopeCohort,
        activeExpressionId,
      }),
    );
  };

  const handleOpenCurrentSource = () => {
    const sourcePath =
      (activeArtifact?.lens === activeLens ? activeArtifact.sourcePath?.trim() : null) ??
      activeMember?.sourcePath?.trim() ??
      null;
    if (!sourcePath) {
      return;
    }

    void getStudioDisplayService().ensureSourcePathDisplayed(sourcePath, [sourcePath]);
  };

  const handleOpenCompareView = () => {
    const currentSourcePath = activeMember?.sourcePath?.trim() ?? '';
    const compareSourcePath =
      activeArtifact?.lens === 'compare' ? (activeArtifact.sourcePath?.trim() ?? '') : '';
    if (!currentSourcePath || !compareSourcePath) {
      return;
    }

    const managedCurrentSourcePaths =
      activeSet?.memberSummaries
        .map((candidate) => candidate.sourcePath?.trim() ?? '')
        .filter((path): path is string => path.length > 0) ?? [];

    void getStudioDisplayService().openComparisonForPaths({
      currentSourcePath,
      compareSourcePath,
      managedCurrentSourcePaths,
      compareLabel: activeArtifact?.title ?? null,
    });
  };

  const handleRecomputeComparePane = (pane: StudioComparePaneSpec) => {
    if (pane.binding?.kind !== 'derived_field') {
      return;
    }

    void getStudioCoordinationService().refreshComparePanes({
      activeSet,
      activeMember,
      compareCohort,
      activeExpression,
      forceRematerialize: true,
      refreshingPaneIds: [pane.id],
      notifyLabel: pane.title,
    });
  };

  // Deck: one large view of at least STUDIO_MIN_VIEW_PX; Compare: two rows
  // of single-plane panes. Both fill the visible column.
  const lensHeight =
    viewportHeight === null
      ? undefined
      : activeLens === 'deck'
        ? Math.max(STUDIO_MIN_VIEW_PX + DECK_VIEW_CHROME_PX, viewportHeight)
        : activeLens === 'compare'
          ? Math.max(2 * (COMPARE_MIN_BODY_PX + COMPARE_PANE_CHROME_PX) + 8, viewportHeight)
          : undefined;

  return (
    // A stable scroll gutter: the column scrolls from its right edge and
    // margins while a wheel over a map steps that map's slice (QA N13).
    <div
      ref={setColumn}
      data-studio-column
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 [scrollbar-gutter:stable]"
    >
      <div
        ref={setToolbar}
        className="sticky top-0 z-20 flex min-w-0 shrink-0 flex-wrap items-center gap-2 rounded-sm border border-border bg-card px-2 py-1 lg:flex-nowrap"
        aria-label="Set studio toolbar"
      >
        <StudioLensSwitcher
          bare
          activeLens={activeLens}
          populationOnly={!!activeSet?.savedPopulation}
          onSelectLens={setActiveLens}
          compareCohort={compareCohort}
          cohorts={cohortList}
          onSelectCompareCohort={setCompareCohort}
        />
        <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
        <div ref={setSlot} className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2" />
      </div>

      <StudioToolbarSlotContext.Provider value={slot}>
      <StudioViewportHeightContext.Provider value={viewportHeight}>
      <div
        className={activeLens === 'population' ? 'shrink-0' : 'min-h-0 shrink-0'}
        style={lensHeight === undefined ? undefined : { height: lensHeight }}
      >
        <LensCanvas
          populationProbeController={populationProbeController}
          activeLens={activeLens}
          activeSet={activeSet}
          activeFeature={activeFeature}
          activeArtifact={activeArtifact}
          activeMemberId={activeMemberId}
          activeMember={activeMember}
          compareCohort={compareCohort}
          activeExpression={activeExpression}
          cohorts={cohortList}
          comparePaneSpecs={comparePaneSpecs}
          comparePaneLoading={comparePaneLoading}
          compareRefreshingPaneIds={compareRefreshingPaneIds}
          scopeCohortLabel={scopeCohort?.label ?? null}
          searchLabel={designSearch.trim() || null}
          filterLabels={activeFilterLabels}
          sortLabel={sortLabel}
          onSelectMember={setActiveMember}
          onSelectCohort={setCompareCohort}
          onDrillToCohort={drillToCohort}
          onOpenComparePane={handleOpenComparePane}
          onInspectComparePane={handleInspectComparePane}
          onRecomputeComparePane={handleRecomputeComparePane}
          onInspectCurrentArtifact={handleInspectCurrentArtifact}
          onOpenCurrentSource={handleOpenCurrentSource}
          onOpenCompareView={handleOpenCompareView}
          onClearScope={() => setActiveScopeCohort(null)}
          visibleMemberIds={visibleMemberIds}
        />
      </div>
      </StudioViewportHeightContext.Provider>
      </StudioToolbarSlotContext.Provider>

      {activeLens === 'compare' ? (
        <StudioTimeRow
          activeMember={activeMember}
          frameCount={null}
          trSeconds={null}
          frame={paneAFrame}
          onFrameChange={handlePaneAFrame}
        />
      ) : null}

      <PopulationProbePanel controller={populationProbeController} />

      <StudioStrip
        contextIssue={population.context.issue}
        memberIds={visibleMemberIds}
        activeMemberId={activeMemberId}
        scopeLabel={scopeCohort?.label ?? null}
        issueFocusLabel={activeIssueLabel}
        searchLabel={designSearch.trim() || null}
        filterLabels={activeFilterLabels}
        filters={activeDesignFilters}
        sortLabel={sortLabel}
        onSelectMember={setActiveMember}
        onClearScope={() => setActiveScopeCohort(null)}
        onClearSearch={() => setDesignSearch('')}
        onRemoveFilter={removeDesignFilter}
      />
    </div>
  );
}
