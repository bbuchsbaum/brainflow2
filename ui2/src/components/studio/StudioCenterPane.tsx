import { populationProbeController } from '@/services/studio/PopulationProbeController';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StudioMenuSection, StudioToolbarMore } from './StudioToolbarSlot';
import {
  STUDIO_MIN_VIEW_PX,
  StudioMenuDataSlotContext,
  StudioMenuSlotContext,
  StudioProvenanceSlotContext,
  StudioToolbarSlotContext,
  StudioViewportHeightContext,
  StudioViewSlotContext,
} from './studioToolbarSlots';
import { getStudioDisplayService } from '@/services/studio/StudioDisplayService';
import { getStudioCoordinationService } from '@/services/studio/StudioCoordinationService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useStudioDerivedState } from '@/hooks/useStudioDerivedState';
import type {
  SpatialFieldSetSummary,
  StudioArtifactSummary,
  StudioCohortSummary,
  StudioComparePaneSpec,
} from '@/types/studio';
import { LensCanvas } from './LensCanvas';
import { StudioCompareSelect, StudioLensSwitcher } from './StudioLensSwitcher';
import { StudioBackgroundControl } from './StudioBackgroundControl';
import { X } from 'lucide-react';
import { Button, IconButton, Notice } from '@/components/ui/bf';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import {
  openStudioDatasetCard,
  studioDatasetCardTarget,
} from '@/services/studio/studioDatasetCard';
import { PopulationOpenControls } from './PopulationOpenControls';
import {
  selectStudioBackgroundAttention,
  selectStudioBackgroundNote,
  selectStudioBackgroundPath,
} from '@/services/studio/studioBackground';
import { StudioSetStatusWord } from './StudioAuditBanner';
import { useStudioSetAudit } from './useStudioSetAudit';
import { StudioMapSelect, StudioSetInfo, StudioSetName } from './StudioToolbar';
import { StudioProvenance } from './StudioProvenance';
import { studioSetMaps } from '@/services/studio/studioMaps';
import { StudioStrip } from './StudioStrip';
import { StudioTimeRow } from './StudioTimeRow';
import { usePopulationProbeDriver } from './usePopulationProbeDriver';

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
  // The Studio's one probe controller: sampled from here, shown in the dock's Values tab.
  usePopulationProbeDriver(populationProbeController, true, { populationOnly: true });
  // The toolbar slot the active lens portals its controls into, and the
  // visible height under the toolbar its maps fill (QA N13).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [viewSlot, setViewSlot] = useState<HTMLElement | null>(null);
  const [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null);
  const [menuDataSlot, setMenuDataSlot] = useState<HTMLElement | null>(null);
  const [provenanceSlot, setProvenanceSlot] = useState<HTMLElement | null>(null);
  // The folder the set was opened from can be reviewed for as long as the
  // store remembers it, whether or not its notice is still on screen.
  const canReviewFolder = useSetStudioStore(
    (state) =>
      !!state.studioOpenNotice && state.studioOpenNotice.setId === state.selection.activeSetId,
  );
  // The lens's own row is shown only while something has been put in it.
  const [rowTwoFilled, setRowTwoFilled] = useState(false);
  useEffect(() => {
    if (!slot) return;
    const check = () => setRowTwoFilled(slot.childElementCount > 0);
    check();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(check);
    observer.observe(slot, { childList: true });
    return () => observer.disconnect();
  }, [slot]);
  // A background note the reader has read and put away (per set and wording).
  const [dismissedAttention, setDismissedAttention] = useState<string | null>(null);
  // A background that failed to open, or whose note asks for a choice.
  const backgroundAttention = useSetStudioStore((state) => {
    const path = selectStudioBackgroundPath(state);
    return state.studioBackgroundIssue && state.studioBackgroundIssue.sourcePath === path
      ? state.studioBackgroundIssue.message
      : selectStudioBackgroundAttention(state);
  });
  const attentionSet = useSetStudioStore((state) => state.selection.activeSetId);
  const attentionKey = `${attentionSet}:${backgroundAttention}`;
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
    workspaceReadiness,
    materialization,
  } = useStudioDerivedState();
  // The set's maps (its roles): the header names the one Population shows.
  const features = useSetStudioStore((state) => state.features);
  const activeFeatureId = useSetStudioStore((state) => state.selection.activeFeatureId);
  const setActiveFeature = useSetStudioStore((state) => state.setActiveFeature);
  const maps = useMemo(() => studioSetMaps(activeSet, features), [activeSet, features]);
  // The set's status and facts: a status word on the row only for a problem,
  // the rest behind ⓘ.
  const setAudit = useStudioSetAudit(activeSet, workspaceReadiness);
  const backgroundNote = useSetStudioStore(selectStudioBackgroundNote);
  const dataStateLabel = activeSet?.savedPopulation
    ? 'Saved calculation'
    : activeSet?.sourceKind === 'demo'
      ? 'Demo data'
      : null;
  // The set's source folder has a card when the Files panel is browsing it.
  // A primitive is selected, so expanding the Files tree does not re-render the Studio.
  const datasetCardReason = useFileBrowserStore((state) => {
    const target = studioDatasetCardTarget(activeSet, state.entries);
    return target.available ? null : target.reason;
  });
  const datasetCard =
    datasetCardReason === null
      ? { available: true as const }
      : { available: false as const, reason: datasetCardReason };

  const activeDesignFilters = useSetStudioStore((state) => state.activeDesignFilters);
  const setActiveLens = useSetStudioStore((state) => state.setActiveLens);
  const setActiveMember = useSetStudioStore((state) => state.setActiveMember);
  const setCompareCohort = useSetStudioStore((state) => state.setCompareCohort);
  const setActiveScopeCohort = useSetStudioStore((state) => state.setActiveScopeCohort);
  const drillToCohort = useSetStudioStore((state) => state.drillToCohort);
  const setDesignSearch = useSetStudioStore((state) => state.setDesignSearch);
  const removeDesignFilter = useSetStudioStore((state) => state.removeDesignFilter);
  const setActiveArtifact = useSetStudioStore((state) => state.setActiveArtifact);

  // Pane-A-scoped frame index. The 4D detection / global frame integration is
  // tracked separately; until a member-level frameCount/TR exists on the
  // StudioMemberSummary contract, the time row stays disabled and this
  // local state acts only as a placeholder for UI affordance verification.
  const [paneAFrame, setPaneAFrame] = useState(0);
  const handlePaneAFrame = useCallback((frame: number) => {
    setPaneAFrame(frame);
  }, []);

  // Deck and Compare open a file in a viewer tab of its own (studioOpenInViewer).
  // A Compare pane clicked (its map, header or menu) becomes the Inspector's
  // artifact: its provenance and recipe, and the pane "Open compare view" uses.
  const handleSelectComparePane = (pane: StudioComparePaneSpec) => {
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
    // It scrolls down only: chrome wraps to the column's width, so nothing
    // is ever reached by scrolling sideways.
    <div
      ref={setColumn}
      data-studio-column
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]"
    >
      <div
        ref={setToolbar}
        // Two rows on one left edge, no box: the lens and its view switch with
        // the one menu at the far end, then the lens's own controls. Their
        // height is measured, so the lens below gives up exactly what they take.
        className="sticky top-0 z-20 flex min-w-0 shrink-0 flex-col gap-2 border-b border-bf-border-subtle bg-background pb-2"
        aria-label="Set studio toolbar"
      >
        <div className="flex min-w-0 items-center gap-x-2" data-testid="studio-toolbar-row-1">
          {/* The set's name leads the row; a status word follows only when something is wrong. */}
          {activeSet ? (
            <>
              {/* Never shortened: the background select gives up its width first. */}
              <span className="flex shrink-0 items-center" data-testid="studio-set-name-slot">
                <StudioSetName
                  className="max-w-[24rem]"
                  setName={activeSet.name}
                  setLocation={activeSet.sourceLocation ?? null}
                  onOpenDatasetCard={
                    datasetCard.available
                      ? (from) => openStudioDatasetCard(activeSet, from)
                      : undefined
                  }
                />
              </span>
              {/* The map Population shows; Deck and Subject vs mean show the member's own image. */}
              {activeLens === 'population' ? (
                <StudioMapSelect
                  maps={maps}
                  activeId={activeFeatureId}
                  onSelect={setActiveFeature}
                />
              ) : null}
              <StudioSetStatusWord audit={setAudit} />
            </>
          ) : null}
          <StudioLensSwitcher
            bare
            switchOnly
            activeLens={activeLens}
            populationOnly={!!activeSet?.savedPopulation}
            onSelectLens={setActiveLens}
            compareCohort={compareCohort}
            cohorts={cohortList}
            onSelectCompareCohort={setCompareCohort}
          />
          {/* The Population lens puts its view switch (Summary | Montage) here. */}
          <div ref={setViewSlot} className="flex min-w-0 shrink-0 items-center empty:hidden" />
          <span className="min-w-0 flex-1" />
          {/* One home for the set's background, in sight: it serves all three lenses. */}
          {activeSet?.supportKind === 'volume' ? <StudioBackgroundControl compact /> : null}
          {/* The set's facts: status, images, grid, where the background came from. */}
          {activeSet ? (
            <StudioSetInfo
              audit={setAudit}
              backgroundNote={backgroundNote}
              dataStateLabel={dataStateLabel}
              setLocation={activeSet.sourceLocation ?? null}
              maps={maps}
              activeMapId={activeFeatureId}
              datasetCard={
                datasetCard.available
                  ? { open: (from) => openStudioDatasetCard(activeSet, from) }
                  : { reason: datasetCard.reason }
              }
            />
          ) : null}
          {/* The Studio's one menu, in two parts: View (the lens's view
              controls) and Data (review, save, open, provenance). */}
          <StudioToolbarMore iconOnly>
            {/* The active lens's rarely used view controls; hidden when it has none. */}
            <StudioMenuSection title="View" testId="studio-menu-view" bodyRef={setMenuSlot} />
            <StudioMenuSection title="Data" testId="studio-menu-data">
              {canReviewFolder ? (
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void getSetIngestionService().reviewOpenedFolder()}
                  >
                    Review…
                  </Button>
                </div>
              ) : null}
              {/* The lens's own data commands (Population's Save calculation). */}
              <div ref={setMenuDataSlot} className="flex flex-col gap-2 empty:hidden" />
              {/* Was the set header's own menu: another saved calculation. */}
              <PopulationOpenControls part="open" />
              {/* Recipe, paths, cache, refresh and moved sources: one disclosure (B5). */}
              <StudioProvenance
                activeSet={activeSet}
                activeMemberId={activeMemberId}
                activeMember={activeMember}
                compareCohort={compareCohort}
                scopeCohort={scopeCohort}
                activeExpression={activeExpression}
                activeArtifact={activeArtifact}
                materialization={materialization}
                lensSlotRef={setProvenanceSlot}
                relocate={<PopulationOpenControls part="relocate" />}
              />
            </StudioMenuSection>
          </StudioToolbarMore>
        </div>
        <div
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
          data-testid="studio-toolbar-row-2"
          // A lens with no controls of its own leaves no empty row.
          hidden={!rowTwoFilled && activeLens !== 'compare'}
        >
          {activeLens === 'compare' ? (
            <StudioCompareSelect
              hideLabel
              compareCohort={compareCohort}
              cohorts={cohortList}
              onSelectCompareCohort={setCompareCohort}
            />
          ) : null}
          {/* The lens's own controls, portalled in. */}
          <div ref={setSlot} className="contents" />
        </div>
        {/* Said on the page only when there is something to do about it. */}
        {backgroundAttention && attentionKey !== dismissedAttention ? (
          <Notice
            severity="warning"
            data-testid="studio-background-attention"
            action={
              <IconButton
                size="xs"
                variant="ghost"
                icon={<X />}
                aria-label="Dismiss background note"
                title="Dismiss"
                onClick={() => setDismissedAttention(attentionKey)}
              />
            }
          >
            {backgroundAttention}
          </Notice>
        ) : null}
      </div>

      <StudioToolbarSlotContext.Provider value={slot}>
      <StudioViewSlotContext.Provider value={viewSlot}>
      <StudioMenuSlotContext.Provider value={menuSlot}>
      <StudioMenuDataSlotContext.Provider value={menuDataSlot}>
      <StudioProvenanceSlotContext.Provider value={provenanceSlot}>
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
          onRecomputeComparePane={handleRecomputeComparePane}
          onSelectComparePane={handleSelectComparePane}
          onOpenCompareView={handleOpenCompareView}
          onClearScope={() => setActiveScopeCohort(null)}
          visibleMemberIds={visibleMemberIds}
        />
      </div>
      </StudioViewportHeightContext.Provider>
      </StudioProvenanceSlotContext.Provider>
      </StudioMenuDataSlotContext.Provider>
      </StudioMenuSlotContext.Provider>
      </StudioViewSlotContext.Provider>
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
        // Population's montage and Summary show every member: the strip keeps
        // only its context there, and the cards take the room.
        showMembers={activeLens !== 'population'}
      />
    </div>
  );
}
