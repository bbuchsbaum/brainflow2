import type { SampleFrame, FrameRow, ResolvedPlotSpec } from '@/plotting';
import {
  INTERVAL_COLUMNS,
  INTERVAL_PRESETS,
  NO_INTERVAL,
  computeInterval,
  computedInterval,
  fromRecipeBandV1,
  intervalChoiceError,
  intervalDefinition,
  intervalDef,
  intervalFitsCentre,
  meanOf,
  spreadOf,
  type IntervalChoice,
  type IntervalSpec,
} from '@/plotting/intervals';
import { sampleQuantile } from '@/utils/distributions';

/**
 * Declared collapse transforms (phase 4 E4), applied per participant line
 * after the within-participant reduction and before the population stage,
 * in the order listed:
 * - `baseline`: subtract the line's mean over positions in [from, to]
 *   (a pre-onset window);
 * - `conditionDifference`: A − B per participant at each position (paired;
 *   participants lacking either side are dropped and counted);
 * - `windowMean`: the line's mean over positions in [from, to], collapsing
 *   the axis to that window.
 */
export type PopulationTransform =
  | { kind: 'baseline'; from: number; to: number }
  | { kind: 'conditionDifference'; column: string; a: string; b: string }
  | {
      kind: 'windowMean';
      from: number;
      to: number;
      /**
       * Where the window came from: set from the data (the peak of the
       * condition-averaged curve) rather than typed. Absent = declared by the
       * user. Stated in captions and exports (round 2 S1: circularity).
       */
      source?: 'condition-averaged-peak';
    };

/** What each transform did, kept in the frame's provenance (meta). */
export interface PopulationTransformRecord {
  transform: PopulationTransform;
  /** The axis the window is on: its label ("Lag") and unit ("TR"). */
  axis?: { label: string; unit: string };
  /** Participant lines in / out. */
  linesIn: number;
  linesOut: number;
  /** Lines dropped (no baseline / window positions, or an unpaired condition). */
  dropped: string[];
}

export interface PopulationPlotRecipe {
  version: 2;
  x: string;
  axis: 'category' | 'number' | 'time';
  axisUnit: string;
  color: string | null;
  facet: string | null;
  detail: string | null;
  mark: 'point' | 'line' | 'box';
  /** Population stage centre: participant mean or median (E4). */
  summary: 'none' | 'mean' | 'median';
  /**
   * Band around the centre, from the interval registry
   * (docs/plans/interval-kinds.md). With `source: 'compute'` the population
   * stage computes it per position; with `source: 'columns'` the frame already
   * holds one summary row per position and its stored bounds are drawn as
   * given, never recomputed.
   */
  band: IntervalSpec;
  /** Repeated rows at one participant/position: reject (`single`) or average (`mean`). `within` in v1. */
  repeatRows: 'single' | 'mean';
  /** Declared collapse transforms (E4); absent = none. */
  transforms?: PopulationTransform[];
}
export const defaultPopulationPlotRecipe: PopulationPlotRecipe = {
  version: 2,
  x: 'member',
  axis: 'category',
  axisUnit: '',
  color: null,
  facet: null,
  detail: null,
  mark: 'point',
  summary: 'none',
  band: NO_INTERVAL,
  repeatRows: 'single',
};

/**
 * A recipe from a study save or plot file, as the current version. v1 bands
 * are translated through the recipe's own legacy table (`ci95` was the t
 * interval here, unlike on a set trace) and `within` becomes `repeatRows`.
 * Validation against a frame stays with {@link validatePlotRecipe}.
 */
export function upgradePlotRecipe(raw: unknown): PopulationPlotRecipe {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('Unsupported population plot recipe.');
  if (r.version === 2) return r as unknown as PopulationPlotRecipe;
  if (r.version !== 1) throw new Error('Unsupported population plot recipe.');
  const choice = fromRecipeBandV1(r.band);
  if (!choice) throw new Error(`Unsupported population plot band: ${String(r.band)}`);
  const { within, ...rest } = r;
  return { ...rest, version: 2, band: computedInterval(choice), repeatRows: within } as unknown as PopulationPlotRecipe;
}

/** The bands the population plot offers, in menu order (disabled where they don't fit the centre). */
export const POPULATION_BAND_CHOICES: readonly IntervalChoice[] = [
  INTERVAL_PRESETS.none,
  INTERVAL_PRESETS.sd,
  INTERVAL_PRESETS.ciNormal95,
  INTERVAL_PRESETS.ciT95,
  INTERVAL_PRESETS.iqr,
];

/**
 * Keep a band choice valid for the centre (three surfaces share this): a kind
 * that fits is kept, `none` stays `none`, anything else becomes the centre's
 * conventional band (t CI for a mean, IQR for a median).
 */
export function bandForCentre(choice: IntervalChoice, centre: 'mean' | 'median'): IntervalChoice {
  if (choice.kind === 'none' || intervalFitsCentre(choice.kind, centre)) return choice;
  return centre === 'median' ? INTERVAL_PRESETS.iqr : INTERVAL_PRESETS.ciT95;
}

/** The band against the registry, the summary and the frame's columns. */
function validateBand(names: ReadonlySet<string>, r: PopulationPlotRecipe) {
  const b = r.band as Partial<IntervalSpec> | undefined;
  if (!b || typeof b !== 'object' || (b.source !== 'compute' && b.source !== 'columns'))
    throw new Error('Unsupported population plot band.');
  const error = intervalChoiceError(b);
  if (error) throw new Error(error);
  const kind = b.kind!;
  if (b.source === 'columns') {
    if (r.summary === 'none') throw new Error('Stored bounds go with a summary centre (mean or median).');
    if (kind === 'none')
      throw new Error('Stored bounds need an interval kind (custom when the definition is not a known kind).');
    for (const c of [b.lower, b.upper])
      if (!c || !names.has(c)) throw new Error(`Interval bound column is unavailable: ${c ?? '(unnamed)'}`);
    if (r.transforms?.length)
      throw new Error('Declared transforms apply to participant rows, not to stored summaries.');
    // The stored centre is what the producer computed; the summary only names it.
    if (!intervalFitsCentre(kind, r.summary))
      throw new Error(`Stored ${kind} bounds describe a ${intervalDef(kind).centre}; the summary must say so.`);
    return;
  }
  if (kind === 'custom') throw new Error('A custom interval is drawn from stored bounds only.');
  if (kind === 'wsci_cm')
    throw new Error('The within-subject CI needs a declared design; draw stored bounds instead.');
  if (kind === 'heuristic_se')
    throw new Error('The heuristic voxel-SE band needs voxel standard errors; draw stored bounds instead.');
  if (r.summary !== 'none' && kind !== 'none' && !intervalFitsCentre(kind, r.summary))
    throw new Error(
      r.summary === 'median'
        ? 'A median summary takes a quantile band (or none).'
        : 'Quantile bands go with a median summary.',
    );
}
export function validatePlotRecipe(frame: SampleFrame, r: PopulationPlotRecipe) {
  if (
    !Array.isArray(frame?.columns) ||
    !Array.isArray(frame.rows) ||
    frame.columns.some(
      (c) =>
        !c ||
        typeof c.name !== 'string' ||
        !c.name.trim() ||
        !['quantitative', 'nominal', 'ordinal', 'temporal', 'index'].includes(c.role) ||
        (c.unit !== undefined && typeof c.unit !== 'string') ||
        (c.label !== undefined && typeof c.label !== 'string'),
    ) ||
    frame.rows.some(
      (row) =>
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.values(row).some(
          (v) =>
            v !== null &&
            (!['string', 'number'].includes(typeof v) ||
              (typeof v === 'number' && !Number.isFinite(v))),
        ),
    )
  )
    throw new Error('Invalid tabular plot samples.');
  const names = new Set(frame.columns.map((c) => c.name));
  if (names.size !== frame.columns.length || !names.has('member') || !names.has('value'))
    throw new Error('Plot samples require unique columns including member and value.');
  if (r.summary !== 'none' && r.mark === 'box')
    throw new Error(
      'Use points or trajectories for summary means; distributions show individuals.',
    );
  if (
    r.version !== 2 ||
    !['category', 'number', 'time'].includes(r.axis) ||
    !['point', 'line', 'box'].includes(r.mark) ||
    !['none', 'mean', 'median'].includes(r.summary) ||
    !['single', 'mean'].includes(r.repeatRows) ||
    (r.transforms !== undefined && !Array.isArray(r.transforms))
  )
    throw new Error('Unsupported population plot recipe.');
  validateBand(names, r);
  const stored = r.band.source === 'columns';
  const transforms = r.transforms ?? [];
  if (transforms.length && !r.detail)
    throw new Error('Choose a participant identity before declaring collapse transforms.');
  for (const t of transforms) {
    if (t?.kind === 'baseline' || t?.kind === 'windowMean') {
      if (r.axis === 'category')
        throw new Error('Baseline and window transforms need a measured (number or time) axis.');
      if (!Number.isFinite(t.from) || !Number.isFinite(t.to) || t.from > t.to)
        throw new Error('A transform window needs finite bounds, from ≤ to.');
      if (t.kind === 'windowMean' && r.mark === 'line')
        throw new Error('A window mean collapses the axis: use points.');
    } else if (t?.kind === 'conditionDifference') {
      if (!names.has(t.column)) throw new Error(`Plot column is unavailable: ${t.column}`);
      if (t.column === r.x || t.column === r.detail)
        throw new Error('A condition difference pairs levels of a condition column, not the axis or participant.');
      if (!t.a || !t.b || t.a === t.b) throw new Error('Choose two different conditions to subtract.');
    } else {
      throw new Error('Unsupported population transform.');
    }
  }
  for (const c of [r.x, r.color, r.facet, r.detail])
    if (c !== null && !names.has(c)) throw new Error(`Plot column is unavailable: ${c}`);
  if (r.axis === 'time' && (typeof r.axisUnit !== 'string' || !r.axisUnit.trim()))
    throw new Error('A time axis requires declared measured times and units.');
  if (r.mark === 'line' && r.summary === 'none' && !r.detail)
    throw new Error('Choose a participant/line identity before drawing individual trajectories.');
  if (r.summary !== 'none' && !r.detail && !stored)
    throw new Error('Choose a participant identity before calculating population summaries.');
}
/**
 * The transform stages in contract order (REVIEW m5): baseline, then the
 * condition difference, then the window mean (which turns the axis into a
 * label). A recipe in another order is applied in this one, never in array
 * order, so no stage can silently drop the lines of a later one.
 */
export const TRANSFORM_STAGE: Readonly<Record<PopulationTransform['kind'], number>> = {
  baseline: 0,
  conditionDifference: 1,
  windowMean: 2,
};

/** The recipe's transforms in stage order (stable within a stage). */
export function orderedTransforms(transforms: readonly PopulationTransform[] | undefined): PopulationTransform[] {
  return [...(transforms ?? [])].sort((a, b) => TRANSFORM_STAGE[a.kind] - TRANSFORM_STAGE[b.kind]);
}

/**
 * Columns a condition difference pairs on that no encoding carries (REVIEW
 * M1): the within-participant cells and the transform lines keep their levels
 * apart, so A and B are not averaged together before they are paired.
 */
function pairedColumns(r: PopulationPlotRecipe): string[] {
  return (r.transforms ?? [])
    .filter((t): t is Extract<PopulationTransform, { kind: 'conditionDifference' }> => t.kind === 'conditionDifference')
    .map((t) => t.column)
    .filter((c) => c !== r.color && c !== r.facet && c !== r.detail && c !== r.x);
}

/** Cached tidy samples -> view. Appearance and regrouping never perform image I/O. */
export function composePopulationPlot(
  frame: SampleFrame,
  r: PopulationPlotRecipe,
): { frame: SampleFrame; spec: ResolvedPlotSpec; summary: boolean } {
  validatePlotRecipe(frame, r);
  const key = cellKey;
  const rows = frame.rows.map((row) => {
    const value = row[r.x];
    if (r.axis === 'category' || value === null) return { ...row };
    if (value === '' || value === undefined || !Number.isFinite(Number(value)))
      throw new Error(`The ${r.x} axis contains an invalid measured value.`);
    return { ...row, [r.x]: Number(value) };
  });
  const columns = frame.columns.map((c) =>
    c.name === r.x
      ? {
          ...c,
          role:
            r.axis === 'category'
              ? ('nominal' as const)
              : r.axis === 'time'
                ? ('temporal' as const)
                : ('quantitative' as const),
          unit: r.axisUnit || undefined,
        }
      : c,
  );
  if (r.mark === 'line' && r.axis !== 'category')
    rows.sort((a, b) => Number(a[r.x]) - Number(b[r.x]));
  if (r.band.source === 'columns') return storedSummary(frame, columns, rows, r);
  const transforms = orderedTransforms(r.transforms);
  const paired = pairedColumns(r);
  if (r.mark === 'line' || r.summary !== 'none' || transforms.length) {
    const cells = new Map<string, FrameRow[]>();
    for (const row of rows) {
      if (row[r.detail!] === null || row[r.detail!] === undefined || row[r.detail!] === '')
        throw new Error('Every plotted observation needs an explicit participant/line identity.');
      const k = key(row, [r.x, r.color, r.facet, r.detail, ...paired]);
      cells.set(k, [...(cells.get(k) ?? []), row]);
    }
    if (r.repeatRows === 'single' && [...cells.values()].some((cell) => cell.length > 1))
      throw new Error(
        'Repeated rows at one participant/axis position require an explicit within-participant mean.',
      );
    let reduced: ReducedRow[] = [...cells.values()].map((cell) => {
      const values = finite(cell);
      return {
        ...cell[0],
        value: values.length ? meanOf(values) : null,
        __contributors: JSON.stringify(cell.map((v) => v.member)),
      };
    });
    let outColumns: SampleFrame['columns'] = columns;
    const records: PopulationTransformRecord[] = [];
    const axisColumn = columns.find((c) => c.name === r.x);
    const axis = { label: axisColumn?.label ?? r.x, unit: r.axisUnit };
    for (const t of transforms) {
      const applied = applyTransform(reduced, outColumns, t, r);
      reduced = applied.rows;
      outColumns = applied.columns;
      records.push({ ...applied.record, axis });
    }
    const provenance = transforms.length ? { populationTransforms: records } : {};
    if (r.summary !== 'none') {
      const groups = new Map<string, ReducedRow[]>();
      reduced.forEach((row) => {
        const k = key(row, [r.x, r.color, r.facet]);
        groups.set(k, [...(groups.get(k) ?? []), row]);
      });
      const summaries = [...groups.values()].map((cell) => {
        const values = finite(cell);
        const { centre, lower, upper, df } = populationStage(values, r.summary as 'mean' | 'median', r.band);
        // SD and SE travel with every summary row (effect sizes, meta-analysis).
        const spread = spreadOf(values);
        return {
          ...Object.fromEntries(
            outColumns.map((c) => [
              c.name,
              [r.x, r.color, r.facet].includes(c.name) ? cell[0][c.name] : null,
            ]),
          ),
          member: null,
          value: centre,
          lower,
          upper,
          [INTERVAL_COLUMNS.n]: values.length,
          sd: spread?.sd ?? null,
          se: spread?.se ?? null,
          ...intervalCells(r.band, df),
          __contributors: JSON.stringify(
            cell.flatMap((v) => JSON.parse(v.__contributors) as string[]),
          ),
        };
      });
      return {
        frame: {
          ...frame,
          columns: summaryColumns(outColumns),
          rows: summaries,
          meta: {
            ...frame.meta,
            ...provenance,
            populationReduction: reductionRecord(r),
          },
        },
        spec: plotSpec(r, true),
        summary: true,
      };
    }
    return {
      frame: { ...frame, columns: outColumns, rows: reduced, meta: { ...frame.meta, ...provenance } },
      spec: plotSpec(r, false),
      summary: false,
    };
  }
  return { frame: { ...frame, columns, rows }, spec: plotSpec(r, false), summary: false };
}

type ReducedRow = FrameRow & { __contributors: string };

/** Columns the population stage adds to each summary row, with per-row interval metadata. */
const SUMMARY_COLUMNS: readonly SampleFrame['columns'][number][] = [
  { name: 'lower', role: 'quantitative' },
  { name: 'upper', role: 'quantitative' },
  { name: INTERVAL_COLUMNS.n, role: 'quantitative' },
  { name: 'sd', role: 'quantitative' },
  { name: 'se', role: 'quantitative' },
  { name: INTERVAL_COLUMNS.kind, role: 'nominal' },
  { name: INTERVAL_COLUMNS.level, role: 'quantitative' },
  { name: INTERVAL_COLUMNS.df, role: 'quantitative' },
];
const SUMMARY_NAMES = new Set(SUMMARY_COLUMNS.map((c) => c.name));

const summaryColumns = (columns: SampleFrame['columns']): SampleFrame['columns'] => [
  ...columns.filter((c) => !SUMMARY_NAMES.has(c.name)),
  ...SUMMARY_COLUMNS,
];

/** The per-row interval cells: what the band is, at which level, on how many df. */
const intervalCells = (band: IntervalChoice, df: number | null | undefined) => ({
  [INTERVAL_COLUMNS.kind]: band.kind,
  [INTERVAL_COLUMNS.level]: band.level ?? null,
  [INTERVAL_COLUMNS.df]: df ?? null,
});

const cellKey = (row: FrameRow, fields: (string | null)[]) =>
  JSON.stringify(fields.map((f) => (f ? (row[f] ?? null) : null)));

const finite = (cell: readonly FrameRow[]) =>
  cell.map((v) => v.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

const finiteOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The population stage over one position's participant values: centre
 * (mean / median) and band, through the interval registry. Bands need two or
 * more participants and a kind that fits the centre.
 */
export function populationStage(
  values: readonly number[],
  summary: 'mean' | 'median',
  band: IntervalChoice,
): { centre: number | null; lower: number | null; upper: number | null; df: number | null } {
  if (!values.length) return { centre: null, lower: null, upper: null, df: null };
  const centre = summary === 'median' ? sampleQuantile(values, 0.5) : meanOf(values);
  const bounds = intervalFitsCentre(band.kind, summary) ? computeInterval(band, values, centre) : null;
  return { centre, lower: bounds?.lower ?? null, upper: bounds?.upper ?? null, df: bounds?.df ?? null };
}

/**
 * Summary rows supplied with their bounds (`band.source: 'columns'`): one row
 * per plotted position, drawn as given. Each row's own interval metadata wins
 * over the recipe's declaration.
 */
function storedSummary(
  frame: SampleFrame,
  columns: SampleFrame['columns'],
  rows: FrameRow[],
  r: PopulationPlotRecipe,
): { frame: SampleFrame; spec: ResolvedPlotSpec; summary: boolean } {
  const seen = new Set<string>();
  for (const row of rows) {
    const k = cellKey(row, [r.x, r.color, r.facet]);
    if (seen.has(k))
      throw new Error('Stored bounds need one summary row per plotted position; this frame repeats a position.');
    seen.add(k);
  }
  const { kind: kindCol, level: levelCol, df: dfCol, n: nCol } = INTERVAL_COLUMNS;
  const summaries = rows.map((row) => {
    const ownKind = typeof row[kindCol] === 'string' && row[kindCol] !== '' ? row[kindCol] : null;
    // The declared level belongs to the declared kind only; a row of another
    // kind without its own level keeps none (labelled from its own words).
    const level = finiteOrNull(row[levelCol]) ?? (ownKind === null || ownKind === r.band.kind ? r.band.level : null);
    return {
    ...row,
    lower: finiteOrNull(row[r.band.lower!]),
    upper: finiteOrNull(row[r.band.upper!]),
    [nCol]: finiteOrNull(row[nCol]),
    sd: finiteOrNull(row.sd),
    se: finiteOrNull(row.se),
    [kindCol]: ownKind ?? r.band.kind,
    [levelCol]: level ?? null,
    [dfCol]: finiteOrNull(row[dfCol]),
    __contributors: '[]',
    };
  });
  return {
    frame: {
      ...frame,
      columns: summaryColumns(columns),
      rows: summaries,
      meta: { ...frame.meta, populationReduction: reductionRecord(r) },
    },
    spec: plotSpec(r, true),
    summary: true,
  };
}

/** How the population stage reduced participants (frame provenance). */
function reductionRecord(r: PopulationPlotRecipe) {
  const stored = r.band.source === 'columns';
  return {
    centre: r.summary,
    interval: r.band,
    weight: stored ? 'stored summaries' : 'equal per participant',
    repeatRows: r.repeatRows,
    bandDefinition: intervalDefinition(r.band, r.summary === 'none' ? undefined : r.summary),
  };
}

/** One declared transform over the reduced participant rows. */
function applyTransform(
  rows: ReducedRow[],
  columns: SampleFrame['columns'],
  t: PopulationTransform,
  r: PopulationPlotRecipe,
): { rows: ReducedRow[]; columns: SampleFrame['columns']; record: PopulationTransformRecord } {
  const lineKey = (row: FrameRow, except: string | null = null) =>
    JSON.stringify(
      [r.color, r.facet, r.detail, ...pairedColumns(r)]
        .filter((f): f is string => !!f && f !== except)
        .map((f) => row[f] ?? null),
    );
  const lines = new Map<string, ReducedRow[]>();
  for (const row of rows) {
    const k = lineKey(row);
    lines.set(k, [...(lines.get(k) ?? []), row]);
  }
  const label = (row: FrameRow) => String(row[r.detail!]);
  const inWindow = (row: FrameRow, from: number, to: number) => {
    const x = Number(row[r.x]);
    return Number.isFinite(x) && x >= from && x <= to;
  };
  if (t.kind === 'baseline' || t.kind === 'windowMean') {
    const out: ReducedRow[] = [];
    const dropped: string[] = [];
    for (const line of lines.values()) {
      const window = finite(line.filter((row) => inWindow(row, t.from, t.to)));
      if (!window.length) {
        dropped.push(label(line[0]));
        continue;
      }
      const level = meanOf(window);
      if (t.kind === 'baseline') {
        for (const row of line)
          out.push({ ...row, value: typeof row.value === 'number' ? row.value - level : null });
      } else {
        out.push({
          ...line[0],
          [r.x]: windowLabel(t.from, t.to, r.axisUnit),
          value: level,
          __contributors: JSON.stringify(line.flatMap((row) => JSON.parse(row.__contributors) as string[])),
        });
      }
    }
    const outColumns =
      t.kind === 'windowMean'
        ? columns.map((c) => (c.name === r.x ? { ...c, role: 'nominal' as const, unit: undefined } : c))
        : columns;
    return {
      rows: out,
      columns: outColumns,
      record: { transform: t, linesIn: lines.size, linesOut: lines.size - dropped.length, dropped },
    };
  }
  // conditionDifference: pair A and B rows of each participant at each position.
  const pairKey = (row: FrameRow) =>
    JSON.stringify([
      row[r.x] ?? null,
      ...[r.color, r.facet, r.detail, ...pairedColumns(r)]
        .filter((f): f is string => !!f && f !== t.column)
        .map((f) => row[f] ?? null),
    ]);
  const pairs = new Map<string, { a?: ReducedRow; b?: ReducedRow }>();
  for (const row of rows) {
    const side = row[t.column] === t.a ? 'a' : row[t.column] === t.b ? 'b' : null;
    if (!side) continue;
    const k = pairKey(row);
    pairs.set(k, { ...pairs.get(k), [side]: row });
  }
  const participants = new Set(rows.filter((row) => [t.a, t.b].includes(String(row[t.column]))).map(label));
  const unpaired = new Set<string>();
  const out: ReducedRow[] = [];
  for (const { a, b } of pairs.values()) {
    if (!a || !b) {
      unpaired.add(label((a ?? b)!));
      continue;
    }
    const value =
      typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : null;
    out.push({
      ...a,
      [t.column]: `${t.a} − ${t.b}`,
      value,
      __contributors: JSON.stringify([
        ...(JSON.parse(a.__contributors) as string[]),
        ...(JSON.parse(b.__contributors) as string[]),
      ]),
    });
  }
  const kept = new Set(out.map(label));
  return {
    rows: out,
    columns,
    record: {
      transform: t,
      linesIn: participants.size,
      linesOut: kept.size,
      dropped: [...unpaired].sort(),
    },
  };
}

function windowLabel(from: number, to: number, unit: string): string {
  return `${from}–${to}${unit ? ` ${unit}` : ''}`;
}

function plotSpec(r: PopulationPlotRecipe, summary: boolean): ResolvedPlotSpec {
  return {
    mark: r.mark,
    encoding: {
      x: r.x,
      y: 'value',
      color: r.color ?? undefined,
      facet: r.facet ?? undefined,
      detail: summary ? undefined : (r.detail ?? undefined),
    },
    transforms: [],
    params: {
      jitter:
        !summary &&
        r.mark === 'point' &&
        r.axis === 'category' &&
        !(r.transforms ?? []).some((t) => t.kind === 'windowMean') &&
        r.x !== 'member' &&
        r.x !== '__populationObservation',
    },
    ...(summary && r.band.kind !== 'none' ? { band: { lower: 'lower', upper: 'upper' } } : {}),
  };
}

/** "lag 0 TR", "lags 1–3 TR", "t 0–4 s": a transform window on its axis. */
export function axisWindowText(from: number, to: number, axis?: { label: string; unit: string }): string {
  const label = (axis?.label ?? '').toLowerCase();
  const noun = label === 'time' ? 't' : label;
  const plural = noun === 'lag' ? 'lags' : noun;
  const num = (v: number) => String(v).replace('-', '−');
  const unit = axis?.unit ? ` ${axis.unit}` : '';
  const span = from === to ? num(from) : `${num(from)}–${num(to)}`;
  const word = from === to ? noun : plural;
  return `${word ? `${word} ` : ''}${span}${unit}`;
}

/**
 * The declared transforms as a clause from the frame's provenance:
 * "baseline: lag 0 TR subtracted per participant; faces − houses, paired;
 * window lags 1–3 TR from the condition-averaged peak (data-driven)".
 * Empty when there are none.
 */
export function populationTransformSummary(frame: SampleFrame): string {
  const records = frame.meta?.populationTransforms as PopulationTransformRecord[] | undefined;
  if (!records?.length) return '';
  return records
    .map(({ transform: t, linesIn, linesOut, axis }) => {
      const kept = linesOut < linesIn ? ` (${linesOut} of ${linesIn} lines kept)` : '';
      if (t.kind === 'baseline')
        return `baseline: ${axisWindowText(t.from, t.to, axis)} subtracted per participant${kept}`;
      if (t.kind === 'windowMean')
        return `window ${axisWindowText(t.from, t.to, axis)}${t.source === 'condition-averaged-peak' ? ' from the condition-averaged peak (data-driven)' : ''}${kept}`;
      return `${t.a} − ${t.b}, paired${linesOut < linesIn ? ` (${linesOut} of ${linesIn} participants paired)` : ''}`;
    })
    .join('; ');
}

/**
 * A window around the peak of the condition-AVERAGED curve, ± one axis step
 * (round 2 S1): each condition's mean at each position, averaged with equal
 * weight per condition, so the window favours no condition. Only offered on
 * request and labelled data-driven; never a silent default. Null without a
 * numeric axis.
 */
export function conditionAveragedPeakWindow(
  frame: SampleFrame,
  r: Pick<PopulationPlotRecipe, 'x' | 'color'> | PopulationPlotRecipe,
): [number, number] | null {
  // With the full recipe (REVIEW m12): the curve after the within-participant
  // mean and the declared stages before the window, as population means, so
  // each participant counts once and a baseline or difference is respected.
  let rows = frame.rows;
  if ('detail' in r && r.detail) {
    try {
      rows = composePopulationPlot(frame, {
        ...r,
        mark: 'line',
        summary: 'mean',
        band: NO_INTERVAL,
        repeatRows: 'mean',
        transforms: orderedTransforms(r.transforms).filter((t) => t.kind !== 'windowMean'),
      }).frame.rows;
    } catch {
      rows = frame.rows;
    }
  }
  const cells = new Map<number, Map<string, { s: number; n: number }>>();
  for (const row of rows) {
    const x = Number(row[r.x]);
    const v = row.value;
    if (!Number.isFinite(x) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    const level = r.color ? String(row[r.color] ?? '(missing)') : '';
    const byLevel = cells.get(x) ?? new Map<string, { s: number; n: number }>();
    const cell = byLevel.get(level) ?? { s: 0, n: 0 };
    cell.s += v;
    cell.n += 1;
    byLevel.set(level, cell);
    cells.set(x, byLevel);
  }
  const xs = [...cells.keys()].sort((a, b) => a - b);
  if (!xs.length) return null;
  let peak = xs[0];
  let best = -Infinity;
  for (const x of xs) {
    const means = [...cells.get(x)!.values()].map(({ s, n }) => s / n);
    const avg = Math.abs(meanOf(means));
    if (avg > best) [best, peak] = [avg, x];
  }
  const step = xs.length > 1 ? Math.min(...xs.slice(1).map((x, i) => x - xs[i])) : 1;
  return [Math.max(xs[0], peak - step), Math.min(xs[xs.length - 1], peak + step)];
}
