import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { useState } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { resolvePopulation } from '@/services/studio/populationContext';
import { partitionPopulation } from '@/services/studio/populationGroups';
import { studioMetadata } from '@/services/studio/studioMetadata';
import { resolvePopulationParticipants } from '@/services/studio/populationParticipants';

const control =
  'w-full min-w-0 rounded-sm border border-border bg-background px-2 py-1 text-bf-sm disabled:opacity-40';
export function PopulationGroupControls() {
  const state = useSetStudioStore();
  const population = resolvePopulation(state);
  const set = state.sets[state.selection.activeSetId ?? ''];
  const metadata = set ? studioMetadata(set, population.context.memberIds) : null;
  const [column, setColumn] = useState('');
  const [secondColumn, setSecondColumn] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const factor = metadata?.columns.includes(column) ? column : '';
  const save = (ids: readonly string[], name: string) =>
    state.createSavedCohort({
      memberIds: [...ids],
      label: name,
      originLabel:
        state.population.working.kind === 'members' ? state.population.working.origin : 'context',
      description: 'Frozen observation membership from Population',
    });
  const a = new Set(population.workingMemberIds);
  const overlap = population.referenceMemberIds.filter((id) => a.has(id)).length;
  const participants = resolvePopulationParticipants(state, population.referenceMemberIds);
  const aParticipants = resolvePopulationParticipants(state, population.workingMemberIds);
  const participantOverlap =
    participants.identity && !participants.issue && aParticipants.identity && !aParticipants.issue
      ? participants.groups.filter((g) =>
          aParticipants.groups.some((a) => a.participantId === g.participantId),
        ).length
      : null;
  return (
    <div
      className="space-y-3 border-t border-border pt-3 text-bf-sm"
      aria-label="Population groups and reference"
    >
      <label className="block space-y-1">
        <span>Group context by factor</span>
        <select
          className={control}
          aria-label="Group by factor"
          value={factor}
          onChange={(e) => setColumn(e.target.value)}
        >
          <option value="">Choose a factor</option>
          {metadata?.columns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span>Split each group by (optional)</span>
        <select
          className={control}
          aria-label="Second grouping factor"
          value={secondColumn}
          onChange={(e) => setSecondColumn(e.target.value)}
        >
          <option value="">No second factor</option>
          {metadata?.columns.filter((c) => c !== factor).map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <button
        className={control}
        disabled={!factor || !!metadata?.issue}
        onClick={() => {
          try {
            const result = state.setPopulationPartition(
              partitionPopulation(
                set,
                population.context.memberIds,
                factor,
                secondColumn || undefined,
              ),
            );
            setError(result.ok ? null : result.reason);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Show factor groups
      </button>
      {state.population.partition && (
        <details className="rounded-sm border border-border p-2">
          <summary className="cursor-pointer">Choose comparison groups</summary>
          <p className="my-2 text-muted-foreground">
            Assign A and B from exact group membership, even before a summary is available.
          </p>
          {(['A', 'B'] as const).map((operand) => (
            <label key={operand} className="block space-y-1 mt-2">
              <span>Population {operand}</span>
              <select
                className={control}
                aria-label={`Assign group to ${operand}`}
                value=""
                onChange={(event) => {
                  const group = state.population.partition?.groups.find(
                    (g) => g.id === event.target.value,
                  );
                  if (!group) return;
                  if (operand === 'A')
                    populationProbeActions.select(
                      group.memberIds,
                      'replace',
                      state.population.partition!.origin,
                      group.label,
                    );
                  else {
                    const cohort = save(group.memberIds, group.label);
                    if (cohort) {
                      state.setPopulationReferenceMode('cohort');
                      state.setCompareCohort(cohort);
                    }
                  }
                }}
              >
                <option value="">Choose a group</option>
                {state.population.partition!.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.label} · {group.memberIds.length} observations
                  </option>
                ))}
              </select>
            </label>
          ))}
        </details>
      )}
      {metadata?.issue && <p className="text-muted-foreground">{metadata.issue}</p>}
      {!!state.population.partitionPast.length && (
        <button className={control} onClick={state.undoPopulationPartition}>
          Undo grouping
        </button>
      )}
      <label className="block space-y-1">
        <span>Name the working selection</span>
        <input
          className={control}
          aria-label="Selection name"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. High response"
        />
      </label>
      <button
        className={control}
        disabled={!label.trim() || !a.size}
        onClick={() => {
          save(population.workingMemberIds, label.trim());
          setLabel('');
        }}
      >
        Save selection as set
      </button>
      <label className="block space-y-1">
        <span>Reference B</span>
        <select
          className={control}
          aria-label="Reference B"
          value={
            state.population.referenceMode === 'complement'
              ? 'complement'
              : (state.selection.compareCohortId ?? '')
          }
          onChange={(e) => {
            state.setPopulationReferenceMode(
              e.target.value === 'complement' ? 'complement' : 'cohort',
            );
            if (e.target.value !== 'complement') state.setCompareCohort(e.target.value || null);
          }}
        >
          <option value="">Choose a reference</option>
          <option value="complement">Remaining observations (live)</option>
          {set?.savedCohortIds.map(
            (id) =>
              state.cohorts[id] && (
                <option key={id} value={id}>
                  {state.cohorts[id].label}
                </option>
              ),
          )}
        </select>
      </label>
      <p className="text-muted-foreground">
        B: {population.referenceMemberIds.length} observations
        {participants.identity && !participants.issue
          ? ` · ${participants.groups.length} participants`
          : ''}{' '}
        · {overlap} observations shared with A
        {participantOverlap !== null ? ` · ${participantOverlap} participants shared` : ''}
      </p>
      {population.referenceIssue && <p role="alert">{population.referenceIssue}</p>}
      {state.population.referenceMode === 'complement' && (
        <button
          className={control}
          disabled={!population.referenceMemberIds.length || !!population.referenceIssue}
          onClick={() => {
            const id = save(population.referenceMemberIds, 'Pinned reference');
            if (id) {
              state.setPopulationReferenceMode('cohort');
              state.setCompareCohort(id);
            }
          }}
        >
          Pin reference membership
        </button>
      )}
      <button
        className={control}
        disabled={!a.size || !population.referenceMemberIds.length || !!population.referenceIssue}
        onClick={() =>
          state.setPopulationPresentation({
            ...state.population.presentation,
            arrangement: 'comparison',
          })
        }
      >
        Compare A and B
      </button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
