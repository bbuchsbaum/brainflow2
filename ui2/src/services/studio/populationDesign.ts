import { useSetStudioStore } from '@/stores/setStudioStore';
import { studioMetadata } from './studioMetadata';
import { resolvePopulation } from './populationContext';
import {
  resolvePopulationParticipants,
  type ParticipantAggregation,
} from './populationParticipants';
import type { PopulationInferenceSpec } from '@/types/population';
export type PopulationLinearDesign = NonNullable<PopulationInferenceSpec['design']>;
export function linearDesignIssue(
  design: PopulationLinearDesign | undefined,
  aggregation: ParticipantAggregation,
): string | null {
  if (!design) return 'Choose covariates, a coefficient and its units for the linear model.';
  const p = design.columns.length;
  const ids = aggregation.groups.map((g) => g.participantId);
  if (
    p < 1 ||
    p > 8 ||
    ids.length <= p ||
    ids.length > 512 ||
    design.participantIds.length !== ids.length ||
    new Set(design.participantIds).size !== ids.length ||
    design.participantIds.some((id) => !ids.includes(id)) ||
    design.values.length !== ids.length ||
    design.values.some((row) => row.length !== p || row[0] !== 1 || !row.every(Number.isFinite)) ||
    design.contrast.length !== p ||
    !design.contrast.every(Number.isFinite) ||
    !design.contrast.some((v) => v !== 0) ||
    !design.contrastUnits.trim()
  )
    return 'OLS requires a finite participant-keyed design, an intercept, a nonzero contrast and units, with more people than coefficients (at most 512 people and 8 coefficients).';
  return null;
}
/** Covariates are person-level declarations. Repeated rows may not silently
 * average conflicting ages, treatments or other design values. */
export function buildPopulationDesign(
  covariates: string[],
  coefficient: string,
  contrastUnits: string,
): PopulationLinearDesign {
  const state = useSetStudioStore.getState();
  const set = state.sets[state.selection.activeSetId ?? ''];
  if (!set) throw new Error('Load a population first.');
  const population = resolvePopulation(state);
  const people = resolvePopulationParticipants(state, population.workingMemberIds);
  if (people.issue || !people.aggregation)
    throw new Error(people.issue ?? 'Declare participant identities first.');
  const metadata = studioMetadata(set, population.workingMemberIds);
  if (metadata.issue) throw new Error(metadata.issue);
  if (
    new Set(covariates).size !== covariates.length ||
    covariates.includes('(intercept)') ||
    covariates.some((c) => !metadata.columns.includes(c))
  )
    throw new Error('Choose unique, available covariate columns.');
  const columns = ['(intercept)', ...covariates];
  if (!columns.includes(coefficient))
    throw new Error('Choose a coefficient in the declared design.');
  const values = people.aggregation.groups.map((person) => [
    1,
    ...covariates.map((column) => {
      const values = person.memberIds.map((id) => metadata.rows.get(id)?.[column]);
      if (
        values.some((v) => v === undefined || !v.trim() || !Number.isFinite(Number(v))) ||
        values.some((v) => Number(v) !== Number(values[0]))
      )
        throw new Error(
          `Covariate ${column} requires one consistent finite value per participant (${person.participantId}). Encode factors explicitly as numeric columns.`,
        );
      return Number(values[0]);
    }),
  ]);
  const design = {
    participantIds: people.aggregation.groups.map((g) => g.participantId),
    columns,
    values,
    contrast: columns.map((c) => (c === coefficient ? 1 : 0)),
    contrastUnits,
  };
  const issue = linearDesignIssue(design, people.aggregation);
  if (issue) throw new Error(issue);
  return design;
}
