import { inferenceMethod, inferenceChannel } from './inferenceCatalog';
import type { PopulationInferenceSpec } from '@/types/population';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { resolvePopulation } from './populationContext';
import {
  resolvePopulationParticipants,
  type ParticipantAggregation,
} from './populationParticipants';
export function inferenceIssue(
  spec: PopulationInferenceSpec,
  aggregation?: ParticipantAggregation | null,
  reference?: ParticipantAggregation | null,
): string | null {
  let method;
  try {
    method = inferenceMethod(spec.method);
    inferenceChannel(spec);
  } catch (error) {
    return (error as Error).message;
  }
  if (!method.acceptedRoles.includes(spec.role))
    return 'Testing requires effect estimates, not t/z, uncertainty or label maps.';
  if (!spec.units.trim() || new TextEncoder().encode(spec.units).length > 128)
    return 'Declare comparable effect units (at most 128 bytes).';
  if (!Number.isFinite(spec.nullValue)) return 'The null effect must be finite.';
  if (!spec.independentParticipants)
    return 'Declare independent participant effects before testing.';
  if (!aggregation)
    return 'Choose participant identities and Single observation or Mean within participant in Analysis unit.';
  if (
    aggregation.groups.length < method.minimumParticipants ||
    new Set(aggregation.groups.map((g) => g.participantId)).size !== aggregation.groups.length
  )
    return 'Select at least two uniquely identified participants.';
  if (method.inputs === 'onePopulation' && reference)
    return 'One-sample inference requires only population A.';
  if (method.inputs === 'independentGroups') {
    if (!reference || reference.groups.length < method.minimumParticipants)
      return 'Choose population B with at least two declared participants.';
    const a = new Set(aggregation.groups.map((g) => g.participantId));
    const b = reference.groups.map((g) => g.participantId);
    if (new Set(b).size !== b.length || b.some((id) => a.has(id)))
      return 'Independent-group testing requires disjoint participant IDs in A and B; overlapping people require a paired or repeated-measures method.';
  }
  return null;
}
export function configureInference(spec: PopulationInferenceSpec | null): string | null {
  const state = useSetStudioStore.getState();
  if (!spec) {
    state.configurePopulationInference(null);
    return null;
  }
  let descriptor;
  try {
    descriptor = inferenceMethod(spec.method);
  } catch (error) {
    return (error as Error).message;
  }
  const population = resolvePopulation(state);
  const participants = resolvePopulationParticipants(state, population.workingMemberIds);
  const reference =
    descriptor.inputs === 'independentGroups'
      ? resolvePopulationParticipants(state, population.referenceMemberIds)
      : null;
  const issue =
    participants.issue ??
    (reference ? (population.referenceIssue ?? reference.issue) : null) ??
    inferenceIssue(spec, participants.aggregation, reference?.aggregation);
  if (issue) return issue;
  const result = state.configurePopulationInference({
    ...spec,
    units: spec.units.trim(),
    setId: state.selection.activeSetId!,
    featureId: state.selection.activeFeatureId!,
  });
  if (!result.ok) return result.reason;
  state.setPopulationPresentation({ ...state.population.presentation, arrangement: 'inspect' });
  return null;
}
export function selectInferenceChannel(channel: PopulationInferenceSpec['channel']) {
  const state = useSetStudioStore.getState();
  if (state.population.inference) {
    const spec = { ...state.population.inference, channel };
    inferenceChannel(spec);
    state.configurePopulationInference(spec);
  }
}
