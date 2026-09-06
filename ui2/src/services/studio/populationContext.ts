import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioDesignFilter,
  StudioSelection,
} from '@/types/studio';
import type {
  PopulationContext,
  PopulationState,
  PopulationWorkingSelection,
} from '@/types/population';

export interface PopulationContextHost {
  readonly sets: Record<string, SpatialFieldSetSummary>;
  readonly cohorts: Record<string, StudioCohortSummary>;
  readonly selection: StudioSelection;
  readonly activeDesignFilters: StudioDesignFilter[];
}

/** Scope and explicit metadata filters define eligibility. Search, issue-row
 * highlighting and ordering only affect presentation and are absent here. */
export function resolvePopulationContext(host: PopulationContextHost): PopulationContext {
  const activeSet = host.selection.activeSetId ? host.sets[host.selection.activeSetId] : null;
  if (!activeSet) return { memberIds: [], issue: null };
  const ids = activeSet.memberIds;
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    return { memberIds: [], issue: 'The dataset contains empty or duplicate observation IDs.' };
  }
  let eligible: readonly string[] = ids;
  const scopeId = host.selection.activeScopeCohortId;
  if (scopeId) {
    const scope = host.cohorts[scopeId];
    if (!scope || !activeSet.savedCohortIds.includes(scopeId)) {
      return { memberIds: [], issue: 'The scope cohort is unavailable for this dataset.' };
    }
    if (
      new Set(scope.memberIds).size !== scope.memberIds.length ||
      scope.memberIds.some((id) => !ids.includes(id))
    ) {
      return {
        memberIds: [],
        issue: 'The scope cohort contains duplicate or unavailable observations.',
      };
    }
    const scoped = new Set(scope.memberIds);
    eligible = ids.filter((id) => scoped.has(id));
  }
  if (host.activeDesignFilters.length === 0) return { memberIds: eligible, issue: null };
  const table = activeSet.designTablePreview;
  if (!table || host.activeDesignFilters.some((filter) => !table.columns.includes(filter.column))) {
    return { memberIds: [], issue: 'A population filter refers to unavailable metadata.' };
  }
  const rows = new Map(table.rows.map((row) => [row.id, row]));
  if (
    new Set(table.columns).size !== table.columns.length ||
    rows.size !== table.rows.length ||
    eligible.some((id) => !rows.has(id) || rows.get(id)?.cells.length !== table.columns.length)
  ) {
    return {
      memberIds: [],
      issue:
        'Population filtering requires complete, uniquely keyed metadata for the eligible observations.',
    };
  }
  return {
    memberIds: eligible.filter((id) =>
      host.activeDesignFilters.every(
        (filter) => rows.get(id)?.cells[table.columns.indexOf(filter.column)] === filter.value,
      ),
    ),
    issue: null,
  };
}

export function resolveWorkingMembers(
  context: readonly string[],
  working: PopulationWorkingSelection,
): string[] {
  if (working.kind === 'context') return [...context];
  const selected = new Set(working.memberIds);
  return context.filter((id) => selected.has(id));
}

export function resolvePopulation(
  host: PopulationContextHost & { readonly population: PopulationState },
) {
  const context = resolvePopulationContext(host);
  const workingMemberIds = resolveWorkingMembers(context.memberIds, host.population.working);
  const selected = new Set(workingMemberIds);
  const selectionOutsideContext =
    host.population.working.kind === 'members'
      ? host.population.working.memberIds.filter((id) => !context.memberIds.includes(id))
      : [];
  let referenceMemberIds: readonly string[] = [];
  let referenceIssue: string | null = context.issue;
  if (!referenceIssue && host.population.referenceMode === 'complement') {
    referenceMemberIds = context.memberIds.filter((id) => !selected.has(id));
  } else if (!referenceIssue && host.selection.compareCohortId) {
    const set = host.selection.activeSetId ? host.sets[host.selection.activeSetId] : null;
    const cohort = host.cohorts[host.selection.compareCohortId];
    if (!cohort || !set?.savedCohortIds.includes(cohort.id)) {
      referenceIssue = 'The reference cohort is unavailable for this dataset.';
    } else {
      // Retain the complete fixed reference. A changed context must not quietly
      // turn it into a smaller comparison group.
      referenceMemberIds = cohort.memberIds;
      if (
        new Set(referenceMemberIds).size !== referenceMemberIds.length ||
        referenceMemberIds.some((id) => !context.memberIds.includes(id))
      ) {
        referenceIssue =
          'The fixed reference includes duplicate or ineligible observations. Choose a new reference or restore the context.';
      }
    }
  }
  return {
    context,
    workingMemberIds,
    selectionOutsideContext,
    referenceMemberIds,
    referenceIssue,
    probe: host.population.pinnedProbe ?? host.population.hoverProbe,
  };
}
