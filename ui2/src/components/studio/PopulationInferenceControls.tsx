import {
  inferenceMethods,
  inferenceMethod,
  inferenceChannelNames,
  inferenceActive,
} from '@/services/studio/inferenceCatalog';
import { resolvePopulation } from '@/services/studio/populationContext';
import { useEffect, useState } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { PopulationInferenceSpec } from '@/types/population';
import { configureInference, selectInferenceChannel } from '@/services/studio/populationInference';
const control = 'rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-40';
export function PopulationInferenceControls() {
  const state = useSetStudioStore();
  const saved = state.population.inference;
  const current =
    saved?.featureId === state.selection.activeFeatureId &&
    saved?.setId === state.selection.activeSetId
      ? saved
      : null;
  const [method, setMethod] = useState<PopulationInferenceSpec['method']>('oneSample');
  const [role, setRole] = useState<PopulationInferenceSpec['role']>('other');
  const [units, setUnits] = useState('');
  const [nullValue, setNull] = useState(0);
  const [independent, setIndependent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setMethod(current?.method ?? 'oneSample');
    setRole(current?.role ?? 'other');
    setUnits(current?.units ?? '');
    setNull(current?.nullValue ?? 0);
    setIndependent(current?.independentParticipants ?? false);
    setError(null);
  }, [state.selection.activeFeatureId, state.population.sessionRevision, current]);
  const paused = current && !inferenceActive(current, state.population.presentation.arrangement);
  const descriptor = inferenceMethod(method);
  const population = resolvePopulation(state);
  return (
    <details className="rounded border border-border p-3 text-xs" aria-label="Statistical question">
      <summary className="cursor-pointer font-medium">
        Statistical question{current ? ` · ${inferenceMethod(current.method).label}` : ''}
      </summary>
      <div className="mt-3 space-y-3">
        <label className="block">
          Method{' '}
          <select
            className={`${control} max-w-full`}
            aria-label="Statistical method"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
          >
            {inferenceMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <p>
          {descriptor.description} Declare the meaning of the feature; filenames do not establish
          it.
        </p>
        {descriptor.inputs === 'independentGroups' && (
          <p className="text-muted-foreground">
            A: {population.workingMemberIds.length} observations · B:{' '}
            {population.referenceMemberIds.length} observations. Uses the current selection and
            reference. Each person must belong to one group only.
          </p>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <label>
            Feature values{' '}
            <select
              className={control}
              aria-label="Feature value role"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              <option value="other">Unknown / other</option>
              <option value="effect">Effect estimate</option>
              <option value="standardError">Standard error</option>
              <option value="variance">Variance</option>
              <option value="t">t statistic</option>
              <option value="z">z statistic</option>
              <option value="label">Labels</option>
            </select>
          </label>
          <label>
            Units{' '}
            <input
              className={`${control} w-36`}
              aria-label="Effect units"
              value={units}
              placeholder="e.g. % signal change"
              onChange={(e) => setUnits(e.target.value)}
            />
          </label>
          <label>
            Null effect{' '}
            <input
              className={`${control} w-24`}
              aria-label="Null effect"
              type="number"
              step="any"
              value={Number.isFinite(nullValue) ? nullValue : ''}
              onChange={(e) => setNull(e.target.valueAsNumber)}
            />
          </label>
        </div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={independent}
            onChange={(e) => setIndependent(e.target.checked)}
          />
          I declare comparable effects from independent participants.
        </label>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            className={control}
            onClick={() =>
              setError(
                configureInference({
                  method,
                  role,
                  units,
                  nullValue,
                  independentParticipants: independent,
                  selectionOrigin:
                    state.population.working.kind === 'members'
                      ? state.population.working.origin
                      : 'manual',
                  channel: 'effect',
                }),
              )
            }
          >
            {method === 'oneSample' ? 'Apply one-sample test' : `Apply ${descriptor.label}`}
          </button>
          {current && (
            <>
              <button className={control} onClick={() => configureInference(null)}>
                Return to descriptive view
              </button>
              <label>
                Channel{' '}
                <select
                  className={control}
                  aria-label="Test result channel"
                  value={current.channel}
                  onChange={(e) =>
                    selectInferenceChannel(e.target.value as PopulationInferenceSpec['channel'])
                  }
                >
                  {Object.entries(inferenceChannelNames(current.method)).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {current && (
          <p role="status">
            {paused ? 'Test paused in this descriptive arrangement. ' : ''}
            {inferenceMethod(current.method).label}:{' '}
            {inferenceMethod(current.method).inputs === 'onePopulation'
              ? 'mean(A)'
              : 'mean(A) − mean(B)'}{' '}
            − {current.nullValue} {current.units}. Selection changes recalculate the test; focus
            does not change its operands.
          </p>
        )}
        <p className="text-muted-foreground">
          {descriptor.limitations} Save calculation records source identities and every declared
          result channel.
        </p>
      </div>
    </details>
  );
}
