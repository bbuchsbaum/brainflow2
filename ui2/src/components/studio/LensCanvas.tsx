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
import { StudioPane } from './StudioPane';
import { CompareLens } from './CompareLens';
import { DeckLens } from './DeckLens';

interface LensCanvasProps {
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
  onSelectLens: (lens: StudioLensType) => void;
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

const LENSES: Array<{ id: StudioLensType; label: string; available: boolean }> = [
  { id: 'deck', label: 'Deck', available: true },
  { id: 'compare', label: 'Compare', available: true },
];

export function LensCanvas({
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
  onSelectLens,
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
  return (
    <StudioPane
      title="View"
      subtitle="Browse members or compare the current member to a cohort."
    >
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {LENSES.filter((lens) => lens.available).map((lens) => (
            <div key={lens.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelectLens(lens.id)}
                className={`rounded-md border px-3 py-1.5 transition-colors ${
                  activeLens === lens.id
                    ? 'border-border bg-accent text-accent-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {lens.label}
              </button>
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1">
          {activeLens === 'compare' ? (
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
      </div>
    </StudioPane>
  );
}
