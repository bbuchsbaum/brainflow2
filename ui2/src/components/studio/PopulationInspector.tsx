import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown, Info } from 'lucide-react';
import { Button, IconButton, Section, SegmentedControl, Select } from '@/components/ui/bf';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/DropdownMenu';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useSetStudioState } from '@/stores/setStudio/useSetStudioState';
import { usePopulationViewStore } from '@/stores/populationViewStore';
import {
  describePopulationExclusion,
  resolvePopulation,
} from '@/services/studio/populationContext';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { populationProbeController } from '@/services/studio/PopulationProbeController';
import {
  populationRelationshipService,
  relationshipUnassigned,
  relationshipViewFit,
} from '@/services/studio/PopulationRelationshipService';
import {
  NEIGHBOUR_PRESERVATION_K,
  medianPairDistance,
  nearestToCentroid,
  neighbourPreservation,
  rankNeighbours,
  type CentroidWeighting,
  type PopulationSummaryKind,
} from '@/services/studio/relationshipNeighbours';
import { participantIdentity } from '@/services/studio/populationParticipants';
import {
  decodePreviewTarget,
  encodePreviewTarget,
  resolveStudioObservationStatuses,
  resolveStudioPopulationPreview,
} from '@/services/studio/observationStatus';
import { resolvePopulationParticipants } from '@/services/studio/populationParticipants';
import { studioMetadata } from '@/services/studio/studioMetadata';
import { PopulationUnitControls } from './PopulationUnitControls';
import { PopulationMaskControls } from './PopulationMaskControls';
import { AboutTheValues, CompareAndTest } from './PopulationCompareTest';
import { compareTestRequests, useInferenceDraft, useReferenceFollowsSelection } from './inferenceDraft';
import {
  RelationshipCentroidList,
  RelationshipNeighbourTable,
  RelationshipUnassignedList,
} from './PopulationRelationshipLists';
import { PopulationExplanation, type ExplanationPairRequest } from './PopulationExplanation';
import {
  formatRelationshipDistance,
  pathListNames,
  relationshipDistanceScale,
  signed,
  valueStanding,
} from './relationshipPresentation';
import { DEFAULT_SIMILARITY_MEASURE, SIMILARITY_MEASURE_LINE } from './montageModel';
import { useValuesLocus } from './valuesLocus';

const count = (n: number) => n.toLocaleString('en-US');
/** A metadata value as the Inspector shows it: a file path by its name (the full path is its title). */
function factText(value: unknown): string {
  const text = String(value);
  const path =
    /[\\/]/.test(text) &&
    (/^(?:[A-Za-z]:[\\/]|[\\/~.])/.test(text) || /\.[A-Za-z0-9]{1,8}$/.test(text));
  return path ? (text.split(/[\\/]/).filter(Boolean).pop() ?? text) : text;
}
const MEASURE_WORD = { 'pattern-shape': 'correlation', effect: 'amplitude' } as const;
/** The synthesized column listing each member's images (wire name "roles"). */
const IMAGES_COLUMN = 'roles';

type NearestMode = 'focused' | 'selection';

/**
 * The Population Inspector answers "what am I looking at": the focused
 * subject, the selection, the subjects nearest either, then the comparison
 * being defined, the settings made once per dataset, and where it all came
 * from. It is its own GoldenLayout root: everything it shows is read from the
 * store and the shared services.
 */
export function PopulationInspector() {
  const state = useSetStudioState();
  const population = resolvePopulation(state);
  const draft = useInferenceDraft();
  // A new selection is compared with the rest unless B was chosen for it.
  useReferenceFollowsSelection();
  const working = state.population.working;
  const hasSelection = working.kind === 'members';
  const focusedId = state.selection.activeMemberId;
  const contextCount = population.context.memberIds.length;

  // "Compare with the rest" (selection bar) opens Compare and test here.
  const [compareOpen, setCompareOpen] = useState(hasSelection);
  const compareRequest = useSyncExternalStore(
    compareTestRequests.subscribe,
    compareTestRequests.getSnapshot,
  );
  const lastRequest = useRef(compareRequest);
  useEffect(() => {
    if (compareRequest === lastRequest.current) return;
    lastRequest.current = compareRequest;
    setCompareOpen(true);
  }, [compareRequest]);

  return (
    <section aria-label="Population inspector" className="flex min-w-0 flex-col text-bf-md">
      {/* The focused subject and the selection are both shown: a selection never hides who is focused. */}
      {focusedId ? <FocusedBlock /> : null}
      <div
        data-testid="population-selection-section"
        className="border-t border-border px-3 py-2 text-bf-sm"
        aria-label="Selection"
        role="group"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-foreground">Selection</span>
          {hasSelection ? (
            <span className="text-muted-foreground">
              {`${population.workingMemberIds.length} of ${contextCount} · ${working.label}`}
            </span>
          ) : null}
        </div>
        {!hasSelection ? (
          <p className="m-0 mt-0.5 text-bf-xs text-muted-foreground" data-testid="selection-empty">
            No selection — summaries use all {contextCount}
          </p>
        ) : null}
        {/* Select all stays; the other commands appear once they apply. */}
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Button
            variant="secondary"
            size="sm"
            disabled={!contextCount}
            onClick={() =>
              populationProbeActions.select(
                population.context.memberIds,
                'replace',
                'manual',
                'Every subject',
              )
            }
          >
            Select all
          </Button>
          {hasSelection ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={populationProbeActions.selectFocused}
                disabled={!population.context.memberIds.includes(focusedId ?? '')}
                title="Keep only the focused subject selected"
              >
                Focused only
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={populationProbeActions.selectAll}
                title="Back to no selection: every subject in play"
              >
                Clear
              </Button>
            </>
          ) : null}
          {state.population.selectionPast.length ? (
            <Button variant="secondary" size="sm" onClick={populationProbeActions.undoSelection}>
              Undo selection
            </Button>
          ) : null}
        </div>
        {hasSelection && !focusedId ? (
          <div className="mt-1.5">
            <HoldToPreview />
          </div>
        ) : null}
      </div>
      <NearestBlock />
      <Section
        title="Compare and test"
        meta={state.population.inference ? 'test set' : 'choose A and B'}
        metaMono={false}
        open={compareOpen}
        onOpenChange={setCompareOpen}
        keepMounted
      >
        <CompareAndTest draft={draft} />
      </Section>
      <Section title="Analysis setup" defaultOpen={false} keepMounted>
        <div className="flex flex-col gap-3">
          <PopulationUnitControls />
          <PopulationMaskControls />
          <AboutTheValues draft={draft} />
          <SimilaritySetup />
        </div>
      </Section>
      <Section
        title="Coverage and sources"
        meta={`${population.workingMemberIds.length} of ${contextCount} available`}
        metaMono={false}
        defaultOpen={false}
      >
        <CoverageAndSources />
      </Section>
    </section>
  );
}

/** A metadata fact: a list of map paths reads as their short names, the shown map marked. */
function FactValue({ column, value }: { column: string; value: unknown }) {
  const shownFeatureId = useSetStudioStore((state) => state.selection.activeFeatureId);
  const text = String(value);
  const list = pathListNames(text);
  if (!list) {
    return (
      <dd className="m-0 truncate" title={text}>
        {factText(value)}
      </dd>
    );
  }
  const shown = list.find((item) => item.path === shownFeatureId) ?? null;
  return (
    <dd
      className="m-0 min-w-0"
      title={`${list.map((item) => item.path).join('\n')}${shown ? `\nShown: ${shown.path}` : ''}`}
      data-testid={column === IMAGES_COLUMN ? 'focused-maps' : undefined}
    >
      {list.map((item, index) => (
        <span key={item.path}>
          {index > 0 ? <span className="text-muted-foreground"> · </span> : null}
          <span
            className={item === shown ? 'font-medium text-foreground' : 'text-muted-foreground'}
            data-shown={item === shown || undefined}
          >
            {item.name}
          </span>
        </span>
      ))}
      {shown ? <span className="sr-only"> (shown: {shown.name})</span> : null}
    </dd>
  );
}

/** The focused subject: who, what is known, and its value at the pin (or pointer) among the others. */
function FocusedBlock() {
  const state = useSetStudioState();
  const focusedId = state.selection.activeMemberId;
  const set = state.selection.activeSetId ? state.sets[state.selection.activeSetId] : null;
  const saved = set?.savedPopulation;
  const source = saved?.members.find((member) => member.memberId === focusedId);
  const metadata = useMemo(
    () => (set && focusedId ? studioMetadata(set, [focusedId]) : null),
    [set, focusedId],
  );
  // The heading already names the subject: a column that only repeats its ID is left out.
  const facts =
    metadata && !metadata.issue && focusedId
      ? metadata.columns
          .map((column) => ({ column, value: metadata.rows.get(focusedId)?.[column] ?? '—' }))
          .filter((fact) => String(fact.value) !== focusedId)
          .slice(0, 4)
      : [];
  const probe = useSyncExternalStore(
    populationProbeController.subscribe,
    populationProbeController.getSnapshot,
  );
  // Only the values of the pin now asked for: the previous pin's value is never shown as this one's.
  const valuesCurrent =
    !!probe.displayed && !probe.pending && probe.displayed.query.key === probe.requested?.key;
  const valuePending = !!probe.requested && !valuesCurrent;
  const frameRows = valuesCurrent ? probe.displayed!.frame.rows : null;
  const valueRow = frameRows?.find((row) => String(row.member) === focusedId);
  // Named after where the Values tab samples (the pin, or the pointer while following hover).
  // No default: with no locus there is no value, and a stale label never names the pin.
  const locusKind = useValuesLocus()?.kind ?? null;
  const where =
    locusKind === 'pointer' ? 'the pointer' : locusKind === 'pin' ? 'the pin' : 'the probe';
  const standing = useMemo(
    () =>
      valueRow && frameRows
        ? valueStanding(
            typeof valueRow.value === 'number' ? valueRow.value : null,
            frameRows.map((row) => (typeof row.value === 'number' ? row.value : null)),
          )
        : null,
    [valueRow, frameRows],
  );
  return (
    <div
      className="flex flex-col gap-2 px-3 py-3 text-bf-sm"
      aria-label="Focused subject"
      role="group"
      data-testid="population-focused-block"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 break-all font-mono text-bf-md font-medium text-foreground">
            {focusedId ?? 'No subject focused'}
          </h3>
          {source?.stackIndex != null ? (
            <p className="m-0 text-bf-xs text-muted-foreground">
              frame {source.stackIndex + 1} (saved index {source.stackIndex})
            </p>
          ) : null}
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          disabled={!focusedId}
          onClick={() => {
            if (!focusedId) return;
            state.setActiveMember(focusedId);
            state.setActiveLens('deck');
          }}
        >
          Open in Deck
        </Button>
      </div>
      {facts.length > 0 || valueRow || valuePending ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {valuePending ? (
            <div className="contents" data-testid="focused-value-pending">
              <dt className="text-muted-foreground">Value at {where}</dt>
              <dd className="m-0 text-muted-foreground">sampling…</dd>
            </div>
          ) : valueRow ? (
            <div className="contents" data-testid="focused-value">
              <dt className="text-muted-foreground">Value at {where}</dt>
              <dd className="m-0 font-mono tabular-nums">
                {typeof valueRow.value === 'number' ? signed(valueRow.value.toPrecision(4)) : '—'}
                {standing ? (
                  <span
                    className="text-muted-foreground"
                    data-testid="focused-standing"
                    title={`Rank from the lowest of the ${standing.of} finite values at ${where}.${
                      standing.z === null
                        ? ''
                        : ' z: this value against the mean and SD of the other subjects (leave-one-out).'
                    }`}
                  >
                    {` · rank ${standing.rank}/${standing.of}`}
                    {standing.z === null ? '' : ` · z ${signed(standing.z.toFixed(1))}`}
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
          {facts.map((fact) => (
            <div key={fact.column} className="contents">
              <dt className="text-muted-foreground">
                {fact.column === IMAGES_COLUMN ? 'Maps' : fact.column}
              </dt>
              <FactValue column={fact.column} value={fact.value} />
            </div>
          ))}
        </dl>
      ) : null}
      <HoldToPreview />
    </div>
  );
}

/**
 * One Nearest table: the subjects nearest the focused subject, or nearest the
 * centre of the selection (a two-way switch, Selection only with a
 * selection). How either is computed is behind ⓘ; the median pair distance
 * under the table says what "near" means in this fit.
 */
function NearestBlock() {
  const state = useSetStudioState();
  const population = resolvePopulation(state);
  const relationship = useSyncExternalStore(
    populationRelationshipService.subscribe,
    populationRelationshipService.getSnapshot,
  );
  // One fit per view: the fit behind the montage's similarity groups (else
  // its order), so the nearest list ranks by the montage's measure.
  const viewFit = relationshipViewFit(state.population);
  // The groups (or order) on screen came from a fit this session no longer
  // holds: no ranks by another fit are shown under them, only why.
  const missing = viewFit.missing;
  const fit = missing ? null : viewFit.fit;
  const usable = !!fit && viewFit.usable;
  const missingReason = missing
    ? `Not ranked: the ${missing.basis === 'grouping' ? 'groups' : 'order'} on screen came from an earlier similarity fit. ${
        missing.basis === 'grouping' ? 'Group' : 'Sort'
      } by similarity again to rank by it.`
    : null;
  const stale = !!fit && fit === relationship.fit && relationship.stale;
  const working = state.population.working;
  const hasSelection = working.kind === 'members';
  const focusedId = state.selection.activeMemberId;

  // The table follows the last thing chosen: a new selection shows its centre.
  const [chosen, setChosen] = useState<NearestMode>('focused');
  useEffect(() => {
    if (working.kind === 'members') setChosen('selection');
  }, [working]);
  const mode: NearestMode =
    chosen === 'selection' && hasSelection
      ? 'selection'
      : focusedId
        ? 'focused'
        : hasSelection
          ? 'selection'
          : 'focused';
  const [methodOpen, setMethodOpen] = useState(false);

  // Centroid of the selection (or of the previewed selection while held).
  const preview = state.populationPreview.holding
    ? resolveStudioPopulationPreview(state, population)
    : null;
  const previewing = !!preview && preview.memberIds.length > 0;
  const centroidSelection = previewing
    ? population.workingMemberIds.filter((id) => !preview!.memberIds.includes(id))
    : population.workingMemberIds;
  const set = state.selection.activeSetId ? state.sets[state.selection.activeSetId] : null;
  let weighting: CentroidWeighting = { kind: 'observations' };
  if (state.population.participants?.reduction === 'mean') {
    let participantOf: ReadonlyMap<string, string> = new Map();
    try {
      if (set) participantOf = participantIdentity(set, state.population.participants);
    } catch {
      // Unresolved identity disables the list with its reason.
    }
    weighting = { kind: 'participants', participantOf };
  }
  // The lens's statistic: the centre of the selection is a mean.
  const summaryKind = usePopulationViewStore((view) => view.summary) as PopulationSummaryKind;
  const centroid =
    fit && hasSelection && mode === 'selection'
      ? nearestToCentroid(fit, centroidSelection, { summaryKind, usable, weighting })
      : null;
  const neighbours = useMemo(
    () => (fit && focusedId ? rankNeighbours(fit, focusedId) : null),
    [fit, focusedId],
  );
  const reference = useMemo(() => (fit ? medianPairDistance(fit.geometry.distances) : null), [fit]);
  const [pairRequest, setPairRequest] = useState<ExplanationPairRequest | null>(null);
  const nonce = useRef(0);
  // Nothing to rank by, and nothing to say why: the block is left out.
  if ((!focusedId && !hasSelection) || (!fit && !missingReason)) return null;
  return (
    <div
      className="flex flex-col gap-1.5 border-t border-border px-3 py-2 text-bf-sm"
      aria-label="Nearest subjects"
      role="group"
      data-testid="population-nearest"
    >
      <div className="flex items-center gap-2">
        <h3 className="m-0 text-bf-sm font-medium">Nearest</h3>
        <SegmentedControl
          aria-label="Nearest to"
          value={mode}
          onValueChange={(value) => setChosen(value as NearestMode)}
          hideWhenSingle={false}
          options={[
            {
              value: 'focused',
              label: 'Focused',
              disabled: !focusedId,
              title: focusedId ? `Nearest to ${focusedId}` : 'Focus a subject first',
            },
            {
              value: 'selection',
              label: 'Selection',
              disabled: !hasSelection,
              title: hasSelection ? 'Nearest the centre of the selection' : 'Select subjects first',
            },
          ]}
        />
        <span className="flex-1" />
        {fit ? (
          <IconButton
            icon={<Info />}
            aria-label="How nearest is measured"
            aria-expanded={methodOpen}
            title="How nearest is measured"
            onClick={() => setMethodOpen((open) => !open)}
          />
        ) : null}
      </div>
      {missingReason ? (
        <p className="m-0 text-bf-xs text-bf-text-secondary" data-testid="nearest-missing-fit">
          {missingReason}
        </p>
      ) : null}
      {fit && mode === 'focused' ? (
        <RelationshipNeighbourTable
          fit={fit}
          focusedId={focusedId}
          neighbours={neighbours}
          usable={usable}
          stale={stale}
          titled={false}
          showMethod={methodOpen}
          onCompare={(neighbourId) => {
            if (!focusedId) return;
            nonce.current += 1;
            // Carries its fit: the explanation ignores it after a refit.
            setPairRequest({ fitId: fit.fitId, a: focusedId, b: neighbourId, nonce: nonce.current });
          }}
        />
      ) : null}
      {fit && centroid ? (
        <RelationshipCentroidList
          result={centroid}
          fit={fit}
          distanceScale={relationshipDistanceScale(fit)}
          stale={stale}
          activeMemberId={focusedId}
          selectedCount={centroidSelection.length}
          participantWeighted={weighting.kind === 'participants'}
          previewLabel={previewing ? preview!.label : null}
          titled={false}
          showMethod={methodOpen}
        />
      ) : null}
      {fit && usable && reference !== null ? (
        <p className="m-0 text-bf-xs text-muted-foreground" data-testid="nearest-reference">
          median pair distance{' '}
          <span className="font-mono tabular-nums">
            {formatRelationshipDistance(reference, relationshipDistanceScale(fit))}
          </span>
        </p>
      ) : null}
      {fit ? (
        <PopulationExplanation
          key={fit.fitId}
          fit={fit}
          current={usable}
          pairRequest={pairRequest}
        />
      ) : null}
    </div>
  );
}

/** The statistic the summary map shows, as the hold control names it ("Group t without …"). */
const SUMMARY_STATISTIC: Record<PopulationSummaryKind, string> = {
  mean: 'mean',
  median: 'median',
  mad: 'MAD',
  sampleSd: 'SD',
  meanAbsolute: 'mean |v|',
  cancellation: 'cancellation',
  coverage: 'coverage',
  oneSampleT: 't',
  positiveFraction: '% positive',
};

/**
 * Hold to see the group summary without a unit (this subject, its
 * participant, a group or a saved set): the summary leaves it out only while
 * the button is held. One split button: the main part holds; its caret
 * chooses what is left out.
 */
function HoldToPreview() {
  const state = useSetStudioState();
  const population = resolvePopulation(state);
  const focusedId = state.selection.activeMemberId;
  const set = state.selection.activeSetId ? state.sets[state.selection.activeSetId] : null;
  const participants = resolvePopulationParticipants(state, population.workingMemberIds);
  const preview = resolveStudioPopulationPreview(state, population);
  const summaryKind = usePopulationViewStore((view) => view.summary) as PopulationSummaryKind;
  const chosenTarget = state.populationPreview.target;
  // The control shows the effective unit: a vanished group or set reads as the
  // focused observation, as the resolver applies it.
  const previewValue = encodePreviewTarget(
    chosenTarget && chosenTarget.kind === preview.kind
      ? chosenTarget
      : { kind: preview.kind === 'participant' ? 'participant' : 'observation' },
  );
  const participantMissing = preview.participant && !participants.identity?.has(focusedId ?? '');
  // Who is left out, by name: the subject, its participant, or the group or set.
  const without = preview.members
    ? preview.members.label
    : preview.participant
      ? `${focusedId ?? 'the focused subject'}'s participant`
      : (focusedId ?? 'the focused subject');
  const statistic = SUMMARY_STATISTIC[summaryKind] ?? 'summary';
  const label = `Group ${statistic} without ${without}`;
  const units: { value: string; label: string }[] = [
    { value: 'observation', label: 'This subject' },
    ...(participants.identity ? [{ value: 'participant', label: 'This participant' }] : []),
    ...(state.population.partition?.groups.map((g) => ({
      value: `group:${g.id}`,
      label: `Group: ${g.label}`,
    })) ?? []),
    ...(set?.savedCohortIds.flatMap((id) =>
      state.cohorts[id] ? [{ value: `set:${id}`, label: `Set: ${state.cohorts[id].label}` }] : [],
    ) ?? []),
  ];
  const menu: DropdownMenuItem[] = [
    { id: 'heading', header: true, label: 'Leave out' },
    ...units.map((unit) => ({
      id: unit.value,
      label: unit.label,
      checked: unit.value === previewValue,
      icon: unit.value === previewValue ? <Check aria-hidden /> : <span aria-hidden />,
      onClick: () => populationProbeActions.choosePreviewTarget(decodePreviewTarget(unit.value)),
    })),
  ];
  const shownUnit = units.find((unit) => unit.value === previewValue)?.label ?? 'This subject';
  return (
    <div className="flex min-w-0 max-w-full items-center" data-testid="hold-to-preview">
      <Button
        variant="secondary"
        size="sm"
        className="min-w-0 truncate rounded-r-none"
        aria-label={`${label} (hold)`}
        disabled={(!preview.members && !focusedId) || !!participantMissing}
        title={
          participantMissing
            ? 'The focused observation has no saved participant identity.'
            : `Hold: the group ${statistic} leaves ${without} out until you let go`
        }
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          populationProbeActions.holdPreview();
        }}
        onPointerUp={() => populationProbeActions.releasePreview()}
        onPointerCancel={() => populationProbeActions.releasePreview()}
        onBlur={() => populationProbeActions.releasePreview()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') populationProbeActions.releasePreview();
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            populationProbeActions.holdPreview();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === ' ' || event.key === 'Enter') populationProbeActions.releasePreview();
        }}
      >
        {label}
      </Button>
      <DropdownMenu
        position="bottom-right"
        items={menu}
        trigger={
          <IconButton
            variant="secondary"
            className="-ml-px rounded-l-none"
            icon={<ChevronDown />}
            aria-label={`Leave out: ${shownUnit}`}
            title="Choose what to leave out: this subject, a group or a set"
            data-testid="hold-to-preview-unit"
          />
        }
      />
    </div>
  );
}

/** The similarity measure (read-only: chosen in Sort or Group) and where it compares. */
function SimilaritySetup() {
  const measure = useSetStudioStore(
    (state) => state.population.similarityMeasure ?? DEFAULT_SIMILARITY_MEASURE,
  );
  const region = useSetStudioStore((state) => state.population.similarityRegion ?? 'support');
  const mask = useSetStudioStore((state) => state.population.mask);
  const pinned = useSetStudioStore((state) => state.population.pinnedProbe);
  const setRegion = useSetStudioStore((state) => state.setPopulationSimilarityRegion);
  const regionReady = !!pinned && pinned.radiusMm > 0;
  const maskName = mask?.sourcePath.split(/[\\/]/).pop() ?? null;
  return (
    <div className="flex flex-col gap-2 text-bf-sm" aria-label="Similarity" role="group">
      <div className="text-bf-xs text-muted-foreground">Similarity</div>
      <div className="flex items-baseline justify-between gap-2">
        <span>Measure</span>
        <output
          data-testid="similarity-measure-readonly"
          aria-label="Similarity measure"
          title={SIMILARITY_MEASURE_LINE[measure]}
          className="font-medium"
        >
          {MEASURE_WORD[measure]}
        </output>
      </div>
      <p className="m-0 text-bf-xs text-muted-foreground">Chosen in Sort or Group, in the montage</p>
      <label className="flex items-center justify-between gap-2">
        Compare within
        <Select
          className="w-auto max-w-[60%]"
          aria-label="Compare within"
          value={region === 'probe' && regionReady ? 'probe' : 'support'}
          onChange={(event) => setRegion(event.target.value as 'support' | 'probe')}
        >
          <option value="support">{maskName ? `Mask: ${maskName}` : 'Whole volume'}</option>
          <option value="probe" disabled={!regionReady}>
            {regionReady ? `Pinned region · ${pinned!.radiusMm} mm` : 'Pinned region (pin a point first)'}
          </option>
        </Select>
      </label>
      <p className="m-0 text-bf-xs text-muted-foreground">
        The mask is set above; the pinned region needs a pin with a radius (Values tab).
      </p>
    </div>
  );
}

/** Where everything came from: counts, source revisions, the fit, who is left out and why. */
function CoverageAndSources() {
  const state = useSetStudioState();
  const published = usePopulationViewStore((view) => view.coverage);
  // Coverage of another set or image is not this one's.
  const coverage =
    published &&
    published.scope === `${state.selection.activeSetId}:${state.selection.activeFeatureId}`
      ? published
      : null;
  const relationship = useSyncExternalStore(
    populationRelationshipService.subscribe,
    populationRelationshipService.getSnapshot,
  );
  // The fit the view describes (as the map and the nearest list do).
  const fit = relationshipViewFit(state.population).fit;
  const set = state.sets[state.selection.activeSetId ?? ''];
  const saved = set?.savedPopulation;
  const outside = useMemo(
    () =>
      resolveStudioObservationStatuses(
        {
          sets: state.sets,
          cohorts: state.cohorts,
          selection: state.selection,
          activeDesignFilters: state.activeDesignFilters,
          populationPreview: state.populationPreview,
          population: {
            working: state.population.working,
            participants: state.population.participants,
            partition: state.population.partition,
          },
        },
        {},
      ).outside,
    [
      state.sets,
      state.cohorts,
      state.selection,
      state.activeDesignFilters,
      state.populationPreview,
      state.population.working,
      state.population.participants,
      state.population.partition,
    ],
  );
  const preservation = useMemo(
    () =>
      fit
        ? neighbourPreservation(fit.geometry.distances, fit.geometry.coordinates, NEIGHBOUR_PRESERVATION_K)
        : null,
    [fit],
  );
  return (
    <div className="flex flex-col gap-3 text-bf-sm text-muted-foreground">
      {coverage ? (
        <div>
          <p className="m-0">
            {coverage.eligible} eligible observations; {coverage.selectedRows} selected rows;{' '}
            {coverage.units} {coverage.unitKind} units. Missing samples are transparent; measured
            zero remains valid.
          </p>
          <div className="mt-1 max-h-32 overflow-auto">
            <table className="w-full text-left" aria-label="Coverage and source revisions">
              <thead>
                <tr>
                  <th>Observation</th>
                  <th>Decoded source SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {coverage.sources.map((source) => (
                  <tr key={source.memberId}>
                    <td>{source.memberId}</td>
                    <td className="break-all font-mono">{source.sha256}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="m-0">No population images yet.</p>
      )}
      {fit ? (
        <div aria-label="Similarity fit" role="group">
          <p className="m-0" data-testid="relationship-fit-line">
            Fit <span className="font-mono">{fit.fitId.slice(0, 8)}</span> ·{' '}
            {count(fit.commonVoxels)} / {count(fit.candidateVoxels)} common finite voxels ·{' '}
            {(100 * (1 - fit.commonVoxels / fit.candidateVoxels)).toFixed(1)}% coverage loss ·
            normalized stress {fit.geometry.stress.toFixed(3)} ·{' '}
            <span data-testid="neighbour-preservation">
              {preservation?.informative
                ? `nearest neighbours kept on screen ${Math.round(100 * preservation.overall)}% (k = ${preservation.k})`
                : `neighbour preservation not informative (n ≤ ${NEIGHBOUR_PRESERVATION_K + 1})`}
            </span>
            {relationshipUnassigned(fit).length
              ? ` · ${relationshipUnassigned(fit).length} not placed`
              : ''}
          </p>
          <RelationshipUnassignedList
            fit={fit}
            stale={fit === relationship.fit && relationship.stale}
            activeMemberId={state.selection.activeMemberId}
          />
        </div>
      ) : null}
      {outside.length > 0 && (
        <div>
          <p className="m-0 font-medium text-foreground">Outside the context ({outside.length})</p>
          <div className="max-h-40 overflow-auto">
            <table className="w-full text-left" aria-label="Observations outside the context">
              <thead>
                <tr>
                  <th>Observation</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {outside.map((status) => (
                  <tr key={status.memberId}>
                    <td className="font-mono">{status.memberId}</td>
                    <td>{describePopulationExclusion(status.exclusion!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {saved && (
        <div aria-label="Saved calculation" role="group">
          <p className="m-0 font-medium text-foreground">Saved calculation · verified inputs</p>
          <p className="m-0 mt-1 break-all">{saved.recordPath}</p>
          <p
            className="m-0 mt-1 break-all font-mono"
            title="SHA-256 of the opened calculation record"
          >
            {saved.recordSha256}
          </p>
          {saved.notices.map((notice) => (
            <p key={notice} className="m-0 mt-1 leading-5">
              {notice}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
