import { validatePopulationPartition } from '@/services/studio/populationGroups';
import { participantIdentity } from '@/services/studio/populationParticipants';
import type {
  PopulationActionResult,
  PopulationInference,
  PopulationPresentation,
  PopulationPartition,
  PopulationMask,
  PopulationParticipantDefinition,
  PopulationPreviewState,
  PopulationPreviewTarget,
  PopulationProbe,
  PopulationRelationship,
  PopulationSelectionOrigin,
  PopulationState,
  PopulationWorkingSelection,
} from '@/types/population';
import {
  resolvePopulationContext,
  resolveWorkingMembers,
  type PopulationContextHost,
} from '@/services/studio/populationContext';

export function initialPopulationState(sessionRevision = 0): PopulationState {
  return {
    sessionRevision,
    inference: null,
    partition: null,
    partitionPast: [],
    presentation: { arrangement: 'inspect', order: null },
    participants: null,
    mask: null,
    working: { kind: 'context' },
    referenceMode: 'cohort',
    pinnedProbe: null,
    hoverProbe: null,
    relationship: null,
    selectionPast: [],
    selectionFuture: [],
  };
}

export const INITIAL_POPULATION_PREVIEW: PopulationPreviewState = Object.freeze({
  target: null,
  holding: false,
});

const PREVIEW_TARGET_KINDS = ['observation', 'participant', 'group', 'set'];

export interface PopulationSlice {
  population: PopulationState;
  /** Presentation state kept outside `population`, so nothing that reads or
   * serializes the analytical state observes a preview. */
  populationPreview: PopulationPreviewState;
  setPopulationPreviewTarget: (target: PopulationPreviewTarget | null) => PopulationActionResult;
  setPopulationPreviewHolding: (holding: boolean) => void;
  clearPopulationPreview: () => void;
  /** After a context change, release a held preview; clear the target only
   * when it no longer resolves. */
  reconcilePopulationPreview: (contextChanged: boolean) => void;
  setPopulationFocusedFrame: (memberId: string, frame: number) => PopulationActionResult;
  configurePopulationInference: (definition: PopulationInference | null) => PopulationActionResult;
  setPopulationPartition: (partition: PopulationPartition | null) => PopulationActionResult;
  undoPopulationPartition: () => void;
  setPopulationPresentation: (presentation: PopulationPresentation) => PopulationActionResult;
  configurePopulationMask: (
    mask: (PopulationMask & { readonly setId: string }) | null,
  ) => PopulationActionResult;
  configurePopulationParticipants: (
    definition: PopulationParticipantDefinition | null,
  ) => PopulationActionResult;
  selectPopulationMembers: (
    ids: readonly string[],
    origin?: PopulationSelectionOrigin,
    label?: string,
  ) => PopulationActionResult;
  selectPopulationContext: () => void;
  combinePopulationMembers: (
    operation: 'union' | 'intersection' | 'difference',
    ids: readonly string[],
    origin?: PopulationSelectionOrigin,
  ) => PopulationActionResult;
  setPopulationReferenceMode: (mode: 'cohort' | 'complement') => void;
  setPopulationProbe: (
    probe: PopulationProbe | null,
    mode: 'pin' | 'hover',
  ) => PopulationActionResult;
  setPopulationRelationship: (
    relationship: PopulationRelationship | null,
  ) => PopulationActionResult;
  undoPopulationSelection: () => void;
  redoPopulationSelection: () => void;
}

type Host = PopulationContextHost & PopulationSlice;

const sameValue = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/** True when the fields that define the population context differ between
 * `previous` and `state`: session, active dataset and its observations or
 * metadata, scope and its members, and filters. Saving, renaming or deleting
 * an unrelated cohort replaces references but is not a context change. */
export function populationPreviewContextChanged(state: Host, previous: Host): boolean {
  const setId = state.selection.activeSetId;
  const scopeId = state.selection.activeScopeCohortId;
  const set = setId ? state.sets[setId] : undefined;
  const before = setId ? previous.sets[setId] : undefined;
  return (
    state.population.sessionRevision !== previous.population.sessionRevision ||
    setId !== previous.selection.activeSetId ||
    scopeId !== previous.selection.activeScopeCohortId ||
    !sameValue(state.activeDesignFilters, previous.activeDesignFilters) ||
    (set !== before &&
      (!set ||
        !before ||
        !sameValue(set.memberIds, before.memberIds) ||
        !sameValue(set.memberSummaries, before.memberSummaries) ||
        !sameValue(set.designTablePreview, before.designTablePreview))) ||
    (scopeId !== null &&
      !sameValue(state.cohorts[scopeId]?.memberIds, previous.cohorts[scopeId]?.memberIds))
  );
}

/** Whether the chosen preview target still names something: a partition group
 * or saved set of the active dataset, or a participant identity. */
export function populationPreviewTargetResolves(state: Host): boolean {
  const target = state.populationPreview.target;
  if (!target || target.kind === 'observation') return true;
  if (target.kind === 'group')
    return !!state.population.partition?.groups.some((group) => group.id === target.groupId);
  const set = state.selection.activeSetId ? state.sets[state.selection.activeSetId] : undefined;
  if (target.kind === 'set')
    return !!set?.savedCohortIds.includes(target.cohortId) && !!state.cohorts[target.cohortId];
  const definition = state.population.participants;
  if (!set || !definition) return false;
  try {
    participantIdentity(set, definition);
    return true;
  } catch {
    return false;
  }
}
type Set = (
  state: Partial<Pick<Host, 'population' | 'selection' | 'populationPreview'>>,
) => void;
const ok: PopulationActionResult = { ok: true };
const fail = (reason: string): PopulationActionResult => ({ ok: false, reason });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const MAX_SELECTION_HISTORY = 40;

function copyProbe(probe: PopulationProbe | null): PopulationProbe | null {
  return probe
    ? {
        ...probe,
        worldMm: [...probe.worldMm],
        ...(probe.region ? { region: structuredClone(probe.region) } : {}),
      }
    : null;
}

export function createPopulationSlice(
  set: Set,
  get: () => Host,
): Omit<PopulationSlice, 'population' | 'populationPreview'> {
  const changeWorking = (working: PopulationWorkingSelection) => {
    const { population } = get();
    if (same(population.working, working)) return;
    set({
      population: {
        ...population,
        working,
        selectionPast: [...population.selectionPast, population.working].slice(
          -MAX_SELECTION_HISTORY,
        ),
        selectionFuture: [],
      },
    });
  };
  const checkedMembers = (ids: readonly string[]): PopulationActionResult => {
    const context = resolvePopulationContext(get());
    if (context.issue) return fail(context.issue);
    if (new Set(ids).size !== ids.length || ids.some((id) => !context.memberIds.includes(id))) {
      return fail('Selections require unique observation IDs from the current context.');
    }
    return ok;
  };
  return {
    setPopulationPreviewTarget(target) {
      if (
        target &&
        (!PREVIEW_TARGET_KINDS.includes(target.kind) ||
          (target.kind === 'group' && !target.groupId.trim()) ||
          (target.kind === 'set' && !target.cohortId.trim()))
      )
        return fail('Choose a focused observation, participant, group or saved set to preview.');
      const { populationPreview } = get();
      if (!same(populationPreview.target, target))
        set({
          populationPreview: { ...populationPreview, target: target ? { ...target } : null },
        });
      return ok;
    },
    setPopulationPreviewHolding(holding) {
      const { populationPreview } = get();
      if (populationPreview.holding !== holding)
        set({ populationPreview: { ...populationPreview, holding } });
    },
    reconcilePopulationPreview(contextChanged) {
      const state = get();
      const { populationPreview } = state;
      const target = populationPreviewTargetResolves(state) ? populationPreview.target : null;
      const holding = populationPreview.holding && !contextChanged && target === populationPreview.target;
      if (target !== populationPreview.target || holding !== populationPreview.holding)
        set({ populationPreview: { target, holding } });
    },
    clearPopulationPreview() {
      const { populationPreview } = get();
      if (populationPreview.target !== null || populationPreview.holding)
        set({ populationPreview: INITIAL_POPULATION_PREVIEW });
    },
    setPopulationFocusedFrame(memberId, frame) {
      const checked = checkedMembers([memberId]);
      if (!checked.ok) return checked;
      if (!Number.isSafeInteger(frame) || frame < 0)
        return fail('Choose a nonnegative integer image frame.');
      const state = get();
      if (
        state.selection.activeMemberId !== memberId ||
        state.population.focusedFrame?.memberId !== memberId ||
        state.population.focusedFrame.frame !== frame
      )
        set({
          selection: { ...state.selection, activeMemberId: memberId },
          population: { ...state.population, focusedFrame: { memberId, frame } },
        });
      return ok;
    },
    configurePopulationInference(definition) {
      const state = get();
      if (
        definition &&
        (definition.setId !== state.selection.activeSetId ||
          definition.featureId !== state.selection.activeFeatureId)
      )
        return fail('The feature changed; declare the current feature.');
      if (same(state.population.inference, definition)) return ok;
      set({
        population: {
          ...state.population,
          inference: definition ? structuredClone(definition) : null,
        },
      });
      return ok;
    },
    setPopulationPartition(partition) {
      const state = get();
      if (partition) {
        const context = resolvePopulationContext(state);
        if (context.issue) return fail(context.issue);
        const issue = validatePopulationPartition(
          partition,
          state.selection.activeSetId ?? '',
          context.memberIds,
        );
        if (issue) return fail(issue);
      }
      if (same(state.population.partition, partition)) return ok;
      set({
        population: {
          ...state.population,
          partition: structuredClone(partition),
          partitionPast: [...state.population.partitionPast, state.population.partition].slice(-20),
          presentation: {
            ...state.population.presentation,
            arrangement: partition ? 'groups' : 'inspect',
          },
        },
      });
      return ok;
    },
    undoPopulationPartition() {
      const { population } = get();
      if (!population.partitionPast.length) return;
      const partition = population.partitionPast.at(-1) ?? null;
      set({
        population: {
          ...population,
          partition,
          partitionPast: population.partitionPast.slice(0, -1),
          presentation: {
            ...population.presentation,
            arrangement: partition ? 'groups' : 'inspect',
          },
        },
      });
    },
    setPopulationPresentation(presentation) {
      const state = get();
      if (
        !['inspect', 'montage', 'groups', 'comparison', 'difference'].includes(
          presentation.arrangement,
        )
      )
        return fail('Unknown population arrangement.');
      if (presentation.order) {
        const checked = checkedMembers(presentation.order.orderedIds);
        if (!checked.ok) return checked;
        if (
          presentation.order.featureId !== state.selection.activeFeatureId ||
          presentation.order.orderedIds.length !== resolvePopulationContext(state).memberIds.length
        )
          return fail('Order must identify the complete current feature context.');
      }
      if (!same(state.population.presentation, presentation))
        set({ population: { ...state.population, presentation: structuredClone(presentation) } });
      return ok;
    },
    configurePopulationMask(mask) {
      const state = get();
      if (
        mask &&
        (mask.setId !== state.selection.activeSetId ||
          !mask.sourcePath.trim() ||
          mask.sourcePath !== mask.sourcePath.trim())
      )
        return fail('Choose a mask file for the current dataset.');
      if (!same(state.population.mask, mask))
        set({
          population: { ...state.population, mask: mask ? { ...mask } : null, relationship: null },
        });
      return ok;
    },
    configurePopulationParticipants(definition) {
      const state = get();
      if (definition) {
        const activeSet = state.selection.activeSetId
          ? state.sets[state.selection.activeSetId]
          : null;
        if (!activeSet || !['observations', 'single', 'mean'].includes(definition.reduction))
          return fail('Choose a dataset and a supported participant reduction.');
        try {
          participantIdentity(activeSet, definition);
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
      }
      if (!same(state.population.participants, definition))
        set({
          population: {
            ...state.population,
            participants: definition ? structuredClone(definition) : null,
          },
        });
      return ok;
    },
    selectPopulationMembers(ids, origin = 'manual', label = 'Selected observations') {
      const checked = checkedMembers(ids);
      if (!checked.ok) return checked;
      const selected = new Set(ids);
      changeWorking({
        kind: 'members',
        memberIds: resolvePopulationContext(get()).memberIds.filter((id) => selected.has(id)),
        origin,
        label,
      });
      return ok;
    },
    selectPopulationContext() {
      changeWorking({ kind: 'context' });
    },
    combinePopulationMembers(operation, ids, origin = 'manual') {
      const checked = checkedMembers(ids);
      if (!checked.ok) return checked;
      const { population } = get();
      const context = resolvePopulationContext(get()).memberIds;
      const current = new Set(resolveWorkingMembers(context, population.working));
      const operand = new Set(ids);
      const members = context.filter((id) =>
        operation === 'union'
          ? current.has(id) || operand.has(id)
          : operation === 'intersection'
            ? current.has(id) && operand.has(id)
            : current.has(id) && !operand.has(id),
      );
      // Data-derived selections retain their exploratory origin through set operations.
      const previousOrigin =
        population.working.kind === 'members' ? population.working.origin : 'manual';
      const combinedOrigin = [previousOrigin, origin].includes('map-derived')
        ? 'map-derived'
        : [previousOrigin, origin].includes('metadata')
          ? 'metadata'
          : 'manual';
      changeWorking({
        kind: 'members',
        memberIds: members,
        origin: combinedOrigin,
        label: `${operation} selection`,
      });
      return ok;
    },
    setPopulationReferenceMode(referenceMode) {
      const { population } = get();
      if (population.referenceMode !== referenceMode)
        set({ population: { ...population, referenceMode } });
    },
    setPopulationProbe(probe, mode) {
      if (
        probe &&
        (!probe.supportKey.trim() ||
          probe.worldMm.length !== 3 ||
          !probe.worldMm.every(Number.isFinite) ||
          !Number.isFinite(probe.radiusMm) ||
          probe.radiusMm < 0 ||
          !['mean', 'median', 'min', 'max', 'sum'].includes(probe.reduce) ||
          (probe.region != null &&
            (!probe.region.label.trim() ||
              probe.region.locus.labelIds.length === 0 ||
              !probe.region.locus.labelIds.every((id) => Number.isSafeInteger(id) && id > 0))))
      ) {
        return fail(
          'A probe requires an identified support, finite world coordinates, a nonnegative radius, a supported spatial reducer and a region with at least one positive label id.',
        );
      }
      const { population } = get();
      const key = mode === 'pin' ? 'pinnedProbe' : 'hoverProbe';
      if (!same(population[key], probe))
        set({ population: { ...population, [key]: copyProbe(probe) } });
      return ok;
    },
    setPopulationRelationship(relationship) {
      const state = get();
      if (relationship) {
        const context = resolvePopulationContext(state);
        if (context.issue) return fail(context.issue);
        if (
          relationship.sessionRevision !== state.population.sessionRevision ||
          relationship.featureId !== state.selection.activeFeatureId ||
          !relationship.fitId.trim() ||
          !relationship.supportKey.trim() ||
          !['effect', 'pattern-shape'].includes(relationship.distance) ||
          !same([...relationship.contextMemberIds].sort(), [...context.memberIds].sort())
        ) {
          return fail(
            'The relationship fit must belong to this session, feature and complete context.',
          );
        }
      }
      if (!same(state.population.relationship, relationship))
        set({
          population: {
            ...state.population,
            relationship: relationship
              ? { ...relationship, contextMemberIds: [...relationship.contextMemberIds] }
              : null,
          },
        });
      return ok;
    },
    undoPopulationSelection() {
      const { population } = get();
      const previous = population.selectionPast.at(-1);
      if (!previous) return;
      set({
        population: {
          ...population,
          working: previous,
          selectionPast: population.selectionPast.slice(0, -1),
          selectionFuture: [population.working, ...population.selectionFuture].slice(
            0,
            MAX_SELECTION_HISTORY,
          ),
        },
      });
    },
    redoPopulationSelection() {
      const { population } = get();
      const next = population.selectionFuture[0];
      if (!next) return;
      set({
        population: {
          ...population,
          working: next,
          selectionPast: [...population.selectionPast, population.working].slice(
            -MAX_SELECTION_HISTORY,
          ),
          selectionFuture: population.selectionFuture.slice(1),
        },
      });
    },
  };
}
