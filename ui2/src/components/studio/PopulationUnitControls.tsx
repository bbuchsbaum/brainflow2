import { useEffect, useMemo, useState } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { resolvePopulation } from '@/services/studio/populationContext';
import { resolvePopulationParticipants } from '@/services/studio/populationParticipants';
import type { PopulationParticipantDefinition } from '@/types/population';

const control = 'rounded border border-border bg-background px-2 py-1 text-xs text-foreground';
export function PopulationUnitControls() {
  const state = useSetStudioStore();
  const [error, setError] = useState<string | null>(null);
  const set = state.selection.activeSetId ? state.sets[state.selection.activeSetId] : null;
  const population = useMemo(() => resolvePopulation(state), [state]);
  const participants = useMemo(
    () => resolvePopulationParticipants(state, population.context.memberIds),
    [state, population.context.memberIds],
  );
  const selected = useMemo(
    () => resolvePopulationParticipants(state, population.workingMemberIds),
    [state, population.workingMemberIds],
  );
  useEffect(() => {
    setError((previous) => (previous === null ? previous : null));
  }, [state.population.sessionRevision, state.selection.activeSetId]);
  const definition = state.population.participants;
  const issue = error ?? selected.issue ?? (participants.identity ? null : participants.issue);
  const columns = set?.designTablePreview?.columns ?? [];
  const mapping = definition?.identity;
  const choice = !mapping
    ? 'none'
    : mapping.kind === 'observationIds'
      ? 'rows'
      : `column:${mapping.column}`;
  const configure = (next: PopulationParticipantDefinition | null) => {
    const result = populationProbeActions.configureParticipants(next);
    setError(result.ok ? null : result.reason);
  };
  if (!set) return null;
  return (
    <details className="rounded border border-border bg-card px-3 py-2 text-xs">
      <summary className="cursor-pointer">
        Analysis unit:{' '}
        {definition && definition.reduction !== 'observations' ? 'participants' : 'observations'} ·{' '}
        {population.context.memberIds.length} observations
        {participants.identity
          ? ` / ${participants.groups.length} participants`
          : ' · participant IDs not configured'}
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label>
          Participant identity{' '}
          <select
            aria-label="Participant identity"
            className={control}
            value={choice}
            onChange={(event) => {
              const value = event.target.value;
              configure(
                value === 'none'
                  ? null
                  : {
                      setId: set.id,
                      identity:
                        value === 'rows'
                          ? { kind: 'observationIds' }
                          : { kind: 'column', column: value.slice(7) },
                      reduction: definition?.reduction ?? 'observations',
                    },
              );
            }}
          >
            <option value="none">Not configured</option>
            <option value="rows">Declare each observation a distinct participant</option>
            {columns.map((column) => (
              <option key={column} value={`column:${column}`}>
                {column}
              </option>
            ))}
          </select>
        </label>
        <label>
          Summarize{' '}
          <select
            aria-label="Population analysis unit"
            className={control}
            value={definition?.reduction ?? 'observations'}
            onChange={(event) => {
              if (definition)
                configure({
                  ...definition,
                  reduction: event.target.value as PopulationParticipantDefinition['reduction'],
                });
            }}
            disabled={!definition}
          >
            <option value="observations">Observations: equal row weights</option>
            <option value="single">Participants: one selected row each</option>
            <option value="mean">Participants: mean selected rows first</option>
          </select>
        </label>
      </div>
      {participants.identity && (
        <p className="mt-1 text-muted-foreground">
          Working selection: {population.workingMemberIds.length} observations /{' '}
          {selected.groups.length} participants. Focus and gallery continue to identify original
          observations.
        </p>
      )}
      {definition?.reduction === 'mean' && (
        <p className="mt-1 text-muted-foreground">
          Each participant has equal weight after averaging their selected rows. Missing rows use
          local finite counts; a participant with no valid rows is unavailable at that location.
        </p>
      )}
      {issue && (
        <p role="alert" className="mt-1 text-destructive">
          {issue}
        </p>
      )}
    </details>
  );
}
