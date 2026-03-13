import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioCompareMaterializeRequest,
  StudioComparePaneSpec,
  StudioFieldExpressionSummary,
  StudioMemberSummary,
} from '@/types/studio';
import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';

export function buildStudioComparePaneSpecs(args: {
  activeSet: SpatialFieldSetSummary | null;
  activeMember: StudioMemberSummary | null;
  compareCohort: StudioCohortSummary | null;
  activeExpression: StudioFieldExpressionSummary | null;
}): StudioComparePaneSpec[] {
  const { activeSet, activeMember, compareCohort, activeExpression } = args;
  const compareReady = activeSet?.ingestAudit.support.readyForCompare ?? false;
  const hasMemberPath = Boolean(activeMember?.sourcePath);
  const cohortSelected = Boolean(compareCohort);

  return [
    {
      id: 'current',
      title: activeMember?.id ?? 'Current member',
      subtitle: activeSet?.supportLabel ?? 'Unknown support',
      status: hasMemberPath ? 'live' : 'blocked',
      reason: hasMemberPath
        ? 'Bound to a concrete member source path.'
        : 'This member has no source path binding yet.',
      recipe: activeMember ? `member(${activeMember.id})` : null,
      binding: {
        kind: 'member_source',
        ready: hasMemberPath,
        sourcePath: activeMember?.sourcePath ?? null,
        materializationKey: null,
        materializedAtMs: null,
      },
    },
    {
      id: 'cohort-mean',
      title: compareCohort?.label ?? 'Cohort mean',
      subtitle: compareCohort
        ? `${compareCohort.memberCount} members`
        : 'Select a cohort to enable derived panes',
      status: cohortSelected ? (compareReady ? 'pending' : 'blocked') : 'blocked',
      reason: !cohortSelected
        ? 'No cohort selected.'
        : compareReady
          ? 'Waiting for derived cohort materialization.'
          : 'Set ingest audit does not yet permit compare-safe reductions.',
      recipe: compareCohort ? `mean(cohort:${compareCohort.id})` : null,
      binding: {
        kind: 'derived_field',
        ready: false,
        sourcePath: null,
        materializationKey: compareCohort ? `cohort-mean:${compareCohort.id}` : null,
        materializedAtMs: null,
      },
    },
    {
      id: 'residual',
      title: 'Residual',
      subtitle: activeMember ? `${activeMember.id} - cohort mean` : 'Current minus cohort mean',
      status: cohortSelected && compareReady && hasMemberPath ? 'pending' : 'blocked',
      reason:
        cohortSelected && compareReady && hasMemberPath
          ? 'Waiting for derived residual handle.'
          : 'Needs a bound current member and compare-safe cohort.',
      recipe: compareCohort && activeMember ? `residual(member:${activeMember.id}, cohort:${compareCohort.id})` : null,
      binding: {
        kind: 'derived_field',
        ready: false,
        sourcePath: null,
        materializationKey:
          compareCohort && activeMember ? `residual:${activeMember.id}:${compareCohort.id}` : null,
        materializedAtMs: null,
      },
    },
    {
      id: 'zscore',
      title: 'Z-score',
      subtitle: activeExpression?.label ?? 'Cohort-relative comparison',
      status: cohortSelected && compareReady && Boolean(activeExpression) ? 'pending' : 'blocked',
      reason:
        cohortSelected && compareReady && Boolean(activeExpression)
          ? 'Expression is defined; waiting for materialized compare output.'
          : 'Needs an active comparison expression and compare-safe cohort.',
      recipe: activeExpression?.recipe ?? null,
      binding: {
        kind: 'derived_field',
        ready: false,
        sourcePath: null,
        materializationKey: compareCohort && activeExpression ? `zscore:${compareCohort.id}:${activeExpression.id}` : null,
        materializedAtMs: null,
      },
    },
  ];
}

export class StudioCompareService {
  private transport: BackendTransport;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  async materializeComparePanes(args: {
    activeSet: SpatialFieldSetSummary | null;
    activeMember: StudioMemberSummary | null;
    compareCohort: StudioCohortSummary | null;
    activeExpression: StudioFieldExpressionSummary | null;
    forceRematerialize?: boolean;
  }): Promise<StudioComparePaneSpec[]> {
    const request = this.buildRequest(args);
    try {
      return await this.transport.invoke<StudioComparePaneSpec[]>(
        'materialize_set_studio_compare_panes',
        { request }
      );
    } catch (error) {
      console.warn('[StudioCompareService] Falling back to local compare-pane builder:', error);
      return buildStudioComparePaneSpecs(args);
    }
  }

  private buildRequest(args: {
    activeSet: SpatialFieldSetSummary | null;
    activeMember: StudioMemberSummary | null;
    compareCohort: StudioCohortSummary | null;
    activeExpression: StudioFieldExpressionSummary | null;
    forceRematerialize?: boolean;
  }): StudioCompareMaterializeRequest {
    const {
      activeSet,
      activeMember,
      compareCohort,
      activeExpression,
      forceRematerialize = false,
    } = args;
    return {
      supportLabel: activeSet?.supportLabel ?? 'Unknown support',
      compareReady: activeSet?.ingestAudit.support.readyForCompare ?? false,
      forceRematerialize,
      activeMemberId: activeMember?.id ?? null,
      activeMemberSourcePath: activeMember?.sourcePath ?? null,
      cohortMemberSourcePaths:
        compareCohort && activeSet
          ? compareCohort.memberIds
              .map((memberId) =>
                activeSet.memberSummaries.find((member) => member.id === memberId)?.sourcePath?.trim() ?? ''
              )
              .filter((path): path is string => path.length > 0)
          : [],
      compareCohortId: compareCohort?.id ?? null,
      compareCohortLabel: compareCohort?.label ?? null,
      compareCohortMemberCount: compareCohort?.memberCount ?? null,
      activeExpressionLabel: activeExpression?.label ?? null,
      activeExpressionRecipe: activeExpression?.recipe ?? null,
    };
  }
}

let instance: StudioCompareService | null = null;

export function getStudioCompareService(): StudioCompareService {
  if (!instance) {
    instance = new StudioCompareService();
  }
  return instance;
}
