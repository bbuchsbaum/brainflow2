import { participantIdentity } from '@/services/studio/populationParticipants';
import type {
  PopulationActionResult,
  PopulationParticipantDefinition,
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
    participants: null,
    working: { kind: 'context' },
    referenceMode: 'cohort',
    pinnedProbe: null,
    hoverProbe: null,
    relationship: null,
    selectionPast: [],
    selectionFuture: [],
  };
}

export interface PopulationSlice {
  population: PopulationState;
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
type Set = (state: Partial<Pick<Host, 'population'>>) => void;
const ok: PopulationActionResult = { ok: true };
const fail = (reason: string): PopulationActionResult => ({ ok: false, reason });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const MAX_SELECTION_HISTORY = 40;

function copyProbe(probe: PopulationProbe | null): PopulationProbe | null {
  return probe ? { ...probe, worldMm: [...probe.worldMm] } : null;
}

export function createPopulationSlice(
  set: Set,
  get: () => Host,
): Omit<PopulationSlice, 'population'> {
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
          !['mean', 'median', 'min', 'max', 'sum'].includes(probe.reduce))
      ) {
        return fail(
          'A probe requires an identified support, finite world coordinates, a nonnegative radius and a supported spatial reducer.',
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
