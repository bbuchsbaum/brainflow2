import { StudioPlaneToggle } from './StudioPlaneToggle';
import { StudioToolbarPortal } from './StudioToolbarSlot';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { populationUnderlaySource } from '@/services/studio/PopulationSliceService';
import { useWorkspaceStore } from '@/stores/workspaceStore';
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
import { StudioDerivedPaneCanvas } from './StudioDerivedPaneCanvas';
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
  fallbackTitle: string;
  fallbackSubtitle: string;
}

const PANE_SLOTS: PaneSlot[] = [
  {
    paneId: 'current',
    letter: 'A',
    accent: 'sky',
    fallbackTitle: 'Current (Selected)',
    fallbackSubtitle: 'Active member',
  },
  {
    paneId: 'cohort-mean',
    letter: 'B',
    accent: 'emerald',
    fallbackTitle: 'Cohort mean',
    fallbackSubtitle: 'Select a cohort to enable comparisons',
  },
  {
    paneId: 'residual',
    letter: 'C',
    accent: 'amber',
    fallbackTitle: 'Residual (Current − Mean)',
    fallbackSubtitle: 'Needs cohort selection',
  },
  {
    paneId: 'zscore',
    letter: 'D',
    accent: 'violet',
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
  // Anatomy under B–D by the Population rule: a template only when the set
  // declares that template space (QA N10).
  const underlayPath = populationUnderlaySource(activeSet?.supportLabel).sourcePath;
  // All four panes show the session's plane (QA N13 c), set by the toggle
  // shared with the Deck.
  const plane = useSetStudioStore((state) => state.studioPlane);
  // The derived panes belong to the Studio's workspace, not to whichever
  // workspace is in front (Set Studio is a singleton tab).
  const studioWorkspaceId = useWorkspaceStore((state) => {
    for (const workspace of state.workspaces.values()) {
      if (workspace.type === 'set-studio') return workspace.id;
    }
    return null;
  });

  return (
    <>
    <StudioToolbarPortal>
      <StudioPlaneToggle />
    </StudioToolbarPortal>
    <div
      className="grid h-full min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2"
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
        // B–D draw their materialized map once it is ready (QA F8); until
        // then, or for a surface set, the pane says its status.
        const derivedPath =
          !isCurrent && pane?.binding?.ready ? pane.binding.sourcePath?.trim() || null : null;
        const body = isCurrent ? (
          <CurrentPaneCanvas
            activeSet={activeSet}
            memberLabel={activeMemberId}
            memberSourcePath={activeMember?.sourcePath ?? null}
            plane={plane}
          />
        ) : derivedPath &&
          studioWorkspaceId &&
          activeSet?.supportKind === 'volume' &&
          !isRefreshing ? (
          <StudioDerivedPaneCanvas
            paneId={slot.paneId}
            sourcePath={derivedPath}
            label={pane?.title ?? slot.fallbackTitle}
            workspaceId={studioWorkspaceId}
            underlayPath={underlayPath}
            plane={plane}
          />
        ) : null;

        // The "Open in viewer" affordance for the comparator pair.
        const headerExtra =
          !isCurrent && pane?.binding?.ready && activeMember?.sourcePath ? (
            <button
              type="button"
              onClick={onOpenCompareView}
              className="hidden text-bf-2xs text-muted-foreground hover:text-foreground"
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
    </>
  );
}

/**
 * Pane A's body: render the active member through the existing
 * orthogonal/surface adapter. Header/footer are owned by StudioComparePane.
 */
function CurrentPaneCanvas({
  activeSet,
  memberLabel,
  memberSourcePath,
  plane,
}: {
  activeSet: SpatialFieldSetSummary | null;
  memberLabel: string | null;
  memberSourcePath: string | null;
  plane: 'axial' | 'coronal' | 'sagittal';
}) {
  // One colourbar: the shared view's, describing the member even when it
  // is the base layer, placed off the data by the shared rule (QA N16; a
  // second compact bar here sat beside it, the full one over the blob).
  return (
    <div className="absolute inset-0">
      <StudioRenderAdapter
        supportKind={activeSet?.supportKind}
        title=""
        subtitle=""
        hideChrome
        plane={plane}
        memberSourcePath={memberSourcePath}
        describeBase
      />
      {memberLabel ? (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-2 left-2 rounded-sm border border-border/60 bg-background/70 px-2 py-0.5 text-bf-2xs text-muted-foreground"
        >
          {memberLabel}
        </div>
      ) : null}
    </div>
  );
}
