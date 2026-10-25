import { buildPopulationDesign } from '@/services/studio/populationDesign';
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
const control = 'rounded-sm border border-border bg-background px-2 py-1 text-bf-sm disabled:opacity-40';
export function PopulationInferenceControls() {
  const state = useSetStudioStore();
  const feature = state.features[state.selection.activeFeatureId ?? ''];
  const saved = state.population.inference;
  const current =
    saved?.featureId === state.selection.activeFeatureId &&
    saved?.setId === state.selection.activeSetId
      ? saved
      : null;
  const [method, setMethod] = useState<PopulationInferenceSpec['method']>('oneSample');
  const [covariates, setCovariates] = useState<string[]>([]);
  const [coefficient, setCoefficient] = useState('(intercept)');
  const [contrastUnits, setContrastUnits] = useState('');
  const [role, setRole] = useState<PopulationInferenceSpec['role']>('other');
  const [units, setUnits] = useState('');
  const [nullValue, setNull] = useState(0);
  const [independent, setIndependent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setMethod(current?.method ?? 'oneSample');
    setCovariates(current?.design?.columns.slice(1) ?? []);
    setCoefficient(
      current?.design?.columns[current.design.contrast.findIndex((v) => v !== 0)] ?? '(intercept)',
    );
    setContrastUnits(current?.design?.contrastUnits ?? '');
    setRole(current?.role ?? feature?.valueRole ?? 'other');
    setUnits(current?.units ?? feature?.units ?? '');
    setNull(current?.nullValue ?? 0);
    setIndependent(current?.independentParticipants ?? false);
    setError(null);
  }, [state.selection.activeFeatureId, state.population.sessionRevision, current, feature]);
  const paused = current && !inferenceActive(current, state.population.presentation.arrangement);
  const descriptor = inferenceMethod(method);
  const population = resolvePopulation(state);
  return (
    <details className="rounded-sm border border-border p-3 text-bf-sm" aria-label="Statistical question">
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
        {['independentGroups', 'pairedGroups'].includes(descriptor.inputs) && (
          <p className="text-muted-foreground">
            A: {population.workingMemberIds.length} observations · B:{' '}
            {population.referenceMemberIds.length} observations. Uses the current selection and
            reference.{' '}
            {descriptor.inputs === 'pairedGroups'
              ? 'Match exactly the same participants using distinct A and B observations. Missing values remove that pair locally.'
              : 'Each person must belong to one group only.'}
          </p>
        )}
        {method === 'linearModel' && (
          <fieldset className="space-y-2 rounded-sm border border-border p-2">
            <legend>Participant design</legend>
            <p className="text-muted-foreground">
              An intercept is included. Select numeric covariates; encode factors in the table
              explicitly. Covariates must agree across each person's repeated rows. Rank is checked
              by the native solver.
            </p>
            <div className="flex flex-wrap gap-2">
              {(state.sets[state.selection.activeSetId ?? '']?.designColumns ?? []).map(
                (column) => (
                  <label key={column} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={covariates.includes(column)}
                      onChange={(e) =>
                        setCovariates((cols) =>
                          e.target.checked ? [...cols, column] : cols.filter((c) => c !== column),
                        )
                      }
                    />
                    {column}
                  </label>
                ),
              )}
            </div>
            <label>
              Coefficient{' '}
              <select
                className={control}
                aria-label="Model coefficient"
                value={coefficient}
                onChange={(e) => setCoefficient(e.target.value)}
              >
                {['(intercept)', ...covariates].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block">
              Coefficient units{' '}
              <input
                className={control}
                aria-label="Coefficient units"
                placeholder="e.g. % signal change / year"
                value={contrastUnits}
                onChange={(e) => setContrastUnits(e.target.value)}
              />
            </label>
            <p className="text-muted-foreground">
              Ordinary least squares; independent participants and homoskedastic errors. Missing
              responses remove people locally. No automatic covariate centering, column dropping or
              mixed-effects fit.
            </p>
          </fieldset>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <label>
            Feature values{' '}
            <select
              className={control}
              aria-label="Feature value role"
              disabled={!!feature?.valueRole}
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
              readOnly={!!feature?.units}
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
            onClick={() => {
              try {
                setError(
                  configureInference({
                    method,
                    role,
                    units,
                    nullValue,
                    independentParticipants: independent,
                    ...(method === 'linearModel'
                      ? { design: buildPopulationDesign(covariates, coefficient, contrastUnits) }
                      : {}),
                    selectionOrigin:
                      state.population.working.kind === 'members'
                        ? state.population.working.origin
                        : 'manual',
                    channel: 'effect',
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
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
            {current.method === 'linearModel'
              ? `coefficient contrast (${current.design?.columns.join(', ')})`
              : inferenceMethod(current.method).inputs === 'onePopulation'
                ? 'mean(A)'
                : current.method === 'paired'
                  ? 'mean(within-person A − B)'
                  : 'mean(A) − mean(B)'}{' '}
            − {current.nullValue} {current.design?.contrastUnits ?? current.units}. Selection
            changes recalculate the test; focus does not change its operands.
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
