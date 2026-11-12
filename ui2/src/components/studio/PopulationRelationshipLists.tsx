/**
 * The relationship section's tables (W1, W2): the focused observation's
 * neighbours by declared distance, the observations nearest the selection
 * centroid, and the unassigned observations of the fit.
 *
 * Rankings come from `relationshipNeighbours.ts`; this file only presents
 * them. A stale fit keeps its IDs visible but hides distances and disables
 * every ranking-based action (the plan's stale principle).
 */
import { useEffect, type ReactNode } from 'react';
import { Button, KeyValue, Notice, SelectableRow, useRovingFocus } from '@/components/ui/bf';
import { cn } from '@/utils/cn';
import {
  relationshipCoverageMedian,
  relationshipUnassigned,
  relationshipUnassignedReasonLabel,
  type RelationshipFit,
  type RelationshipUnassigned,
} from '@/services/studio/PopulationRelationshipService';
import {
  NEIGHBOUR_PRESERVATION_K,
  type NearestToCentroid,
  type RelationshipNeighbour,
} from '@/services/studio/relationshipNeighbours';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { populationMemberHover } from '@/services/studio/populationMemberHover';
import {
  distanceDefinition,
  distanceUnit,
  formatRelationshipDistance,
  ordinal,
  relationshipDistanceScale,
} from './relationshipPresentation';

/** Rows shown in the neighbour table and the centroid list. */
export const RELATIONSHIP_LIST_ROWS = 5;

const count = (n: number) => n.toLocaleString('en-US');
const observations = (n: number) => `${n} ${n === 1 ? 'observation' : 'observations'}`;


const Heading = ({ children, aside }: { children: ReactNode; aside?: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-2">
    <h3 className="m-0 text-bf-sm font-medium">{children}</h3>
    {aside && <span className="text-bf-xs text-bf-text-muted">{aside}</span>}
  </div>
);

export function RelationshipNeighbourTable({
  fit,
  focusedId,
  neighbours,
  usable,
  stale,
  onCompare,
  titled = true,
  showMethod = true,
}: {
  fit: RelationshipFit;
  focusedId: string | null;
  /** `rankNeighbours(fit, focusedId)`; null when the focused observation has no position. */
  neighbours: RelationshipNeighbour[] | null;
  /** False when stale or out of scope: ranks and Where they differ are off. */
  usable: boolean;
  stale: boolean;
  onCompare: (neighbourId: string) => void;
  /** Show the "Nearest to …" heading (the Inspector names the table in its own header). */
  titled?: boolean;
  /** Show how the distance is defined (the Inspector keeps it behind ⓘ). */
  showMethod?: boolean;
}) {
  // A row that goes away under the pointer leaves no tile marked.
  useEffect(() => () => populationMemberHover.set(null, 'inspector'), []);
  if (!focusedId)
    return (
      <section aria-label="Nearest observations" className="flex flex-col gap-1.5">
        {titled && <Heading>Nearest observations</Heading>}
        <p className="m-0 text-bf-text-muted">
          Focus an observation to rank the others by distance.
        </p>
      </section>
    );
  const unassigned = relationshipUnassigned(fit).find((u) => u.memberId === focusedId);
  if (unassigned) return <FocusedUnassigned fit={fit} entry={unassigned} titled={titled} />;
  if (!neighbours)
    return (
      <section aria-label={`Nearest to ${focusedId}`} className="flex flex-col gap-1.5">
        {titled && (
          <Heading>
            Nearest to <span className="font-mono">{focusedId}</span>
          </Heading>
        )}
        <p className="m-0 text-bf-text-muted">
          {focusedId} is not part of this fit. Refit to include it.
        </p>
      </section>
    );
  const rows = neighbours.slice(0, RELATIONSHIP_LIST_ROWS);
  const k = NEIGHBOUR_PRESERVATION_K;
  // The nearest point on screen, when it is not among the true k nearest.
  const screenFirst = neighbours.filter((n) => n.screenRank === 1);
  const misplaced =
    screenFirst.length > 0 && screenFirst.every((n) => n.rank > k) ? screenFirst[0] : null;
  const hidden = !usable;
  const scale = relationshipDistanceScale(fit);
  const aside = hidden ? (stale ? 'Refit to rank' : 'Unavailable') : undefined;
  return (
    <section aria-label={`Nearest to ${focusedId}`} className="flex flex-col gap-1.5">
      {titled ? (
        <Heading aside={aside}>
          Nearest to <span className="font-mono">{focusedId}</span>
        </Heading>
      ) : aside ? (
        <p className="m-0 text-bf-xs text-bf-text-muted">{aside}</p>
      ) : null}
      {showMethod && !titled ? (
        <p className="m-0 text-bf-xs text-bf-text-muted" data-testid="nearest-method">
          Distance from <span className="font-mono">{focusedId}</span>:{' '}
          {distanceDefinition(fit.request.distance)}, by the fit's distances on the common
          support, not by the plot.
        </p>
      ) : null}
      <NearestRowsTable
        fit={fit}
        ariaLabel={`Observations nearest to ${focusedId}`}
        hidden={hidden}
        withAction
        rows={rows.map((n) => {
          // The 2D layout's own rank stays one hover away, on the distance.
          const flagged = !hidden && n.rank <= k && n.screenRank > k;
          return {
            memberId: n.memberId,
            rank: n.rank,
            distance: formatRelationshipDistance(n.distance, scale),
            flagged,
            title: hidden
              ? undefined
              : flagged
                ? `${ordinal(n.screenRank)} nearest on screen: the 2D layout misplaces this neighbour`
                : `${ordinal(n.screenRank)} nearest on screen`,
          };
        })}
        action={(memberId) => (
          // A row action: shown on hover or keyboard focus, not repeated down the list.
          <Button
            variant="ghost"
            size="sm"
            disabled={hidden}
            className="opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
            aria-label={`Where ${focusedId} and ${memberId} differ`}
            title={`Where ${focusedId} and ${memberId} differ`}
            onClick={() => onCompare(memberId)}
          >
            Where they differ
          </Button>
        )}
      />
      {hidden ? (
        <p className="m-0 text-bf-xs text-bf-text-muted">
          {stale
            ? 'Observation IDs are kept so you can see who was nearest. Distances are hidden: they describe inputs that no longer exist.'
            : 'This fit belongs to another population. Refit to rank.'}
        </p>
      ) : misplaced ? (
        <p className="m-0 text-bf-xs text-bf-text-secondary" data-testid="neighbour-screen-note">
          <span className="font-mono">{misplaced.memberId}</span> is nearest on screen but{' '}
          {ordinal(misplaced.rank)} by distance. The 2D layout misplaces it.
        </p>
      ) : null}
    </section>
  );
}

interface NearestRow {
  memberId: string;
  rank: number;
  /** Formatted distance. */
  distance: string;
  /** Kept as data (and said to screen readers); the number itself stays plain. */
  flagged?: boolean;
  title?: string;
}

/**
 * The one Nearest table form: rank, ID (a link to focus it, underlined on
 * hover), and the distance as a plain right-aligned tabular number. Hovering
 * a row marks that subject's tile and point (`populationMemberHover`).
 */
function NearestRowsTable({
  fit,
  ariaLabel,
  rows,
  hidden,
  activeMemberId = null,
  withAction = false,
  action,
}: {
  fit: RelationshipFit;
  ariaLabel: string;
  rows: NearestRow[];
  /** Distances withheld (stale or out of scope): IDs stay, numbers are dashes. */
  hidden: boolean;
  activeMemberId?: string | null;
  withAction?: boolean;
  action?: (memberId: string) => ReactNode;
}) {
  const unit = distanceUnit(fit.request.distance);
  return (
    <table
      className="w-full border-collapse text-bf-sm"
      aria-disabled={hidden || undefined}
      aria-label={ariaLabel}
      onPointerLeave={() => populationMemberHover.set(null, 'inspector')}
    >
      <thead>
        <tr className="text-left text-bf-xs text-bf-text-muted">
          <th scope="col" className="w-6 pb-1 pr-2 font-normal">
            #
          </th>
          <th scope="col" className="pb-1 pr-2 font-normal">
            ID
          </th>
          <th
            scope="col"
            className="whitespace-nowrap pb-1 pr-2 text-right font-normal"
            title={`Distance: ${distanceDefinition(fit.request.distance)}. By the fit's distances, not by the plot.`}
            data-testid="neighbour-distance-header"
          >
            Distance ({unit})
            <span className="sr-only">: {distanceDefinition(fit.request.distance)}</span>
          </th>
          {withAction ? (
            <th scope="col" className="pb-1">
              <span className="sr-only">Action</span>
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.memberId}
            className={cn(
              'group h-7 border-t border-bf-border-subtle hover:bg-bf-bg-hover',
              row.memberId === activeMemberId && 'bg-bf-bg-selected',
            )}
            aria-current={row.memberId === activeMemberId || undefined}
            data-member={row.memberId}
            onPointerEnter={() => populationMemberHover.set(row.memberId, 'inspector')}
            onPointerLeave={() => populationMemberHover.set(null, 'inspector')}
            onFocus={() => populationMemberHover.set(row.memberId, 'inspector')}
            onBlur={() => populationMemberHover.set(null, 'inspector')}
          >
            <td className="pr-2 font-mono tabular-nums text-bf-text-muted">{row.rank}</td>
            <td className="pr-2">
              <Button
                variant="link"
                size="sm"
                className="font-mono no-underline hover:underline focus-visible:underline"
                aria-label={`Focus ${row.memberId}`}
                onClick={() => populationProbeActions.focus(row.memberId)}
              >
                {row.memberId}
              </Button>
            </td>
            <td
              className="pr-2 text-right font-mono tabular-nums"
              data-flagged={row.flagged || undefined}
              title={row.title}
            >
              {hidden ? '—' : row.distance}
              {row.flagged && <span className="sr-only"> (far on screen)</span>}
            </td>
            {withAction ? (
              <td className="w-0 whitespace-nowrap text-right">{action?.(row.memberId)}</td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FocusedUnassigned({
  fit,
  entry,
  titled = true,
}: {
  fit: RelationshipFit;
  entry: RelationshipUnassigned;
  titled?: boolean;
}) {
  const median = relationshipCoverageMedian(fit);
  const tau = fit.request.eligibility?.lowCoverageTau;
  const reason = relationshipUnassignedReasonLabel(entry.reason).toLowerCase();
  const items = [
    {
      label: 'Finite voxels',
      value: `${count(entry.finiteCount)} of ${count(fit.candidateVoxels)}`,
    },
    ...(median !== null && tau !== undefined
      ? [
          {
            label: 'Rule threshold',
            value: `${count(Math.round(tau * median * 10) / 10)} (${tau} × ${count(median)})`,
          },
        ]
      : []),
    { label: 'Support loss', value: `${count(entry.supportLossVoxels)} common voxels` },
  ];
  return (
    <section aria-label={`Nearest to ${entry.memberId}`} className="flex flex-col gap-1.5">
      {titled && (
        <Heading>
          Nearest to <span className="font-mono">{entry.memberId}</span>
        </Heading>
      )}
      <Notice severity="neutral" role={null}>
        {entry.memberId} is not placed in this fit, so it has no distances to rank. Reason: {reason}
        .
        {entry.reason.kind === 'allMissing'
          ? ' It has no finite voxel on the candidate support.'
          : ` Including it would remove ${count(entry.supportLossVoxels)} voxels from every other observation's comparison.`}
      </Notice>
      <KeyValue items={items} layout="rows" boxed labelWidth="wide" />
      <p className="m-0 text-bf-xs text-bf-text-muted">
        {entry.memberId} is still in the population: it counts in summaries and the movie, and you
        can inspect its original image.
      </p>
    </section>
  );
}

export function RelationshipCentroidList({
  result,
  fit,
  distanceScale,
  stale,
  activeMemberId,
  selectedCount,
  participantWeighted,
  previewLabel,
  titled = true,
  showMethod = true,
}: {
  result: NearestToCentroid;
  /** The fit ranked (for the distance header). */
  fit: RelationshipFit;
  /** The fit's largest distance; smaller-than-resolvable distances print as 0. */
  distanceScale: number;
  stale: boolean;
  activeMemberId: string | null;
  /** Selected observations the centroid was asked for (before dropping unassigned ones). */
  selectedCount: number;
  participantWeighted: boolean;
  /** Set while hold-to-preview applies: the centroid excludes this target. */
  previewLabel: string | null;
  /** Show the heading (the Inspector names the table in its own header). */
  titled?: boolean;
  /** Show how the centre is computed (the Inspector keeps it behind ⓘ). */
  showMethod?: boolean;
}) {
  // A row that goes away under the pointer leaves no tile marked.
  useEffect(() => () => populationMemberHover.set(null, 'inspector'), []);
  const entries = result.enabled ? result.entries.slice(0, RELATIONSHIP_LIST_ROWS) : [];
  const unassignedCount = result.selectedUnassigned.length;
  const unassignedNote = unassignedCount
    ? ` ${unassignedCount} selected ${unassignedCount === 1 ? 'observation' : 'observations'}, ${result.selectedUnassigned.join(', ')}, ${unassignedCount === 1 ? 'is' : 'are'} unassigned and not included.`
    : '';
  const aside = previewLabel ? `Previewing without ${previewLabel}` : undefined;
  return (
    <section
      aria-label="Nearest the selection centroid"
      className={cn('flex flex-col gap-1.5', previewLabel && 'text-bf-text-faint')}
      data-preview={previewLabel ? 'without' : undefined}
    >
      {titled ? (
        <Heading aside={aside}>Nearest the selection centroid</Heading>
      ) : aside ? (
        <p className="m-0 text-bf-xs text-bf-text-muted">{aside}</p>
      ) : null}
      {result.enabled ? (
        <>
          {showMethod ? (
            <p className="m-0 text-bf-xs text-bf-text-muted" data-testid="nearest-method">
              Nearest the centroid on the fit's common support ({count(result.commonVoxels)}{' '}
              voxels), from {observations(result.weights.length)} selected and placed
              {participantWeighted ? ', each participant weighted equally' : ''}. Not the displayed
              mean map, which uses every voxel's own count.
            </p>
          ) : null}
          {unassignedNote ? (
            <p className="m-0 text-bf-xs text-bf-text-muted">{unassignedNote.trim()}</p>
          ) : null}
          <NearestRowsTable
            fit={fit}
            ariaLabel="Observations nearest the selection centroid"
            hidden={false}
            activeMemberId={activeMemberId}
            rows={entries.map((e) => ({
              memberId: e.memberId,
              rank: e.rank,
              distance: formatRelationshipDistance(e.distance, distanceScale),
            }))}
          />
        </>
      ) : (
        <Notice severity="neutral" role={null} data-reason={result.reason}>
          {stale ? 'Unavailable until refit.' : result.message}
          {result.reason === 'no-fitted-selection' && selectedCount > 0 ? unassignedNote : ''}
        </Notice>
      )}
    </section>
  );
}

export function RelationshipUnassignedList({
  fit,
  stale,
  activeMemberId,
}: {
  fit: RelationshipFit;
  stale: boolean;
  activeMemberId: string | null;
}) {
  const unassigned = relationshipUnassigned(fit);
  const ids = unassigned.map((u) => u.memberId);
  const roving = useRovingFocus({ ids, activeId: activeMemberId });
  if (!unassigned.length) return null;
  const median = relationshipCoverageMedian(fit);
  const tau = fit.request.eligibility?.lowCoverageTau;
  const columns =
    'grid w-full grid-cols-[minmax(4rem,6rem)_minmax(0,1fr)_minmax(4rem,auto)_minmax(4rem,auto)] items-center gap-3';
  return (
    <section
      aria-label={`Unassigned (${unassigned.length})`}
      className="flex flex-col gap-1.5 border-t border-bf-border-subtle pt-3"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="m-0 text-bf-sm font-medium">Unassigned ({unassigned.length})</h3>
        <span className="text-bf-xs text-bf-text-muted">
          {stale
            ? 'As of fit time'
            : 'In the population, but not placed: no position, no neighbours, no similarity group'}
        </span>
      </div>
      <div
        role="listbox"
        aria-label="Unassigned observations"
        onKeyDown={roving.onKeyDown}
        className="flex flex-col"
      >
        <div aria-hidden className={cn(columns, 'pb-1 pl-2.5 pr-2 text-bf-xs text-bf-text-muted')}>
          <span>Observation</span>
          <span>Reason</span>
          <span className="text-right">Finite voxels</span>
          <span className="text-right">Common voxels it would remove</span>
        </div>
        {unassigned.map((u) => {
          const reason = relationshipUnassignedReasonLabel(u.reason);
          const loss =
            u.reason.kind === 'allMissing'
              ? `all ${count(u.supportLossVoxels)}`
              : count(u.supportLossVoxels);
          return (
            <SelectableRow
              key={u.memberId}
              {...roving.getItemProps(u.memberId)}
              selected={u.memberId === activeMemberId}
              data-unassigned={u.reason.kind}
              aria-label={`${u.memberId}, ${reason}, ${count(u.finiteCount)} finite voxels, would remove ${loss} common voxels`}
              onSelect={() => populationProbeActions.focus(u.memberId)}
            >
              <span className={columns}>
                <span className="font-mono">{u.memberId}</span>
                <span className="truncate">{reason}</span>
                <span className="text-right font-mono tabular-nums">{count(u.finiteCount)}</span>
                <span className="text-right font-mono tabular-nums">{loss}</span>
              </span>
            </SelectableRow>
          );
        })}
      </div>
      {tau !== undefined && (
        <p className="m-0 text-bf-xs text-bf-text-muted">
          Rule for this fit: no finite values, or fewer than {tau} × the median finite voxels
          {median !== null ? ` (${count(median)})` : ''}
          {fit.request.distance === 'pattern-shape'
            ? '; pattern shape also leaves out maps constant on the shared voxels'
            : ''}
          . Recorded with the fit.
        </p>
      )}
    </section>
  );
}
