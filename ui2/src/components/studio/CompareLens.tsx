import React from 'react';
import type {
  SpatialFieldSetSummary,
  StudioArtifactSummary,
  StudioCohortSummary,
  StudioComparePaneSpec,
  StudioFeatureSummary,
  StudioFieldExpressionSummary,
  StudioMemberSummary,
} from '@/types/studio';
import { StudioRenderAdapter } from './StudioRenderAdapter';
import { StudioComparePane } from './StudioComparePane';
import type { ComparePaneAccent, ComparePaneLetter } from './StudioComparePane';

interface CompareLensProps {
  activeSet: SpatialFieldSetSummary | null;
  activeFeature: StudioFeatureSummary | null;
  activeArtifact: StudioArtifactSummary | null;
  activeMemberId: string | null;
  activeMember: StudioMemberSummary | null;
  compareCohort: StudioCohortSummary | null;
  cohorts: StudioCohortSummary[];
  activeExpression: StudioFieldExpressionSummary | null;
  paneSpecs: StudioComparePaneSpec[];
  loading: boolean;
  refreshingPaneIds: string[];
  scopeLabel?: string | null;
  searchLabel?: string | null;
  filterLabels?: string[];
  sortLabel?: string | null;
  onSelectCohort: (cohortId: string | null) => void;
  onDrillToCohort: (cohortId: string | null) => void;
  onOpenPane: (pane: StudioComparePaneSpec) => void;
  onInspectPane: (pane: StudioComparePaneSpec) => void;
  onInspectCurrent: () => void;
  onOpenCurrentSource: () => void;
  onOpenCompareView: () => void;
  onRecomputePane: (pane: StudioComparePaneSpec) => void;
}

interface PaneSlot {
  paneId: StudioComparePaneSpec['id'];
  letter: ComparePaneLetter;
  accent: ComparePaneAccent;
  units: string;
  fallbackTitle: string;
  fallbackSubtitle: string;
}

const PANE_SLOTS: PaneSlot[] = [
  {
    paneId: 'current',
    letter: 'A',
    accent: 'sky',
    units: 't',
    fallbackTitle: 'Current (Selected)',
    fallbackSubtitle: 'Active member',
  },
  {
    paneId: 'cohort-mean',
    letter: 'B',
    accent: 'emerald',
    units: 'β',
    fallbackTitle: 'Cohort Mean',
    fallbackSubtitle: 'Select a cohort to enable comparisons',
  },
  {
    paneId: 'residual',
    letter: 'C',
    accent: 'amber',
    units: 'Δ',
    fallbackTitle: 'Residual (Current − Mean)',
    fallbackSubtitle: 'Needs cohort selection',
  },
  {
    paneId: 'zscore',
    letter: 'D',
    accent: 'violet',
    units: 'z',
    fallbackTitle: 'Z-score (Current vs Mean)',
    fallbackSubtitle: 'Needs cohort selection',
  },
];

export function CompareLens({
  activeSet,
  activeArtifact,
  activeMemberId,
  activeMember,
  compareCohort,
  paneSpecs,
  loading,
  refreshingPaneIds,
  onDrillToCohort,
  onOpenPane,
  onInspectPane,
  onInspectCurrent,
  onOpenCurrentSource,
  onOpenCompareView,
  onRecomputePane,
}: CompareLensProps) {
  const displayedArtifact =
    activeArtifact && activeArtifact.lens === 'compare' ? activeArtifact : null;
  const activeViewId = displayedArtifact?.paneId ?? 'current';
  const cohortLabel = compareCohort?.label ?? null;
  const cohortId = compareCohort?.id ?? null;
  const cohortMemberCount = compareCohort?.memberCount ?? null;

  return (
    <div
      className="grid h-full min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3"
      role="grid"
      aria-label="Compare 2x2 grid"
    >
      {PANE_SLOTS.map((slot) => {
        const pane = paneSpecs.find((p) => p.id === slot.paneId);
        const isCurrent = slot.paneId === 'current';
        const isRefreshing = pane ? refreshingPaneIds.includes(pane.id) : false;

        const onInspect = isCurrent
          ? onInspectCurrent
          : pane
            ? () => onInspectPane(pane)
            : undefined;
        const onRecompute =
          !isCurrent && pane?.binding?.kind === 'derived_field'
            ? () => onRecomputePane(pane)
            : undefined;
        const onOpen = isCurrent
          ? activeMember?.sourcePath
            ? onOpenCurrentSource
            : undefined
          : pane?.binding?.ready && pane.binding.sourcePath
            ? () => onOpenPane(pane)
            : undefined;
        const onDrill =
          !isCurrent && cohortId ? () => onDrillToCohort(cohortId) : undefined;

        // Pane A renders the live ortho/surface viewer for the active member.
        // Other panes show a renderer-aware skeleton until the pop-out viewer is wired.
        const body = isCurrent ? (
          <CurrentPaneCanvas activeSet={activeSet} memberLabel={activeMemberId} />
        ) : null;

        // The "Open in viewer" affordance for the comparator pair.
        const headerExtra =
          !isCurrent && pane?.binding?.ready && activeMember?.sourcePath ? (
            <button
              type="button"
              onClick={onOpenCompareView}
              className="hidden text-[10px] text-muted-foreground hover:text-foreground"
              aria-hidden
            />
          ) : null;
        void headerExtra;

        return (
          <StudioComparePane
            key={slot.paneId}
            letter={slot.letter}
            accent={slot.accent}
            pane={pane}
            fallbackTitle={slot.fallbackTitle}
            fallbackSubtitle={isCurrent ? activeMemberId ?? slot.fallbackSubtitle : slot.fallbackSubtitle}
            unitsLabel={slot.units}
            selected={activeViewId === slot.paneId}
            isRefreshing={isRefreshing}
            isAnyLoading={loading}
            cohortMemberCount={isCurrent ? null : cohortMemberCount}
            cohortLabel={cohortLabel}
            cohortId={cohortId}
            activeMemberId={activeMemberId}
            activeSet={activeSet}
            onInspect={onInspect}
            onRecompute={onRecompute}
            onOpen={onOpen}
            onDrillToCohort={onDrill}
          >
            {body}
          </StudioComparePane>
        );
      })}
    </div>
  );
}

/**
 * Pane A's body: render the active member through the existing
 * orthogonal/surface adapter. Header/footer are owned by StudioComparePane.
 */
function CurrentPaneCanvas({
  activeSet,
  memberLabel,
}: {
  activeSet: SpatialFieldSetSummary | null;
  memberLabel: string | null;
}) {
  return (
    <div className="absolute inset-0">
      <StudioRenderAdapter
        supportKind={activeSet?.supportKind}
        title=""
        subtitle=""
        hideChrome
      />
      {memberLabel ? (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-muted-foreground"
        >
          {memberLabel}
        </div>
      ) : null}
    </div>
  );
}
