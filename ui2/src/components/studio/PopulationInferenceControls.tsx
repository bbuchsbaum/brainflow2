import { useEffect, useState } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { PopulationInferenceSpec } from '@/types/population';
import {
  configureInference,
  inferenceNames,
  selectInferenceChannel,
} from '@/services/studio/populationInference';
const control = 'rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-40';
export function PopulationInferenceControls() {
  const state = useSetStudioStore();
  const saved = state.population.inference;
  const current = saved?.featureId === state.selection.activeFeatureId ? saved : null;
  const [role, setRole] = useState<PopulationInferenceSpec['role']>('other');
  const [units, setUnits] = useState('');
  const [nullValue, setNull] = useState(0);
  const [independent, setIndependent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRole(current?.role ?? 'other');
    setUnits(current?.units ?? '');
    setNull(current?.nullValue ?? 0);
    setIndependent(current?.independentParticipants ?? false);
    setError(null);
  }, [state.selection.activeFeatureId, state.population.sessionRevision, current]);
  const paused = ['groups', 'comparison', 'difference'].includes(
    state.population.presentation.arrangement,
  );
  return (
    <details className="rounded border border-border p-3 text-xs" aria-label="Statistical question">
      <summary className="cursor-pointer font-medium">
        Statistical question{current ? ' · one-sample' : ''}
      </summary>
      <div className="mt-3 space-y-3">
        <p>
          Test the selected participants’ mean effect against a stated value. Declare the meaning of
          every map in this feature; filenames do not establish it.
        </p>
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
                  method: 'oneSample',
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
            Apply one-sample test
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
                  {Object.entries(inferenceNames).map(([id, name]) => (
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
            {paused ? 'Test paused in this descriptive arrangement. ' : ''}One-sample: mean −{' '}
            {current.nullValue} {current.units}. Selection changes recalculate the test; focus does
            not change its operands.
          </p>
        )}
        <p className="text-muted-foreground">
          Exploratory analysis. Map-derived selections are not independent confirmation. No p-values
          or multiple-comparison correction. SE and df require two locally valid participants; t
          also requires positive SE. Save calculation freezes the inputs and all five channels.
        </p>
      </div>
    </details>
  );
}
