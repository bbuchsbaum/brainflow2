import type { SampleFrame, FrameRow, ResolvedPlotSpec } from '@/plotting';
import { sampleQuantile, tQuantile } from '@/utils/distributions';

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
  | { kind: 'windowMean'; from: number; to: number };

/** What each transform did, kept in the frame's provenance (meta). */
export interface PopulationTransformRecord {
  transform: PopulationTransform;
  /** Participant lines in / out. */
  linesIn: number;
  linesOut: number;
  /** Lines dropped (no baseline / window positions, or an unpaired condition). */
  dropped: string[];
}

export interface PopulationPlotRecipe {
  version: 1;
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
   * Band around the centre: SD; mean ± 1.96 SE (normal approximation); the
   * t-based 95% CI of the mean (t quantile, n − 1 df); or the IQR (median).
   */
  band: 'none' | 'sd' | 'sem95' | 'ci95' | 'iqr';
  within: 'single' | 'mean';
  /** Declared collapse transforms (E4); absent = none. */
  transforms?: PopulationTransform[];
}
export const defaultPopulationPlotRecipe: PopulationPlotRecipe = {
  version: 1,
  x: 'member',
  axis: 'category',
  axisUnit: '',
  color: null,
  facet: null,
  detail: null,
  mark: 'point',
  summary: 'none',
  band: 'none',
  within: 'single',
};
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
    r.version !== 1 ||
    !['category', 'number', 'time'].includes(r.axis) ||
    !['point', 'line', 'box'].includes(r.mark) ||
    !['none', 'mean', 'median'].includes(r.summary) ||
    !['none', 'sd', 'sem95', 'ci95', 'iqr'].includes(r.band) ||
    !['single', 'mean'].includes(r.within) ||
    (r.transforms !== undefined && !Array.isArray(r.transforms))
  )
    throw new Error('Unsupported population plot recipe.');
  if (r.summary === 'median' && !['none', 'iqr'].includes(r.band))
    throw new Error('A median summary takes the IQR band (or none).');
  if (r.summary === 'mean' && r.band === 'iqr')
    throw new Error('The IQR band goes with a median summary.');
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
  if (r.summary !== 'none' && !r.detail)
    throw new Error('Choose a participant identity before calculating population summaries.');
}
/** Cached tidy samples -> view. Appearance and regrouping never perform image I/O. */
export function composePopulationPlot(
  frame: SampleFrame,
  r: PopulationPlotRecipe,
): { frame: SampleFrame; spec: ResolvedPlotSpec; summary: boolean } {
  validatePlotRecipe(frame, r);
  const key = (row: FrameRow, fields: (string | null)[]) =>
    JSON.stringify(fields.map((f) => (f ? (row[f] ?? null) : null)));
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
  const transforms = r.transforms ?? [];
  if (r.mark === 'line' || r.summary !== 'none' || transforms.length) {
    const cells = new Map<string, FrameRow[]>();
    for (const row of rows) {
      if (row[r.detail!] === null || row[r.detail!] === undefined || row[r.detail!] === '')
        throw new Error('Every plotted observation needs an explicit participant/line identity.');
      const k = key(row, [r.x, r.color, r.facet, r.detail]);
      cells.set(k, [...(cells.get(k) ?? []), row]);
    }
    if (r.within === 'single' && [...cells.values()].some((cell) => cell.length > 1))
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
    for (const t of transforms) {
      const applied = applyTransform(reduced, outColumns, t, r);
      reduced = applied.rows;
      outColumns = applied.columns;
      records.push(applied.record);
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
        const { centre, lower, upper } = populationStage(values, r.summary as 'mean' | 'median', r.band);
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
          count: values.length,
          __contributors: JSON.stringify(
            cell.flatMap((v) => JSON.parse(v.__contributors) as string[]),
          ),
        };
      });
      return {
        frame: {
          ...frame,
          columns: [
            ...outColumns.filter((c) => !['lower', 'upper', 'count'].includes(c.name)),
            ...['lower', 'upper', 'count'].map((name) => ({ name, role: 'quantitative' as const })),
          ],
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

const finite = (cell: readonly FrameRow[]) =>
  cell.map((v) => v.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

/** Running mean (stable; equal weight per value). */
const meanOf = (values: readonly number[]) => values.reduce((m, v, i) => m + (v - m) / (i + 1), 0);

/**
 * The population stage over one position's participant values: centre
 * (mean / median) and band. Bands need two or more participants.
 */
export function populationStage(
  values: readonly number[],
  summary: 'mean' | 'median',
  band: PopulationPlotRecipe['band'],
): { centre: number | null; lower: number | null; upper: number | null } {
  const n = values.length;
  if (!n) return { centre: null, lower: null, upper: null };
  if (summary === 'median') {
    const centre = sampleQuantile(values, 0.5);
    if (band !== 'iqr' || n < 2) return { centre, lower: null, upper: null };
    return { centre, lower: sampleQuantile(values, 0.25), upper: sampleQuantile(values, 0.75) };
  }
  const mean = meanOf(values);
  const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
  const spread =
    band === 'none' || sd === null
      ? null
      : band === 'sd'
        ? sd
        : band === 'sem95'
          ? (1.96 * sd) / Math.sqrt(n)
          : band === 'ci95'
            ? (tQuantile(0.975, n - 1) * sd) / Math.sqrt(n)
            : null;
  return { centre: mean, lower: spread === null ? null : mean - spread, upper: spread === null ? null : mean + spread };
}

/** How the population stage reduced participants (frame provenance). */
function reductionRecord(r: PopulationPlotRecipe) {
  return {
    centre: r.summary,
    band: r.band,
    weight: 'equal per participant',
    within: r.within,
    bandDefinition:
      r.band === 'ci95'
        ? 'mean ± t(0.975, n − 1) · SD / √n'
        : r.band === 'sem95'
          ? 'mean ± 1.96 · SD / √n (normal approximation)'
          : r.band === 'sd'
            ? 'mean ± SD (n − 1)'
            : r.band === 'iqr'
              ? '25th–75th percentile (type 7)'
              : 'none',
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
      [r.color, r.facet, r.detail]
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
      ...[r.color, r.facet, r.detail].filter((f): f is string => !!f && f !== t.column).map((f) => row[f] ?? null),
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
    ...(summary && r.band !== 'none' ? { band: { lower: 'lower', upper: 'upper' } } : {}),
  };
}
