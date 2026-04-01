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

const demoTemplateSource = (templateId: string) => `template:${templateId}`;

const DEMO_COMPARE_BINDINGS = {
  'cohort-mean': demoTemplateSource('MNI152NLin2009cAsym_GM_2mm'),
  residual: demoTemplateSource('MNI152NLin2009cAsym_WM_2mm'),
  zscore: demoTemplateSource('MNI152NLin2009cAsym_CSF_2mm'),
} as const;

const DEMO_MATERIALIZED_AT_MS = 0;

function isDemoSourceSet(activeSet: SpatialFieldSetSummary | null): boolean {
  return activeSet?.sourceKind === 'demo';
}

export function buildStudioComparePaneSpecs(args: {
  activeSet: SpatialFieldSetSummary | null;
  activeMember: StudioMemberSummary | null;
  compareCohort: StudioCohortSummary | null;
  activeExpression: StudioFieldExpressionSummary | null;
},
options?: {
  syntheticFallback?: boolean;
}): StudioComparePaneSpec[] {
  const { activeSet, activeMember, compareCohort, activeExpression } = args;
  const syntheticFallback = options?.syntheticFallback ?? false;
  const compareReady = activeSet?.ingestAudit.support.readyForCompare ?? false;
  const hasMemberPath = Boolean(activeMember?.sourcePath);
  const cohortSelected = Boolean(compareCohort);
  const useDemoBindings = isDemoSourceSet(activeSet) && compareReady && cohortSelected;

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
        cacheStatus: 'source',
        cacheMessage: hasMemberPath
          ? 'Bound directly to the active member source path.'
          : 'No member source path is available.',
        provenancePath: null,
      },
    },
    {
      id: 'cohort-mean',
      title: compareCohort?.label ?? 'Cohort mean',
      subtitle: compareCohort
        ? `${compareCohort.memberCount} members`
        : 'Select a cohort to enable derived panes',
      status: cohortSelected ? (compareReady ? (useDemoBindings ? 'live' : 'pending') : 'blocked') : 'blocked',
      reason: !cohortSelected
        ? 'No cohort selected.'
        : syntheticFallback && useDemoBindings
          ? 'Showing a synthetic demo cohort preview because backend materialization failed.'
        : useDemoBindings
          ? 'Using the seeded demo cohort artifact.'
        : compareReady
          ? 'Waiting for derived cohort materialization.'
          : 'Set ingest audit does not yet permit compare-safe reductions.',
      recipe: compareCohort ? `mean(cohort:${compareCohort.id})` : null,
      binding: {
        kind: 'derived_field',
        ready: useDemoBindings,
        sourcePath: useDemoBindings ? DEMO_COMPARE_BINDINGS['cohort-mean'] : null,
        materializationKey: compareCohort ? `cohort-mean:${compareCohort.id}` : null,
        materializedAtMs: useDemoBindings ? DEMO_MATERIALIZED_AT_MS : null,
        cacheStatus: useDemoBindings
          ? (syntheticFallback ? 'synthetic' : 'hit')
          : 'unavailable',
        cacheMessage: !cohortSelected
          ? 'No cohort selected.'
          : syntheticFallback && useDemoBindings
            ? 'Backend materialization failed; showing a synthetic demo cohort preview.'
          : useDemoBindings
            ? 'Using the seeded demo cohort artifact.'
            : compareReady
              ? 'Backend materialization has not produced a cache entry yet.'
              : 'Compare-safe reductions are unavailable for this set.',
        provenancePath: null,
      },
    },
    {
      id: 'residual',
      title: 'Residual',
      subtitle: activeMember ? `${activeMember.id} - cohort mean` : 'Current minus cohort mean',
      status:
        cohortSelected && compareReady && hasMemberPath
          ? (useDemoBindings ? 'live' : 'pending')
          : 'blocked',
      reason:
        syntheticFallback && useDemoBindings
          ? 'Showing a synthetic demo residual preview because backend materialization failed.'
          : useDemoBindings
          ? 'Using the seeded demo residual artifact.'
          : cohortSelected && compareReady && hasMemberPath
          ? 'Waiting for derived residual handle.'
          : 'Needs a bound current member and compare-safe cohort.',
      recipe: compareCohort && activeMember ? `residual(member:${activeMember.id}, cohort:${compareCohort.id})` : null,
      binding: {
        kind: 'derived_field',
        ready: useDemoBindings && hasMemberPath,
        sourcePath: useDemoBindings && hasMemberPath ? DEMO_COMPARE_BINDINGS.residual : null,
        materializationKey:
          compareCohort && activeMember ? `residual:${activeMember.id}:${compareCohort.id}` : null,
        materializedAtMs:
          useDemoBindings && hasMemberPath ? DEMO_MATERIALIZED_AT_MS : null,
        cacheStatus:
          useDemoBindings && hasMemberPath
            ? (syntheticFallback ? 'synthetic' : 'hit')
            : 'unavailable',
        cacheMessage:
          syntheticFallback && useDemoBindings
            ? 'Backend materialization failed; showing a synthetic demo residual preview.'
            : useDemoBindings
            ? 'Using the seeded demo residual artifact.'
            : cohortSelected && compareReady && hasMemberPath
              ? 'Backend materialization has not produced a residual cache entry yet.'
              : 'Residual materialization is not available yet.',
        provenancePath: null,
      },
    },
    {
      id: 'zscore',
      title: 'Z-score',
      subtitle: activeExpression?.label ?? 'Cohort-relative comparison',
      status:
        cohortSelected && compareReady && Boolean(activeExpression)
          ? (useDemoBindings ? 'live' : 'pending')
          : 'blocked',
      reason:
        syntheticFallback && useDemoBindings
          ? 'Showing a synthetic demo comparison preview because backend materialization failed.'
          : useDemoBindings
          ? 'Using the seeded demo comparison artifact.'
          : cohortSelected && compareReady && Boolean(activeExpression)
          ? 'Expression is defined; waiting for materialized compare output.'
          : 'Needs an active comparison expression and compare-safe cohort.',
      recipe: activeExpression?.recipe ?? null,
      binding: {
        kind: 'derived_field',
        ready: useDemoBindings && Boolean(activeExpression),
        sourcePath: useDemoBindings && activeExpression ? DEMO_COMPARE_BINDINGS.zscore : null,
        materializationKey: compareCohort && activeExpression ? `zscore:${compareCohort.id}:${activeExpression.id}` : null,
        materializedAtMs:
          useDemoBindings && activeExpression ? DEMO_MATERIALIZED_AT_MS : null,
        cacheStatus:
          useDemoBindings && Boolean(activeExpression)
            ? (syntheticFallback ? 'synthetic' : 'hit')
            : 'unavailable',
        cacheMessage:
          syntheticFallback && useDemoBindings
            ? 'Backend materialization failed; showing a synthetic demo comparison preview.'
            : useDemoBindings
            ? 'Using the seeded demo comparison artifact.'
            : cohortSelected && compareReady && Boolean(activeExpression)
              ? 'Backend materialization has not produced a z-score cache entry yet.'
              : 'Z-score materialization is not available yet.',
        provenancePath: null,
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
      return buildStudioComparePaneSpecs(args, { syntheticFallback: true });
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
