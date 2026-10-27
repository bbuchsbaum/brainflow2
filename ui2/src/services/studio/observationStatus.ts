import {
  resolvePopulationContextDetail,
  resolveWorkingMembers,
  type PopulationContextDetail,
  type PopulationContextHost,
  type PopulationExclusionReason,
} from './populationContext';
import { resolvePopulationParticipants } from './populationParticipants';
import type { RelationshipUnassignedReason } from './PopulationRelationshipService';
import type { StudioCohortSummary } from '@/types/studio';
import type {
  PopulationContext,
  PopulationPartition,
  PopulationPreviewState,
  PopulationPreviewTarget,
  PopulationState,
} from '@/types/population';

/** The hold-to-preview target expanded to observation IDs. Presentation only. */
export interface ResolvedPopulationPreview {
  /** The effective unit: an unknown group or set falls back to the focused observation. */
  readonly kind: PopulationPreviewTarget['kind'];
  /** The named group or saved set, unfiltered, as the slice request receives it. */
  readonly members: { readonly label: string; readonly memberIds: readonly string[] } | null;
  readonly participant: boolean;
  /** Control label, e.g. "focused observation" or "Young controls (2 observations)". */
  readonly label: string;
  readonly holding: boolean;
  /** Context observations the target names, in context order. */
  readonly memberIds: readonly string[];
}

export interface PopulationPreviewInput {
  readonly preview: PopulationPreviewState;
  readonly contextMemberIds: readonly string[];
  readonly focusedId: string | null;
  readonly participantIdentity: ReadonlyMap<string, string> | null;
  readonly participantReduction: 'observations' | 'single' | 'mean' | null;
  readonly partition: PopulationPartition | null;
  readonly cohorts: Readonly<Record<string, StudioCohortSummary>>;
}

const observationCount = (n: number) => `${n} ${n === 1 ? 'observation' : 'observations'}`;

export function resolvePopulationPreview(input: PopulationPreviewInput): ResolvedPopulationPreview {
  const { preview, contextMemberIds, focusedId, participantIdentity: identity } = input;
  const target = preview.target;
  const named =
    target?.kind === 'group'
      ? (input.partition?.groups.find((group) => group.id === target.groupId) ?? null)
      : target?.kind === 'set'
        ? (input.cohorts[target.cohortId] ?? null)
        : null;
  const participant =
    !named &&
    !!identity &&
    (target?.kind ??
      (input.participantReduction !== 'observations' ? 'participant' : 'observation')) ===
      'participant';
  const kind: PopulationPreviewTarget['kind'] = named
    ? target!.kind
    : participant
      ? 'participant'
      : 'observation';
  let namedIds: ReadonlySet<string>;
  if (named) namedIds = new Set(named.memberIds);
  else if (participant) {
    const person = focusedId ? identity!.get(focusedId) : undefined;
    namedIds = new Set(
      person === undefined ? [] : contextMemberIds.filter((id) => identity!.get(id) === person),
    );
  } else namedIds = new Set(focusedId ? [focusedId] : []);
  return {
    kind,
    members: named ? { label: named.label, memberIds: named.memberIds } : null,
    participant,
    label: named
      ? `${named.label} (${observationCount(named.memberIds.length)})`
      : `focused ${participant ? 'participant' : 'observation'}`,
    holding: preview.holding,
    memberIds: contextMemberIds.filter((id) => namedIds.has(id)),
  };
}

/**
 * Facets of one observation. They co-occur (a selected observation can be
 * previewed out and unavailable at the probe), so views read flags rather
 * than one label.
 */
export interface ObservationStatus {
  readonly memberId: string;
  readonly inContext: boolean;
  /** Why the observation is outside the context; null inside it or under a whole-context issue. */
  readonly exclusion: PopulationExclusionReason | null;
  readonly selected: boolean;
  /** Removed by an active hold-to-preview. */
  readonly previewedOut: boolean;
  readonly unavailableAtProbe: boolean;
  /** Without a fitted position in the relationship fit, with the fit's reason. */
  readonly unassigned: RelationshipUnassignedReason | null;
}

export interface ObservationStatusInput {
  /** Dataset observations in source order. */
  readonly memberIds: readonly string[];
  readonly context: PopulationContextDetail;
  readonly workingMemberIds: readonly string[];
  readonly preview?: Pick<ResolvedPopulationPreview, 'holding' | 'memberIds'> | null;
  readonly unavailableAtProbe?: Iterable<string>;
  readonly unassigned?: readonly {
    readonly memberId: string;
    readonly reason: RelationshipUnassignedReason;
  }[];
}

export interface ObservationStatuses {
  /** A whole-context issue, reported once instead of per observation. */
  readonly issue: string | null;
  readonly byId: ReadonlyMap<string, ObservationStatus>;
  /** Observations outside the context with a reason, in dataset order. */
  readonly outside: readonly ObservationStatus[];
}

export function resolveObservationStatuses(input: ObservationStatusInput): ObservationStatuses {
  const { context } = input;
  const inContext = new Set(context.memberIds);
  const exclusions = new Map(context.excluded.map((entry) => [entry.memberId, entry.reason]));
  const selected = new Set(input.workingMemberIds);
  const previewed = new Set(input.preview?.holding ? input.preview.memberIds : []);
  const unavailable = new Set(input.unavailableAtProbe ?? []);
  const unassigned = new Map(
    (input.unassigned ?? []).map((entry) => [entry.memberId, entry.reason]),
  );
  const byId = new Map<string, ObservationStatus>();
  const outside: ObservationStatus[] = [];
  for (const memberId of input.memberIds) {
    const member = inContext.has(memberId);
    const status: ObservationStatus = {
      memberId,
      inContext: member,
      exclusion: member ? null : (exclusions.get(memberId) ?? null),
      selected: member && selected.has(memberId),
      previewedOut: member && previewed.has(memberId),
      unavailableAtProbe: member && unavailable.has(memberId),
      unassigned: member ? (unassigned.get(memberId) ?? null) : null,
    };
    byId.set(memberId, status);
    if (status.exclusion) outside.push(status);
  }
  return { issue: context.issue, byId, outside };
}

/** Members whose sampled response is missing or non-finite. */
export function probeUnavailableIds(
  rows: readonly { readonly member?: unknown; readonly value?: unknown }[],
): string[] {
  return rows
    .filter((row) => typeof row.value !== 'number' || !Number.isFinite(row.value))
    .map((row) => String(row.member));
}

/** The Studio fields the status resolvers read. Hover probes, presentation
 * and history are absent, so callers can memoise on these slices alone. */
export type StudioStatusHost = PopulationContextHost & {
  readonly population: Pick<PopulationState, 'working' | 'participants' | 'partition'>;
  readonly populationPreview: PopulationPreviewState;
};

/** The preview of the current Studio state, as the lens and values table read it. */
export function resolveStudioPopulationPreview(
  state: StudioStatusHost,
  population: { readonly context: PopulationContext; readonly workingMemberIds: readonly string[] },
): ResolvedPopulationPreview {
  return resolvePopulationPreview({
    preview: state.populationPreview,
    contextMemberIds: population.context.memberIds,
    focusedId: state.selection.activeMemberId,
    participantIdentity: resolvePopulationParticipants(state, population.workingMemberIds).identity,
    participantReduction: state.population.participants?.reduction ?? null,
    partition: state.population.partition,
    cohorts: state.cohorts,
  });
}

/** Every observation's facets for the current Studio state. The context is
 * resolved once; the preview is expanded only while it is held. */
export function resolveStudioObservationStatuses(
  state: StudioStatusHost,
  extras: Pick<ObservationStatusInput, 'unavailableAtProbe' | 'unassigned'> = {},
): ObservationStatuses {
  const context = resolvePopulationContextDetail(state);
  const workingMemberIds = resolveWorkingMembers(context.memberIds, state.population.working);
  const set = state.selection.activeSetId ? state.sets[state.selection.activeSetId] : null;
  return resolveObservationStatuses({
    memberIds: set?.memberIds ?? [],
    context,
    workingMemberIds,
    preview: state.populationPreview.holding
      ? resolveStudioPopulationPreview(state, { context, workingMemberIds })
      : null,
    ...extras,
  });
}

/** The preview-unit control's option value for a target. */
export function encodePreviewTarget(target: PopulationPreviewTarget): string {
  return target.kind === 'group'
    ? `group:${target.groupId}`
    : target.kind === 'set'
      ? `set:${target.cohortId}`
      : target.kind;
}

export function decodePreviewTarget(value: string): PopulationPreviewTarget {
  if (value.startsWith('group:')) return { kind: 'group', groupId: value.slice(6) };
  if (value.startsWith('set:')) return { kind: 'set', cohortId: value.slice(4) };
  return { kind: value === 'participant' ? 'participant' : 'observation' };
}
