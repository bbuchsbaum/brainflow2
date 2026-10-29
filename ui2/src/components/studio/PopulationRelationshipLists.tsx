/**
 * The relationship section's tables (W1, W2): the focused observation's
 * neighbours by declared distance, the observations nearest the selection
 * centroid, and the unassigned observations of the fit.
 *
 * Rankings come from `relationshipNeighbours.ts`; this file only presents
 * them. A stale fit keeps its IDs visible but hides distances and disables
 * every ranking-based action (the plan's stale principle).
 */
import type { ReactNode } from 'react';
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
import {
  distanceDefinition,
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
}: {
  fit: RelationshipFit;
  focusedId: string | null;
  /** `rankNeighbours(fit, focusedId)`; null when the focused observation has no position. */
  neighbours: RelationshipNeighbour[] | null;
  /** False when stale or out of scope: ranks and Compare are off. */
  usable: boolean;
  stale: boolean;
  onCompare: (neighbourId: string) => void;
}) {
  if (!focusedId)
    return (
      <section aria-label="Nearest observations" className="flex flex-col gap-1.5">
        <Heading>Nearest observations</Heading>
        <p className="m-0 text-bf-text-muted">
          Focus an observation to rank the others by distance.
        </p>
      </section>
    );
  const unassigned = relationshipUnassigned(fit).find((u) => u.memberId === focusedId);
  if (unassigned) return <FocusedUnassigned fit={fit} entry={unassigned} />;
  if (!neighbours)
    return (
      <section aria-label={`Nearest to ${focusedId}`} className="flex flex-col gap-1.5">
        <Heading>
          Nearest to <span className="font-mono">{focusedId}</span>
        </Heading>
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
  return (
    <section aria-label={`Nearest to ${focusedId}`} className="flex flex-col gap-1.5">
      <Heading
        aside={hidden ? (stale ? 'Refit to rank' : 'Unavailable') : 'By distance, not by the plot'}
      >
        Nearest to <span className="font-mono">{focusedId}</span>
      </Heading>
      <table
        className="w-full border-collapse text-bf-sm"
        aria-disabled={hidden || undefined}
        aria-label={`Observations nearest to ${focusedId}`}
      >
        <thead>
          <tr className="text-left text-bf-xs text-bf-text-muted">
            <th scope="col" className="w-6 pb-1 pr-2 font-normal">
              #
            </th>
            <th scope="col" className="pb-1 pr-2 font-normal">
              Observation
            </th>
            <th scope="col" className="pb-1 pr-2 text-right font-normal">
              Distance <span className="sr-only">({distanceDefinition(fit.request.distance)})</span>
              <span aria-hidden className="block text-bf-xs">
                {distanceDefinition(fit.request.distance)}
              </span>
            </th>
            <th scope="col" className="pb-1 pr-2 text-right font-normal">
              On screen
            </th>
            <th scope="col" className="pb-1">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => {
            const flagged = !hidden && n.rank <= k && n.screenRank > k;
            return (
              <tr key={n.memberId} className="h-7 border-t border-bf-border-subtle">
                <td className="pr-2 font-mono text-bf-text-muted">{n.rank}</td>
                <td className="pr-2">
                  <Button
                    variant="link"
                    size="sm"
                    className="font-mono"
                    aria-label={`Focus ${n.memberId}`}
                    onClick={() => populationProbeActions.focus(n.memberId)}
                  >
                    {n.memberId}
                  </Button>
                </td>
                <td className="pr-2 text-right font-mono tabular-nums">
                  {hidden ? '—' : formatRelationshipDistance(n.distance, scale)}
                </td>
                <td
                  className={cn(
                    'pr-2 text-right font-mono tabular-nums',
                    flagged ? 'text-bf-warning' : 'text-bf-text-muted',
                  )}
                  data-flagged={flagged || undefined}
                >
                  {hidden ? '—' : ordinal(n.screenRank)}
                  {flagged && <span className="sr-only"> (far on screen)</span>}
                </td>
                <td className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={hidden}
                    aria-label={`Compare ${focusedId} with ${n.memberId}`}
                    onClick={() => onCompare(n.memberId)}
                  >
                    Compare
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hidden ? (
        <p className="m-0 text-bf-xs text-bf-text-muted">
          {stale
            ? 'Observation IDs are kept so you can see who was nearest. Distances are hidden: they describe inputs that no longer exist.'
            : 'This fit belongs to another population. Refit to rank.'}
        </p>
      ) : misplaced ? (
        <p className="m-0 text-bf-text-secondary" data-testid="neighbour-screen-note">
          <span className="font-mono">{misplaced.memberId}</span> is nearest on screen but{' '}
          {ordinal(misplaced.rank)} by distance. The 2D layout misplaces it.
        </p>
      ) : null}
    </section>
  );
}

function FocusedUnassigned({
  fit,
  entry,
}: {
  fit: RelationshipFit;
  entry: RelationshipUnassigned;
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
      <Heading>
        Nearest to <span className="font-mono">{entry.memberId}</span>
      </Heading>
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
  distanceScale,
  stale,
  activeMemberId,
  selectedCount,
  participantWeighted,
  previewLabel,
}: {
  result: NearestToCentroid;
  /** The fit's largest distance; smaller-than-resolvable distances print as 0. */
  distanceScale: number;
  stale: boolean;
  activeMemberId: string | null;
  /** Selected observations the centroid was asked for (before dropping unassigned ones). */
  selectedCount: number;
  participantWeighted: boolean;
  /** Set while hold-to-preview applies: the centroid excludes this target. */
  previewLabel: string | null;
}) {
  const entries = result.enabled ? result.entries.slice(0, RELATIONSHIP_LIST_ROWS) : [];
  const ids = entries.map((e) => e.memberId);
  const roving = useRovingFocus({ ids, activeId: activeMemberId });
  const unassignedCount = result.selectedUnassigned.length;
  const unassignedNote = unassignedCount
    ? ` ${unassignedCount} selected ${unassignedCount === 1 ? 'observation' : 'observations'}, ${result.selectedUnassigned.join(', ')}, ${unassignedCount === 1 ? 'is' : 'are'} unassigned and not included.`
    : '';
  return (
    <section
      aria-label="Nearest the selection centroid"
      className={cn('flex flex-col gap-1.5', previewLabel && 'text-bf-text-faint')}
      data-preview={previewLabel ? 'without' : undefined}
    >
      <Heading aside={previewLabel ? `Previewing without ${previewLabel}` : undefined}>
        Nearest the selection centroid
      </Heading>
      {result.enabled ? (
        <>
          <p className="m-0 text-bf-xs text-bf-text-muted">
            Nearest the centroid on the fit's common support ({count(result.commonVoxels)} voxels),
            from {observations(result.weights.length)} selected and placed
            {participantWeighted ? ', each participant weighted equally' : ''}. Not the displayed
            mean map, which uses every voxel's own count.{unassignedNote}
          </p>
          <div
            role="listbox"
            aria-label="Observations nearest the selection centroid"
            onKeyDown={roving.onKeyDown}
            className="flex flex-col"
          >
            {entries.map((e) => (
              <SelectableRow
                key={e.memberId}
                {...roving.getItemProps(e.memberId)}
                selected={e.memberId === activeMemberId}
                aria-label={`${e.memberId}, rank ${e.rank}, distance ${formatRelationshipDistance(e.distance, distanceScale)}`}
                onSelect={() => populationProbeActions.focus(e.memberId)}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="w-5 font-mono text-bf-text-muted">{e.rank}</span>
                  <span className="flex-1 font-mono">{e.memberId}</span>
                  <span className="font-mono tabular-nums">
                    {formatRelationshipDistance(e.distance, distanceScale)}
                  </span>
                </span>
              </SelectableRow>
            ))}
          </div>
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
