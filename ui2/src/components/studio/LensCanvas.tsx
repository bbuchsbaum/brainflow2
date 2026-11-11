import type { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import React from 'react';
import type {
  SpatialFieldSetSummary,
  StudioArtifactSummary,
  StudioCohortSummary,
  StudioComparePaneSpec,
  StudioFeatureSummary,
  StudioFieldExpressionSummary,
  StudioLensType,
  StudioMemberSummary,
} from '@/types/studio';
import { CompareLens } from './CompareLens';
import { DeckLens } from './DeckLens';
import { PopulationLens } from './PopulationLens';
import { useStudioReadiness } from '@/hooks/useStudioReadiness';
import { StudioReadinessNotice } from './StudioReadinessNotice';
import { StudioSourceFetchNotice } from './StudioSourceFetchNotice';
import { usePopulationSourcesLocal } from '@/hooks/useStudioSourceFetch';

interface LensCanvasProps {
  populationProbeController?: PopulationProbeController;
  activeLens: StudioLensType;
  activeSet: SpatialFieldSetSummary | null;
  activeFeature: StudioFeatureSummary | null;
  activeArtifact: StudioArtifactSummary | null;
  activeMemberId: string | null;
  activeMember: StudioMemberSummary | null;
  compareCohort: StudioCohortSummary | null;
  activeExpression: StudioFieldExpressionSummary | null;
  cohorts: StudioCohortSummary[];
  comparePaneSpecs: StudioComparePaneSpec[];
  comparePaneLoading: boolean;
  compareRefreshingPaneIds: string[];
  scopeCohortLabel?: string | null;
  searchLabel?: string | null;
  filterLabels?: string[];
  sortLabel?: string | null;
  onSelectMember: (memberId: string) => void;
  onSelectCohort: (cohortId: string | null) => void;
  onDrillToCohort: (cohortId: string | null) => void;
  onOpenComparePane: (pane: StudioComparePaneSpec) => void;
  onInspectComparePane: (pane: StudioComparePaneSpec) => void;
  onRecomputeComparePane: (pane: StudioComparePaneSpec) => void;
  onInspectCurrentArtifact: () => void;
  onOpenCurrentSource: () => void;
  onOpenCompareView: () => void;
  onClearScope: () => void;
  visibleMemberIds?: string[];
}

/**
 * Population once its images can be read. A set on a remote mount has only
 * the images something has opened on this computer; the rest are fetched
 * first, and the fetch is shown in place of the maps. A local set renders
 * the lens at once.
 */
function PopulationWhenLocal({
  probeController,
}: {
  probeController?: PopulationProbeController;
}) {
  return usePopulationSourcesLocal() ? (
    <PopulationLens probeController={probeController} />
  ) : (
    <StudioSourceFetchNotice lens="population" variant="panel" />
  );
}

/**
 * Pure lens body switcher. The lens segmented control lives in
 * StudioLensSwitcher above the canvas; this component only renders the
 * selected lens body so the viewer can take the full center area.
 */
export function LensCanvas({
  populationProbeController,
  activeLens,
  activeSet,
  activeFeature,
  activeArtifact,
  activeMemberId,
  activeMember,
  compareCohort,
  activeExpression,
  cohorts,
  comparePaneSpecs,
  comparePaneLoading,
  compareRefreshingPaneIds,
  scopeCohortLabel,
  searchLabel,
  filterLabels,
  sortLabel,
  onSelectMember,
  onSelectCohort,
  onDrillToCohort,
  onOpenComparePane,
  onInspectComparePane,
  onRecomputeComparePane,
  onInspectCurrentArtifact,
  onOpenCurrentSource,
  onOpenCompareView,
  onClearScope,
  visibleMemberIds,
}: LensCanvasProps) {
  // A set that cannot be read together yet (its grids unchecked or being
  // checked, or on different grids) gets one calm state for the whole
  // Population lens, not a pair of empty image wells under an error.
  const populationReadiness = useStudioReadiness('population');
  return (
    <div className="flex h-full min-h-0 flex-col">
      {activeLens === 'population' ? (
        populationReadiness.phase === 'ready' ? (
          <PopulationWhenLocal probeController={populationProbeController} />
        ) : (
          <StudioReadinessNotice lens="population" variant="panel" />
        )
      ) : activeLens === 'compare' ? (
        <CompareLens
          activeSet={activeSet}
          activeFeature={activeFeature}
          activeArtifact={activeArtifact}
          activeMemberId={activeMemberId}
          activeMember={activeMember}
          compareCohort={compareCohort}
          cohorts={cohorts}
          activeExpression={activeExpression}
          paneSpecs={comparePaneSpecs}
          loading={comparePaneLoading}
          refreshingPaneIds={compareRefreshingPaneIds}
          scopeLabel={scopeCohortLabel}
          searchLabel={searchLabel}
          filterLabels={filterLabels}
          sortLabel={sortLabel}
          onSelectCohort={onSelectCohort}
          onDrillToCohort={onDrillToCohort}
          onOpenPane={onOpenComparePane}
          onInspectPane={onInspectComparePane}
          onRecomputePane={onRecomputeComparePane}
          onInspectCurrent={onInspectCurrentArtifact}
          onOpenCurrentSource={onOpenCurrentSource}
          onOpenCompareView={onOpenCompareView}
        />
      ) : (
        <DeckLens
          activeSet={activeSet}
          activeFeature={activeFeature}
          activeMemberId={activeMemberId}
          activeMemberSourcePath={activeMember?.sourcePath ?? null}
          scopeLabel={scopeCohortLabel}
          searchLabel={searchLabel}
          filterLabels={filterLabels}
          sortLabel={sortLabel}
          onClearScope={onClearScope}
          onSelectMember={onSelectMember}
          onInspectCurrent={onInspectCurrentArtifact}
          onOpenCurrentSource={onOpenCurrentSource}
          visibleMemberIds={visibleMemberIds}
        />
      )}
    </div>
  );
}
