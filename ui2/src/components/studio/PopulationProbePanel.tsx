import { useStudioWorkspaceKey } from '@/hooks/useStudioWorkspace';
import { Info, MoreHorizontal } from 'lucide-react';
import { Button, IconButton, Notice, NumberField, SegmentedControl, Select } from '@/components/ui/bf';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/DropdownMenu';
import { isRegionSource } from '@/services/atlasRegionLookup';
import { resolveSeriesRegion } from '@/services/series/seriesRegion';
import { openDockTab } from '@/components/layout/openDockTab';
import { AtlasPicker } from '@/components/inspector/imaging/InspectorLoadDialogs';
import { ValidatedNumberField } from '@/components/plots/ValidatedNumberField';
import { useLayerStore } from '@/stores/layerStore';
import { PopulationPivot } from './PopulationPivot';
import { populationPlotService } from '@/services/studio/PopulationPlotService';
import { PopulationBrush } from './PopulationBrush';
import {
  resolvePopulationParticipants,
  participantProbeFrame,
} from '@/services/studio/populationParticipants';
import { orderPopulationFrame } from '@/services/studio/populationWitnesses';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { PlotEncoder } from '@/components/plots/encoder/PlotEncoder';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useSetStudioState } from '@/stores/setStudio/useSetStudioState';
import { useViewStateStore } from '@/stores/viewStateStore';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { resolvePopulation } from '@/services/studio/populationContext';
import {
  probeUnavailableIds,
  resolveStudioObservationStatuses,
} from '@/services/studio/observationStatus';
import { populationRelationshipService } from '@/services/studio/PopulationRelationshipService';
import { populationMemberHover } from '@/services/studio/populationMemberHover';
import {
  buildPopulationProbeQuery,
  PopulationProbeController,
  describePopulationProbe,
} from '@/services/studio/PopulationProbeController';
import { CUTOUT_WIDTHS_MM, usePopulationViewStore } from '@/stores/populationViewStore';
import { probeQueryInputs, usePopulationProbeDriver } from './usePopulationProbeDriver';
import type { PopulationProbe } from '@/types/population';
import type { ResolvedPlotSpec, SampleFrame } from '@/plotting';
import { formatWorldPoint } from '@/utils/valueFormat';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { MARK_UNSELECTED_OPACITY } from './subsetOpacity';
import { currentVoxelGridReference, snapWorldToVoxelCentre } from '@/utils/voxelSnap';
import { studioSetMaps } from '@/services/studio/studioMaps';
import { shortImageNames } from '@/services/studio/designPanelModel';
import type { PopulationPartition } from '@/types/population';
import { GroupMark, groupMarkParts, groupMarksFor, OUTLIER_MARK, type GroupMarkKind } from './groupMarks';

/**
 * The ranked dot plot: neutral dots (colour is not the sign; group marks when
 * the montage is grouped), a bold zero rule, a dashed mean rule (named in the
 * legend), three y ticks under a "value (unit)" title, and the lowest,
 * highest and focused IDs labelled directly, clear of the dots and rules, in
 * place of an x axis. Unselected dots dim to 40 % (subsetOpacity.ts).
 */
function pointSpecFor(yTitle: string, mean: number | null): ResolvedPlotSpec {
  return {
    mark: 'point',
    encoding: { x: 'member', y: 'value' },
    transforms: [],
    params: {
      seriesColor: 'var(--bf-text-secondary)',
      zeroLine: true,
      zeroLineStrong: true,
      yRules: mean === null ? [] : [{ y: mean, label: '' }],
      yTitle,
      yTickCount: 3,
      xAxis: false,
      directLabels: true,
      unselectedOpacity: MARK_UNSELECTED_OPACITY,
    },
  };
}
const finiteValue = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/**
 * Rows ranked by value, ascending; ties keep source order and unavailable
 * rows go last (the same rule as the montage's response order).
 */
function rankedFrame(frame: SampleFrame): SampleFrame {
  const finite = finiteValue;
  const rows = frame.rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = a.row.value,
        y = b.row.value;
      if (finite(x) && finite(y)) return x - y || a.index - b.index;
      if (finite(x)) return -1;
      if (finite(y)) return 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
  return { ...frame, rows };
}
/** Rows in the montage's order (its IDs first, in order; any others after, ranked). */
function montageOrderedFrame(frame: SampleFrame, ids: readonly string[]): SampleFrame {
  const at = new Map(ids.map((id, i) => [id, i]));
  const ranked = rankedFrame(frame).rows;
  const rows = ranked
    .map((row, index) => ({ row, index, at: at.get(String(row.member)) }))
    .sort((a, b) =>
      a.at !== undefined && b.at !== undefined
        ? a.at - b.at
        : a.at !== undefined
          ? -1
          : b.at !== undefined
            ? 1
            : a.index - b.index,
    )
    .map(({ row }) => row);
  return { ...frame, rows };
}
/** The montage is sorted by the value at the pin (not the 12-sample witnesses). */
// The montage is ordered by the values shown here: by value at the pin (the
// saved pin order is labelled "Response order at …" when not reversed), or
// following the pointer on a single page. A sampled subset or a within-page
// order does not match the strip's whole-set rank.
const montageSortedByValue = (label: string | undefined) =>
  !!label &&
  (/value at pin/i.test(label) || /^Response order at /.test(label) || /^Value at the pointer$/.test(label)) &&
  !/sampled|within each page/i.test(label);
const formatStat = (v: number | null) => (v === null ? 'unavailable' : v.toPrecision(4));
/** The locus a probe samples: a cluster row, an atlas / label region, or a point / sphere. */
const locusOfProbe = (probe: PopulationProbe | null): 'point' | 'region' | 'cluster' =>
  probe?.region ? (probe.region.locus.labelSource.type === 'volume' ? 'cluster' : 'region') : 'point';
const coordinates = (probe: PopulationProbe) =>
  formatWorldPoint(probe.worldMm);

/** Body heights (px) the tab asks of the dock (C3 auto-height). */
const EMPTY_LINE_PX = 28;
const CONTROL_ROW_PX = 26;
const TITLE_LINE_PX = 16;
const STRIP_PLOT_PX = 84;
const STATS_ROW_PX = 16;
/** The stats block's title row (its text and the ⓘ button). */
const STATS_TITLE_PX = 20;
const NOTICE_PX = 32;
const TABLE_PX = 200;

/**
 * The pointer's position as the status bar says it (raw world mm), while the
 * pointer is in the voxel the probe sampled; else the sampled voxel's centre.
 * The Values title and the status bar then never disagree (14.4 vs 14.0).
 * Its own component: the pointer moving within a voxel re-renders only this.
 * Screen readers hear the voxel, not every 0.1 mm step.
 */
function PointerCoordinates({ sampled }: { sampled: readonly [number, number, number] }) {
  const live = useMouseCoordinateStore((state) => {
    const raw = state.worldCoordinates;
    if (!raw || !state.activeView) return null;
    const reference = currentVoxelGridReference();
    const voxel = reference ? snapWorldToVoxelCentre([...raw] as [number, number, number], reference) : raw;
    return voxel.every((v, i) => v === sampled[i]) ? formatWorldPoint(raw) : null;
  });
  const voxel = formatWorldPoint(sampled);
  if (live === null || live === voxel) return <>{voxel}</>;
  return (
    <>
      <span aria-hidden data-testid="values-pointer-coordinates">
        {live}
      </span>
      <span className="sr-only">{voxel}</span>
    </>
  );
}

/**
 * The rendered height of `element` (0 when absent), kept current with a
 * ResizeObserver. For blocks whose natural height follows the dock's width,
 * not its height, so asking the dock for it cannot feed back.
 */
function useMeasuredHeight(element: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!element) {
      setHeight(0);
      return;
    }
    const measure = () => {
      const next = Math.ceil(element.getBoundingClientRect().height);
      setHeight((previous) => (previous === next ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return height;
}

const CANCELLATION_NOTE =
  'Cancellation is how much positive and negative values cancel: |mean| vs average size (average size − |mean|; 0 = all one sign).';

type ProbeStats = ReturnType<typeof describePopulationProbe>;
/** "25 − / 10 +", with "n ≈ 0" between when the near-zero count is shown. */
const signValueOf = (stats: ProbeStats, showNearZero: boolean) =>
  `${stats.negative} \u2212 / ${
    showNearZero ? `${stats.nearZero} \u2248 0 / ` : ''
  }${stats.positive} +`;
const signSentenceOf = (stats: ProbeStats) => {
  const share = (n: number) => (stats.count ? `${((100 * n) / stats.count).toFixed(1)}%` : 'unavailable');
  return `Negative ${stats.negative} (${share(stats.negative)}) · Near zero ${stats.nearZero} (${share(stats.nearZero)}) · Positive ${stats.positive} (${share(stats.positive)})`;
};

/**
 * Each group's mark, as the montage headers and the similarity map draw it:
 * groups in the partition's order, and a map-derived group of one member as
 * an outlier.
 */
function groupMarkEntries(partition: PopulationPartition | null | undefined) {
  if (!partition) return [];
  const outlier = (group: PopulationPartition['groups'][number]) =>
    partition.origin === 'map-derived' && group.memberIds.length === 1;
  const marks = groupMarksFor(partition.groups.map((group) => ({ id: group.id, outliers: outlier(group) })));
  return partition.groups.map((group) => ({
    ...group,
    outlier: outlier(group),
    mark: marks.get(group.id) ?? OUTLIER_MARK,
  }));
}

/** The summary's group columns: one per group (outliers have none), "G1", "G2" for a map-derived grouping. */
function valuesGroupColumns(partition: PopulationPartition | null | undefined) {
  if (!partition) return [];
  const groups = groupMarkEntries(partition).filter((group) => !group.outlier);
  if (groups.length < 2) return [];
  return groups.map((group, i) => ({
    id: group.id,
    label: partition.origin === 'map-derived' ? `G${i + 1}` : group.label,
    title: `${group.label} · ${group.memberIds.length}`,
    mark: group.mark,
    memberIds: group.memberIds,
  }));
}


/**
 * The Values dock tab: every subject's value at the pinned point, as a strip
 * (or a table), with the distribution beside it. Its header defines the
 * probe (where, how big, the cutout width) and sends it to Plot.
 */
export function PopulationProbePanel({
  controller: suppliedController,
  drive = true,
  reportsDockHeight = false,
}: {
  controller?: PopulationProbeController;
  /** Sample from this panel; false when a driver elsewhere already does. */
  drive?: boolean;
  /** Ask the dock to size to this panel (the Values dock tab). */
  reportsDockHeight?: boolean;
} = {}) {
  const studio = useSetStudioState();
  const workspaceId = useStudioWorkspaceKey();
  const [controller] = useState(() => suppliedController ?? new PopulationProbeController());
  usePopulationProbeDriver(controller, drive);
  // The query on show, rebuilt only when what it is built from changes.
  const inputs = probeQueryInputs(studio);
  const definition = useMemo(
    () => buildPopulationProbeQuery(useSetStudioStore.getState(), workspaceId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId, ...inputs],
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const relationshipSnapshot = useSyncExternalStore(
    populationRelationshipService.subscribe,
    populationRelationshipService.getSnapshot,
  );
  // Shared hover (tile ↔ point ↔ dot): another view's hover rings its dot
  // here; a dot under the pointer is published as the Values dock's.
  const memberHover = useSyncExternalStore(
    populationMemberHover.subscribe,
    populationMemberHover.getSnapshot,
  );
  const linkedDot =
    memberHover.source && memberHover.source !== 'values' ? memberHover.memberId : null;
  useEffect(() => () => populationMemberHover.set(null, 'values'), []);
  const cutoutWidth = usePopulationViewStore((state) => state.cutoutWidthMm);
  const setCutoutWidth = usePopulationViewStore((state) => state.setCutoutWidthMm);
  const [pinError, setPinError] = useState<string | null>(null);
  const previewHover = usePopulationViewStore((state) => state.followHover);
  const lensOrder = usePopulationViewStore((state) => state.lensOrder);
  const [radius, setRadius] = useState(0);
  const [nearZeroLimit, setNearZeroLimit] = useState(0);
  const [view, setView] = useState<'strip' | 'table'>('strip');
  // Quiet affordances: the radius field and the near-zero band show once asked
  // for (or once they hold a non-default value).
  const [radiusOpen, setRadiusOpen] = useState(false);
  const [nearZeroOpen, setNearZeroOpen] = useState(false);
  const radiusRef = useRef<HTMLLabelElement>(null);
  const nearZeroRef = useRef<HTMLLabelElement>(null);
  const focusField = (host: RefObject<HTMLElement | null>) =>
    requestAnimationFrame(() => host.current?.querySelector<HTMLInputElement>('input')?.focus());
  useEffect(() => {
    setNearZeroLimit((previous) => (previous === 0 ? previous : 0));
    setNearZeroOpen(false);
  }, [studio.population.sessionRevision, studio.selection.activeFeatureId]);
  const [width, setWidth] = useState(640);
  // A callback ref: the strip mounts only once there is a result, after this
  // panel, so a mount-time observer would never see it and the plot would keep
  // its default width, wider than its column (the right-most label was cut).
  const [plotEl, setPlotEl] = useState<HTMLDivElement | null>(null);
  const population = useMemo(() => resolvePopulation(studio), [studio]);
  const selected = useMemo(
    () => new Set(population.workingMemberIds),
    [population.workingMemberIds],
  );

  useEffect(() => {
    const next = population.probe?.radiusMm;
    if (next !== undefined) setRadius((previous) => (previous === next ? previous : next));
  }, [population.probe?.radiusMm]);
  useEffect(() => {
    if (!plotEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(plotEl);
    return () => observer.disconnect();
  }, [plotEl]);
  // Hover follows the pointer over the Population lens only: Deck and Compare
  // show one subject, and the pin (shared by every lens) is what they show here.
  const inPopulation = studio.selection.activeLens === 'population';
  useEffect(() => {
    if (!previewHover || !inPopulation) return;
    return populationProbeActions.followHover(radius, workspaceId);
  }, [previewHover, inPopulation, radius, workspaceId]);
  // Follow hover off (however it was turned off) retires the hover probe.
  useEffect(() => {
    if (!previewHover) populationProbeActions.clearHover();
  }, [previewHover]);

  // Region locus (phase 4 E2/E3): an atlas / label region or a cluster row.
  const pinnedLocus = locusOfProbe(population.probe ?? null);
  // The control shows the locus of the data on screen: a Region or Cluster
  // that fails to resolve leaves it on the previous locus (v1 function 1),
  // and the alert says so and offers the fix.
  const [requestedLocus, setRequestedLocus] = useState<'point' | 'region' | 'cluster' | null>(null);
  const probeLocus = requestedLocus ?? pinnedLocus;
  // A failed Region / Cluster choice belongs to the pinned probe and the locus
  // it left on screen: it shows only while that locus and pin are still the
  // ones shown, so a later pin, radius change or locus switch retires it. It
  // is keyed to the pin, never to the hover probe: with Follow hover on (and
  // nothing pinned) every pointer move replaces the hover probe, and the
  // issue would vanish before it could be read.
  const [locusIssue, setLocusIssue] = useState<{
    kind: 'region' | 'cluster';
    message: string;
    shownOn: 'point' | 'region' | 'cluster';
    pinned: PopulationProbe | null;
  } | null>(null);
  const raiseLocusIssue = (kind: 'region' | 'cluster', message: string) => {
    const pinned = useSetStudioStore.getState().population.pinnedProbe ?? null;
    setLocusIssue({ kind, message, shownOn: locusOfProbe(pinned), pinned });
  };
  const raiseLocusIssueRef = useRef(raiseLocusIssue);
  raiseLocusIssueRef.current = raiseLocusIssue;
  const [atlasPicker, setAtlasPicker] = useState(false);
  const regionAtlas = useLayerStore((s) => s.layers.find(isRegionSource));
  // The control follows the pinned probe (REVIEW m3): a pin from the viewer
  // (a point) or a re-pinned cluster replaces a requested locus.
  useEffect(() => {
    setRequestedLocus(null);
  }, [population.probe]);
  // A pinned cluster stays on the current cluster table (REVIEW M2).
  useEffect(
    () => populationProbeActions.followClusterTable((message) => raiseLocusIssueRef.current('cluster', message)),
    [],
  );
  // Only the latest locus choice may apply (REVIEW m3: Region → Cluster resolved out of order).
  const locusRequest = useRef(0);
  // A failed Region / Cluster choice moves focus to the alert's action, never
  // to <body> (the segment that had it reverts, v4 function).
  const issueRef = useRef<HTMLDivElement>(null);
  const focusIssueAction = useRef(false);
  useEffect(() => {
    if (!locusIssue || !focusIssueAction.current) return;
    focusIssueAction.current = false;
    const id = requestAnimationFrame(() => issueRef.current?.querySelector<HTMLElement>('button, select')?.focus());
    return () => cancelAnimationFrame(id);
  }, [locusIssue]);
  const chooseProbeLocus = async (
    kind: 'point' | 'region' | 'cluster',
    pick: { layerId: string; labelId: number } | null = null,
  ) => {
    const request = ++locusRequest.current;
    if (kind === 'point') {
      setRequestedLocus(kind);
      setLocusIssue(null);
      setPinError(null);
      return populationProbeActions.clearRegion();
    }
    // The Studio workspace's crosshair, not the tab in front (F44).
    const crosshair = useViewStateStore.getState().getWorkspaceViewState(workspaceId).crosshair.world_mm;
    const resolved = await resolveSeriesRegion({ locus: kind, regionPick: pick }, crosshair);
    if (request !== locusRequest.current) return;
    if (!resolved?.region) {
      focusIssueAction.current = true;
      raiseLocusIssue(kind, resolved?.issue ?? 'No region here.');
      return;
    }
    setRequestedLocus(kind);
    setLocusIssue(null);
    setPinError(null);
    populationProbeActions.pinRegion({ locus: resolved.region, label: resolved.label });
  };
  const shownLocusIssue =
    locusIssue &&
    locusIssue.shownOn === probeLocus &&
    locusIssue.pinned === (studio.population.pinnedProbe ?? null)
      ? locusIssue
      : null;
  const regionOptions = (regionAtlas?.atlasPaletteLegend ?? []).map((e) => ({
    value: String(e.label_id),
    label: e.displayName ?? e.roi,
  }));
  const pickRegion = (v: string) =>
    regionAtlas && void chooseProbeLocus('region', { layerId: regionAtlas.id, labelId: Number(v) });

  const updateRadius = (next: number) => {
    setRadius(next);
    populationProbeActions.setRadius(next);
  };
  const result = snapshot.displayed;
  const participants = useMemo(
    () => resolvePopulationParticipants(studio, population.workingMemberIds),
    [studio, population.workingMemberIds],
  );
  const participantMode =
    !!studio.population.participants && studio.population.participants.reduction !== 'observations';
  const analysis = useMemo(() => {
    if (!result || (participantMode && participants.issue))
      return { frame: undefined, issue: null };
    try {
      return {
        frame: participants.aggregation
          ? participantProbeFrame(result.frame, participants.aggregation)
          : result.frame,
        issue: null,
      };
    } catch (error) {
      // An earlier query may remain visible while the current context is sampled.
      // Its rows must never be silently reused as a complete new participant set.
      return { frame: undefined, issue: error instanceof Error ? error.message : String(error) };
    }
  }, [result, participantMode, participants]);
  const analysisFrame = analysis.frame;
  const analysisSelected = useMemo(
    () =>
      participantMode ? new Set(participants.groups.map((group) => group.participantId)) : selected,
    [participantMode, participants.groups, selected],
  );
  const unit = participantMode ? 'participants' : 'observations';
  const plotFrame = useMemo(() => {
    if (!result) return null;
    const frame = orderPopulationFrame(result.frame, snapshot.arrangement);
    return participants.identity
      ? {
          ...frame,
          columns: [
            ...frame.columns.filter((column) => column.name !== 'participant'),
            { name: 'participant', role: 'nominal' as const },
          ],
          rows: frame.rows.map((row) => ({
            ...row,
            participant: participants.identity!.get(String(row.member)) ?? null,
          })),
          meta: { ...frame.meta, participantDefinition: studio.population.participants },
        }
      : frame;
  }, [result, snapshot.arrangement, participants.identity, studio.population.participants]);
  const current = result?.query.key === definition.query?.key;
  // Facets come from one resolver; the table never re-derives them. Memoised on
  // the slices it reads, so hover-probe writes do not recompute it.
  const { sets, cohorts, selection, activeDesignFilters, populationPreview } = studio;
  const { working, participants: participantDefinition, partition } = studio.population;
  const resultRows = result?.frame.rows;
  const statuses = useMemo(
    () =>
      resolveStudioObservationStatuses(
        {
          sets,
          cohorts,
          selection,
          activeDesignFilters,
          populationPreview,
          population: { working, participants: participantDefinition, partition },
        },
        {
          unavailableAtProbe: resultRows ? probeUnavailableIds(resultRows) : [],
          unassigned: relationshipSnapshot.fit
            ? (populationRelationshipService.currentUnassigned() ?? [])
            : [],
        },
      ),
    [
      sets,
      cohorts,
      selection,
      activeDesignFilters,
      populationPreview,
      working,
      participantDefinition,
      partition,
      resultRows,
      relationshipSnapshot,
    ],
  );
  const previewing = studio.populationPreview.holding;
  const distribution = useMemo(
    () => describePopulationProbe(analysisFrame, analysisSelected, nearZeroLimit),
    [analysisFrame, analysisSelected, nearZeroLimit],
  );
  const { mean, unavailable } = distribution;
  const issue = definition.issue ?? participants.issue ?? analysis.issue ?? snapshot.error;
  const pinned = studio.population.pinnedProbe;
  const pinHere = () => populationProbeActions.pin(radius, previewToPin);
  // A hover preview is on show (and can be pinned) only while nothing is pinned:
  // a pin takes precedence over the hover probe.
  const previewToPin = previewHover && !pinned && !!studio.population.hoverProbe;
  const pinButton = (
    <Button
      variant="primary"
      size="sm"
      onClick={pinHere}
      disabled={!studio.selection.activeSetId}
    >
      {previewToPin ? 'Pin preview' : 'Pin crosshair'}
    </Button>
  );
  // One Pin / Unpin toggle: a pinned probe offers Unpin, unless a hover
  // preview is on show, which it offers to pin. The other action is in ⋯.
  const pinToggle =
    pinned && !previewToPin ? (
      <Button
        variant="secondary"
        size="sm"
        onClick={populationProbeActions.unpin}
        title="Stop sampling at the pinned point"
      >
        Unpin
      </Button>
    ) : (
      pinButton
    );
  // Radius and the near-zero band wait in ⋯ until asked for (or until they
  // hold a non-default value); then their field shows in place.
  const showRadius = probeLocus === 'point' && (radiusOpen || radius !== 0);
  const showNearZero = nearZeroOpen || nearZeroLimit !== 0;
  const composeInPlot = () => {
    if (!result || !plotFrame) return;
    try {
      populationPlotService.pin(result, plotFrame);
      setPinError(null);
    } catch (error) {
      setPinError(error instanceof Error ? error.message : String(error));
    }
  };
  const overflowItems: DropdownMenuItem[] = [
    {
      id: 'compose',
      label: 'Compose in Plot',
      disabled:
        !result || !plotFrame || snapshot.pending || result.query.key !== snapshot.requested?.key,
      onClick: composeInPlot,
    },
    ...(pinned
      ? [
          {
            id: 'repin',
            label: 'Pin crosshair here',
            disabled: !studio.selection.activeSetId,
            onClick: pinHere,
          },
        ]
      : []),
    ...(probeLocus === 'point' && !showRadius
      ? [
          {
            id: 'radius',
            label: 'Set radius',
            onClick: () => {
              setRadiusOpen(true);
              focusField(radiusRef);
            },
          },
        ]
      : []),
    ...(result && !showNearZero
      ? [
          {
            id: 'near-zero',
            label: 'Set near-zero band',
            onClick: () => {
              setView('strip');
              setNearZeroOpen(true);
              focusField(nearZeroRef);
            },
          },
        ]
      : []),
  ];
  // The strip shows every observation ranked by its value; when the montage is
  // sorted by the value at the pin, the dots take the montage's order exactly.
  const followMontage = montageSortedByValue(lensOrder?.label);
  const montageIds = followMontage ? lensOrder!.ids : null;
  const montageReversed = followMontage && /reversed/i.test(lensOrder!.label);
  const displayFrame = useMemo(
    () =>
      plotFrame ? (montageIds ? montageOrderedFrame(plotFrame, montageIds) : rankedFrame(plotFrame)) : null,
    [plotFrame, montageIds],
  );
  const finiteRows = useMemo(
    () => displayFrame?.rows.filter((row) => finiteValue(row.value)) ?? [],
    [displayFrame],
  );
  const plotted = finiteRows.length;
  // One subset rule (A3): a selection is a strict subset of the context; then
  // the other dots dim and every number says which subset it describes.
  const contextSize = population.context.memberIds.length;
  const hasSelection =
    studio.population.working.kind === 'members' && population.workingMemberIds.length < contextSize;
  // "subjects" when each plotted observation is its own declared participant;
  // otherwise "observations" (names never imply people).
  const noun = useMemo(() => {
    const identity = participants.identity;
    if (!identity || participantMode) return plotted === 1 ? 'observation' : 'observations';
    const people = new Set(finiteRows.map((row) => identity.get(String(row.member)) ?? null));
    const subjects = !people.has(null) && people.size === plotted;
    return subjects
      ? plotted === 1
        ? 'subject'
        : 'subjects'
      : plotted === 1
        ? 'observation'
        : 'observations';
  }, [participants.identity, participantMode, finiteRows, plotted]);
  const featureId = studio.selection.activeFeatureId ?? '';
  const feature = studio.features[featureId];
  // The map's short name ("same_item"), never its file path.
  const activeSet = studio.selection.activeSetId ? studio.sets[studio.selection.activeSetId] : null;
  const mapName = useMemo(
    () =>
      studioSetMaps(activeSet, studio.features).find((map) => map.id === featureId)?.short ??
      (feature?.label ? (shortImageNames([feature.label]).get(feature.label) ?? feature.label) : 'Value'),
    [activeSet, studio.features, featureId, feature?.label],
  );
  const valueUnit = feature?.units?.trim() || null;
  const shownProbe = result?.query.probe ?? pinned ?? population.probe ?? null;
  const where = shownProbe
    ? shownProbe.region
      ? `in region ${shownProbe.region.label}`
      : `at (${coordinates(shownProbe)}) mm${shownProbe.radiusMm ? `, ${shownProbe.radiusMm} mm sphere` : ''}`
    : null;
  // The location contract (see valuesLocus.ts): the pin, else the pointer.
  const locusKind = pinned ? 'pin' : 'pointer';
  const order = montageIds
    ? `in montage order (by value${montageReversed ? ', highest first' : ''})`
    : 'ranked';
  const titleText = result
    ? `${mapName}${where ? ` ${where}` : ''} · ${locusKind} · ${plotted} ${noun}, ${order}${
        !current ? ' · previous query' : ''
      }${snapshot.pending ? ' · updating' : ''}`
    : pinned
      ? `${mapName}${where ? ` ${where}` : ''} · pin${snapshot.pending ? ' · sampling…' : ''}`
      : 'Sampling…';
  // At the pointer, the coordinates read as the status bar's (see PointerCoordinates).
  const sampledText = shownProbe && !shownProbe.region ? `(${coordinates(shownProbe)})` : null;
  const titleNode =
    locusKind === 'pointer' && shownProbe && sampledText && titleText.includes(sampledText) ? (
      <>
        {titleText.slice(0, titleText.indexOf(sampledText))}(
        <PointerCoordinates sampled={shownProbe.worldMm as [number, number, number]} />)
        {titleText.slice(titleText.indexOf(sampledText) + sampledText.length)}
      </>
    ) : (
      titleText
    );
  const statsTitle = participantMode
    ? `${hasSelection ? 'Selection' : 'All'} · ${analysisSelected.size} participants`
    : hasSelection
      ? `Selection · ${population.workingMemberIds.length} of ${contextSize}`
      : `All · ${contextSize}`;
  const focusedShown =
    !!studio.selection.activeMemberId &&
    finiteRows.some((row) => String(row.member) === studio.selection.activeMemberId);
  // The mean rule is named in the legend, not on the plot.
  const pointSpec = useMemo(
    () => pointSpecFor(valueUnit ? `value (${valueUnit})` : 'value', mean),
    [valueUnit, mean],
  );
  // Table: rank (1 = lowest) and z against every shown value.
  const tableStats = useMemo(() => {
    const values = (result?.frame.rows ?? []).map((row) => row.value).filter(finiteValue);
    const n = values.length;
    const m = n ? values.reduce((a, b) => a + b, 0) / n : 0;
    const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)) : 0;
    const sorted = [...values].sort((a, b) => a - b);
    return {
      n,
      rank: (v: number) => sorted.indexOf(v) + 1,
      z: (v: number) => (sd > 0 ? (v - m) / sd : null),
    };
  }, [result]);
  const groupOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of studio.population.partition?.groups ?? [])
      for (const id of group.memberIds) map.set(id, group.label);
    return map;
  }, [studio.population.partition]);
  // Grouped (a partition of the context): dots wear the group marks and the
  // summary gains a column per group. Participant summaries stay ungrouped
  // (their rows are people, not the partition's observations).
  const groupColumns = useMemo(
    () => (participantMode ? [] : valuesGroupColumns(studio.population.partition)),
    [participantMode, studio.population.partition],
  );
  const markOf = useMemo(() => {
    const map = new Map<string, GroupMarkKind>();
    if (participantMode) return map;
    for (const entry of groupMarkEntries(studio.population.partition))
      for (const id of entry.memberIds) map.set(id, entry.mark);
    return map;
  }, [participantMode, studio.population.partition]);
  const glyph = useMemo(
    () =>
      markOf.size
        ? (id: string, cx: number, cy: number, r: number) => {
            const mark = markOf.get(id);
            return mark ? groupMarkParts(mark, cx, cy, r) : null;
          }
        : undefined,
    [markOf],
  );
  const groupStats = useMemo(
    () =>
      groupColumns.map((column) => {
        const members = new Set(column.memberIds);
        const ids = new Set([...analysisSelected].filter((id) => members.has(id)));
        return { column, stats: describePopulationProbe(analysisFrame, ids, nearZeroLimit) };
      }),
    [groupColumns, analysisFrame, analysisSelected, nearZeroLimit],
  );
  const [aboutOpen, setAboutOpen] = useState(false);
  const participantNote = participantMode
    ? `Summaries use equal participant weights after ${
        studio.population.participants?.reduction === 'mean'
          ? 'averaging selected observation responses within each person'
          : 'requiring one selected observation per person'
      }. Plot points and cutouts remain original observations.`
    : undefined;
  const sphereNote =
    result && (result.query.probe.radiusMm > 0 || result.query.probe.region)
      ? `Each response is the ${result.query.probe.reduce} ${
          result.query.probe.region ? "over the region's voxels" : 'within this sphere'
        }. These summaries combine observation responses; population images summarize each voxel separately.`
      : undefined;

  // The notices' rendered height (they wrap): reported only when it changes.
  const [stripEl, setStripEl] = useState<HTMLDivElement | null>(null);
  const stripMeasured = useMeasuredHeight(stripEl);
  const [titleEl, setTitleEl] = useState<HTMLDivElement | null>(null);
  const titleMeasured = useMeasuredHeight(titleEl);
  const [noticesEl, setNoticesEl] = useState<HTMLDivElement | null>(null);
  const [noticesMeasured, setNoticesMeasured] = useState(0);
  useEffect(() => {
    if (!noticesEl) {
      setNoticesMeasured(0);
      return;
    }
    const measure = () => {
      const next = Math.ceil(noticesEl.getBoundingClientRect().height);
      setNoticesMeasured((previous) => (previous === next ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(noticesEl);
    return () => observer.disconnect();
  }, [noticesEl]);

  // A8: nothing pinned, nothing hovered and nothing sampling: one quiet line.
  const idle = !result && !snapshot.pending && !pinned;
  const noticeCount =
    (issue ? 1 : 0) + (shownLocusIssue ? 1 : 0) + (pinError ? 1 : 0);
  // The dock sizes to this tab (C3): a 28 px line when empty, the strip
  // (controls, title, plot beside the summary) when filled.
  // The stats block in full (its title, the group header, every row): the
  // request must include it, or the last rows (Sign, n) are clipped. Rows are
  // one 16 px line each (labels never wrap); the rendered block, measured,
  // wins when it is taller (a wrapped layout, larger type).
  const statsRows =
    (groupColumns.length ? 1 : 0) + 4 + (unavailable > 0 ? 1 : 0) + (aboutOpen ? 1 : 0);
  const statsHeight = Math.max(
    STATS_TITLE_PX + statsRows * STATS_ROW_PX + (aboutOpen ? 32 : 0) + (showNearZero ? 28 : 0),
    stripMeasured,
  );
  // Notices wrap at narrow widths: their rendered height (plus the column gap
  // before them), never less than one line each. Measured on the notices
  // alone, whose height follows the dock's width, not its height, so the
  // dock growing to fit them cannot feed back into the measurement.
  const noticesHeight = noticeCount
    ? Math.max(noticeCount * NOTICE_PX, noticesMeasured > 0 ? noticesMeasured + 4 : 0)
    : 0;
  const bodyHeight = idle
    ? EMPTY_LINE_PX + noticesHeight
    : 8 +
      CONTROL_ROW_PX +
      4 +
      Math.max(TITLE_LINE_PX, titleMeasured) +
      noticesHeight +
      (result ? 4 + (view === 'strip' ? Math.max(STRIP_PLOT_PX, statsHeight) : TABLE_PX) : 0);
  const setValuesDockHeight = usePopulationViewStore((state) => state.setValuesDockHeight);
  useEffect(() => {
    if (reportsDockHeight) setValuesDockHeight(bodyHeight);
  }, [reportsDockHeight, bodyHeight, setValuesDockHeight]);
  useEffect(
    () => () => {
      if (reportsDockHeight) setValuesDockHeight(null);
    },
    [reportsDockHeight, setValuesDockHeight],
  );
  const notices = (noticeCount > 0 || atlasPicker) && (
    <div
      ref={setNoticesEl}
      data-testid="population-values-notices"
      className="flex shrink-0 flex-col gap-1"
    >
      {issue && (
        <Notice role="alert" severity="danger">
          {issue}
        </Notice>
      )}
      {shownLocusIssue && (
        <Notice ref={issueRef} role="alert" severity="danger">
          <span>
            No {shownLocusIssue.kind}: {shownLocusIssue.message} Kept the previous locus.
          </span>
          {shownLocusIssue.kind === 'cluster' ? (
            <Button variant="secondary" size="sm" className="ml-2" onClick={() => openDockTab('clusters', { focus: true })}>
              Open Clusters
            </Button>
          ) : regionAtlas ? (
            <Select
              aria-label="Probe region"
              className="ml-2 inline-flex w-auto max-w-[220px]"
              value=""
              onValueChange={pickRegion}
              options={[{ value: '', label: 'Pick a region', disabled: true }, ...regionOptions]}
            />
          ) : (
            <Button variant="secondary" size="sm" className="ml-2" onClick={() => setAtlasPicker(true)}>
              Load atlas…
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => setLocusIssue(null)}>
            Dismiss
          </Button>
        </Notice>
      )}
      {atlasPicker ? <AtlasPicker onClose={() => setAtlasPicker(false)} /> : null}
      {pinError && (
        <Notice role="alert" severity="danger">
          {pinError}
        </Notice>
      )}
    </div>
  );
  const followHoverToggle = (
    <label
      className="flex items-center gap-1"
      title="While nothing is pinned, show the values under the pointer on the Population maps"
    >
      <input
        type="checkbox"
        checked={previewHover}
        onChange={(event) => populationProbeActions.setFollowHover(event.target.checked)}
      />{' '}
      Follow hover
    </label>
  );
  if (idle)
    return (
      <section
        aria-label="Population values"
        className="flex h-full min-h-0 flex-col gap-1 overflow-auto px-3 text-bf-sm"
      >
        <div
          data-testid="population-values-empty"
          className="flex h-7 shrink-0 items-center gap-1.5"
        >
          <span className="text-bf-text-muted">
            {previewHover && inPopulation ? 'Nothing pinned · hover a map, or' : 'Nothing pinned ·'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={pinHere}
            disabled={!studio.selection.activeSetId}
            title="Sample every subject at the crosshair"
          >
            Pin crosshair
          </Button>
          <span className="min-w-0 flex-1" />
          {followHoverToggle}
          <DropdownMenu
            position="bottom-right"
            trigger={
              <IconButton
                size="xs"
                variant="ghost"
                icon={<MoreHorizontal />}
                aria-label="More values actions"
                title="More: pin a region or a cluster"
              />
            }
            items={[
              {
                id: 'pin-region',
                label: 'Pin region at crosshair',
                disabled: !studio.selection.activeSetId,
                onClick: () => void chooseProbeLocus('region'),
              },
              {
                id: 'pin-cluster',
                label: 'Pin selected cluster',
                disabled: !studio.selection.activeSetId,
                onClick: () => void chooseProbeLocus('cluster'),
              },
            ]}
          />
        </div>
        {notices}
      </section>
    );

  const legend =
    result && view === 'strip' ? (
      <span
        data-testid="population-plot-legend"
        aria-hidden
        className="flex shrink-0 flex-wrap items-center gap-x-2 text-bf-2xs text-bf-text-muted"
      >
        {groupColumns.map((column) => (
          <span key={column.id} className="flex items-center gap-1">
            <GroupMark kind={column.mark} size={9} />
            {column.label}
          </span>
        ))}
        {hasSelection ? (
          <>
            <span className="flex items-center gap-1">
              <span className="inline-block size-1.5 rounded-full bg-bf-text-secondary" />
              selected
            </span>
            <span className="flex items-center gap-1">
              <span
                data-testid="population-legend-others-swatch"
                className="inline-block size-1.5 rounded-full bg-bf-text-secondary"
                style={{ opacity: MARK_UNSELECTED_OPACITY }}
              />
              others
            </span>
          </>
        ) : null}
        {focusedShown ? (
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full border border-bf-text-primary bg-bf-text-secondary" />
            current
          </span>
        ) : null}
        {mean !== null ? (
          <span className="flex items-center gap-1" data-testid="population-legend-mean">
            <svg width="14" height="4" aria-hidden className="shrink-0">
              <line x1="0" x2="14" y1="2" y2="2" stroke="var(--bf-text-muted)" strokeWidth="1" strokeDasharray="4 3" />
            </svg>
            mean
          </span>
        ) : null}
      </span>
    ) : null;

  const statRows: {
    key: string;
    label: string;
    title: string;
    testId: string;
    value: (stats: ProbeStats) => string;
    cellTitle?: (stats: ProbeStats) => string | undefined;
  }[] = [
    {
      key: 'mean',
      label: 'Mean',
      title: participantNote ?? 'Mean of the values (the dashed line)',
      testId: 'population-mean',
      value: (stats) => formatStat(stats.mean),
    },
    {
      key: 'size',
      label: 'Avg size',
      title: 'Average size: the mean of |value|, how far values sit from zero whatever their sign',
      testId: 'population-mean-absolute',
      value: (stats) => formatStat(stats.meanAbsolute),
      cellTitle: () => sphereNote,
    },
    {
      key: 'sign',
      label: 'Sign',
      title: 'Negative / near zero / positive counts',
      testId: 'population-sign-counts',
      value: (stats) => signValueOf(stats, nearZeroLimit > 0 || distribution.nearZero > 0),
      cellTitle: (stats) =>
        `${signSentenceOf(stats)}. Observed sign share of the ${unit}; near-zero endpoints are included. ${stats.count} finite ${unit} · ${stats.selectedMissing} unavailable.`,
    },
    {
      key: 'n',
      label: 'n',
      title: `Finite ${unit}: those with a value here`,
      testId: 'population-finite-count',
      value: (stats) => String(stats.count),
      cellTitle: (stats) =>
        `${stats.count} finite ${unit}${stats.unavailable > 0 ? ` · ${stats.unavailable} unavailable ${unit}` : ''}`,
    },
    ...(unavailable > 0
      ? [
          {
            key: 'unavailable',
            label: 'Unavailable',
            title: `${unit} with no finite value here`,
            testId: 'population-unavailable-count',
            value: (stats: ProbeStats) => String(stats.unavailable),
          },
        ]
      : []),
    ...(aboutOpen
      ? [
          {
            key: 'cancellation',
            label: 'Cancellation',
            title: CANCELLATION_NOTE,
            testId: 'population-cancellation',
            value: (stats: ProbeStats) => formatStat(stats.cancellation),
          },
        ]
      : []),
  ];
  // The whole column of a row reads as one sentence for assistive technology.
  const cellLabel = (row: (typeof statRows)[number], stats: ProbeStats) =>
    row.key === 'sign' ? signSentenceOf(stats) : undefined;

  return (
    <section
      aria-label="Population values"
      className="flex h-full min-h-0 flex-col gap-1 overflow-auto px-3 py-1 text-bf-sm"
    >
      <div
        data-testid="population-values-controls"
        className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1"
      >
        <span className="flex items-center gap-1">
          <span className="text-bf-text-muted">At</span>
          <SegmentedControl
            aria-label="Probe locus"
            options={[
              { value: 'point', label: 'Point' },
              { value: 'region', label: 'Region' },
              { value: 'cluster', label: 'Cluster' },
            ]}
            value={probeLocus}
            onValueChange={(v) => void chooseProbeLocus(v as 'point' | 'region' | 'cluster')}
          />
        </span>
        {showRadius ? (
          <label ref={radiusRef} className="flex items-center gap-1">
            Radius{' '}
            <ValidatedNumberField
              aria-label="Probe radius in millimetres"
              min={0}
              step={1}
              value={radius}
              validate={(v) =>
                v === null
                  ? 'Enter a radius in mm (0 = the voxel only)'
                  : v < 0
                    ? 'Radius must be ≥ 0 mm (0 = the voxel only)'
                    : null
              }
              onCommit={updateRadius}
              fieldClassName="w-20"
              unit="mm"
            />
            {radius === 0 ? <span className="text-bf-2xs text-bf-text-muted">voxel only</span> : null}
          </label>
        ) : null}
        {probeLocus === 'region' && regionAtlas ? (
          <Select
            aria-label="Probe region"
            className="w-auto max-w-[220px]"
            value={
              population.probe?.region?.locus.labelSource.type === 'layer'
                ? String(population.probe.region.locus.labelIds[0])
                : ''
            }
            onValueChange={pickRegion}
            options={regionOptions}
          />
        ) : null}
        <label
          className="flex items-center gap-1"
          title="Width of pinned-region tiles in the montage and of the Summary cutouts"
        >
          Cutout{' '}
          <Select
            className="w-auto"
            aria-label="Cutout width"
            value={cutoutWidth}
            onChange={(event) => setCutoutWidth(Number(event.target.value))}
          >
            {CUTOUT_WIDTHS_MM.map((mm) => (
              <option key={mm} value={mm}>
                {mm} mm
              </option>
            ))}
          </Select>
        </label>
        {followHoverToggle}
        {pinToggle}
        {result && (
          <SegmentedControl
            aria-label="Values view"
            hideWhenSingle={false}
            options={[
              { value: 'strip', label: 'Strip' },
              { value: 'table', label: 'Table' },
            ]}
            value={view}
            onValueChange={(v) => setView(v as 'strip' | 'table')}
          />
        )}
        <DropdownMenu
          position="bottom-right"
          trigger={
            <IconButton
              size="xs"
              variant="ghost"
              icon={<MoreHorizontal />}
              aria-label="More values actions"
              title="More: compose in Plot, radius, near-zero band"
            />
          }
          items={overflowItems}
        />
      </div>
      <div ref={setTitleEl} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <p
          role="status"
          data-testid="population-plot-title"
          className="m-0 min-w-0 flex-1 break-words font-mono text-bf-xs text-bf-text-secondary"
          title={[
            result
              ? `Each dot is one ${noun.replace(/s$/, '')}'s value at this location; ${
                  montageIds ? 'dots follow the montage order' : 'dots are ranked lowest to highest'
                }. Drag across the dots to select them (Shift adds, Alt removes).`
              : null,
            sphereNote ?? null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {titleNode}
        </p>
        {legend}
      </div>
      {notices}
      {result && view === 'strip' && (
        <div
          ref={setStripEl}
          data-testid="population-values-strip"
          className="flex min-h-0 min-w-0 shrink-0 flex-wrap items-start gap-x-6 gap-y-2"
        >
          <div ref={setPlotEl} className="min-w-[240px] flex-[3_1_360px] overflow-hidden">
            {displayFrame && (
              <PopulationBrush horizontal direct scope={definition.query?.key ?? 'no-probe'}>
                <PlotEncoder
                  frame={displayFrame}
                  spec={pointSpec}
                  width={width}
                  height={STRIP_PLOT_PX}
                  context={{
                    datumLink: {
                      idColumn: 'member',
                      focusedId: studio.selection.activeMemberId,
                      selectedIds: selected,
                      onFocus: populationProbeActions.focus,
                      onToggleSelection: populationProbeActions.toggle,
                      action: 'Click to make this the active member',
                      onHover: (id) => populationMemberHover.set(id, 'values'),
                      linkedId: linkedDot,
                      glyph,
                    },
                  }}
                />
              </PopulationBrush>
            )}
          </div>
          <div
            className="flex min-w-[180px] flex-[1_1_200px] flex-col gap-0.5 overflow-x-auto"
            aria-label="Observed response distribution"
            title={participantNote ?? sphereNote}
          >
            <div className="flex h-5 shrink-0 items-center gap-1">
              <p
                data-testid="population-stats-title"
                className="m-0 min-w-0 flex-1 text-bf-xs text-bf-text-secondary"
                title={
                  hasSelection
                    ? 'These numbers describe the selected subjects only'
                    : 'These numbers describe every subject shown'
                }
              >
                {statsTitle}
              </p>
              <IconButton
                size="xs"
                variant="ghost"
                icon={<Info />}
                aria-label="About these numbers"
                aria-expanded={aboutOpen}
                title={`Cancellation ${formatStat(distribution.cancellation)}: ${CANCELLATION_NOTE}`}
                onClick={() => setAboutOpen((open) => !open)}
              />
            </div>
            <table
              data-testid="population-stats"
              className="w-full border-collapse text-left"
              aria-label="Summary of the values"
            >
              {groupColumns.length ? (
                <thead>
                  <tr>
                    <th className="p-0 font-normal" />
                    <th className="h-4 p-0 pl-3 text-right text-bf-2xs font-normal text-bf-text-muted">
                      {hasSelection ? 'Selected' : 'All'}
                    </th>
                    {groupColumns.map((column) => (
                      <th
                        key={column.id}
                        data-testid={`population-stats-group-${column.id}`}
                        className="p-0 pl-3 text-right text-bf-2xs font-normal text-bf-text-muted"
                        title={`${column.title}${hasSelection ? ', selected members only' : ''}`}
                      >
                        <span className="inline-flex items-center justify-end gap-1">
                          <GroupMark kind={column.mark} size={9} />
                          {column.label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
              ) : null}
              <tbody>
                {statRows.map((row) => (
                  <tr key={row.key}>
                    <th
                      scope="row"
                      className="whitespace-nowrap p-0 text-bf-xs font-normal text-bf-text-muted"
                      title={row.title}
                    >
                      {row.label}
                    </th>
                    <td
                      data-testid={row.testId}
                      className="whitespace-nowrap p-0 pl-3 text-right font-mono text-bf-xs tabular-nums"
                      aria-label={cellLabel(row, distribution)}
                      title={row.cellTitle?.(distribution)}
                    >
                      {row.value(distribution)}
                    </td>
                    {groupStats.map(({ column, stats }) => (
                      <td
                        key={column.id}
                        data-testid={`${row.testId}-${column.id}`}
                        className="whitespace-nowrap p-0 pl-3 text-right font-mono text-bf-xs tabular-nums"
                        aria-label={cellLabel(row, stats)}
                        title={row.cellTitle?.(stats)}
                      >
                        {row.value(stats)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {aboutOpen ? (
              <p data-testid="population-stats-about" className="m-0 text-bf-2xs text-bf-text-muted">
                {CANCELLATION_NOTE}
              </p>
            ) : null}
            {showNearZero ? (
              <label ref={nearZeroRef} className="flex items-center justify-end gap-1 text-bf-xs text-bf-text-muted">
                Near zero ±{' '}
                <NumberField
                  aria-label="Near-zero response limit"
                  fieldClassName="w-20"
                  min={0}
                  step="any"
                  value={nearZeroLimit}
                  onChange={(event) => {
                    const next = event.target.valueAsNumber;
                    if (Number.isFinite(next) && next >= 0)
                      setNearZeroLimit((previous) => (previous === next ? previous : next));
                  }}
                />
              </label>
            ) : null}
          </div>
        </div>
      )}
      {result && view === 'table' && (
        <div className="min-h-0 flex-1 overflow-auto">
          {studio.population.partition?.factorColumns && (
            <PopulationPivot
              key={JSON.stringify(studio.population.partition)}
              partition={studio.population.partition}
              frame={result.frame}
              current={result.query.key === definition.query?.key}
            />
          )}
          <table className="w-full text-left" aria-label="Observation values">
            <thead>
              <tr>
                <th>Select</th>
                <th>Observation</th>
                <th>Group</th>
                <th className="text-right">Value</th>
                <th className="text-right" title={`Rank among the ${tableStats.n} shown values, 1 = lowest`}>
                  Rank
                </th>
                <th className="text-right" title="z: distance from the mean of all shown values, in standard deviations">
                  z
                </th>
              </tr>
            </thead>
            <tbody>
              {result.frame.rows.map((row) => {
                const id = String(row.member);
                const source = result.frame.meta?.sources?.find(
                  (source) => source.memberId === id,
                );
                // Preview is transient presentation: muted, struck value and a
                // text marker, distinct from the selection box and focus ring.
                const status = statuses.byId.get(id);
                const previewedOut = previewing && !!status?.previewedOut;
                const value = finiteValue(row.value) ? row.value : null;
                const z = value === null ? null : tableStats.z(value);
                // Source status stays reachable as the row's tooltip.
                const sourceStatus =
                  source?.error ??
                  (source?.sourceRevision
                    ? `Snapshot recorded${source.sourceRevision.sha256 ? ` · ${source.sourceRevision.sha256}` : ''}`
                    : 'Source identity unavailable');
                return (
                  <tr
                    key={id}
                    title={sourceStatus}
                    data-preview={previewedOut ? 'without' : undefined}
                    data-unavailable={status?.unavailableAtProbe ? '' : undefined}
                    data-unassigned={status?.unassigned?.kind}
                    data-source-error={source?.error ? '' : undefined}
                    className={previewedOut ? 'text-bf-text-faint' : undefined}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${id}`}
                        checked={selected.has(id)}
                        onChange={() => populationProbeActions.toggle(id)}
                      />
                    </td>
                    <td>
                      <Button
                        variant="link"
                        size="sm"
                        className="min-h-6 font-mono"
                        onClick={() => populationProbeActions.focus(id)}
                      >
                        {id}
                      </Button>
                      {previewedOut && <span className="ml-1 italic">Previewing without</span>}
                      {source?.error ? (
                        <span className="ml-1 text-bf-xs text-bf-danger">{source.error}</span>
                      ) : null}
                    </td>
                    <td className="max-w-[160px] truncate text-bf-text-secondary">{groupOf.get(id) ?? '—'}</td>
                    <td className={`text-right font-mono tabular-nums${previewedOut ? ' line-through' : ''}`}>
                      {value === null ? '—' : value.toPrecision(4)}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {value === null ? '—' : tableStats.rank(value)}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {z === null ? '—' : z.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
