import { Notice, Select } from '@/components/ui/bf';
import { studioMetadata } from '@/services/studio/studioMetadata';
import { useEffect, useMemo, useState } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { resolvePopulation } from '@/services/studio/populationContext';
import { resolvePopulationParticipants } from '@/services/studio/populationParticipants';
import type { PopulationParticipantDefinition } from '@/types/population';

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
  const issue =
    error ??
    selected.issue ??
    (state.population.participants?.identity.kind === 'saved' || participants.identity
      ? null
      : participants.issue);
  const columns = set ? studioMetadata(set, []).columns : [];
  const mapping = definition?.identity;
  const choice = !mapping
    ? 'none'
    : mapping.kind === 'observationIds'
      ? 'rows'
      : mapping.kind === 'saved'
        ? 'saved'
        : `column:${mapping.column}`;
  const configure = (next: PopulationParticipantDefinition | null) => {
    const result = populationProbeActions.configureParticipants(next);
    setError(result.ok ? null : result.reason);
  };
  if (!set) return null;
  return (
    <details className="rounded-sm border border-border bg-card px-3 py-2 text-bf-sm">
      <summary className="cursor-pointer">
        Analysis unit:{' '}
        {definition && definition.reduction !== 'observations' ? 'participants' : 'observations'} ·{' '}
        {population.context.memberIds.length} observations
        {participants.identity
          ? ` / ${participants.groups.length} participants`
          : definition?.identity.kind === 'saved'
            ? ' · saved selection identities'
            : ' · participant IDs not configured'}
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="block w-full min-w-0">
          Participant identity{' '}
          <Select
            aria-label="Participant identity"
            value={choice}
            onChange={(event) => {
              const value = event.target.value;
              configure(
                value === 'none'
                  ? null
                  : {
                      setId: set.id,
                      identity:
                        value === 'saved' && mapping?.kind === 'saved'
                          ? mapping
                          : value === 'rows'
                            ? { kind: 'observationIds' }
                            : { kind: 'column', column: value.slice(7) },
                      reduction: definition?.reduction ?? 'observations',
                    },
              );
            }}
          >
            <option value="none">Not configured</option>
            {mapping?.kind === 'saved' && <option value="saved">Saved participant groups</option>}
            <option value="rows">Declare each observation a distinct participant</option>
            {columns.map((column) => (
              <option key={column} value={`column:${column}`}>
                {column}
              </option>
            ))}
          </Select>
        </label>
        <label className="block w-full min-w-0">
          Summarize{' '}
          <Select
            aria-label="Population analysis unit"
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
          </Select>
        </label>
      </div>
      {selected.identity && (
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
        <Notice role="alert" severity="danger" className="mt-1">
          {issue}
        </Notice>
      )}
    </details>
  );
}
