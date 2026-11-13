import { useState } from 'react';
import { Info } from 'lucide-react';
import { Button, IconButton, Notice, NumberField, Select, TextField } from '@/components/ui/bf';
import { buildPopulationDesign } from '@/services/studio/populationDesign';
import {
  inferenceMethods,
  inferenceMethod,
  inferenceActive,
} from '@/services/studio/inferenceCatalog';
import {
  compareOperandsIssue,
  draftMissing,
  methodNeedsB,
  sameMembers,
  type InferenceDraft,
  type Method,
  type Role,
} from './inferenceDraft';
import { resolvePopulation } from '@/services/studio/populationContext';
import { comparableGroups } from '@/services/studio/populationGroups';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { resolvePopulationParticipants } from '@/services/studio/populationParticipants';
import {
  configureInference,
  inferenceOperandsCurrent,
} from '@/services/studio/populationInference';
import { useSetStudioState } from '@/stores/setStudio/useSetStudioState';
import { EXPLORATORY_LABEL, EXPLORATORY_REASON, isExploratorySelection } from './exploratorySelection';

/** About the values: role, units, null and the independence declaration (Analysis setup). */
export function AboutTheValues({ draft }: { draft: InferenceDraft }) {
  const { feature } = draft;
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-label="About the values">
      <legend className="mb-1 text-bf-xs text-muted-foreground">About the values</legend>
      <label className="flex items-center justify-between gap-2">
        Values are
        <Select
          className="w-auto max-w-[60%]"
          aria-label="Feature value role"
          disabled={!!feature?.valueRole}
          value={draft.role}
          onChange={(e) => draft.setRole(e.target.value as Role)}
        >
          <option value="other">Unknown / other</option>
          <option value="effect">Effect estimate</option>
          <option value="standardError">Standard error</option>
          <option value="variance">Variance</option>
          <option value="t">t statistic</option>
          <option value="z">z statistic</option>
          <option value="label">Labels</option>
        </Select>
      </label>
      <label className="flex items-center justify-between gap-2">
        Units
        <TextField
          className="w-36"
          aria-label="Effect units"
          readOnly={!!feature?.units}
          value={draft.units}
          placeholder="e.g. % signal change"
          onChange={(e) => draft.setUnits(e.target.value)}
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        Null effect
        <NumberField
          fieldClassName="w-24"
          aria-label="Null effect"
          step="any"
          value={Number.isFinite(draft.nullValue) ? draft.nullValue : ''}
          onChange={(e) => draft.setNull(e.target.valueAsNumber)}
        />
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={draft.independent}
          onChange={(e) => draft.setIndependent(e.target.checked)}
        />
        I declare comparable effects from independent participants.
      </label>
      <p className="m-0 text-bf-xs text-muted-foreground">
        Declare the meaning of the feature; filenames do not establish it.
      </p>
    </fieldset>
  );
}

/**
 * Compare and test: A (the selection, labelled exploratory when the data
 * chose it), B, and a test that runs only on Run. Choosing a test runs
 * nothing; changing A or B after a Run leaves the result waiting for the next
 * Run instead of re-running it. The set is never compared with itself: a B
 * identical to A reads as unchosen, and Run says why it is off.
 */
export function CompareAndTest({ draft }: { draft: InferenceDraft }) {
  const state = useSetStudioState();
  const population = resolvePopulation(state);
  const set = state.sets[state.selection.activeSetId ?? ''];
  const [error, setError] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const exploratory = isExploratorySelection(state.population.working);
  const { current } = draft;
  const operandsCurrent = inferenceOperandsCurrent(state);
  const paused = current && !inferenceActive(current, state.population.presentation.arrangement);
  const a = new Set(population.workingMemberIds);
  const overlap = population.referenceMemberIds.filter((id) => a.has(id)).length;
  const participants = resolvePopulationParticipants(state, population.referenceMemberIds);
  const aLabel =
    state.population.working.kind === 'members'
      ? `${state.population.working.label} · ${population.workingMemberIds.length}`
      : `Everyone · ${population.workingMemberIds.length}`;
  const descriptor = draft.method === 'descriptive' ? null : inferenceMethod(draft.method);
  const missing = draftMissing(draft);
  const aIsSelection = state.population.working.kind === 'members';
  const bSameAsA =
    population.referenceMemberIds.length > 0 &&
    sameMembers(population.workingMemberIds, population.referenceMemberIds);
  const operandsIssue = compareOperandsIssue({
    a: population.workingMemberIds,
    b: population.referenceIssue ? [] : population.referenceMemberIds,
    aIsSelection,
    needsB: methodNeedsB(draft.method),
  });
  // A Run with the descriptive comparison only removes a test in force: always allowed.
  const runDisabled =
    draft.method === 'descriptive' ? !current : !!missing || !!operandsIssue;
  const save = (ids: readonly string[], name: string) =>
    state.createSavedCohort({
      memberIds: [...ids],
      label: name,
      originLabel:
        state.population.working.kind === 'members' ? state.population.working.origin : 'context',
      description: 'Frozen observation membership from Population',
    });
  const groups = state.population.partition ? comparableGroups(state.population.partition) : [];
  const run = () => {
    try {
      if (draft.method === 'descriptive') {
        setError(configureInference(null));
        return;
      }
      setError(
        configureInference({
          method: draft.method,
          role: draft.role,
          units: draft.units,
          nullValue: draft.nullValue,
          independentParticipants: draft.independent,
          ...(draft.method === 'linearModel'
            ? {
                design: buildPopulationDesign(
                  draft.covariates,
                  draft.coefficient,
                  draft.contrastUnits,
                ),
              }
            : {}),
          selectionOrigin:
            state.population.working.kind === 'members' ? state.population.working.origin : 'manual',
          channel: 'effect',
        }),
      );
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  return (
    <div className="flex flex-col gap-2 text-bf-sm" aria-label="Compare and test">
      <div className="flex flex-col gap-0.5" data-testid="compare-a">
        <div className="flex items-baseline justify-between gap-2">
          <span className="shrink-0 text-muted-foreground">A</span>
          <span className="min-w-0 flex-1 truncate text-right">{aLabel}</span>
          {exploratory ? (
            <IconButton
              icon={<Info />}
              aria-label="Why exploratory"
              aria-expanded={whyOpen}
              title={EXPLORATORY_REASON}
              onClick={() => setWhyOpen((value) => !value)}
            />
          ) : null}
        </div>
        {exploratory ? (
          <p className="m-0 text-right text-bf-xs text-bf-text-muted">
            <span data-testid="exploratory-label" title={EXPLORATORY_REASON}>
              {EXPLORATORY_LABEL}
            </span>
            {whyOpen ? <span className="block">{EXPLORATORY_REASON}</span> : null}
          </p>
        ) : null}
      </div>
      <label className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">B</span>
        <Select
          className="w-auto max-w-[75%]"
          aria-label="Reference B"
          value={
            // A B that is A itself is no B: it reads as unchosen.
            bSameAsA
              ? ''
              : state.population.referenceMode === 'complement'
                ? 'complement'
                : (state.selection.compareCohortId ?? '')
          }
          onChange={(e) => {
            const value = e.target.value;
            if (value.startsWith('group:')) {
              const group = groups.find((g) => `group:${g.id}` === value);
              const cohort = group ? save(group.memberIds, group.label) : null;
              if (cohort) {
                state.setPopulationReferenceMode('cohort');
                state.setCompareCohort(cohort);
              }
              return;
            }
            state.setPopulationReferenceMode(value === 'complement' ? 'complement' : 'cohort');
            if (value !== 'complement') state.setCompareCohort(value || null);
          }}
        >
          <option value="">Choose B</option>
          <option value="complement" disabled={!aIsSelection}>
            {aIsSelection ? 'The rest (live)' : 'The rest (select A first)'}
          </option>
          {groups.map((group) => {
            const same = sameMembers(group.memberIds, population.workingMemberIds);
            return (
              <option key={group.id} value={`group:${group.id}`} disabled={same}>
                {group.label} · {group.memberIds.length}
                {same ? ' · same as A' : ''}
              </option>
            );
          })}
          {set?.savedCohortIds.map((id) => {
            const cohort = state.cohorts[id];
            if (!cohort) return null;
            const same = sameMembers(cohort.memberIds, population.workingMemberIds);
            return (
              <option key={id} value={id} disabled={same}>
                {cohort.label}
                {same ? ' · same as A' : ''}
              </option>
            );
          })}
        </Select>
      </label>
      {groups.length > 0 && (
        <label className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">A from a group</span>
          <Select
            className="w-auto max-w-[60%]"
            aria-label="Assign group to A"
            value=""
            onChange={(event) => {
              const group = groups.find((g) => g.id === event.target.value);
              if (group && state.population.partition)
                populationProbeActions.select(
                  group.memberIds,
                  'replace',
                  state.population.partition.origin,
                  group.label,
                );
            }}
          >
            <option value="">Choose a group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label} · {group.memberIds.length}
              </option>
            ))}
          </Select>
        </label>
      )}
      <p className="m-0 text-muted-foreground" data-testid="compare-b-count">
        B: {bSameAsA ? 0 : population.referenceMemberIds.length} observations
        {participants.identity && !participants.issue
          ? ` · ${participants.groups.length} participants`
          : ''}{' '}
        {bSameAsA ? '' : ` · ${overlap} shared with A`}
      </p>
      {population.referenceIssue && (
        <Notice role="alert" severity="danger">
          {population.referenceIssue}
        </Notice>
      )}
      {state.population.referenceMode === 'complement' && (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={!population.referenceMemberIds.length || !!population.referenceIssue}
          title="Keep B as these members even when A changes"
          onClick={() => {
            const id = save(population.referenceMemberIds, 'Frozen B');
            if (id) {
              state.setPopulationReferenceMode('cohort');
              state.setCompareCohort(id);
            }
          }}
        >
          Freeze B
        </Button>
      )}
      <label className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Test</span>
        <Select
          className="w-auto max-w-[75%]"
          aria-label="Statistical method"
          value={draft.method}
          onChange={(e) => {
            setError(null);
            draft.setMethod(e.target.value as Method);
          }}
        >
          <option value="descriptive">Difference of means (descriptive)</option>
          {inferenceMethods.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </label>
      {descriptor && (
        <p className="m-0 text-muted-foreground" title={descriptor.limitations}>
          {descriptor.description}
        </p>
      )}
      {draft.method === 'linearModel' && (
        <fieldset className="m-0 flex flex-col gap-2 rounded-sm border border-border p-2">
          <legend className="text-bf-xs text-muted-foreground">Participant design</legend>
          <div className="flex flex-wrap gap-2">
            {(set?.designColumns ?? []).map((column) => (
              <label key={column} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={draft.covariates.includes(column)}
                  onChange={(e) =>
                    draft.setCovariates((cols) =>
                      e.target.checked ? [...cols, column] : cols.filter((c) => c !== column),
                    )
                  }
                />
                {column}
              </label>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2">
            Coefficient
            <Select
              className="w-auto max-w-[60%]"
              aria-label="Model coefficient"
              value={draft.coefficient}
              onChange={(e) => draft.setCoefficient(e.target.value)}
            >
              {['(intercept)', ...draft.covariates].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </label>
          <label className="flex items-center justify-between gap-2">
            Coefficient units
            <TextField
              className="w-40"
              aria-label="Coefficient units"
              placeholder="e.g. % signal change / year"
              value={draft.contrastUnits}
              onChange={(e) => draft.setContrastUnits(e.target.value)}
            />
          </label>
        </fieldset>
      )}
      {missing ? (
        <p className="m-0 text-muted-foreground" data-testid="test-missing">
          {missing}
        </p>
      ) : null}
      {operandsIssue ? (
        <p className="m-0 text-muted-foreground" data-testid="compare-operands-issue">
          {operandsIssue}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={runDisabled}
          title={
            draft.method !== 'descriptive' ? (missing ?? operandsIssue ?? undefined) : undefined
          }
          onClick={run}
        >
          Run
        </Button>
        {current && !operandsCurrent ? (
          <span className="text-bf-text-muted" data-testid="test-out-of-date">
            A or B changed since the last Run
          </span>
        ) : null}
      </div>
      {error && (
        <Notice role="alert" severity="danger">
          {error}
        </Notice>
      )}
      {current && operandsCurrent && (
        <p role="status" className="m-0">
          {paused ? 'Test paused in this arrangement. ' : ''}
          {inferenceMethod(current.method).label}:{' '}
          {current.method === 'linearModel'
            ? `coefficient contrast (${current.design?.columns.join(', ')})`
            : inferenceMethod(current.method).inputs === 'onePopulation'
              ? 'mean(A)'
              : current.method === 'paired'
                ? 'mean(within-person A − B)'
                : 'mean(A) − mean(B)'}{' '}
          − {current.nullValue} {current.design?.contrastUnits ?? current.units}. Its channels are
          in Show.
          {exploratory ? ` A is an ${EXPLORATORY_LABEL.toLowerCase()}.` : ''}
        </p>
      )}
    </div>
  );
}

