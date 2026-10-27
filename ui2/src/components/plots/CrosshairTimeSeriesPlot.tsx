/**
 * The Series mode over a 4D layer (phase 4 E5; round 2 R4/X2/X3/E5b): the
 * layer's series at the Series locus (voxel, sphere, region, cluster; the
 * same control as the dataset series), drawn by the shared encoder with the
 * same caption and export row.
 *
 * - Axis: the dataset's declared lag / time axis when the layer is a dataset
 *   member ("Lag (TR)", 0-based), else seconds with a TR, else the 1-based
 *   frame (X3).
 * - Segments (E5b): the layer's runs (BIDS names that differ only in run /
 *   ses, or a `<stem>_runs.json` sidecar), concatenated, faceted or overlaid;
 *   clicking a sample focuses that run's layer and frame.
 * - Sampling cost (PRD Risk #3): fetches are throttled to ≤ 30 Hz,
 *   de-duplicated on the locus, and stale in-flight requests are dropped via
 *   a monotonic token.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { sampleProvider } from '@/services/SampleProvider';
import { getTimeNavigationService } from '@/services/TimeNavigationService';
import { getTransport } from '@/services/transport';
import { decodeText, isMissingFileError } from '@/services/LabelTableService';
import { useLayerStore } from '@/stores/layerStore';
import { activateRun, formRunGroup, restoreRunGroup } from '@/services/series/runVisibility';
import { transformVoxelToWorldColumnMajor, transformWorldToVoxelColumnMajor } from '@/utils/voxelTransform';
import { sphereVoxelCount } from '@/services/series/sphereVoxels';
import { useClusterStore } from '@/stores/clusterStore';
import { useSeriesStore, seriesRadiusMm } from '@/stores/seriesStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { resolveSeriesRegion, type SeriesRegion } from '@/services/series/seriesRegion';
import { datasetAxisFor, layerAxis, type RawSeriesAxis } from '@/services/series/rawSeriesAxis';
import {
  SEGMENT_FRAME_ID,
  SERIES_SEGMENT,
  manualSegmentGroup,
  parseRunsSidecar,
  rawSeriesCsv,
  runGroupFor,
  runsSidecarPath,
  segmentAt,
  segmentedSeriesFrame,
  type SegmentGroup,
  type SegmentLayout,
} from '@/services/series/seriesSegments';
import { clusterLocusText } from '@/services/series/seriesPresentation';
import {
  populationPlotPng,
  savePopulationPlot,
} from '@/services/studio/PopulationPlotExportService';
import { getEventBus } from '@/events/EventBus';
import { formatWorldMm } from '@/utils/valueFormat';
import { shortLayerLabel } from '@/components/views/viewportFrame/frameFormat';
import { Button, Notice, Select, Toolbar, ToolbarField } from '@/components/ui/bf';
import type { Locus, ResolvedPlotSpec, SampleFrame } from '@/plotting';

import { PlotEncoder } from './encoder/PlotEncoder';
import { populationCategoryColor } from './encoder/cartesianMarks';
import { FRAME_LEGEND_INSET, PlotFrameLegend } from './PlotFrameLegend';
import { SeriesIssue } from './SeriesIssue';
import { seriesIssueAction } from './seriesIssue.helpers';
import { SeriesLocusControls } from './SeriesLocusControls';
import { TIMESERIES_THROTTLE_MS, resolveTimeseriesVoxel } from './crosshairTimeSeriesPlot.helpers';
import type { PlotModeContext } from './plotHost.types';

/** Below this host height (the pinned time row) only the plot is drawn. */
const MIN_FULL_HOST_PX = 180;
const MIN_PLOT_H = 60;

/** Mode id — also the key under which this mode's spec/params are persisted. */
export const TIME_SERIES_MODE_ID = 'crosshair-time-series';

const LAYOUT_OPTIONS = [
  {
    value: 'concatenated',
    label: 'Concatenated',
    title: 'One axis across the runs, boundaries marked',
  },
  { value: 'faceted', label: 'Faceted', title: 'One panel per run, shared y axis' },
  {
    value: 'overlaid',
    label: 'Overlaid',
    title: 'Runs aligned on time within the run, one line each',
  },
] as const;

interface ThrottleState {
  pending: ReturnType<typeof setTimeout> | null;
  lastDispatch: number;
  inflightToken: number;
  /** A dispatched request has not settled (a re-run must not dedupe on its key). */
  inflight: boolean;
}

/** Sampled values per segment layer, and the locus they came from. */
interface RawSample {
  values: Map<string, number[]>;
  voxels: number | null;
}

// Runs sidecars are read once per image path (null: none or unreadable).
const sidecarTexts = new Map<string, Promise<string | null>>();
function readSidecar(path: string): Promise<string | null> {
  let pending = sidecarTexts.get(path);
  if (!pending) {
    pending = getTransport()
      .invoke('plugin:fs|read_text_file', { path })
      .then(decodeText)
      .catch((error) => {
        if (!isMissingFileError(error))
          console.warn(`[Series] Runs sidecar ${path} could not be read:`, error);
        return null;
      })
      .then((text) => {
        // A missing or unreadable sidecar is asked again next time (REVIEW m13).
        if (text === null) sidecarTexts.delete(path);
        return text;
      });
    sidecarTexts.set(path, pending);
  }
  return pending;
}

export function CrosshairTimeSeriesPlotBody({ ctx }: { ctx: PlotModeContext }) {
  const { layerId, crosshairMm, width, height } = ctx;
  const full = height >= MIN_FULL_HOST_PX;
  const settings = useSeriesStore();
  const locusKind = settings.locus;
  const radiusMm = seriesRadiusMm(settings);
  const clusterSelection = useClusterStore((s) => (locusKind === 'cluster' ? s.selectedId : null));
  const clusterTable = useClusterStore((s) => (locusKind === 'cluster' ? s.result : null));

  // --- Segments (E5b) -------------------------------------------------------
  const layers = useLayerStore((s) => s.layers);
  const layer = useMemo(() => layers?.find?.((l) => l.id === layerId), [layers, layerId]);
  const metadata = useLayerStore((s) => s.layerMetadata);
  const sourcePath =
    (layerId ? metadata?.get?.(layerId)?.sourcePath : undefined) ?? layer?.sourcePath;
  const sidecarPath = runsSidecarPath(sourcePath);
  const [sidecar, setSidecar] = useState<{ path: string; text: string | null } | null>(null);
  useEffect(() => {
    if (!sidecarPath || settings.segments === 'off') return;
    let live = true;
    void readSidecar(sidecarPath).then((text) => live && setSidecar({ path: sidecarPath, text }));
    return () => {
      live = false;
    };
  }, [sidecarPath, settings.segments]);
  const grid = (id: string) => {
    const m = metadata?.get?.(id);
    return m ? { dimensions: m.dimensions, voxelToWorld: m.voxelToWorld } : undefined;
  };
  const { group, groupIssue } = useMemo((): {
    group: SegmentGroup | null;
    groupIssue: string | null;
  } => {
    if (!layer || !layers?.length || settings.segments === 'off')
      return { group: null, groupIssue: null };
    if (settings.segments === 'manual')
      return {
        group: manualSegmentGroup(settings.manualSegmentLayerIds, layers),
        groupIssue: null,
      };
    if (sidecar && sidecar.path === sidecarPath && sidecar.text) {
      try {
        return { group: parseRunsSidecar(sidecar.text, layer), groupIssue: null };
      } catch (e) {
        return { group: null, groupIssue: `Runs sidecar ignored: ${(e as Error).message}` };
      }
    }
    return { group: runGroupFor(layer.id, layers, grid), groupIssue: null };
    // grid reads `metadata`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    layer,
    layers,
    metadata,
    settings.segments,
    settings.manualSegmentLayerIds,
    sidecar,
    sidecarPath,
  ]);
  // Whether runs can be found for the layer, whatever the current choice.
  const autoAvailable = useMemo(() => {
    if (!layer || !layers?.length) return false;
    if (sidecar && sidecar.path === sidecarPath && sidecar.text) {
      try {
        parseRunsSidecar(sidecar.text, layer);
        return true;
      } catch {
        /* falls through to BIDS runs */
      }
    }
    return runGroupFor(layer.id, layers, grid) !== null;
    // grid reads `metadata`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, layers, metadata, sidecar, sidecarPath]);
  // Offered when the layer is alone: every 4D layer on its grid, by hand.
  const groupable = useMemo(() => {
    if (!layer) return [] as string[];
    const own = grid(layer.id);
    return (layers ?? [])
      .filter((l) => (l.timeSeriesInfo?.num_timepoints ?? 0) >= 2)
      .filter((l) => l.id === layer.id || JSON.stringify(grid(l.id)) === JSON.stringify(own))
      .map((l) => l.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, layers, metadata]);
  const layout: SegmentLayout = settings.segmentLayout ?? 'concatenated';

  // --- Axis (X3) -------------------------------------------------------------
  const studioSets = useSetStudioStore((s) => s.sets);
  const studioSelection = useSetStudioStore((s) => s.selection);
  const studioPopulation = useSetStudioStore((s) => s.population);
  const studioFeatures = useSetStudioStore((s) => s.features);
  const tr =
    layer?.timeSeriesInfo?.tr && layer.timeSeriesInfo.tr > 0 ? layer.timeSeriesInfo.tr : null;
  const datasetAxis = useMemo(
    () => (group ? null : datasetAxisFor(sourcePath, { sets: studioSets, selection: studioSelection, population: studioPopulation, features: studioFeatures })),
    [group, sourcePath, studioSets, studioSelection, studioPopulation, studioFeatures],
  );
  const axis: RawSeriesAxis = datasetAxis ?? layerAxis(tr);

  // --- Locus ----------------------------------------------------------------
  const regionLocusWanted = locusKind === 'region' || locusKind === 'cluster';
  const [region, setRegion] = useState<SeriesRegion | null>(null);
  useEffect(() => {
    let live = true;
    if (!crosshairMm || !regionLocusWanted) {
      setRegion(null);
      return;
    }
    void resolveSeriesRegion({ locus: locusKind, regionPick: settings.regionPick }, [
      crosshairMm[0],
      crosshairMm[1],
      crosshairMm[2],
    ]).then((next) => live && setRegion(next));
    return () => {
      live = false;
    };
  }, [
    crosshairMm,
    locusKind,
    regionLocusWanted,
    settings.regionPick,
    clusterSelection,
    clusterTable,
  ]);
  const regionLocus = region && region.region ? region.region : null;
  const regionLabel = region && region.region ? region.label : '';
  const regionKey = regionLocus ? JSON.stringify(regionLocus) : regionLocusWanted ? 'pending' : '';
  const regionIssue = region && !region.region ? region.issue : null;

  // --- Sampling ----------------------------------------------------------------
  // Keyed by value: the group object is rebuilt whenever a layer changes
  // (each frame step), and must not restart sampling (round 3 T4).
  const sampleLayerKey = group ? [...new Set(group.segments.map((s) => s.layerId))].join('\n') : (layerId ?? '');
  const sampleLayerIds = useMemo(() => (sampleLayerKey ? sampleLayerKey.split('\n') : []), [sampleLayerKey]);
  const [sample, setSample] = useState<RawSample | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const throttleRef = useRef<ThrottleState>({ pending: null, lastDispatch: 0, inflightToken: 0, inflight: false });
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    const target = resolveTimeseriesVoxel(layerId, crosshairMm);
    if (!target || !layerId || !crosshairMm || regionKey === 'pending' || regionIssue) {
      // Drop stale data when the target becomes invalid; bump the token so a
      // request in flight cannot resurrect it.
      throttleRef.current.inflightToken += 1;
      lastKeyRef.current = '';
      setSample(null);
      setError(null);
      setLoading(false);
      return;
    }
    const worldMm: [number, number, number] = [crosshairMm[0], crosshairMm[1], crosshairMm[2]];
    // A point is keyed on its voxel (sub-voxel moves sample the same voxel); a
    // sphere's membership depends on the fractional position.
    const locusKey =
      radiusMm > 0
        ? `s:${worldMm.map((v) => v.toFixed(2)).join(',')}`
        : `v:${target.voxel.join(',')}`;
    const key = `${sampleLayerIds.join('+')}:${regionLocus ? `r:${regionKey}` : `${locusKey}:${radiusMm}`}`;
    if (key === lastKeyRef.current && sample !== null) return;
    if (throttleRef.current.pending) {
      clearTimeout(throttleRef.current.pending);
      throttleRef.current.pending = null;
    }
    const elapsed = Date.now() - throttleRef.current.lastDispatch;
    const delay = elapsed >= TIMESERIES_THROTTLE_MS ? 0 : TIMESERIES_THROTTLE_MS - elapsed;
    const locus: Locus = regionLocus
      ? { kind: 'point', worldMm, region: regionLocus }
      : radiusMm > 0
        ? { kind: 'sphere', worldMm, radiusMm }
        : { kind: 'point', worldMm };
    const token = ++throttleRef.current.inflightToken;
    const dispatch = () => {
      throttleRef.current.pending = null;
      throttleRef.current.lastDispatch = Date.now();
      lastKeyRef.current = key;
      throttleRef.current.inflight = true;
      setLoading(true);
      setError(null);
      Promise.all(
        sampleLayerIds.map((id) =>
          sampleProvider
            .sample({ datasetId: id, locus, reduce: 'mean' })
            .then((frame: SampleFrame) => [id, frame] as const),
        ),
      )
        .then((frames) => {
          if (token !== throttleRef.current.inflightToken) return;
          throttleRef.current.inflight = false;
          const values = new Map<string, number[]>();
          for (const [id, frame] of frames)
            values.set(
              id,
              frame.rows.map((r) => (typeof r.value === 'number' ? r.value : Number.NaN)),
            );
          const counts = frames
            .map(([, f]) => (f.meta as { validCount?: unknown } | undefined)?.validCount)
            .filter((n): n is number => typeof n === 'number');
          setSample({ values, voxels: counts.length ? Math.max(...counts) : null });
          setLoading(false);
        })
        .catch((err) => {
          if (token !== throttleRef.current.inflightToken) return;
          throttleRef.current.inflight = false;
          lastKeyRef.current = '';
          setSample(null);
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        });
    };
    if (delay === 0) dispatch();
    else throttleRef.current.pending = setTimeout(dispatch, delay);
    const throttleHandle = throttleRef;
    return () => {
      if (throttleHandle.current.pending) {
        clearTimeout(throttleHandle.current.pending);
        throttleHandle.current.pending = null;
      }
      // A late resolve after re-run or unmount is ignored, so its key must
      // not count as sampled ("sampling…" stuck, round 3 T4).
      throttleHandle.current.inflightToken += 1;
      if (throttleHandle.current.inflight) {
        throttleHandle.current.inflight = false;
        lastKeyRef.current = '';
      }
    };
    // `sample` is excluded: including it would refire after each success.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId, crosshairMm, radiusMm, regionKey, regionIssue, sampleLayerIds]);

  // --- The plotted frame -------------------------------------------------------
  const currentTimepoint = layer?.currentTimepoint ?? 0;
  const plotted = useMemo(() => {
    if (!sample) return null;
    if (group) {
      const samples = group.segments
        .map((segment, index) => ({
          segment,
          index,
          values: (sample.values.get(segment.layerId) ?? []).slice(
            segment.frameStart,
            segment.frameStart + segment.frames,
          ),
        }))
        .filter((s) => s.values.length > 0);
      if (!samples.length) return null;
      const series = segmentedSeriesFrame(samples, layout);
      return {
        ...series,
        integer: !series.xTitle.includes('(s)'),
        segments: samples.map((s) => s.segment),
      };
    }
    const values = sample.values.get(layerId ?? '') ?? [];
    if (values.length < 2) return null;
    const frame: SampleFrame = {
      columns: [
        { name: 't', role: 'temporal', ...(axis.unit ? { unit: axis.unit } : {}) },
        { name: 'value', role: 'quantitative' },
        { name: SEGMENT_FRAME_ID, role: 'index' },
      ],
      rows: values.map((v, i) => ({
        t: axis.at(i),
        value: Number.isFinite(v) ? v : null,
        [SEGMENT_FRAME_ID]: `0:${i}`,
      })),
    };
    return {
      frame,
      xTitle: axis.title,
      rules: [],
      step: axis.step,
      note: null,
      integer: axis.integer,
      segments: null,
    };
  }, [sample, group, layout, layerId, axis]);

  const layerName = layer?.name;
  const member = datasetAxis?.member ?? null;
  const yTitle = `${datasetAxis?.measure ?? 'Signal'} (a.u.)`;
  const legend =
    plotted?.segments && layout === 'overlaid'
      ? plotted.segments.map((s, i) => ({ label: s.label, color: segmentColor(i) }))
      : [];
  const spec: ResolvedPlotSpec | null = plotted
    ? {
        mark: 'line',
        encoding: {
          x: 't',
          y: 'value',
          ...(plotted.segments && layout === 'overlaid' ? { color: SERIES_SEGMENT } : {}),
          ...(plotted.segments && layout === 'faceted' ? { facet: SERIES_SEGMENT } : {}),
          // Concatenated runs are separate paths: no line joins two runs (round 3 T1).
          ...(plotted.segments && layout === 'concatenated' ? { detail: SERIES_SEGMENT } : {}),
        },
        transforms: [],
        params: {
          xTitle: plotted.xTitle,
          yTitle,
          xIntegerTicks: plotted.integer,
          xPadHalfStep: plotted.step,
          ...(plotted.rules.length ? { xRules: plotted.rules } : {}),
          ...(legend.length ? { topInset: FRAME_LEGEND_INSET } : {}),
          // Concatenated runs are one time sequence for the arrow keys (round 3 C2).
          ...(plotted.segments && layout === 'concatenated' ? { keysAcrossGroups: true } : {}),
          // Overlaid runs: a fixed, well-separated palette (round 3 C9).
          ...(legend.length ? { colorMap: Object.fromEntries(legend.map((e) => [e.label, e.color])) } : {}),
          // Faceted runs: one row up to four panels on a shared y (round 3 T3).
          ...(plotted.segments && layout === 'faceted' ? { facetColumns: Math.min(4, plotted.segments.length), facetPrefix: false } : {}),
          ...(datasetAxis?.condition ? { seriesColor: populationCategoryColor(datasetAxis.condition) } : {}),
          ariaLabel: `${yTitle} by ${plotted.xTitle.toLowerCase()}${layerName ? `, ${shortLayerLabel(layerName)}` : ''}`,
        },
      }
    : null;

  // Segment and frame under the current timepoint ("run 2 · frame 13/24").
  const here = group ? segmentAt(group, layerId, currentTimepoint) : null;
  const focusedId = group
    ? here
      ? `${here.index}:${currentTimepoint}`
      : null
    : String(`0:${currentTimepoint}`);
  const withinNow = here ? here.frame - 1 : currentTimepoint;
  const entryIds = useMemo(
    () =>
      new Set(
        group
          ? group.segments.map((s, i) => `${i}:${s.frameStart + Math.min(withinNow, s.frames - 1)}`)
          : [`0:${currentTimepoint}`],
      ),
    [group, withinNow, currentTimepoint],
  );
  const segmentIds = useMemo(
    () => new Set((plotted?.frame.rows ?? []).map((r) => String(r[SEGMENT_FRAME_ID]))),
    [plotted],
  );
  const focus = (id: string) => {
    const [si, t] = id.split(':').map(Number);
    const segment = group?.segments[si];
    const targetLayer = segment?.layerId ?? layerId;
    if (targetLayer && targetLayer !== layerId) {
      // An explicit activation of another run (round 3 C3): only now does the
      // view change which run is shown.
      if (group) activateRun(group, targetLayer, layerId);
      useLayerStore.getState().selectLayer?.(targetLayer);
    }
    getTimeNavigationService().setTimepoint(t);
  };
  // A run group shows the focused run only (round 3 F1), set once when the
  // group forms; "This layer only" restores what the view changed (C3).
  const formedKey = useRef<string | null>(null);
  useEffect(() => {
    const key = group && group.source !== 'sidecar' ? group.key : null;
    if (formedKey.current && formedKey.current !== key) restoreRunGroup(formedKey.current);
    formedKey.current = key;
    if (group && key && layerId) formRunGroup(group, layerId);
    // layerId is read once at formation; a later focus is an activation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.key]);
  // Leaving the Series view (another plot mode, the dock closed) restores what
  // the view changed (REVIEW m4).
  useEffect(
    () => () => {
      if (formedKey.current) restoreRunGroup(formedKey.current);
      formedKey.current = null;
    },
    [],
  );
  // A run selected elsewhere (Inspector, layer list) is shown like one
  // activated in the plot (v4 function 1).
  const shownLayer = useRef(layerId);
  useEffect(() => {
    const previous = shownLayer.current;
    shownLayer.current = layerId;
    if (group && layerId && previous && previous !== layerId && group.segments.some((s) => s.layerId === layerId))
      activateRun(group, layerId, previous);
    // group is the current group; the effect follows the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId]);
  const datumLabel = (i: number) => {
    const row = plotted?.frame.rows[i];
    if (!row) return '';
    const [si, t] = String(row[SEGMENT_FRAME_ID]).split(':').map(Number);
    const v = Number(row.value);
    const value = Number.isFinite(v) ? v.toPrecision(4) : 'no value';
    if (group) {
      const segment = group.segments[si];
      const within = t - segment.frameStart;
      return `${segment.label} · frame ${within + 1}/${segment.frames}${segment.tr ? `, ${Number((within * segment.tr).toFixed(3))} s` : ''}: ${value}`;
    }
    return datasetAxis
      ? `${axis.describe(t)} (frame ${t + 1} of ${plotted!.frame.rows.length}): ${value}`
      : `${t + 1 === axis.at(t) ? `Frame ${t + 1}` : `Frame ${t + 1}, ${axis.describe(t)}`}: ${value}`;
  };

  // --- Caption, export ------------------------------------------------------------
  const locusText = regionLocus
    ? locusKind === 'cluster'
      ? (clusterLocusText(
          useClusterStore.getState().result,
          useClusterStore.getState().selectedId,
        ) ?? regionLabel)
      : regionLabel
    : crosshairMm
      ? radiusMm > 0
        ? `${radiusMm} mm sphere at ${crosshairMm.map((v) => formatWorldMm(v)).join(', ')} mm`
        : voxelLocusText(layerId, layerName, crosshairMm)
      : 'no locus';
  // A voxel locus is one voxel (round 3 S2); regions report their own count.
  const voxels =
    locusKind === 'cluster'
      ? null
      : regionLocus
        ? (sample?.voxels ?? null)
        : radiusMm > 0 && crosshairMm
          ? sphereCount(layerId, crosshairMm, radiusMm)
          : 1;
  const counter = group
    ? here
      ? `${here.segment.label} · frame ${here.frame}/${here.segment.frames}`
      : null
    : datasetAxis
      ? `${axis.describe(currentTimepoint)} (frame ${currentTimepoint + 1} of ${layer?.timeSeriesInfo?.num_timepoints ?? '?'})`
      : null;
  // The source once (v4 user: the caption repeated the layer): a group names
  // its runs, their TR and frames; a dataset member names its dataset.
  const runTrs = group ? [...new Set(group.segments.map((s) => s.tr))] : [];
  const source = group
    ? `${group.title}: ${group.segments.length} ${group.factor === 'session' ? 'sessions' : group.factor === 'run' ? 'runs' : 'segments'}${
        runTrs.length === 1 && runTrs[0] ? `, TR ${runTrs[0]} s` : runTrs.every((t) => t) ? `, TR ${runTrs.join('/')} s` : ''
      }, ${group.segments.map((s) => s.frames).join('/')} frames`
    : [
        layerName && !locusText.includes(shortLayerLabel(layerName)) ? shortLayerLabel(layerName) : null,
        datasetAxis?.dataset ?? null,
        // The member, unless the layer name already says it ("fir (sub-s01, faces)").
        member && !member.split(' · ').every((part) => (layerName ?? '').includes(part)) ? member : null,
      ]
        .filter(Boolean)
        .join(' · ');
  const caption = [
    voxels !== null && voxels > 1
      ? `${locusText}, ${voxels.toLocaleString('en-US')} voxels`
      : locusText,
    source,
    plotted?.note ?? null,
    counter,
  ]
    .filter(Boolean)
    .join(' · ');

  const copyCsv = async () => {
    if (!plotted || !sample) return;
    const allTr = !!plotted.segments?.every((s) => s.tr !== null);
    const rows = group
      ? plotted.segments!.flatMap((segment) =>
          (sample.values.get(segment.layerId) ?? [])
            .slice(segment.frameStart, segment.frameStart + segment.frames)
            .map((v, i) => ({
              // As on screen ("run 2"), round 3 C9.
              segment: segment.label,
              volumeIndex: segment.frameStart + i,
              frame: i + 1,
              tr: segment.tr,
              // One unit for the whole column (REVIEW m9): seconds only when every run has a TR.
              tWithin: allTr ? Number((i * segment.tr!).toFixed(6)) : i + 1,
              // Each row's locus on its own run's grid (v4 fidelity).
              locusLabel: radiusMm > 0 || regionLocus || !crosshairMm ? undefined : voxelLocusText(segment.layerId, layers.find((l) => l.id === segment.layerId)?.name, crosshairMm),
              t: null as number | null,
              value: Number.isFinite(v) ? v : null,
              layer: layers.find((l) => l.id === segment.layerId)?.name ?? segment.layerId,
            })),
        )
      : (sample.values.get(layerId ?? '') ?? []).map((v, i) => ({
          segment: null,
          volumeIndex: i,
          frame: i + 1,
          tr,
          tWithin: null,
          t: axis.at(i),
          value: Number.isFinite(v) ? v : null,
          layer: layerName ?? layerId ?? '',
        }));
    if (group) {
      // The concatenated axis, whatever the layout on screen.
      let offset = 0;
      const seconds = plotted.segments!.every((s) => s.tr !== null);
      for (const segment of plotted.segments!) {
        rows
          .filter((r) => r.segment === segment.label)
          .forEach((r, i) => {
            r.t = seconds ? Number((offset + i * segment.tr!).toFixed(6)) : offset + i + 1;
          });
        offset += seconds ? segment.frames * segment.tr! : segment.frames;
      }
    }
    const segAxis = group
      ? {
          name: plotted.segments!.every((s) => s.tr !== null) ? 't' : 'frame',
          unit: plotted.segments!.every((s) => s.tr !== null) ? 's' : null,
        }
      : { name: axis.name, unit: axis.unit };
    const csv = rawSeriesCsv({
      rows,
      axis: segAxis,
      locus: {
        kind: regionLocus ? locusKind : radiusMm > 0 ? 'sphere' : 'voxel',
        label: locusText,
        voxels,
      },
    });
    try {
      await navigator.clipboard.writeText(csv);
      getEventBus().emit('ui.notification', { type: 'info', message: 'Series copied as CSV' });
    } catch {
      getEventBus().emit('ui.notification', {
        type: 'warning',
        message: 'Could not copy to the clipboard',
      });
    }
  };
  const plotBox = useRef<HTMLDivElement>(null);
  const exportImage = async () => {
    if (!plotBox.current) return;
    try {
      const png = await populationPlotPng(plotBox.current, caption, legend);
      const saved = await savePopulationPlot(png, 'png');
      if (saved) getEventBus().emit('ui.notification', { type: 'info', message: `Saved ${saved}` });
    } catch (e) {
      getEventBus().emit('ui.notification', {
        type: 'error',
        message: `Export failed: ${(e as Error).message}`,
      });
    }
  };

  // The plot takes what the toolbar and caption leave (measured).
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = plotBox.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const next = { width: Math.floor(r.width), height: Math.floor(r.height) };
      setPlotSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const plotWidth = plotSize.width > 0 ? plotSize.width : Math.max(width - 16, 80);
  const plotHeight =
    plotSize.height > 0 ? plotSize.height : Math.max(height - (full ? 72 : 36), MIN_PLOT_H);

  const issue = regionIssue ?? (error ? error.message : null);
  return (
    <div
      data-testid="crosshair-ts-plot-body"
      className="absolute inset-0 flex min-h-0 flex-col gap-1 p-2 text-bf-xs"
    >
      {ctx.chrome || full ? (
        <Toolbar aria-label="Series" className="shrink-0 flex-wrap px-0">
          {ctx.chrome}
          {full ? <SeriesLocusControls resolvedRegion={locusKind === 'region' && !settings.regionPick ? regionLabel || null : null} /> : null}
          {full && (group || groupable.length > 1) ? (
            <ToolbarField label="Runs">
              <Select
                aria-label="Series runs"
                className="w-auto max-w-[260px]"
                // Fixed option names (v4 function 5): the choice never renames itself.
                value={settings.segments === 'off' || !group ? 'off' : settings.segments}
                onValueChange={(v) =>
                  settings.update(
                    v === 'manual'
                      ? { segments: 'manual', manualSegmentLayerIds: groupable }
                      : { segments: v as 'auto' | 'off' },
                  )
                }
                options={[
                  { value: 'off', label: 'This layer only' },
                  ...(autoAvailable ? [{ value: 'auto', label: 'Runs of this acquisition' }] : []),
                  ...(groupable.length > 1 ? [{ value: 'manual', label: 'All 4D layers on this grid' }] : []),
                ]}
              />
            </ToolbarField>
          ) : null}
          {full && group ? (
            <ToolbarField label="Layout">
              <Select
                aria-label="Runs layout"
                className="w-auto"
                value={layout}
                onValueChange={(v) => settings.update({ segmentLayout: v as SegmentLayout })}
                options={LAYOUT_OPTIONS}
              />
            </ToolbarField>
          ) : null}
        </Toolbar>
      ) : null}
      {full && issue ? (
        <SeriesIssue message={issue} action={regionIssue ? seriesIssueAction(locusKind) : null} />
      ) : null}
      {full && groupIssue ? (
        <Notice severity="warning" role="status" className="shrink-0">
          {groupIssue}
        </Notice>
      ) : null}
      {loading && !plotted ? (
        <p data-testid="crosshair-ts-loading" className="text-bf-text-muted">
          Sampling…
        </p>
      ) : null}
      {!full && error ? (
        <p data-testid="crosshair-ts-error" className="text-bf-danger">
          {error.message}
        </p>
      ) : null}
      <div className="relative min-h-[60px] flex-1">
        <div ref={plotBox} className="absolute inset-0" data-testid="raw-series-plot">
          {plotted && spec ? (
            <PlotEncoder
              frame={plotted.frame}
              spec={spec}
              width={plotWidth}
              height={plotHeight}
              context={{
                datumLink: {
                  idColumn: SEGMENT_FRAME_ID,
                  focusedId,
                  selectedIds: segmentIds,
                  onFocus: focus,
                  onToggleSelection: () => undefined,
                  // Arrow keys step frames; no selection here.
                  selectable: false,
                  activateOnMove: true,
                  label: datumLabel,
                  // A facet is entered at the shared frame, clamped to its run (v4 function).
                  entryIds: entryIds,
                  action: group ? "Click to show this run's frame" : 'Click to show this frame',
                },
              }}
            />
          ) : null}
        </div>
        <PlotFrameLegend entries={legend} label="Runs legend" />
      </div>
      {full && plotted ? (
        <div className="flex shrink-0 items-start gap-2">
          <p
            className="min-w-0 flex-1 text-bf-2xs text-bf-text-muted"
            data-testid="raw-series-caption"
          >
            {caption}
            {loading ? ' · sampling…' : ''}
          </p>
          <span className="inline-flex shrink-0 gap-1">
            <Button variant="secondary" size="sm" onClick={() => void copyCsv()}>
              Copy CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void exportImage()}>
              Export image
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Voxels of the layer's grid in a sphere locus, as sample_stack gathers them. */
function sphereCount(layerId: string | undefined, worldMm: readonly [number, number, number], radiusMm: number): number | null {
  const meta = layerId ? useLayerStore.getState().getLayerMetadata?.(layerId) : undefined;
  if (!meta?.worldToVoxel || !meta.voxelToWorld || !meta.dimensions) return null;
  try {
    const centre = transformWorldToVoxelColumnMajor(meta.worldToVoxel, [worldMm[0], worldMm[1], worldMm[2]]);
    const m = meta.voxelToWorld;
    const spacing = [0, 1, 2].map((c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2])) as [number, number, number];
    return sphereVoxelCount(centre, meta.dimensions, spacing, radiusMm);
  } catch {
    return null;
  }
}

/** Distinct hues for overlaid runs, clear of the crosshair green. */
const SEGMENT_HUES = [28, 210, 330, 265, 52, 185];
function segmentColor(i: number): string {
  return `hsl(${SEGMENT_HUES[i % SEGMENT_HUES.length]} 70% 58%)`;
}

/** "voxel ijk 10 23 30 on <layer> grid (centre −40, −20, 48 mm)": the sampled voxel, not the crosshair (round 3 S2). */
function voxelLocusText(
  layerId: string | undefined,
  layerName: string | undefined,
  crosshairMm: readonly [number, number, number],
): string {
  const voxel = resolveTimeseriesVoxel(layerId, crosshairMm);
  const vox2world = layerId ? useLayerStore.getState().getLayerMetadata?.(layerId)?.voxelToWorld : undefined;
  if (!voxel) return `voxel at ${crosshairMm.map((v) => formatWorldMm(v)).join(', ')} mm`;
  let centre: number[] | null = null;
  try {
    centre = vox2world ? transformVoxelToWorldColumnMajor(vox2world, voxel.voxel) : null;
  } catch {
    centre = null;
  }
  const grid = layerName ? ` on ${shortLayerLabel(layerName)} grid` : '';
  return `voxel ijk ${voxel.voxel.join(' ')}${grid}${centre ? ` (centre ${centre.map((v) => formatWorldMm(v)).join(', ')} mm)` : ''}`;
}

export default CrosshairTimeSeriesPlotBody;
