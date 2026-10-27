/**
 * Segmented series (phase 4 E5b): a 4D series that is several runs or
 * sessions, i.e. series axis × segment factor (within-segment time plus a
 * segment id, with per-segment frame counts and TR). Sources, most explicit
 * first:
 * - one 4D volume with a `<stem>_runs.json` sidecar
 *   (`{"factor": "run", "segments": [{"label": "run-1", "frames": 20, "tr": 2}, …]}`);
 * - several 4D layers on one grid whose BIDS entities differ only in `run` /
 *   `ses`, offered as "Runs of sub-01 task-faces", or grouped by hand.
 *
 * The layouts are three encodings of one frame, not three code paths:
 * concatenated (cumulative x, labelled boundaries), faceted (one panel per
 * segment, shared y) and overlaid (within-segment x, one line per segment).
 * Each row carries the segment (`__seriesSegment`) and the within-segment
 * time (`__seriesT`), so export and focus work the same in every layout.
 */
import type { FrameColumn, FrameRow, SampleFrame } from '@/plotting';
import { parseBidsFilename } from '@/utils/bids';

export type SegmentFactor = 'run' | 'session' | 'segment';
export type SegmentLayout = 'concatenated' | 'faceted' | 'overlaid';

export interface SeriesSegment {
  /** Stable id, BIDS style ("run-1", "ses-2"); the CSV `segment` column. */
  id: string;
  /** How it reads on screen ("run 1"). */
  label: string;
  layerId: string;
  /** First frame of the segment in its layer (a sidecar splits one volume). */
  frameStart: number;
  frames: number;
  /** Seconds per frame, or null when unknown. */
  tr: number | null;
}

export interface SegmentGroup {
  key: string;
  /** "Runs of sub-01 task-faces". */
  title: string;
  factor: SegmentFactor;
  source: 'layers' | 'sidecar' | 'manual';
  segments: SeriesSegment[];
}

/** Frame columns a segmented series adds (E5b interface). */
export const SERIES_SEGMENT = '__seriesSegment';
export const SERIES_T = '__seriesT';
/** Datum id of a sample: "<segment index>:<frame in its layer>". */
export const SEGMENT_FRAME_ID = '__frame';

/** The layer facts grouping needs (LayerInfo satisfies it). */
export interface SegmentLayer {
  id: string;
  name: string;
  sourcePath?: string;
  volumeType?: string;
  timeSeriesInfo?: { num_timepoints: number; tr: number | null } | null;
}

/** The grid two runs must share (layer metadata). */
export interface SegmentGrid {
  dimensions?: readonly number[];
  voxelToWorld?: readonly number[];
}

const frameCount = (l: SegmentLayer) => l.timeSeriesInfo?.num_timepoints ?? 0;
const trOf = (l: SegmentLayer) => {
  const tr = l.timeSeriesInfo?.tr;
  return typeof tr === 'number' && tr > 0 ? tr : null;
};

/** "run-01" → "run 1"; other ids unchanged. */
export function segmentLabel(id: string): string {
  const m = /^(run|ses)-0*(\d+)$/.exec(id);
  return m ? `${m[1] === 'ses' ? 'session' : 'run'} ${m[2]}` : id;
}

const sameGrid = (a: SegmentGrid | undefined, b: SegmentGrid | undefined) =>
  !!a &&
  !!b &&
  JSON.stringify(a.dimensions ?? null) === JSON.stringify(b.dimensions ?? null) &&
  (a.voxelToWorld ?? []).every((v, i) => Math.abs(v - (b.voxelToWorld ?? [])[i]) < 1e-4);

interface RunIdentity {
  /** Every entity but run / ses, plus the suffix. */
  key: string;
  run: string | null;
  ses: string | null;
  entities: Record<string, string>;
}

function runIdentity(path: string | undefined): RunIdentity | null {
  if (!path) return null;
  const parsed = parseBidsFilename(path);
  if (!parsed || (!parsed.entities.run && !parsed.entities.ses)) return null;
  const { run = null, ses = null, ...rest } = parsed.entities;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  // Sessions live in sibling folders (sub-01/ses-1/func): drop the ses part of the folder.
  const folder = ses ? dir.replace(new RegExp(`/ses-${ses}(?=/|$)`), '/ses-*') : dir;
  const key = JSON.stringify([folder, Object.entries(rest).sort(), parsed.suffix]);
  return { key, run, ses, entities: parsed.entities };
}

const byNumber = (a: string | null, b: string | null) =>
  (Number(a) || 0) - (Number(b) || 0) || String(a).localeCompare(String(b));

/**
 * The runs (or sessions) a 4D layer belongs to: loaded 4D layers on the same
 * grid whose BIDS names differ only in `run` / `ses`. Null when the layer is
 * alone. Ordered by session, then run.
 */
export function runGroupFor(
  layerId: string,
  layers: readonly SegmentLayer[],
  grid: (layerId: string) => SegmentGrid | undefined,
): SegmentGroup | null {
  const target = layers.find((l) => l.id === layerId);
  const id = target ? runIdentity(target.sourcePath) : null;
  if (!target || !id || frameCount(target) < 2) return null;
  const members = layers
    .filter((l) => frameCount(l) >= 2)
    .map((l) => ({ layer: l, id: runIdentity(l.sourcePath) }))
    .filter(
      (m): m is { layer: SegmentLayer; id: RunIdentity } =>
        m.id !== null &&
        m.id.key === id.key &&
        (m.layer.id === layerId || sameGrid(grid(m.layer.id), grid(layerId))),
    )
    .sort((a, b) => byNumber(a.id.ses, b.id.ses) || byNumber(a.id.run, b.id.run));
  if (members.length < 2) return null;
  const runsDiffer = new Set(members.map((m) => m.id.run)).size > 1;
  const sessionsDiffer = new Set(members.map((m) => m.id.ses)).size > 1;
  const factor: SegmentFactor = runsDiffer || !sessionsDiffer ? 'run' : 'session';
  const segments = members.map(({ layer, id: m }) => {
    const parts = [
      sessionsDiffer && m.ses ? `ses-${m.ses}` : null,
      (runsDiffer || !sessionsDiffer) && m.run ? `run-${m.run}` : null,
    ].filter((p): p is string => p !== null);
    const segmentId = parts.join('_') || layer.name;
    return {
      id: segmentId,
      label: parts.map(segmentLabel).join(', ') || layer.name,
      layerId: layer.id,
      frameStart: 0,
      frames: frameCount(layer),
      tr: trOf(layer),
    };
  });
  if (new Set(segments.map((s) => s.id)).size !== segments.length) return null;
  const e = id.entities;
  const who = [
    e.sub ? `sub-${e.sub}` : null,
    !sessionsDiffer && e.ses ? `ses-${e.ses}` : null,
    e.task ? `task-${e.task}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    key: `layers:${members.map((m) => m.layer.id).join(',')}`,
    title: `${factor === 'session' ? 'Sessions' : 'Runs'} of ${who || target.name}`,
    factor,
    source: 'layers',
    segments,
  };
}

/** Layers grouped by hand, in the order given, labelled by name. */
export function manualSegmentGroup(
  layerIds: readonly string[],
  layers: readonly SegmentLayer[],
): SegmentGroup | null {
  const members = layerIds
    .map((id) => layers.find((l) => l.id === id))
    .filter((l): l is SegmentLayer => !!l && frameCount(l) >= 2);
  if (members.length < 2) return null;
  return {
    key: `manual:${members.map((l) => l.id).join(',')}`,
    title: `${members.length} grouped layers`,
    factor: 'segment',
    source: 'manual',
    segments: members.map((l, i) => {
      const id = runIdentity(l.sourcePath);
      const segmentId = id?.run ? `run-${id.run}` : id?.ses ? `ses-${id.ses}` : `segment-${i + 1}`;
      return {
        id: segmentId,
        label: id ? segmentLabel(segmentId) : l.name,
        layerId: l.id,
        frameStart: 0,
        frames: frameCount(l),
        tr: trOf(l),
      };
    }),
  };
}

/** `<stem>_runs.json` next to a NIfTI image, or null for another file type. */
export function runsSidecarPath(imagePath: string | undefined): string | null {
  const m = imagePath ? /^(.*?)(\.nii\.gz|\.nii)$/i.exec(imagePath) : null;
  return m ? `${m[1]}_runs.json` : null;
}

/**
 * A runs sidecar for one concatenated 4D layer. Throws an Error that says
 * what is wrong (it is shown to the user) when it does not describe the layer.
 */
export function parseRunsSidecar(text: string, layer: SegmentLayer): SegmentGroup {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('The runs sidecar is not valid JSON.');
  }
  const raw = (doc as { segments?: unknown })?.segments;
  if (!Array.isArray(raw) || raw.length < 1) throw new Error('The runs sidecar lists no segments.');
  const declared = (doc as { factor?: unknown }).factor;
  const factor: SegmentFactor =
    declared === 'session'
      ? 'session'
      : declared === 'run' || declared === undefined
        ? 'run'
        : 'segment';
  let start = 0;
  const segments = raw.map((entry, i) => {
    const e = entry as { label?: unknown; frames?: unknown; tr?: unknown };
    const frames = Number(e.frames);
    if (!Number.isInteger(frames) || frames < 1)
      throw new Error(`Segment ${i + 1} of the runs sidecar needs a positive whole "frames".`);
    const tr = e.tr === undefined || e.tr === null ? trOf(layer) : Number(e.tr);
    if (tr !== null && !(Number.isFinite(tr) && tr > 0))
      throw new Error(`Segment ${i + 1} of the runs sidecar has an invalid "tr".`);
    const id =
      typeof e.label === 'string' && e.label.trim()
        ? e.label.trim()
        : `${factor === 'session' ? 'ses' : 'run'}-${i + 1}`;
    const segment: SeriesSegment = {
      id,
      label: segmentLabel(id),
      layerId: layer.id,
      frameStart: start,
      frames,
      tr,
    };
    start += frames;
    return segment;
  });
  if (start !== frameCount(layer))
    throw new Error(`The runs sidecar lists ${start} frames; the image has ${frameCount(layer)}.`);
  return {
    key: `sidecar:${layer.id}`,
    title: `${segments.length} ${factor === 'session' ? 'sessions' : factor === 'run' ? 'runs' : 'segments'} of ${layer.name}`,
    factor,
    source: 'sidecar',
    segments,
  };
}

/** One segment's sampled values (its frames only). */
export interface SegmentSamples {
  segment: SeriesSegment;
  values: readonly number[];
}

export interface SegmentedSeries {
  frame: SampleFrame;
  xTitle: string;
  /** Segment boundaries for the concatenated layout. */
  rules: { x: number; label: string }[];
  /** Half the x step (axis padding). */
  step: number;
  /** A caption clause when the layout needs one (per-segment TR scaling). */
  note: string | null;
}

/**
 * The plotted frame of a segmented series. x is seconds when every segment's
 * TR is known, else the 1-based frame (as every frame readout). Concatenated
 * segments with different TRs keep their own TR (stated in `note`); there is
 * no temporal resampling.
 */
export function segmentedSeriesFrame(
  samples: readonly SegmentSamples[],
  layout: SegmentLayout,
): SegmentedSeries {
  const seconds = samples.length > 0 && samples.every((s) => s.segment.tr !== null);
  const trs = [...new Set(samples.map((s) => s.segment.tr))];
  const rows: FrameRow[] = [];
  const rules: { x: number; label: string }[] = [];
  let offset = 0;
  samples.forEach(({ segment, values }, si) => {
    const step = seconds ? segment.tr! : 1;
    const within = (i: number) => (seconds ? i * step : i + 1);
    if (layout === 'concatenated')
      rules.push({ x: offset + within(0) - step / 2, label: segment.label });
    values.forEach((value, i) => {
      rows.push({
        t: layout === 'concatenated' ? offset + within(i) : within(i),
        value: Number.isFinite(value) ? value : null,
        [SERIES_SEGMENT]: segment.label,
        [SERIES_T]: within(i),
        [SEGMENT_FRAME_ID]: `${si}:${segment.frameStart + i}`,
      });
    });
    offset += seconds ? values.length * step : values.length;
  });
  const columns: FrameColumn[] = [
    { name: 't', role: 'temporal', ...(seconds ? { unit: 's' } : {}) },
    { name: 'value', role: 'quantitative' },
    { name: SERIES_SEGMENT, label: 'Segment', role: 'nominal' },
    {
      name: SERIES_T,
      label: 'Within-segment time',
      role: 'temporal',
      ...(seconds ? { unit: 's' } : {}),
    },
    { name: SEGMENT_FRAME_ID, role: 'index' },
  ];
  const within = layout !== 'concatenated';
  return {
    frame: { columns, rows, meta: { segmented: true, layout } },
    xTitle: seconds ? (within ? 'Time in run (s)' : 'Time (s)') : within ? 'Frame in run' : 'Frame',
    rules,
    step: seconds ? Math.min(...samples.map((s) => s.segment.tr!)) : 1,
    note:
      layout === 'concatenated' && seconds && trs.length > 1
        ? `concatenated in seconds, each segment at its own TR (${trs.map((t) => `${t} s`).join(', ')})`
        : null,
  };
}

/** Which segment holds frame `timepoint` of `layerId`, and its 1-based frame in it. */
export function segmentAt(
  group: SegmentGroup,
  layerId: string | undefined,
  timepoint: number,
): { segment: SeriesSegment; index: number; frame: number } | null {
  const index = group.segments.findIndex(
    (s) =>
      s.layerId === layerId && timepoint >= s.frameStart && timepoint < s.frameStart + s.frames,
  );
  if (index < 0) return null;
  const segment = group.segments[index];
  return { segment, index, frame: timepoint - segment.frameStart + 1 };
}

const csvCell = (v: unknown) => {
  const text = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * A raw 4D series as CSV, one header row: segment (when segmented),
 * volume_index (0-based index in the segment's image), t_within_s, t_s, value,
 * then the locus and the layer, so CSVs from several loci stack.
 */
export function rawSeriesCsv(input: {
  rows: readonly {
    segment: string | null;
    volumeIndex: number;
    tWithin: number | null;
    t: number | null;
    value: number | null;
    layer: string;
  }[];
  axis: { name: string; unit: string | null };
  locus: { kind: string; label: string; voxels: number | null };
}): string {
  const segmented = input.rows.some((r) => r.segment !== null);
  const unit = input.axis.unit ? `_${input.axis.unit}` : '';
  const header = [
    ...(segmented ? ['segment'] : []),
    'volume_index',
    ...(segmented ? [`${input.axis.name}_within${unit}`] : []),
    `${input.axis.name}${unit}`,
    'value',
    'locus_kind',
    'locus_label',
    'n_voxels',
    'layer',
  ];
  const lines = input.rows.map((r) =>
    [
      ...(segmented ? [r.segment ?? ''] : []),
      r.volumeIndex,
      ...(segmented ? [r.tWithin ?? ''] : []),
      r.t ?? '',
      r.value ?? '',
      input.locus.kind,
      input.locus.label.replace(/[−−–]/g, '-'),
      input.locus.voxels ?? '',
      r.layer,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}
