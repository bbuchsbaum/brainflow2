import { useMemo } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioDesignFilter,
  StudioFieldExpressionSummary,
  StudioFeatureSummary,
  StudioMaterializationStatus,
  StudioMemberSummary,
  StudioComparePaneSpec,
  StudioArtifactSummary,
  StudioSavedRecipeSummary,
} from '@/types/studio';

export interface StudioDerivedSnapshotInput {
  activeSetId: string | null;
  activeFeatureId: string | null;
  activeLens: 'deck' | 'compare' | 'pivot-matrix' | 'atlas';
  activeMemberId: string | null;
  compareCohortId: string | null;
  activeScopeCohortId: string | null;
  activeExpressionId: string | null;
  sets: Record<string, SpatialFieldSetSummary>;
  features: Record<string, StudioFeatureSummary>;
  cohorts: Record<string, StudioCohortSummary>;
  expressions: Record<string, StudioFieldExpressionSummary>;
  materialization: StudioMaterializationStatus;
  comparePaneSpecs: StudioComparePaneSpec[];
  comparePaneLoading: boolean;
  compareRefreshingPaneIds: string[];
  activeArtifact: StudioArtifactSummary | null;
  artifactHistory: StudioArtifactSummary[];
  savedRecipes: StudioSavedRecipeSummary[];
  activeIssueMemberIds: string[];
  activeIssueLabel: string | null;
  designSearch: string;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  activeDesignFilters: StudioDesignFilter[];
}

export function computeStudioDerivedSnapshot(input: StudioDerivedSnapshotInput) {
  const {
    activeSetId,
    activeFeatureId,
    activeLens,
    activeMemberId,
    compareCohortId,
    activeScopeCohortId,
    activeExpressionId,
    sets,
    features,
    cohorts,
    expressions,
    materialization,
    comparePaneSpecs,
    comparePaneLoading,
    compareRefreshingPaneIds,
    activeArtifact,
    artifactHistory,
    savedRecipes,
    activeIssueMemberIds,
    activeIssueLabel,
    designSearch,
    sortColumn,
    sortDirection,
    activeDesignFilters,
  } = input;

  const activeSet = activeSetId ? sets[activeSetId] ?? null : null;
  const activeFeature = activeFeatureId ? features[activeFeatureId] ?? null : null;
  const compareCohort = compareCohortId ? cohorts[compareCohortId] ?? null : null;
  const scopeCohort = activeScopeCohortId ? cohorts[activeScopeCohortId] ?? null : null;
  const activeExpression = activeExpressionId ? expressions[activeExpressionId] ?? null : null;
  const activeMember =
    activeSet?.memberSummaries.find((member) => member.id === activeMemberId) ?? null;
  const cohortList =
    activeSet?.savedCohortIds.map((cohortId) => cohorts[cohortId]).filter(Boolean) ?? [];
  const workspaceReadiness = deriveWorkspaceReadiness(activeSet);

  const baseVisibleMemberIds =
    scopeCohort?.memberIds.filter((memberId) => activeSet?.memberIds.includes(memberId)) ??
    activeSet?.memberIds ??
    [];
  const issueVisibleMemberIds =
    activeIssueMemberIds.length > 0
      ? baseVisibleMemberIds.filter((memberId) => activeIssueMemberIds.includes(memberId))
      : baseVisibleMemberIds;
  const normalizedDesignSearch = designSearch.trim().toLowerCase();
  const searchFilteredMemberIds =
    normalizedDesignSearch.length === 0
      ? issueVisibleMemberIds
      : issueVisibleMemberIds.filter((memberId) => {
          if (memberId.toLowerCase().includes(normalizedDesignSearch)) {
            return true;
          }
          const row = activeSet?.designTablePreview?.rows.find((candidate) => candidate.id === memberId);
          return row?.cells.some((cell) => cell.toLowerCase().includes(normalizedDesignSearch)) ?? false;
        });
  const filteredMemberIds =
    activeDesignFilters.length === 0 || !activeSet?.designTablePreview
      ? searchFilteredMemberIds
      : searchFilteredMemberIds.filter((memberId) => {
          const row = activeSet.designTablePreview.rows.find((candidate) => candidate.id === memberId);
          if (!row) {
            return false;
          }
          return activeDesignFilters.every((filter) => {
            const columnIndex = activeSet.designTablePreview?.columns.indexOf(filter.column) ?? -1;
            if (columnIndex < 0) {
              return true;
            }
            return row.cells[columnIndex] === filter.value;
          });
        });

  const visibleMemberIds = (() => {
    if (!sortColumn || !activeSet?.designTablePreview) {
      return filteredMemberIds;
    }

    const columnIndex = activeSet.designTablePreview.columns.indexOf(sortColumn);
    if (columnIndex < 0) {
      return filteredMemberIds;
    }

    const rowMap = new Map(activeSet.designTablePreview.rows.map((row) => [row.id, row]));
    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: 'base',
    });

    return [...filteredMemberIds].sort((leftId, rightId) => {
      const leftValue = rowMap.get(leftId)?.cells[columnIndex] ?? leftId;
      const rightValue = rowMap.get(rightId)?.cells[columnIndex] ?? rightId;
      const order = collator.compare(leftValue, rightValue);
      return sortDirection === 'desc' ? -order : order;
    });
  })();

  const quickFilterOptions = (() => {
    if (!activeSet?.designTablePreview) {
      return [];
    }

    const rows = activeSet.designTablePreview.rows.filter((row) =>
      searchFilteredMemberIds.includes(row.id)
    );
    return activeSet.designTablePreview.columns
      .slice(0, 4)
      .map((column, columnIndex) => {
        const values = Array.from(
          new Set(
            rows
              .map((row) => row.cells[columnIndex])
              .filter((value): value is string => Boolean(value))
          )
        ).slice(0, 6);

        return { column, values };
      })
      .filter((option) => option.values.length > 0);
  })();

  const activeFilterLabels = activeDesignFilters.map((filter) => `${filter.column}=${filter.value}`);
  const sortLabel = sortColumn ? `${sortColumn} ${sortDirection}` : null;

  return {
    activeSetId,
    activeSet,
    activeFeature,
    activeLens,
    activeMemberId,
    activeExpressionId,
    activeMember,
    compareCohort,
    scopeCohort,
    activeExpression,
    materialization,
    comparePaneSpecs,
    comparePaneLoading,
    compareRefreshingPaneIds,
    activeArtifact,
    artifactHistory,
    savedRecipes,
    cohortList,
    workspaceReadiness,
    activeIssueMemberIds,
    activeIssueLabel,
    designSearch,
    sortColumn,
    sortDirection,
    activeDesignFilters,
    visibleMemberIds,
    quickFilterOptions,
    activeFilterLabels,
    sortLabel,
  };
}

export function useStudioDerivedState() {
  const activeSetId = useSetStudioStore((state) => state.selection.activeSetId);
  const activeFeatureId = useSetStudioStore((state) => state.selection.activeFeatureId);
  const activeLens = useSetStudioStore((state) => state.selection.activeLens);
  const activeMemberId = useSetStudioStore((state) => state.selection.activeMemberId);
  const compareCohortId = useSetStudioStore((state) => state.selection.compareCohortId);
  const activeScopeCohortId = useSetStudioStore((state) => state.selection.activeScopeCohortId);
  const activeExpressionId = useSetStudioStore((state) => state.selection.activeExpressionId);
  const sets = useSetStudioStore((state) => state.sets);
  const features = useSetStudioStore((state) => state.features);
  const cohorts = useSetStudioStore((state) => state.cohorts);
  const expressions = useSetStudioStore((state) => state.expressions);
  const materialization = useSetStudioStore((state) => state.materialization);
  const comparePaneSpecs = useSetStudioStore((state) => state.comparePaneSpecs);
  const comparePaneLoading = useSetStudioStore((state) => state.comparePaneLoading);
  const compareRefreshingPaneIds = useSetStudioStore((state) => state.compareRefreshingPaneIds);
  const activeArtifact = useSetStudioStore((state) => state.activeArtifact);
  const artifactHistory = useSetStudioStore((state) => state.artifactHistory);
  const savedRecipes = useSetStudioStore((state) => state.savedRecipes);
  const activeIssueMemberIds = useSetStudioStore((state) => state.activeIssueMemberIds);
  const activeIssueLabel = useSetStudioStore((state) => state.activeIssueLabel);
  const designSearch = useSetStudioStore((state) => state.designSearch);
  const sortColumn = useSetStudioStore((state) => state.sortColumn);
  const sortDirection = useSetStudioStore((state) => state.sortDirection);
  const activeDesignFilters = useSetStudioStore((state) => state.activeDesignFilters);

  return useMemo(
    () =>
      computeStudioDerivedSnapshot({
        activeSetId,
        activeFeatureId,
        activeLens,
        activeMemberId,
        compareCohortId,
        activeScopeCohortId,
        activeExpressionId,
        sets,
        features,
        cohorts,
        expressions,
        materialization,
        comparePaneSpecs,
        comparePaneLoading,
        compareRefreshingPaneIds,
        activeArtifact,
        artifactHistory,
        savedRecipes,
        activeIssueMemberIds,
        activeIssueLabel,
        designSearch,
        sortColumn,
        sortDirection,
        activeDesignFilters,
      }),
    [
      activeSetId,
      activeFeatureId,
      activeLens,
      activeMemberId,
      compareCohortId,
      activeScopeCohortId,
      activeExpressionId,
      sets,
      features,
      cohorts,
      expressions,
      materialization,
      comparePaneSpecs,
      comparePaneLoading,
      compareRefreshingPaneIds,
      activeArtifact,
      artifactHistory,
      savedRecipes,
      activeIssueMemberIds,
      activeIssueLabel,
      designSearch,
      sortColumn,
      sortDirection,
      activeDesignFilters,
    ]
  );
}

export function deriveWorkspaceReadiness(activeSet: SpatialFieldSetSummary | null) {
  if (!activeSet) {
    return null;
  }

  const hasJoinProblems =
    activeSet.ingestAudit.join.unmatchedRows > 0 || activeSet.ingestAudit.join.duplicateKeys > 0;
  const compareReady = activeSet.ingestAudit.support.readyForCompare && !hasJoinProblems;

  if (compareReady) {
    return {
      state: 'ready' as const,
      eyebrow: 'Compare Ready',
      title: 'This set is ready for cohort-relative reading',
      message:
        'Alignment and join audit are clean enough to trust Compare as the primary workflow.',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-foreground',
    };
  }

  if (
    activeSet.ingestAudit.join.severity === 'error' ||
    activeSet.ingestAudit.support.severity === 'error'
  ) {
    return {
      state: 'blocked' as const,
      eyebrow: 'Audit Attention',
      title: 'Inspect this set before relying on Compare',
      message:
        'Blocking ingest or support problems are present. Use Deck and the audit panels to inspect the set first.',
      className: 'border-rose-500/30 bg-rose-500/10 text-foreground',
    };
  }

  return {
    state: 'review' as const,
    eyebrow: 'Deck First',
    title: 'Warnings are present; review before compare',
    message:
      'Studio can still browse this set, but unmatched rows, duplicate keys, or support warnings mean Compare should be treated as provisional.',
    className: 'border-amber-500/30 bg-amber-500/10 text-foreground',
  };
}

export function buildSubsetCohortLabel(
  filters: StudioDesignFilter[],
  search: string
): string {
  const parts = [
    ...filters.map((filter) => `${filter.column}=${filter.value}`),
    ...(search.trim() ? [`search ${search.trim()}`] : []),
  ];
  if (parts.length === 0) {
    return 'Saved Subset';
  }
  return `Subset · ${trimLabel(parts.join(' · '), 48)}`;
}

export function buildSubsetCohortDescription(
  filters: StudioDesignFilter[],
  search: string,
  scopeLabel: string | null
): string {
  const clauses = [
    filters.length > 0 ? `filters ${filters.map((filter) => `${filter.column}=${filter.value}`).join(', ')}` : null,
    search.trim() ? `search "${search.trim()}"` : null,
    scopeLabel ? `scoped within ${scopeLabel}` : null,
  ].filter(Boolean);
  if (clauses.length === 0) {
    return 'Saved from the current visible Studio subset.';
  }
  return `Saved from the current Studio subset using ${clauses.join('; ')}.`;
}

export function buildSubsetOriginLabel(
  filters: StudioDesignFilter[],
  search: string,
  scopeLabel: string | null
): string {
  const parts = [
    ...filters.map((filter) => `${filter.column}=${filter.value}`),
    ...(search.trim() ? [`search ${search.trim()}`] : []),
    ...(scopeLabel ? [`scope ${scopeLabel}`] : []),
  ];
  return parts.length > 0 ? trimLabel(parts.join(' · '), 64) : 'Current Studio subset';
}

export function trimLabel(label: string, max = 40): string {
  const compact = label.trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

export function buildDeckArtifact(args: {
  activeSet: SpatialFieldSetSummary | null;
  activeMember: StudioMemberSummary | null;
  activeFeatureLabel: string | null;
  scopeCohort: StudioCohortSummary | null;
  activeExpressionId: string | null;
}) {
  const { activeSet, activeMember, activeFeatureLabel, scopeCohort, activeExpressionId } = args;
  if (!activeSet || !activeMember) {
    return null;
  }

  return {
    id: `deck:${activeMember.id}`,
    kind: 'member' as const,
    lens: 'deck' as const,
    title: activeMember.id,
    subtitle: activeFeatureLabel
      ? `${activeFeatureLabel} on ${activeSet.supportLabel}`
      : activeSet.supportLabel,
    recipe: `member(${activeMember.id})`,
    sourcePath: activeMember.sourcePath,
    materializationKey: null,
    materializedAtMs: null,
    supportLabel: activeSet.supportLabel,
    alignmentClass: activeSet.alignmentClass,
    activeMemberId: activeMember.id,
    cohortId: null,
    cohortLabel: null,
    cohortOriginKind: null,
    cohortOriginLabel: null,
    scopeCohortId: scopeCohort?.id ?? null,
    scopeCohortLabel: scopeCohort?.label ?? null,
    scopeCohortOriginKind: scopeCohort?.originKind ?? null,
    scopeCohortOriginLabel: scopeCohort?.originLabel ?? null,
    activeExpressionId,
    paneId: null,
    bindingKind: activeMember.sourcePath ? 'member_source' : null,
    status: activeMember.sourcePath ? 'live' : 'blocked',
    capturedAtMs: 0,
  };
}
