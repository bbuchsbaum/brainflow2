import type { SampleFrame, FrameRow, ResolvedPlotSpec } from '@/plotting';

export interface PopulationPlotRecipe {
  version: 1;
  x: string;
  axis: 'category' | 'number' | 'time';
  axisUnit: string;
  color: string | null;
  facet: string | null;
  detail: string | null;
  mark: 'point' | 'line' | 'box';
  summary: 'none' | 'mean';
  band: 'none' | 'sd' | 'sem95';
  within: 'single' | 'mean';
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
  if (r.summary === 'mean' && r.mark === 'box')
    throw new Error(
      'Use points or trajectories for summary means; distributions show individuals.',
    );
  if (
    r.version !== 1 ||
    !['category', 'number', 'time'].includes(r.axis) ||
    !['point', 'line', 'box'].includes(r.mark) ||
    !['none', 'mean'].includes(r.summary) ||
    !['none', 'sd', 'sem95'].includes(r.band) ||
    !['single', 'mean'].includes(r.within)
  )
    throw new Error('Unsupported population plot recipe.');
  for (const c of [r.x, r.color, r.facet, r.detail])
    if (c !== null && !names.has(c)) throw new Error(`Plot column is unavailable: ${c}`);
  if (r.axis === 'time' && (typeof r.axisUnit !== 'string' || !r.axisUnit.trim()))
    throw new Error('A time axis requires declared measured times and units.');
  if (r.mark === 'line' && r.summary === 'none' && !r.detail)
    throw new Error('Choose a participant/line identity before drawing individual trajectories.');
  if (r.summary === 'mean' && !r.detail)
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
  if (r.mark === 'line' || r.summary === 'mean') {
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
    const reduced: (FrameRow & { __contributors: string })[] = [...cells.values()].map((cell) => {
      const values = cell
        .map((v) => v.value)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const mean = values.reduce((m, v, i) => m + (v - m) / (i + 1), 0);
      return {
        ...cell[0],
        value: values.length ? mean : null,
        __contributors: JSON.stringify(cell.map((v) => v.member)),
      };
    });
    if (r.summary === 'mean') {
      const groups = new Map<string, typeof reduced>();
      reduced.forEach((row) => {
        const k = key(row, [r.x, r.color, r.facet]);
        groups.set(k, [...(groups.get(k) ?? []), row]);
      });
      const summaries = [...groups.values()].map((cell) => {
        const values = cell
          .map((v) => v.value)
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        const mean = values.reduce((m, v, i) => m + (v - m) / (i + 1), 0);
        const sd =
          values.length > 1
            ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1))
            : null;
        const spread =
          r.band === 'none' || sd === null
            ? null
            : r.band === 'sd'
              ? sd
              : (1.96 * sd) / Math.sqrt(values.length);
        return {
          ...Object.fromEntries(
            columns.map((c) => [
              c.name,
              [r.x, r.color, r.facet].includes(c.name) ? cell[0][c.name] : null,
            ]),
          ),
          member: null,
          value: values.length ? mean : null,
          lower: spread === null ? null : mean - spread,
          upper: spread === null ? null : mean + spread,
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
            ...columns.filter((c) => !['lower', 'upper', 'count'].includes(c.name)),
            ...['lower', 'upper', 'count'].map((name) => ({ name, role: 'quantitative' as const })),
          ],
          rows: summaries,
        },
        spec: plotSpec(r, true),
        summary: true,
      };
    }
    return {
      frame: { ...frame, columns, rows: reduced },
      spec: plotSpec(r, false),
      summary: false,
    };
  }
  return { frame: { ...frame, columns, rows }, spec: plotSpec(r, false), summary: false };
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
        r.x !== 'member' &&
        r.x !== '__populationObservation',
    },
    ...(summary && r.band !== 'none' ? { band: { lower: 'lower', upper: 'upper' } } : {}),
  };
}
