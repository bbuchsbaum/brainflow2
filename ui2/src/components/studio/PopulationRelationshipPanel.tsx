import { Button, Notice, NumberField, Select, StatusPill } from '@/components/ui/bf';
import { PopulationExplanation, type ExplanationPairRequest } from './PopulationExplanation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import {
  populationRelationshipService,
  relationshipFittedIds,
  relationshipSource,
  relationshipUnassigned,
  relationshipUsable,
  type RelationshipRequest,
} from '@/services/studio/PopulationRelationshipService';
import {
  NEIGHBOUR_PRESERVATION_K,
  nearestToCentroid,
  neighbourPreservation,
  rankNeighbours,
  type CentroidWeighting,
  type PopulationSummaryKind,
} from '@/services/studio/relationshipNeighbours';
import { resolvePopulation } from '@/services/studio/populationContext';
import { participantIdentity } from '@/services/studio/populationParticipants';
import { resolveStudioPopulationPreview } from '@/services/studio/observationStatus';
import type { PopulationSliceService } from '@/services/studio/PopulationSliceService';
import { PopulationBrush } from './PopulationBrush';
import { PopulationRelationshipScatter } from './PopulationRelationshipScatter';
import { relationshipDistanceScale } from './relationshipPresentation';
import {
  RelationshipCentroidList,
  RelationshipNeighbourTable,
  RelationshipUnassignedList,
} from './PopulationRelationshipLists';

const count = (n: number) => n.toLocaleString('en-US');

function Swatch({ kind }: { kind: 'observation' | 'selected' | 'focused' | 'preview' | 'line' }) {
  return (
    <svg aria-hidden width="20" height="14" viewBox="0 0 20 14" className="shrink-0">
      {kind === 'line' ? (
        <line x1="1" x2="19" y1="7" y2="7" stroke="var(--bf-border-strong)" />
      ) : kind === 'preview' ? (
        <rect
          x="4"
          y="1"
          width="12"
          height="12"
          fill="none"
          stroke="var(--bf-text-primary)"
          strokeDasharray="3 2"
        />
      ) : (
        <>
          <circle
            cx="10"
            cy="7"
            r={kind === 'focused' ? 3 : 2.5}
            fill={kind === 'observation' ? 'var(--bf-text-muted)' : 'var(--bf-text-primary)'}
          />
          {kind === 'focused' && (
            <circle
              cx="10"
              cy="7"
              r="6"
              fill="none"
              stroke="var(--bf-border-focus)"
              strokeWidth="1.5"
            />
          )}
        </>
      )}
    </svg>
  );
}

export function PopulationRelationshipPanel({
  summaryKind = 'mean',
  sliceService,
}: {
  /** The lens's live summary choice; nearest-the-centroid needs the mean. */
  summaryKind?: PopulationSummaryKind;
  /** The lens's slice owner, which renders the scatter peek's rasters. */
  sliceService?: PopulationSliceService;
} = {}) {
  const state = useSetStudioStore();
  useViewStateStore((s) => s.activeWorkspaceKey);
  const service = populationRelationshipService;
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );
  const { scope, source, issue } = relationshipSource();
  const [distance, setDistance] = useState<RelationshipRequest['distance']>('effect');
  const [count_, setCount] = useState(2);
  const [bounds, setBounds] = useState<HTMLDivElement | null>(null);
  const [pairRequest, setPairRequest] = useState<ExplanationPairRequest | null>(null);
  const nonce = useRef(0);
  useEffect(() => {
    service.resetScope(scope);
    return () => service.cancel();
  }, [service, scope]);
  const fit = snapshot.scope === scope ? snapshot.fit : null;
  const current = !!fit && !snapshot.stale && !snapshot.pending;
  const stale = !!fit && snapshot.stale;
  // Rankings, the centroid list and Compare need a fit that is current for
  // this population; the shared predicate also drives order() and group().
  const usable = !!fit && relationshipUsable(service);
  const population = resolvePopulation(state);
  const selected = new Set(population.workingMemberIds);
  const contextCount = population.context.memberIds.length;
  // Geometry is indexed by fitted members; unassigned members have no position.
  const fitted = useMemo(() => (fit ? relationshipFittedIds(fit) : []), [fit]);
  const unassignedCount = fit ? relationshipUnassigned(fit).length : 0;
  const focusedId = state.selection.activeMemberId;

  const preservation = useMemo(
    () =>
      fit
        ? neighbourPreservation(
            fit.geometry.distances,
            fit.geometry.coordinates,
            NEIGHBOUR_PRESERVATION_K,
          )
        : null,
    [fit],
  );
  const neighbours = useMemo(
    () => (fit && focusedId ? rankNeighbours(fit, focusedId) : null),
    [fit, focusedId],
  );
  const neighbourMarks = useMemo(
    () =>
      usable && neighbours
        ? neighbours
            .filter((n) => n.rank <= NEIGHBOUR_PRESERVATION_K)
            .map((n) => ({ memberId: n.memberId, rank: n.rank }))
        : [],
    [usable, neighbours],
  );

  // The centroid of the working selection, or of the previewed selection
  // while hold-to-preview applies.
  const preview = state.populationPreview.holding
    ? resolveStudioPopulationPreview(state, population)
    : null;
  const previewing = !!preview && preview.memberIds.length > 0;
  const centroidSelection = previewing
    ? population.workingMemberIds.filter((id) => !preview!.memberIds.includes(id))
    : population.workingMemberIds;
  const participants = state.population.participants;
  const set = state.selection.activeSetId ? state.sets[state.selection.activeSetId] : null;
  let weighting: CentroidWeighting = { kind: 'observations' };
  if (participants?.reduction === 'mean') {
    let participantOf: ReadonlyMap<string, string> = new Map();
    try {
      if (set) participantOf = participantIdentity(set, participants);
    } catch {
      // Unresolved identity disables the list with its reason.
    }
    weighting = { kind: 'participants', participantOf };
  }
  const centroid = fit
    ? nearestToCentroid(fit, centroidSelection, { summaryKind, usable, weighting })
    : null;

  const compare = (neighbourId: string) => {
    if (!focusedId || !fit) return;
    nonce.current += 1;
    // Carries its fit: the explanation ignores it after a refit.
    setPairRequest({ fitId: fit.fitId, a: focusedId, b: neighbourId, nonce: nonce.current });
  };

  return (
    <details
      className="rounded-sm border border-border p-3 text-bf-sm"
      aria-label="Spatial relationships"
    >
      <summary className="cursor-pointer">
        <span className="font-medium">Spatial relationships</span>{' '}
        <span className="text-bf-text-muted">
          {fit
            ? `· ${fitted.length} of ${fitted.length + unassignedCount} observations placed`
            : `· ${contextCount} observations · not fitted`}
        </span>
        {stale && (
          <StatusPill status="warning" className="ml-2 align-middle">
            Out of date
          </StatusPill>
        )}
      </summary>
      <div ref={setBounds} className="relative mt-3 space-y-3">
        {!fit && (
          <p className="m-0 text-bf-text-muted">
            Compare every pair of maps on the voxels they share, then see each observation's nearest
            maps and how faithfully a 2D plot keeps them. Maps that cover too little of the support
            are listed with a reason instead of placed.
          </p>
        )}
        {stale && (
          <Notice role="alert" severity="warning">
            Inputs changed since this fit. The layout stays frozen. Neighbour ranks, the centroid
            list and Compare are off until you refit.
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label>
            Distance{' '}
            <Select
              className="w-auto max-w-full"
              aria-label="Spatial distance"
              value={distance}
              onChange={(e) => setDistance(e.target.value as typeof distance)}
            >
              <option value="effect">Effect · RMS difference</option>
              <option value="pattern-shape">Pattern shape · centered, unit norm</option>
            </Select>
          </label>
          <Button
            variant={stale || !fit ? 'primary' : 'secondary'}
            size="sm"
            disabled={!source || snapshot.pending}
            onClick={() => void service.fit(distance)}
          >
            Fit on current support
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={
              !source ||
              snapshot.pending ||
              !state.population.pinnedProbe ||
              state.population.pinnedProbe.radiusMm <= 0
            }
            onClick={() => void service.fit(distance, true)}
          >
            Compare maps in pinned region
          </Button>
          {snapshot.pending && (
            <Button variant="secondary" size="sm" onClick={service.cancel}>
              Cancel fit
            </Button>
          )}
        </div>
        {!fit && (
          <p className="m-0 text-bf-text-muted">
            Effect distance compares magnitudes in map units. Pattern shape removes each map's mean
            and scale first. Pin a region to compare maps within it.
          </p>
        )}
        {snapshot.pending && (
          <p role="status">Computing spatial relationships… Previous fit retained.</p>
        )}
        {(issue || snapshot.error) && (
          <Notice role="alert" severity="danger">
            {issue || snapshot.error}
            {fit && snapshot.error && ' Previous fit retained below.'}
          </Notice>
        )}
        {!fit && !snapshot.pending && (
          <p className="m-0 rounded-sm border border-dashed border-bf-border-subtle p-3 text-bf-text-muted">
            No fit yet. Positions, neighbours and the unassigned list appear here.
          </p>
        )}
        {fit && (
          <>
            <p className="m-0">
              {fit.request.distance === 'effect'
                ? 'Effect distance: root mean squared difference in original map units.'
                : 'Pattern-shape distance: each map spatially centered and normalized to unit Euclidean norm; magnitude removed.'}{' '}
              {fit.request.region
                ? `Sphere: ${fit.request.region.radiusMm} mm at (${fit.request.region.worldMm.join(', ')}).`
                : 'Whole current support.'}{' '}
              {fit.request.mask
                ? 'Common mask applied.'
                : 'No mask: finite background values are included.'}
            </p>
            <p className="m-0 text-bf-text-muted" data-testid="relationship-fit-line">
              Fit <span className="font-mono">{fit.fitId.slice(0, 8)}</span> ·{' '}
              {count(fit.commonVoxels)} / {count(fit.candidateVoxels)} common finite voxels ·{' '}
              {(100 * (1 - fit.commonVoxels / fit.candidateVoxels)).toFixed(1)}% coverage loss · 2D
              keeps {(100 * fit.geometry.explainedFraction).toFixed(1)}% of variation · normalized
              stress {fit.geometry.stress.toFixed(3)} ·{' '}
              <span data-testid="neighbour-preservation">
                {preservation?.informative ? (
                  <>
                    nearest neighbours kept on screen{' '}
                    <span className="font-mono text-bf-text-primary">
                      {Math.round(100 * preservation.overall)}%
                    </span>{' '}
                    (k = {preservation.k})
                  </>
                ) : (
                  <span title={preservation?.reason}>
                    neighbour preservation not informative (n ≤ {NEIGHBOUR_PRESERVATION_K + 1})
                  </span>
                )}
              </span>
            </p>
            {!fit.geometry.orderable && (
              <p className="m-0 text-bf-text-muted">
                No distinct first axis: leading axes are tied or there is no variation. Axis-1
                ordering is unavailable.
              </p>
            )}
            <div className="flex flex-wrap items-start gap-4">
              <figure className="m-0 flex min-w-0 flex-[1_1_360px] flex-col gap-1.5">
                <PopulationBrush
                  scope={fit.fitId}
                  lasso
                  origin="map-derived"
                  selectionLabel={`Spatial relationship lasso · ${fit.fitId}`}
                >
                  <div
                    className="rounded-sm border border-bf-border-subtle bg-bf-bg-panel-sunken"
                    data-frozen={stale || undefined}
                  >
                    <PopulationRelationshipScatter
                      fitId={fit.fitId}
                      fitted={fitted}
                      coordinates={fit.geometry.coordinates}
                      selected={selected}
                      activeMemberId={focusedId}
                      neighbourMarks={neighbourMarks}
                      sliceService={sliceService}
                      bounds={bounds}
                      onToggle={(id) => service.toggle(id)}
                    />
                  </div>
                </PopulationBrush>
                <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-bf-xs text-bf-text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Swatch kind="observation" />
                    Observation
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Swatch kind="selected" />
                    Selected
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Swatch kind="focused" />
                    Focused
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Swatch kind="preview" />
                    Previewed
                  </span>
                  {neighbourMarks.length > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Swatch kind="line" />
                      Nearest {NEIGHBOUR_PRESERVATION_K} by distance, numbered
                    </span>
                  )}
                </figcaption>
                <p className="m-0 text-bf-xs text-bf-text-muted">
                  {stale ? 'Positions at fit time. ' : ''}Hover a point to preview its slice; click
                  to focus. Coincident points overlap; arrow keys reach each one.
                  {unassignedCount > 0 &&
                    ` The lasso selects placed observations only; the ${unassignedCount} unassigned are never lassoed.`}
                </p>
              </figure>
              <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-4">
                <RelationshipNeighbourTable
                  fit={fit}
                  focusedId={focusedId}
                  neighbours={neighbours}
                  usable={usable}
                  stale={stale}
                  onCompare={compare}
                />
                {centroid && (
                  <RelationshipCentroidList
                    result={centroid}
                    distanceScale={relationshipDistanceScale(fit)}
                    stale={stale}
                    activeMemberId={focusedId}
                    selectedCount={centroidSelection.length}
                    participantWeighted={weighting.kind === 'participants'}
                    previewLabel={previewing ? preview!.label : null}
                  />
                )}
              </div>
            </div>
            <RelationshipUnassignedList fit={fit} stale={stale} activeMemberId={focusedId} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!current || !fit.geometry.orderable}
                onClick={() => service.order()}
              >
                Order movie by MDS axis 1
              </Button>
              <label>
                Groups{' '}
                <NumberField
                  fieldClassName="w-16"
                  aria-label="Similarity group count"
                  min={2}
                  max={fitted.length}
                  value={Number.isFinite(count_) ? count_ : ''}
                  onChange={(e) => setCount(e.target.valueAsNumber)}
                />
              </label>
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  !current || !Number.isInteger(count_) || count_ < 2 || count_ > fitted.length
                }
                onClick={() => service.group(count_)}
              >
                Create similarity groups
              </Button>
            </div>
            <PopulationExplanation
              key={fit.fitId}
              fit={fit}
              current={current}
              pairRequest={pairRequest}
            />
            <p className="m-0 text-bf-text-muted">
              Average linkage uses the original distances, not the 2D picture. Groups and selections
              are exploratory. Exact fit: up to 128 observations within a bounded spatial support.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
