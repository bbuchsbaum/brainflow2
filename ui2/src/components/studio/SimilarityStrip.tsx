import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { populationProbeController } from '@/services/studio/PopulationProbeController';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { Button, IconButton, SegmentedControl, StatusPill } from '@/components/ui/bf';
import {
  populationRelationshipService,
  relationshipMapShare,
  relationshipFittedIds,
  relationshipUnassigned,
  relationshipViewFit,
} from '@/services/studio/PopulationRelationshipService';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { populationMemberHover } from '@/services/studio/populationMemberHover';
import { rankNeighbours } from '@/services/studio/relationshipNeighbours';
import type { PopulationSliceService } from '@/services/studio/PopulationSliceService';
import {
  similarityGroupingView,
  suggestionText,
} from '@/services/studio/similarityGroupingView';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { usePopulationViewStore, type SimilarityFit } from '@/stores/populationViewStore';
import { PopulationRelationshipScatter } from './PopulationRelationshipScatter';
import { RELATIONSHIP_LIST_ROWS } from './PopulationRelationshipLists';
import { GroupMark } from './GroupMark';
import { groupMarksFor, type GroupMarkKind } from './groupMarks';
import type { SimilarityMeasure } from './montageModel';
import { ROBUST_MIN_POINTS, fidelityText, robustFramingAvailable } from './similarityStripLayout';

/** Why "Fit core" is unavailable on a small map. */
const FIT_CORE_UNAVAILABLE = `Fit core needs at least ${ROBUST_MIN_POINTS} points; with fewer, every point is framed`;

const MEASURE_WORD: Record<SimilarityMeasure, string> = {
  'pattern-shape': 'correlation',
  effect: 'amplitude',
};
/**
 * The measure, stated once (the map's caption), by its one name with its
 * formula. Correlation is the distance between z-scored maps, √(2−2r), not
 * 1 − r: the caption says what was computed.
 */
const MEASURE_CAPTION: Record<SimilarityMeasure, string> = {
  'pattern-shape': 'Distance: correlation (√(2−2r))',
  effect: 'Distance: amplitude (RMS)',
};
const value = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : '—');
/** "Group 2" → "G2" for a label at the group's centroid. */
const shortGroup = (label: string) => label.replace(/^Group\s+/, 'G');

export interface SimilarityStripProps {
  mode: 'inline' | 'sheet';
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  measure: SimilarityMeasure;
  /** Subjects in an explicit selection. */
  selected: ReadonlySet<string>;
  focusedId: string | null;
  /** The subject under the pointer in the grid: its point is ringed. */
  linkedId: string | null;
  onHoverMember: (memberId: string | null) => void;
  /** Similarity is being computed: what, and how to stop it. */
  busy: { text: string; onCancel: () => void } | null;
  /** Why the similarity choice failed; with amplitude to try when correlation was refused. */
  error: string | null;
  onUseAmplitude: (() => void) | null;
  onRefit: () => void;
  /** Clusters the tree is cut into (the Group stepper's value), when grouped. */
  showing: number | null;
  sliceService?: PopulationSliceService;
}

/**
 * The similarity map beside the montage: a square MDS map with one scale on
 * both axes, whose legend is the montage's groups (with their outliers), the
 * fit's quality, and the grouping the fit suggests. Hovering a point outlines
 * its tile; a lasso selects tiles. It folds to a 24 px rail.
 */
export function SimilarityStrip({
  mode,
  collapsed,
  onCollapsedChange,
  measure,
  selected,
  focusedId,
  linkedId,
  onHoverMember,
  busy,
  error,
  onUseAmplitude,
  onRefit,
  showing,
  sliceService,
}: SimilarityStripProps) {
  const snapshot = useSyncExternalStore(
    populationRelationshipService.subscribe,
    populationRelationshipService.getSnapshot,
  );
  const partition = useSetStudioStore((state) => state.population.partition);
  const order = useSetStudioStore((state) => state.population.presentation.order);
  const [bounds, setBounds] = useState<HTMLDivElement | null>(null);
  const [info, setInfo] = useState(false);
  // Fit core (default) frames the robust core; Fit all, every point. Kept for the session.
  const extent = usePopulationViewStore((state) => state.similarityFit);
  const setExtent = usePopulationViewStore((state) => state.setSimilarityFit);
  // One fit per view: the fit that made the groups (else the order) on screen.
  // Read on every render: the service's snapshot (subscribed above) and the
  // population scope decide it.
  const viewFit = relationshipViewFit({ partition, presentation: { order } });
  // A fit made elsewhere (the relationship panel) is computed: the same busy state.
  const working =
    busy ??
    (snapshot.pending
      ? { text: 'Computing similarity…', onCancel: populationRelationshipService.cancel }
      : null);
  // While the measure asked for is computed, a fit by the other measure is not
  // shown under its name: the busy state stands alone.
  const fit =
    viewFit.fit && !(working && viewFit.fit.request.distance !== measure) ? viewFit.fit : null;
  const shownMeasure: SimilarityMeasure = fit?.request.distance ?? measure;
  // "Fit core" needs enough points for a robust core (similarityStripLayout).
  const robustExtent = fit ? robustFramingAvailable(fit.geometry.coordinates) : true;
  const stale = snapshot.stale && !!fit && fit === snapshot.fit;
  const fitted = fit ? relationshipFittedIds(fit) : [];
  const unassigned = fit ? relationshipUnassigned(fit).length : 0;
  const view = similarityGroupingView(fit, partition);
  // The focused subject's true nearest neighbours (by the fit's distances, not
  // the plot): the same rows, and the same numbers, as the Inspector's Nearest list.
  const usable = !!fit && viewFit.usable;
  const neighbourMarks = useMemo(
    () =>
      fit && usable && focusedId
        ? (rankNeighbours(fit, focusedId) ?? [])
            .slice(0, RELATIONSHIP_LIST_ROWS)
            .map((n) => ({ memberId: n.memberId, rank: n.rank }))
        : [],
    [fit, usable, focusedId],
  );
  // Each group's mark (the montage's group headers wear the same) and its centroid label.
  const classMarks = useMemo(() => groupMarksFor(view.classes), [view.classes]);
  const marks = useMemo(() => {
    const byMember = new Map<string, GroupMarkKind>();
    for (const entry of view.classes) {
      const kind = classMarks.get(entry.id);
      if (kind) for (const id of entry.memberIds) byMember.set(id, kind);
    }
    return byMember;
  }, [view.classes, classMarks]);
  const groupLabels = useMemo(
    () =>
      view.classes
        .filter((entry) => !entry.outliers)
        .map((entry) => ({
          id: entry.id,
          text: `${shortGroup(entry.label)} · ${entry.memberIds.length}`,
          memberIds: entry.memberIds,
        })),
    [view.classes],
  );
  const share = fit ? relationshipMapShare(fit) : null;
  const caption = `${MEASURE_CAPTION[shownMeasure]}${share !== null ? ` · ${fidelityText(share)}` : ''}`;
  const [lassoError, setLassoError] = useState<string | null>(null);
  // Hover from another view (the Inspector's lists, the Values dock) marks the
  // point here and, through the montage's hover channel, its tile. The map's
  // own hover and the montage's are not forwarded: the montage already knows
  // its own tile (forwarding it would ring the tile under the pointer).
  const external = useSyncExternalStore(
    populationMemberHover.subscribe,
    populationMemberHover.getSnapshot,
  );
  const hoverOut = useRef(onHoverMember);
  useEffect(() => {
    hoverOut.current = onHoverMember;
  });
  const externalId =
    external.source && external.source !== 'map' && external.source !== 'montage'
      ? external.memberId
      : null;
  const externalShown = useRef(false);
  useEffect(() => {
    if (externalId !== null) {
      hoverOut.current(externalId);
      externalShown.current = true;
    } else if (externalShown.current) {
      hoverOut.current(null);
      externalShown.current = false;
    }
  }, [externalId]);
  useEffect(() => () => populationMemberHover.set(null, 'map'), []);
  const suggestion = suggestionText(view);
  // Focus follows the fold: into the map when it opens, back to its rail when it folds.
  const root = useRef<HTMLDivElement | null>(null);
  const rail = useRef<HTMLButtonElement | null>(null);
  const moveFocus = useRef(false);
  const toggle = (next: boolean) => {
    moveFocus.current = true;
    onCollapsedChange(next);
  };
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (collapsed ? rail.current : root.current)?.focus();
  }, [collapsed]);
  // The point under the pointer, said here too (its tile may be folded away).
  const [pointed, setPointed] = useState<string | null>(null);
  const probe = useSyncExternalStore(
    populationProbeController.subscribe,
    populationProbeController.getSnapshot,
  );
  const pointedValue =
    pointed && probe.displayed && !probe.pending && probe.displayed.query.key === probe.requested?.key
      ? probe.displayed.frame.rows.find((row) => String(row.member) === pointed)?.value
      : undefined;
  // The measure is the caption's; the title says only what is mapped and where.
  const title = `Similarity${
    fit?.request.region ? ` · within the pinned region (r = ${fit.request.region.radiusMm} mm)` : ''
  }`;

  if (collapsed)
    return (
      <div
        role="complementary"
        aria-label="Similarity map"
        className="flex h-full w-full flex-col items-center gap-2 py-2"
      >
        <IconButton
          ref={rail}
          icon={<ChevronLeft />}
          aria-label="Show the similarity map"
          title="Show the similarity map"
          aria-expanded={false}
          onClick={() => toggle(false)}
        />
        <span
          aria-hidden
          className="text-bf-xs text-bf-text-muted [writing-mode:vertical-rl]"
        >
          Similarity
        </span>
      </div>
    );

  return (
    <div
      ref={(element) => {
        root.current = element;
        setBounds(element);
      }}
      tabIndex={-1}
      role="complementary"
      aria-label="Similarity map"
      aria-busy={!!working || undefined}
      data-mode={mode}
      onKeyDown={(event) => {
        // Escape folds the map (a sheet over the grid gives it back).
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          toggle(true);
        }
      }}
      className="relative flex h-full min-h-0 w-full flex-col gap-2 overflow-y-auto overflow-x-hidden p-2 text-bf-sm"
    >
      <div className="flex min-w-0 items-center gap-1">
        <h3 className="m-0 min-w-0 flex-1 truncate text-bf-sm font-medium text-bf-text-primary">
          {title}
        </h3>
        {fit ? (
          <SegmentedControl
            aria-label="Map extent"
            className="shrink-0"
            // Too few points for a robust core: both choices frame every
            // point, so the choice is shown as Fit all and offers nothing
            // (the session's preference is kept for a larger fit).
            value={robustExtent ? extent : 'all'}
            disabled={!robustExtent}
            title={robustExtent ? undefined : FIT_CORE_UNAVAILABLE}
            onValueChange={(next) => setExtent(next as SimilarityFit)}
            options={[
              {
                value: 'core',
                label: 'Fit core',
                title: robustExtent
                  ? 'Frame the robust core; points far off it are ticks at the edge, listed below'
                  : FIT_CORE_UNAVAILABLE,
              },
              { value: 'all', label: 'Fit all', title: 'Frame every point' },
            ]}
          />
        ) : null}
        {stale && !working ? (
          <>
            <StatusPill status="warning">Out of date</StatusPill>
            <Button variant="secondary" size="sm" onClick={onRefit}>
              Refit
            </Button>
          </>
        ) : null}
        <IconButton
          icon={<Info />}
          aria-label="About this map"
          aria-expanded={info}
          title="About this map"
          onClick={() => setInfo((open) => !open)}
        />
        <IconButton
          icon={<ChevronRight />}
          aria-label="Hide the similarity map"
          title="Hide the similarity map (Esc)"
          aria-expanded
          onClick={() => toggle(true)}
        />
      </div>
      {stale ? (
        <p role="status" aria-live="polite" className="m-0 text-bf-xs text-bf-warning">
          Inputs changed since this fit. The layout stays frozen; nearest subjects and the centre
          of the selection wait for Refit.
        </p>
      ) : null}
      <p className="m-0 text-bf-xs text-bf-text-secondary" data-testid="similarity-caption">
        {caption}
      </p>
      {info ? (
        <div className="flex flex-col gap-1 text-bf-xs leading-4 text-bf-text-muted">
          <p className="m-0" data-testid="similarity-method">
            Positions are classical MDS of the {MEASURE_WORD[shownMeasure]} distances; one scale on
            both axes, and the axes have no units. Groups come from {view.linkageName} of the
            original distances, not the 2D picture; a subject alone in its cluster is an outlier
            and joins no group. Groups and selections chosen here are exploratory.
          </p>
          <p className="m-0" data-testid="similarity-howto">
            Hover a point to find its tile; click to focus. Drag on empty space to lasso (Shift
            adds); Esc clears. While you point at the map, spokes join the focused subject to
            its {RELATIONSHIP_LIST_ROWS} nearest by distance, numbered as in the Inspector. A
            point far off the scale is a tick at the frame's edge; the off-scale note lists it. With the keyboard: arrow keys move
            between points, Shift+Enter or Shift+Space adds or removes one.
          </p>
        </div>
      ) : null}
      {working ? (
        <div role="status" className="flex items-center gap-2" data-testid="similarity-busy">
          <span className="min-w-0 flex-1 font-medium text-bf-text-primary">{working.text}</span>
          <Button variant="secondary" size="sm" className="shrink-0" onClick={working.onCancel}>
            Cancel
          </Button>
        </div>
      ) : null}
      {!working && fit && viewFit.missing ? (
        <p className="m-0 text-bf-xs text-bf-text-secondary" data-testid="similarity-fit-mismatch">
          {viewFit.missing.basis === 'grouping' ? 'The groups' : 'The order'} came from an earlier
          fit{viewFit.missing.distance ? ` by ${MEASURE_WORD[viewFit.missing.distance]}` : ''}; this
          map is {viewFit.basis === 'order' ? 'the order\'s fit' : 'the current fit'}, by{' '}
          {MEASURE_WORD[fit.request.distance]}.{' '}
          {viewFit.missing.basis === 'grouping' ? 'Group' : 'Sort'} again to match them.
        </p>
      ) : null}
      {!working && fit && viewFit.otherOrder ? (
        <p className="m-0 text-bf-xs text-bf-text-muted" data-testid="similarity-other-order">
          The montage is sorted by {MEASURE_WORD[viewFit.otherOrder]}, from another fit; this map
          and its groups are by {MEASURE_WORD[fit.request.distance]}.
        </p>
      ) : null}
      {error && !working ? (
        <div role="alert" className="flex flex-col items-start gap-1.5" data-testid="similarity-refused">
          <span className="text-bf-danger">{error}</span>
          {onUseAmplitude ? (
            <Button variant="secondary" size="sm" onClick={onUseAmplitude}>
              Use amplitude instead
            </Button>
          ) : null}
        </div>
      ) : null}
      {fit ? (
        <div
          className={working ? 'opacity-40 transition-opacity' : undefined}
          data-dimmed={working ? true : undefined}
        >
          <div data-frozen={stale || undefined}>
            <PopulationRelationshipScatter
              square
              spokes="engaged"
              extent={robustExtent ? extent : 'all'}
              fitId={fit.fitId}
              fitted={fitted}
              coordinates={fit.geometry.coordinates}
              selected={selected}
              activeMemberId={focusedId}
              neighbourMarks={neighbourMarks}
              sliceService={sliceService}
              bounds={bounds}
              marks={marks}
              groupLabels={groupLabels}
              linkedId={linkedId ?? externalId}
              onHoverMember={(id) => {
                setPointed(id);
                onHoverMember(id);
                populationMemberHover.set(id, 'map');
              }}
              onToggle={(id) => populationRelationshipService.toggle(id, fit.fitId)}
              onLasso={(ids, mode) => {
                const result = populationProbeActions.select(
                  ids,
                  mode,
                  'map-derived',
                  'Similarity map lasso',
                );
                setLassoError(result.ok ? null : result.reason);
              }}
              onClear={() => {
                setLassoError(null);
                populationProbeActions.selectAll();
              }}
            />
          </div>
          {lassoError ? (
            <p role="alert" className="m-0 mt-1 text-bf-xs text-bf-danger">
              {lassoError}
            </p>
          ) : null}
        </div>
      ) : !working && !error ? (
        <p className="m-0 text-bf-text-muted">No similarity computed yet.</p>
      ) : null}
      {fit ? (
        <p className="m-0 min-h-4 font-mono text-bf-xs tabular-nums text-bf-text-secondary" data-testid="similarity-readout">
          {pointed
            ? `${pointed}${
                pointedValue === undefined
                  ? ''
                  : ` · ${typeof pointedValue === 'number' ? pointedValue.toPrecision(4) : 'no value'} at the pin`
              }`
            : ''}
        </p>
      ) : null}
      {fit && view.classes.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Similarity groups">
          {view.classes.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2" data-class={entry.id}>
              <GroupMark kind={classMarks.get(entry.id)} />
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              <span className="tabular-nums text-bf-text-muted">{entry.memberIds.length}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {fit ? (
        <p className="m-0 text-bf-xs text-bf-text-muted" data-testid="similarity-fit-quality">
          {view.silhouette !== null ? `Silhouette ${value(view.silhouette)} · ` : ''}
          stress {value(fit.geometry.stress, 3)} · {fitted.length} of {fitted.length + unassigned}{' '}
          placed
        </p>
      ) : null}
      {fit && showing !== null ? (
        <p className="m-0 text-bf-xs text-bf-text-muted" data-testid="similarity-suggestion">
          {suggestion ? `${suggestion} · ` : ''}showing {showing}.
          {view.classes.some((entry) => entry.outliers) ? ' Outliers join no group.' : ''}
        </p>
      ) : null}
    </div>
  );
}
