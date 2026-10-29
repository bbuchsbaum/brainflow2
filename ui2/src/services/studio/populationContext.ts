import { studioMetadata } from './studioMetadata';
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

/** Why an observation of the active dataset is outside the population context. */
export type PopulationExclusionReason =
  | {
      readonly kind: 'scope';
      readonly cohortId: string;
      readonly cohortLabel: string;
    }
  | {
      readonly kind: 'filter';
      readonly column: string;
      readonly value: string;
      /** The observation's own value for the column. */
      readonly observed: string | null;
    };

export interface PopulationExclusion {
  readonly memberId: string;
  readonly reason: PopulationExclusionReason;
}

/** The context plus a reason for every active-set observation outside it.
 * A whole-context issue is reported once as `issue`, with no per-member
 * exclusions: an unresolvable context does not mean every observation is out. */
export interface PopulationContextDetail extends PopulationContext {
  readonly excluded: readonly PopulationExclusion[];
}

export function describePopulationExclusion(reason: PopulationExclusionReason): string {
  return reason.kind === 'scope'
    ? `Outside the scope cohort ${reason.cohortLabel}`
    : `Filter ${reason.column} = ${reason.value}${reason.observed === null ? '' : ` (has ${reason.observed || 'an empty value'})`}`;
}

const contextIssue = (issue: string): PopulationContextDetail => ({
  memberIds: [],
  issue,
  excluded: [],
});

/** Scope and explicit metadata filters define eligibility. Search, issue-row
 * highlighting and ordering only affect presentation and are absent here. */
export function resolvePopulationContextDetail(
  host: PopulationContextHost,
): PopulationContextDetail {
  const activeSet = host.selection.activeSetId ? host.sets[host.selection.activeSetId] : null;
  if (!activeSet) return { memberIds: [], issue: null, excluded: [] };
  const ids = activeSet.memberIds;
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    return contextIssue('The dataset contains empty or duplicate observation IDs.');
  }
  let eligible: readonly string[] = ids;
  const excluded: PopulationExclusion[] = [];
  const scopeId = host.selection.activeScopeCohortId;
  if (scopeId) {
    const scope = host.cohorts[scopeId];
    if (!scope || !activeSet.savedCohortIds.includes(scopeId)) {
      return contextIssue('The scope cohort is unavailable for this dataset.');
    }
    if (
      new Set(scope.memberIds).size !== scope.memberIds.length ||
      scope.memberIds.some((id) => !ids.includes(id))
    ) {
      return contextIssue('The scope cohort contains duplicate or unavailable observations.');
    }
    const scoped = new Set(scope.memberIds);
    eligible = ids.filter((id) => scoped.has(id));
    const reason: PopulationExclusionReason = {
      kind: 'scope',
      cohortId: scope.id,
      cohortLabel: scope.label,
    };
    for (const id of ids) if (!scoped.has(id)) excluded.push({ memberId: id, reason });
  }
  if (host.activeDesignFilters.length === 0) return { memberIds: eligible, issue: null, excluded };
  const metadata = studioMetadata(activeSet, eligible);
  if (metadata.issue) return contextIssue(metadata.issue);
  if (host.activeDesignFilters.some((filter) => !metadata.columns.includes(filter.column)))
    return contextIssue('A population filter refers to unavailable metadata.');
  const memberIds: string[] = [];
  const filtered = new Map<string, PopulationExclusionReason>();
  for (const id of eligible) {
    const row = metadata.rows.get(id);
    const failed = host.activeDesignFilters.find((filter) => row?.[filter.column] !== filter.value);
    if (!failed) memberIds.push(id);
    else
      filtered.set(id, {
        kind: 'filter',
        column: failed.column,
        value: failed.value,
        observed: row?.[failed.column] ?? null,
      });
  }
  // Report exclusions in dataset order; a scope exclusion takes precedence.
  const scopedOut = new Map(excluded.map((entry) => [entry.memberId, entry.reason]));
  return {
    memberIds,
    issue: null,
    excluded: ids.flatMap((id) => {
      const reason = scopedOut.get(id) ?? filtered.get(id);
      return reason ? [{ memberId: id, reason }] : [];
    }),
  };
}

export function resolvePopulationContext(host: PopulationContextHost): PopulationContext {
  const { memberIds, issue } = resolvePopulationContextDetail(host);
  return { memberIds, issue };
}

export function resolveWorkingMembers(
  context: readonly string[],
  working: PopulationWorkingSelection,
): string[] {
  if (working.kind === 'context') return [...context];
  const selected = new Set(working.memberIds);
  return context.filter((id) => selected.has(id));
}

/** `context` may be supplied by a caller that already resolved it (for example
 * from `resolvePopulationContextDetail`), so it is not resolved twice. */
export function resolvePopulation(
  host: PopulationContextHost & { readonly population: PopulationState },
  context: PopulationContext = resolvePopulationContext(host),
) {
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
