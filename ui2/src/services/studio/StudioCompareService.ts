import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioComparePaneNotReadyKind,
  StudioComparePaneSpec,
  StudioFieldExpressionSummary,
  StudioMemberSummary,
  StudioRoleBindingInput,
} from '@/types/studio';
import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import { isSetCompareReady } from '@/services/studio/importContract';
import { studioReadiness } from '@/services/studio/studioReadiness';
import {
  getStudioSourceFetchService,
  plainStudioSourceError,
  StudioSourceFetchError,
  type StudioSource,
} from '@/services/studio/StudioSourceFetchService';
import type {
  StudioCompareMaterializeRequest,
  StudioComparePaneSpec as BackendStudioComparePaneSpec,
  StudioMaterializationJobStatus,
} from '@brainflow/api';

const demoTemplateSource = (templateId: string) => `template:${templateId}`;
const MATERIALIZATION_POLL_INTERVAL_MS = 50;

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

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(materializationCancelledError());
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        reject(materializationCancelledError());
      },
      { once: true }
    );
  });
}

function materializationCancelledError(): Error {
  const error = new Error('Set studio materialization cancelled.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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

/** What each kind of missing input reads as, in a pane. */
export const NOT_READY_TEXT: Record<StudioComparePaneNotReadyKind, string> = {
  'grid-check': 'Image grids have not been checked yet.',
  'different-grids': 'These images are on different grids, so they cannot be averaged.',
  'not-confirmed': 'These images were not confirmed to be on one grid, so they cannot be averaged.',
  'no-group': 'Choose what to compare the member with.',
  'no-member': 'Choose a member to compare.',
  'no-comparison': 'Choose a comparison.',
  'no-mean': 'Needs the mean, which could not be computed.',
  fetch: 'Needs images that have not been fetched from the remote folder yet.',
};

type ComparePaneArgs = {
  activeSet: SpatialFieldSetSummary | null;
  activeMember: StudioMemberSummary | null;
  compareCohort: StudioCohortSummary | null;
  activeExpression: StudioFieldExpressionSummary | null;
};

/** Why the set as a whole cannot be averaged yet, if it cannot. */
function setNotReady(
  activeSet: SpatialFieldSetSummary | null,
): { kind: StudioComparePaneNotReadyKind; message: string } | null {
  if (!activeSet || isSetCompareReady(activeSet)) return null;
  // The grid check's own progress is the lens's to show (studioReadiness
  // with the live check state); here it is only "not checked" or not.
  const readiness = studioReadiness(activeSet, { status: 'idle', message: null }, 'compare');
  if (readiness.phase === 'needs-check' || readiness.phase === 'check-failed')
    return { kind: 'grid-check', message: readiness.short };
  const mixed =
    (activeSet.ingestAudit?.support?.alignmentClass ?? activeSet.alignmentClass) === 'mixed';
  return { kind: mixed ? 'different-grids' : 'not-confirmed', message: readiness.short };
}

const FAILED_PREFIX = /^(Cohort mean|Residual|Z-score) materialization failed:\s*/;
const FAILED_SUBJECT: Record<string, string> = {
  'Cohort mean': 'The mean',
  Residual: 'The residual',
  'Z-score': 'The z-score map',
};

/**
 * Pane specs as the Studio shows them, whoever built them (the backend's
 * materialization or the local builder).
 *
 * A pane whose inputs are not available yet (grids unchecked, no member, no
 * group or comparison chosen, no mean to subtract) is marked `notReady` with
 * a plain sentence saying what is needed. It has not failed, whatever status
 * the builder gave it. A pane left `blocked` without `notReady` is a real
 * failure, and keeps the builder's reason in plain words. Titles and
 * subtitles say each fact once: the pane's subject, then what it computes.
 */
export function presentComparePaneSpecs(
  args: ComparePaneArgs,
  specs: StudioComparePaneSpec[],
): StudioComparePaneSpec[] {
  const { activeSet, activeMember, compareCohort, activeExpression } = args;
  const hasMember = Boolean(activeMember?.sourcePath);
  const set = setNotReady(activeSet);
  const meanReady = Boolean(specs.find((pane) => pane.id === 'cohort-mean')?.binding?.ready);
  const waiting = (
    kind: StudioComparePaneNotReadyKind,
    message = NOT_READY_TEXT[kind],
  ): StudioComparePaneSpec['notReady'] => ({ kind, message });
  return specs.map((pane) => {
    if (pane.id === 'current')
      return {
        ...pane,
        subtitle: 'Current member',
        reason: hasMember ? 'Shows this member’s image.' : 'This member has no image file.',
        notReady: null,
      };
    const subtitle =
      pane.id === 'cohort-mean'
        ? 'Mean'
        : pane.id === 'residual'
          ? 'Current − mean'
          : pane.id === 'zscore'
            ? '(Current − mean) / SD'
            : pane.subtitle;
    if (pane.binding?.ready) return { ...pane, subtitle, notReady: null };
    let notReady: StudioComparePaneSpec['notReady'] = null;
    if (!compareCohort) notReady = waiting('no-group');
    else if (set) notReady = set;
    else if (pane.id === 'residual' && !hasMember) notReady = waiting('no-member');
    else if (pane.id === 'zscore' && !activeExpression) notReady = waiting('no-comparison');
    else if (pane.id === 'zscore' && !hasMember) notReady = waiting('no-member');
    else if (pane.id !== 'cohort-mean' && pane.status === 'blocked' && !meanReady)
      notReady = waiting('no-mean');
    if (notReady) return { ...pane, subtitle, reason: notReady.message, notReady };
    const failed = FAILED_PREFIX.exec(pane.reason);
    return {
      ...pane,
      subtitle,
      // Why, in plain words: a missing image is named, not shown as the
      // decoder's nested I/O error.
      reason: failed
        ? `${FAILED_SUBJECT[failed[1]]} could not be computed: ${plainStudioSourceError(
            pane.reason.slice(failed[0].length),
            (path) => sourceNameForPath(activeSet, path),
          )}`
        : pane.reason,
      notReady: null,
    };
  });
}

/** "sub-1014: same_item.nii.gz" for a member's image file, else null. */
function sourceNameForPath(
  activeSet: SpatialFieldSetSummary | null,
  path: string,
): string | null {
  const member = activeSet?.memberSummaries.find(
    (candidate) =>
      candidate.sourcePath === path ||
      candidate.bindings?.some((binding) => binding.sourcePath === path),
  );
  const file = path.split(/[\\/]/).filter(Boolean).pop();
  return member && file ? `${member.id}: ${file}` : null;
}

/**
 * The panes when the images of a remote set are not on this computer: the
 * member's own pane as it is, and each computed pane saying what it waits
 * for (a fetch that is stopped or unconfirmed) or why the fetch failed.
 */
function comparePanesWithoutSources(
  args: ComparePaneArgs,
  error: StudioSourceFetchError,
): StudioComparePaneSpec[] {
  return buildStudioComparePaneSpecs(args).map((pane) => {
    if (pane.id === 'current' || pane.binding?.ready || pane.notReady) return pane;
    if (error.kind !== 'failed')
      return {
        ...pane,
        status: 'blocked' as const,
        reason: NOT_READY_TEXT.fetch,
        notReady: { kind: 'fetch' as const, message: NOT_READY_TEXT.fetch },
      };
    return pane.id === 'cohort-mean'
      ? {
          ...pane,
          status: 'blocked' as const,
          reason: `The mean could not be computed: ${error.message}`,
          notReady: null,
        }
      : {
          ...pane,
          status: 'blocked' as const,
          reason: NOT_READY_TEXT['no-mean'],
          notReady: { kind: 'no-mean' as const, message: NOT_READY_TEXT['no-mean'] },
        };
  });
}

/** The image files a Compare request reads: the group's and the member's. */
function compareFetchSources(
  request: StudioCompareMaterializeRequest,
  activeSet: SpatialFieldSetSummary | null,
): StudioSource[] {
  if (!request.compareReady || !request.compareCohortId) return [];
  const paths = [...request.cohortMemberSourcePaths];
  if (request.activeMemberSourcePath) paths.push(request.activeMemberSourcePath);
  return paths.map((path) => ({
    path,
    label: activeSet?.memberSummaries.find((member) =>
      member.sourcePath === path ||
      member.bindings?.some((binding) => binding.sourcePath === path),
    )?.id,
  }));
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

  return presentComparePaneSpecs(args, [
    {
      id: 'current',
      title: activeMember?.id ?? 'Current member',
      subtitle: 'Current member',
      status: hasMemberPath ? 'live' : 'blocked',
      reason: hasMemberPath ? 'Shows this member’s image.' : 'This member has no image file.',
      recipe: activeMember ? `member(${activeMember.id})` : null,
      binding: {
        kind: 'member_source',
        ready: hasMemberPath,
        sourcePath: activeMember?.sourcePath ?? null,
        materializationKey: null,
        materializedAtMs: null,
        cacheStatus: 'source',
        cacheMessage: hasMemberPath
          ? 'Read directly from the member’s image file.'
          : 'This member has no image file.',
        provenancePath: null,
      },
    },
    {
      id: 'cohort-mean',
      title: compareCohort?.label ?? 'Group mean',
      subtitle: 'Mean',
      status: cohortSelected ? (compareReady ? (useDemoBindings ? 'live' : 'pending') : 'blocked') : 'blocked',
      reason: !cohortSelected
        ? NOT_READY_TEXT['no-group']
        : syntheticFallback && useDemoBindings
          ? 'Showing an example mean because the mean could not be computed.'
        : useDemoBindings
          ? 'Showing the example mean.'
        : compareReady
          ? 'The mean is being computed.'
          : NOT_READY_TEXT['not-confirmed'],
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
          ? NOT_READY_TEXT['no-group']
          : syntheticFallback && useDemoBindings
            ? 'Backend materialization failed; showing a synthetic demo cohort preview.'
          : useDemoBindings
            ? 'Showing the example mean.'
            : compareReady
              ? 'The mean has not been computed yet.'
              : NOT_READY_TEXT['not-confirmed'],
        provenancePath: null,
      },
    },
    {
      id: 'residual',
      title: 'Residual',
      subtitle: 'Current − mean',
      status:
        cohortSelected && compareReady && hasMemberPath
          ? (useDemoBindings ? 'live' : 'pending')
          : 'blocked',
      reason:
        syntheticFallback && useDemoBindings
          ? 'Showing an example residual because the residual could not be computed.'
          : useDemoBindings
          ? 'Showing the example residual.'
          : cohortSelected && compareReady && hasMemberPath
          ? 'The residual is being computed.'
          : NOT_READY_TEXT[hasMemberPath ? 'not-confirmed' : 'no-member'],
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
            ? 'Showing the example residual.'
            : cohortSelected && compareReady && hasMemberPath
              ? 'The residual has not been computed yet.'
              : 'The residual is not available yet.',
        provenancePath: null,
      },
    },
    {
      id: 'zscore',
      title: 'Z-score',
      subtitle: '(Current − mean) / SD',
      status:
        cohortSelected && compareReady && Boolean(activeExpression)
          ? (useDemoBindings ? 'live' : 'pending')
          : 'blocked',
      reason:
        syntheticFallback && useDemoBindings
          ? 'Showing an example z-score map because the z-scores could not be computed.'
          : useDemoBindings
          ? 'Showing the example z-score map.'
          : cohortSelected && compareReady && Boolean(activeExpression)
          ? 'The z-scores are being computed.'
          : NOT_READY_TEXT[activeExpression ? 'not-confirmed' : 'no-comparison'],
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
            ? 'Showing the example z-score map.'
            : cohortSelected && compareReady && Boolean(activeExpression)
              ? 'The z-scores have not been computed yet.'
              : 'The z-score map is not available yet.',
        provenancePath: null,
      },
    },
  ]);
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
  },
  options?: {
    signal?: AbortSignal;
  }): Promise<StudioComparePaneSpec[]> {
    const request = this.buildRequest(args);

    // On a remote mount only the images something has opened are on this
    // computer: fetch the ones this request reads first. A local set has
    // nothing pending and goes straight on.
    const fetching = getStudioSourceFetchService().pending(
      compareFetchSources(request, args.activeSet),
      options?.signal,
    );
    if (fetching) {
      try {
        await fetching;
      } catch (error) {
        if (error instanceof StudioSourceFetchError)
          return comparePanesWithoutSources(args, error);
        throw error;
      }
    }

    try {
      const panes = await this.materializeComparePanesViaJob(request, options?.signal);
      return presentComparePaneSpecs(args, panes.map(toUiComparePaneSpec));
    } catch (jobError) {
      if (isAbortError(jobError)) {
        throw jobError;
      }
      console.warn('[StudioCompareService] Falling back to direct compare-pane materialization:', jobError);
    }

    try {
      const panes = await this.transport.invoke<BackendStudioComparePaneSpec[]>(
        'materialize_set_studio_compare_panes',
        { request }
      );
      return presentComparePaneSpecs(args, panes.map(toUiComparePaneSpec));
    } catch (error) {
      console.warn('[StudioCompareService] Falling back to local compare-pane builder:', error);
      return buildStudioComparePaneSpecs(args, { syntheticFallback: true });
    }
  }

  private async materializeComparePanesViaJob(
    request: StudioCompareMaterializeRequest,
    signal?: AbortSignal
  ): Promise<BackendStudioComparePaneSpec[]> {
    const jobId = await this.transport.invoke<string>('start_set_studio_compare_materialization', {
      request,
    });
    if (typeof jobId !== 'string' || !jobId.trim()) {
      throw new Error('Backend did not return a materialization job id.');
    }

    let cancelIssued = false;
    const cancelBackendJob = async () => {
      if (cancelIssued) {
        return;
      }
      cancelIssued = true;
      try {
        await this.transport.invoke<boolean>('cancel_set_studio_materialization', { jobId });
      } catch (error) {
        console.warn('[StudioCompareService] Failed to cancel materialization job:', error);
      }
    };
    const abortListener = () => {
      void cancelBackendJob();
    };

    if (signal?.aborted) {
      await cancelBackendJob();
      throw materializationCancelledError();
    }

    signal?.addEventListener('abort', abortListener, { once: true });
    try {
      for (;;) {
        if (signal?.aborted) {
          await cancelBackendJob();
          throw materializationCancelledError();
        }

        const status = await this.transport.invoke<StudioMaterializationJobStatus | null>(
          'get_set_studio_materialization_status',
          { jobId }
        );
        if (!status) {
          throw new Error(`Materialization job ${jobId} was not found.`);
        }

        if (status.state === 'completed') {
          if (!status.result) {
            throw new Error(`Materialization job ${jobId} completed without a result.`);
          }
          return status.result;
        }
        if (status.state === 'failed') {
          throw new Error(status.error ?? status.message ?? `Materialization job ${jobId} failed.`);
        }
        if (status.state === 'cancelled') {
          throw materializationCancelledError();
        }

        await delay(MATERIALIZATION_POLL_INTERVAL_MS, signal);
      }
    } finally {
      signal?.removeEventListener('abort', abortListener);
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
