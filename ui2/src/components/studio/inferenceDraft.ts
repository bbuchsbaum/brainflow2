import { useEffect, useState } from 'react';
import { inferenceMethod } from '@/services/studio/inferenceCatalog';
import { resolvePopulation } from '@/services/studio/populationContext';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { PopulationInferenceSpec } from '@/types/population';

export type Method = PopulationInferenceSpec['method'] | 'descriptive';
export type Role = PopulationInferenceSpec['role'];

/**
 * What a test will be run with: the method and model (Compare and test) and
 * what the values are (Analysis setup). One draft for both sections, held by
 * the Inspector; it follows the test in force and the feature's own
 * declarations, and nothing runs until Run.
 */
export function useInferenceDraft() {
  // Narrow selectors: the draft re-renders for its own inputs only, never for
  // a moving hover probe or other unrelated store writes.
  const activeFeatureId = useSetStudioStore((state) => state.selection.activeFeatureId);
  const activeSetId = useSetStudioStore((state) => state.selection.activeSetId);
  const sessionRevision = useSetStudioStore((state) => state.population.sessionRevision);
  const saved = useSetStudioStore((state) => state.population.inference);
  const feature = useSetStudioStore((state) => state.features[activeFeatureId ?? '']);
  const current =
    saved?.featureId === activeFeatureId && saved?.setId === activeSetId ? saved : null;
  const [method, setMethod] = useState<Method>('descriptive');
  const [covariates, setCovariates] = useState<string[]>([]);
  const [coefficient, setCoefficient] = useState('(intercept)');
  const [contrastUnits, setContrastUnits] = useState('');
  const [role, setRole] = useState<Role>('other');
  const [units, setUnits] = useState('');
  const [nullValue, setNull] = useState(0);
  const [independent, setIndependent] = useState(false);
  useEffect(() => {
    setMethod(current?.method ?? 'descriptive');
    setCovariates(current?.design?.columns.slice(1) ?? []);
    setCoefficient(
      current?.design?.columns[current.design.contrast.findIndex((v) => v !== 0)] ?? '(intercept)',
    );
    setContrastUnits(current?.design?.contrastUnits ?? '');
    setRole(current?.role ?? feature?.valueRole ?? 'other');
    setUnits(current?.units ?? feature?.units ?? '');
    setNull(current?.nullValue ?? 0);
    setIndependent(current?.independentParticipants ?? false);
  }, [activeFeatureId, sessionRevision, current, feature]);
  return {
    current,
    feature,
    method,
    setMethod,
    covariates,
    setCovariates,
    coefficient,
    setCoefficient,
    contrastUnits,
    setContrastUnits,
    role,
    setRole,
    units,
    setUnits,
    nullValue,
    setNull,
    independent,
    setIndependent,
  };
}
export type InferenceDraft = ReturnType<typeof useInferenceDraft>;

/** What still has to be declared before a test can run, in Analysis setup. */
export function draftMissing(draft: InferenceDraft): string | null {
  if (draft.method === 'descriptive') return null;
  const method = inferenceMethod(draft.method);
  if (!method.acceptedRoles.includes(draft.role))
    return 'Declare the values as effect estimates in Analysis setup.';
  if (!draft.units.trim()) return 'Declare the value units in Analysis setup.';
  if (!Number.isFinite(draft.nullValue)) return 'Declare a finite null effect in Analysis setup.';
  if (!draft.independent) return 'Declare independent participants in Analysis setup.';
  return null;
}


/** Whether two member lists hold the same subjects (order and repeats ignored). */
export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * Why A and B cannot be compared yet, or null. A test of one population
 * (`needsB` false) needs only A. A comparison of the set with itself is never
 * offered: identical A and B say so instead of running.
 */
export function compareOperandsIssue({
  a,
  b,
  aIsSelection,
  needsB,
}: {
  a: readonly string[];
  b: readonly string[];
  /** A is a selection (else everyone in the context). */
  aIsSelection: boolean;
  needsB: boolean;
}): string | null {
  if (!a.length) return 'A is empty: select subjects for A.';
  if (!needsB) return null;
  if (!b.length)
    return aIsSelection ? 'Choose B to compare with A.' : 'Select subjects for A, or choose B.';
  if (sameMembers(a, b))
    return `A and B are the same ${a.length} ${a.length === 1 ? 'subject' : 'subjects'}: choose a different B.`;
  return null;
}

/** Whether `b` contains every member of `a`: B would compare A largely with itself. */
function containsAll(b: readonly string[], a: readonly string[]): boolean {
  const inB = new Set(b);
  return a.every((id) => inB.has(id));
}

const compareRequestListeners = new Set<() => void>();
let compareRequestNonce = 0;

/**
 * Requests to show Compare and test (a counter): the Inspector opens the
 * section when it changes.
 */
export const compareTestRequests = {
  subscribe(listener: () => void) {
    compareRequestListeners.add(listener);
    return () => {
      compareRequestListeners.delete(listener);
    };
  },
  getSnapshot: () => compareRequestNonce,
};

/**
 * "Compare with the rest": A is the current selection and B everyone else in
 * the context (live), the montage shows A and B, and the Inspector opens
 * Compare and test. Does nothing (returns false) without a selection or when
 * the selection is everyone.
 */
export function compareSelectionWithTheRest(): boolean {
  const state = useSetStudioStore.getState();
  if (state.population.working.kind !== 'members') return false;
  const { workingMemberIds, context } = resolvePopulation(state);
  if (!workingMemberIds.length || workingMemberIds.length >= context.memberIds.length) return false;
  state.setPopulationReferenceMode('complement');
  const next = useSetStudioStore.getState();
  next.setPopulationPresentation({
    ...next.population.presentation,
    arrangement: 'comparison',
    contributorsGroupId: undefined,
  });
  compareRequestNonce += 1;
  for (const listener of compareRequestListeners) listener();
  return true;
}

/**
 * B follows a new selection: when the selection changes and B is unset,
 * unavailable, or holds all of A (the default saved cohort is usually every
 * subject), B becomes the rest. A B chosen after the selection is kept.
 */
export function useReferenceFollowsSelection() {
  const working = useSetStudioStore((state) => state.population.working);
  useEffect(() => {
    if (working.kind !== 'members') return;
    const state = useSetStudioStore.getState();
    if (state.population.referenceMode === 'complement') return;
    const population = resolvePopulation(state);
    if (
      population.referenceIssue ||
      !population.referenceMemberIds.length ||
      containsAll(population.referenceMemberIds, population.workingMemberIds)
    )
      state.setPopulationReferenceMode('complement');
  }, [working]);
}
