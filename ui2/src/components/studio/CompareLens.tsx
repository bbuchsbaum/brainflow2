import { useMemo, useState } from 'react';
import { StudioPlaneToggle } from './StudioPlaneToggle';
import { StudioToolbarPortal } from './StudioToolbarSlot';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { selectStudioBackgroundPath } from '@/services/studio/studioBackground';
import { buildStudioComparePaneSpecs } from '@/services/studio/StudioCompareService';
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
import { StudioReadinessNotice } from './StudioReadinessNotice';
import { StudioSourceFetchNotice } from './StudioSourceFetchNotice';
import type { ComparePaneAccent, ComparePaneLetter } from './StudioComparePane';
import { useStudioMemberMapDisplay } from '@/hooks/useStudioMemberMapDisplay';
import { formatStudioWindow } from '@/services/studio/studioMapDisplay';

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
    fallbackTitle: 'Current member',
    fallbackSubtitle: '',
  },
  {
    paneId: 'cohort-mean',
    letter: 'B',
    accent: 'emerald',
    fallbackTitle: 'Group mean',
    fallbackSubtitle: 'Mean',
  },
  {
    paneId: 'residual',
    letter: 'C',
    accent: 'amber',
    fallbackTitle: 'Residual',
    fallbackSubtitle: 'Current − mean',
  },
  {
    paneId: 'zscore',
    letter: 'D',
    accent: 'violet',
    fallbackTitle: 'Z-score',
    fallbackSubtitle: '(Current − mean) / SD',
  },
];

export function CompareLens({
  activeSet,
  activeArtifact,
  activeMemberId,
  activeMember,
  compareCohort,
  activeExpression,
  paneSpecs: computedPaneSpecs,
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
  // Before the first result for a set there are no specs. The panes are then
  // what the local builder says of the same inputs: A is the member's image,
  // B–D are being computed or say which input they wait for. Never a bare
  // "Pending" over an image that is on screen. Not for the example set, whose
  // local specs are example maps.
  const paneSpecs = useMemo(
    () =>
      computedPaneSpecs.length || !activeSet || activeSet.sourceKind === 'demo'
        ? computedPaneSpecs
        : buildStudioComparePaneSpecs({ activeSet, activeMember, compareCohort, activeExpression }),
    [computedPaneSpecs, activeSet, activeMember, compareCohort, activeExpression],
  );
  const displayedArtifact =
    activeArtifact && activeArtifact.lens === 'compare' ? activeArtifact : null;
  const activeViewId = displayedArtifact?.paneId ?? 'current';
  const cohortLabel = compareCohort?.label ?? null;
  const cohortId = compareCohort?.id ?? null;
  const cohortMemberCount = compareCohort?.memberCount ?? null;
  // Anatomy under B–D is the set's background, as in Population: the user's
  // choice, else a template only when the set declares that template space
  // (QA N10). Pane A draws the same template through its render scope.
  const underlayPath = useSetStudioStore(selectStudioBackgroundPath);
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
  // A and B show the same quantity (the member, and the mean of members):
  // by default B is drawn with the member's display, so one colour is one
  // value in both. C and D are other quantities and keep their own scales.
  // Only for a member the Studio draws by its map rule; the pane's menu
  // gives the mean its own scale back.
  const [shareScale, setShareScale] = useState(true);
  const memberDisplay = useStudioMemberMapDisplay(
    activeSet?.supportKind === 'volume' ? activeMember?.sourcePath : null,
    studioWorkspaceId,
  );

  return (
    <>
    <StudioToolbarPortal>
      <StudioPlaneToggle />
    </StudioToolbarPortal>
    {/* One set-level line for the grid check, with its action: the panes
        that wait on it say so without repeating the action. */}
    <div className="mb-2 shrink-0 empty:hidden">
      <StudioReadinessNotice lens="compare" variant="line" />
    </div>
    {/* A remote set's images are fetched before the panes can be computed. */}
    <div className="mb-2 shrink-0 empty:hidden">
      <StudioSourceFetchNotice lens="compare" variant="line" />
    </div>
    <div
      className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2"
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
            shareMemberScale={slot.paneId === 'cohort-mean' && shareScale}
            sharedDisplay={slot.paneId === 'cohort-mean' ? memberDisplay : null}
          />
        ) : null;
        // Said once, under the mean: pane A's legend shows the same window.
        const sharesScale = slot.paneId === 'cohort-mean' && !!body && !!memberDisplay;
        const scaleNote =
          sharesScale && shareScale
            ? `A and B share ${formatStudioWindow(memberDisplay.intensity)}`
            : null;
        const extraActions = sharesScale
          ? [
              {
                label: shareScale ? 'Use its own scale' : 'Share the scale of A',
                onClick: () => setShareScale((shared) => !shared),
              },
            ]
          : undefined;

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
            fallbackTitle={isCurrent ? (activeMemberId ?? slot.fallbackTitle) : slot.fallbackTitle}
            fallbackSubtitle={
              isCurrent && activeMemberId ? 'Current member' : slot.fallbackSubtitle
            }
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
            scaleNote={scaleNote}
            extraActions={extraActions}
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
  memberSourcePath,
  plane,
}: {
  activeSet: SpatialFieldSetSummary | null;
  memberSourcePath: string | null;
  plane: 'axial' | 'coronal' | 'sagittal';
}) {
  // One colourbar: the shared view's, describing the member even when it
  // is the base layer, placed off the data by the shared rule (QA N16; a
  // second compact bar here sat beside it, the full one over the blob).
  // No member label over the image: the pane's header names the member.
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
        compactColorbar
      />
    </div>
  );
}
