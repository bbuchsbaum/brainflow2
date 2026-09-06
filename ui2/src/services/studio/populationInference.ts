import type { PopulationInferenceSpec } from '@/types/population';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { resolvePopulation } from './populationContext';
import {
  resolvePopulationParticipants,
  type ParticipantAggregation,
} from './populationParticipants';
export const inferenceNames = {
  effect: 'Effect relative to null',
  standardError: 'Standard error',
  t: 't statistic',
  df: 'Degrees of freedom',
  count: 'Valid participant count',
};
export function inferenceIssue(
  spec: PopulationInferenceSpec,
  aggregation?: ParticipantAggregation | null,
): string | null {
  if (spec.role !== 'effect')
    return 'Testing requires effect estimates, not t/z, uncertainty or label maps.';
  if (!spec.units.trim() || new TextEncoder().encode(spec.units).length > 128)
    return 'Declare comparable effect units (at most 128 bytes).';
  if (!Number.isFinite(spec.nullValue)) return 'The null effect must be finite.';
  if (!spec.independentParticipants)
    return 'Declare independent participant effects before testing.';
  if (!aggregation)
    return 'Choose participant identities and Single observation or Mean within participant in Analysis unit.';
  if (
    aggregation.groups.length < 2 ||
    new Set(aggregation.groups.map((g) => g.participantId)).size !== aggregation.groups.length
  )
    return 'Select at least two uniquely identified participants.';
  return null;
}
export function configureInference(spec: PopulationInferenceSpec | null): string | null {
  const state = useSetStudioStore.getState();
  if (!spec) {
    state.configurePopulationInference(null);
    return null;
  }
  const population = resolvePopulation(state);
  const participants = resolvePopulationParticipants(state, population.workingMemberIds);
  const issue = participants.issue ?? inferenceIssue(spec, participants.aggregation);
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
  if (state.population.inference)
    state.configurePopulationInference({ ...state.population.inference, channel });
}
