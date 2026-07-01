import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioComparePaneSpec,
  StudioFieldExpressionSummary,
  StudioMemberSummary,
  StudioRoleBindingInput,
} from '@/types/studio';
import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import { isSetCompareReady } from '@/services/studio/importContract';
import type {
  StudioCompareMaterializeRequest,
  StudioComparePaneSpec as BackendStudioComparePaneSpec,
} from '@brainflow/api';

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

function materializedAtMsToNumber(value: bigint | number | null): number | null {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return value;
}

function toUiComparePaneSpec(pane: BackendStudioComparePaneSpec): StudioComparePaneSpec {
  return {
    ...pane,
    id: pane.id as StudioComparePaneSpec['id'],
    binding: pane.binding
      ? {
          ...pane.binding,
          materializedAtMs: materializedAtMsToNumber(pane.binding.materializedAtMs),
        }
      : null,
  };
}

type MemberBinding = NonNullable<StudioMemberSummary['bindings']>[number];

function selectedRoleForSet(
  activeSet: SpatialFieldSetSummary | null,
  activeMember: StudioMemberSummary | null
): string {
  return (
    activeSet?.primaryFeatureId ??
    activeMember?.bindings?.find((binding) => binding.isPrimary)?.role ??
    activeMember?.bindings?.[0]?.role ??
    'statmap'
  );
}

function bindingMatchesRole(binding: MemberBinding, role: string): boolean {
  return binding.role === role || binding.featureId === role;
}

function sourcePathForRole(member: StudioMemberSummary | null, role: string): string | null {
  if (!member) {
    return null;
  }
  const binding = member.bindings?.find((entry) => bindingMatchesRole(entry, role));
  return binding?.sourcePath?.trim() || member.sourcePath?.trim() || null;
}

function roleBindingInputsForMember(
  member: StudioMemberSummary,
  selectedRole: string,
  activeSet: SpatialFieldSetSummary | null
): StudioRoleBindingInput[] {
  const bindings = member.bindings ?? [];
  const inputs = bindings.map((binding) => ({
    memberId: member.id,
    role: binding.role,
    featureId: binding.featureId ?? null,
    sourcePath: binding.sourcePath ?? null,
    supportKind: binding.supportKind,
    supportLabel: binding.supportLabel ?? null,
    availability: binding.availability,
  }));
  if (!bindings.some((binding) => bindingMatchesRole(binding, selectedRole))) {
    inputs.push({
      memberId: member.id,
      role: selectedRole,
      featureId: selectedRole,
      sourcePath: null,
      supportKind: activeSet?.supportKind ?? 'unknown',
      supportLabel: activeSet?.supportLabel ?? null,
      availability: 'unavailable',
    });
  }
  return inputs;
}

function defaultReducerSpecs(
  selectedRole: string,
  activeMember: StudioMemberSummary | null,
  compareCohort: StudioCohortSummary | null
): StudioCompareMaterializeRequest['reducerSpecs'] {
  if (!compareCohort) {
    return null;
  }
  return [
    {
      id: `sd-${selectedRole}`,
      label: `${selectedRole} SD`,
      kind: 'sd',
      role: selectedRole,
      cohortId: compareCohort.id,
      excludedMemberId: null,
    },
    {
      id: `loo-mean-${selectedRole}`,
      label: `${selectedRole} leave-one-out mean`,
      kind: 'leave_one_out_mean',
      role: selectedRole,
      cohortId: compareCohort.id,
      excludedMemberId: activeMember?.id ?? null,
    },
  ];
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
  const compareReady = isSetCompareReady(activeSet);
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
      const panes = await this.transport.invoke<BackendStudioComparePaneSpec[]>(
        'materialize_set_studio_compare_panes',
        { request }
      );
      return panes.map(toUiComparePaneSpec);
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
    const selectedRole = selectedRoleForSet(activeSet, activeMember);
    const activeMemberSourcePath = sourcePathForRole(activeMember, selectedRole);
    const cohortMembers =
      compareCohort && activeSet
        ? compareCohort.memberIds
            .map((memberId) =>
              activeSet.memberSummaries.find((member) => member.id === memberId) ?? null
            )
            .filter((member): member is StudioMemberSummary => Boolean(member))
        : [];
    const cohortMemberSourcePaths = cohortMembers
      .map((member) => sourcePathForRole(member, selectedRole)?.trim() ?? '')
      .filter((path): path is string => path.length > 0);
    const activeMemberRoleBindings = activeMember
      ? roleBindingInputsForMember(activeMember, selectedRole, activeSet)
      : [];
    const cohortMemberRoleBindings = cohortMembers.flatMap((member) =>
      roleBindingInputsForMember(member, selectedRole, activeSet)
    );
    return {
      supportLabel: activeSet?.supportLabel ?? 'Unknown support',
      compareReady: isSetCompareReady(activeSet),
      forceRematerialize,
      activeMemberId: activeMember?.id ?? null,
      activeMemberSourcePath,
      cohortMemberSourcePaths,
      compareCohortId: compareCohort?.id ?? null,
      compareCohortLabel: compareCohort?.label ?? null,
      compareCohortMemberCount: compareCohort?.memberCount ?? null,
      activeExpressionLabel: activeExpression?.label ?? null,
      activeExpressionRecipe: activeExpression?.recipe ?? null,
      reducerSpecs: defaultReducerSpecs(selectedRole, activeMember, compareCohort),
      activeMemberRoleBindings,
      cohortMemberRoleBindings,
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
