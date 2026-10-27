/* eslint-disable react-refresh/only-export-components -- this is a registry of
 * named MarkRenderer functions (lowercase `lineMark`/`areaMark`/…), not a React
 * component module that participates in Vite fast refresh. */

/**
 * Generic visx mark renderers for the grammar-of-graphics-lite plot encoder.
 *
 * Each exported {@link MarkRenderer} (`lineMark`, `areaMark`, `pointMark`,
 * `barMark`) turns a (frame, resolved spec) pair into a small cartesian chart.
 * They share a single internal {@link CartesianMark} component that owns the
 * `<svg>` wrapper, margins, scales and axes; each renderer supplies only the
 * geometry (the line / area / points / bars) so the layout stays DRY.
 *
 * Pure render: no hooks beyond `useMemo`, no effects, no store access.
 */

import { useMemo, type ReactNode } from 'react';
import { scaleBand, scaleLinear, scalePoint } from '@visx/scale';
import { Area, AreaClosed, Bar, Circle, LinePath } from '@visx/shape';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { Group } from '@visx/group';

import type { BoxStats, SampleFrame } from '@/plotting';
import { boxStats, columnValues, getColumn, linearFit, numericColumn } from '@/plotting';

import type { MarkRenderer, MarkRenderProps } from './types';

// ---------------------------------------------------------------------------
// Tokens / layout
// ---------------------------------------------------------------------------

export function populationCategoryColor(label: string) {
  let hash = 0;
  for (const c of label) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return `hsl(${Math.round((Math.abs(hash) * 137.508) % 360)} 60% 55%)`;
}

const lineColor = 'var(--app-plot-line)';
const gridColor = 'var(--app-plot-grid)';
const mutedColor = 'var(--app-text-muted)';
const axisLabelColor = 'var(--bf-text-secondary)';
const axisLabelSize = 'var(--bf-text-2xs)';
const axisFontFamily = 'var(--app-font-mono, monospace)';
const proseFontFamily = 'var(--bf-font-sans, sans-serif)';

const MARGIN = { top: 8, right: 10, bottom: 22, left: 36 } as const;

/** Below these inner sizes the axes are too cramped to label. */
const MIN_AXIS_WIDTH = 60;
const MIN_AXIS_HEIGHT = 40;

type MarkKind = 'line' | 'area' | 'point' | 'bar' | 'box' | 'heatmap';

// ---------------------------------------------------------------------------
// Channel reading helpers
// ---------------------------------------------------------------------------

/**
 * A continuous-mark datum: the y value plus (optionally) a CI band and the two
 * ways to place it on x — a numeric `xNum` (linear axis) or a `cat` label (a
 * categorical scale, used e.g. for the member axis of a cross-set trace).
 */
interface SeriesPoint {
  readonly rowIndex?: number;
  /** Category label for a band/point x-scale (nominal/ordinal x). */
  readonly cat: string;
  /** Numeric x for a linear x-scale (temporal/quantitative x, or row index). */
  readonly xNum: number;
  readonly y: number;
  /** CI band lower/upper; `NaN` when the row carries no band. */
  readonly lo: number;
  readonly hi: number;
}

/**
 * Build the continuous-mark series aligned to frame rows. In categorical mode
 * (`catMode`) x is the stringified value of `xName` and rows keep their order;
 * otherwise x is numeric (`xName`, or the row index when unbound) and rows with
 * a non-finite x are dropped. Rows with a non-finite y break paths. When
 * a `band` is given, each row also carries its lower/upper (`NaN` if missing).
 */
function seriesPoints(
  frame: SampleFrame,
  xName: string | undefined,
  yName: string,
  catMode: boolean,
  band: { lower: string; upper: string } | undefined,
): SeriesPoint[] {
  const ys = numericColumn(frame, yName);
  const los = band ? numericColumn(frame, band.lower) : [];
  const his = band ? numericColumn(frame, band.upper) : [];
  const cats = catMode && xName ? columnValues(frame, xName).map((v) => String(v ?? '')) : [];
  const xs = !catMode && xName ? numericColumn(frame, xName) : [];
  const out: SeriesPoint[] = [];
  for (let i = 0; i < ys.length; i += 1) {
    const y = ys[i];
    // Keep unavailable y values so paths break at missing samples.
    const xNum = catMode ? i : xName ? xs[i] : i;
    if (!catMode && !Number.isFinite(xNum)) continue;
    out.push({
      rowIndex: i,
      cat: catMode ? cats[i] : String(i),
      xNum,
      y,
      lo: band ? los[i] : Number.NaN,
      hi: band ? his[i] : Number.NaN,
    });
  }
  return out;
}

/**
 * Linear y-domain padded so a flat series still shows. If every value is
 * equal, pad by ±1 (or ±|v|·0.1 when that is larger).
 */
function paddedDomain(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1);
    return [min - pad, max + pad];
  }
  return [min, max];
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyMark({ kind, width, height }: { kind: MarkKind; width: number; height: number }) {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  return (
    <svg
      data-testid={`plot-mark-${kind}`}
      width={w}
      height={h}
      role="img"
      aria-label={`${kind} plot`}
    >
      <text
        x={w / 2}
        y={h / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={mutedColor}
        fontSize={10}
        style={{ fontSize: axisLabelSize, fontFamily: proseFontFamily }}
      >
        No data
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared cartesian frame
// ---------------------------------------------------------------------------

type LinearScale = ReturnType<typeof scaleLinear<number>>;
type BandScale = ReturnType<typeof scaleBand<string>>;
type PointScale = ReturnType<typeof scalePoint<string>>;

/** Axis craft a series plot asks for (phase 4 v1: titles, integer index ticks, a zero line). */
interface AxisOptions {
  readonly xTitle?: string;
  readonly yTitle?: string;
  /** Integer ticks (lag / frame axes): every integer when ≤ 12 of them. */
  readonly xIntegerTicks?: boolean;
  /** A hairline at y = 0 when the domain spans zero (difference plots). */
  readonly zeroLine?: boolean;
}

interface CartesianMarkProps {
  readonly axes?: AxisOptions;
  readonly margin?: { top: number; right: number; bottom: number; left: number };
  readonly interactive?: boolean;
  readonly kind: MarkKind;
  readonly width: number;
  readonly height: number;
  /** Scales for the plot area; provided by the host renderer. */
  readonly xScale?: LinearScale | BandScale | PointScale;
  readonly yScale: LinearScale;
  readonly innerWidth: number;
  readonly innerHeight: number;
  /** The mark geometry, drawn inside the translated plot group. */
  readonly children: ReactNode;
}

// Tick numerals: mono for tabular alignment, secondary text at the 2xs step.
const tickLabelProps = () => ({
  fill: axisLabelColor,
  fontSize: 10,
  fontFamily: axisFontFamily,
  style: { fontSize: axisLabelSize },
});

/**
 * Shared chrome for the cartesian marks: the `<svg>` wrapper, the margin
 * group, and light left/bottom axes. The host renderer supplies the scales,
 * inner dimensions and the geometry children.
 */
function CartesianMark({
  axes,
  margin = MARGIN,
  interactive,
  kind,
  width,
  height,
  xScale,
  yScale,
  innerWidth,
  innerHeight,
  children,
}: CartesianMarkProps) {
  const showAxes = innerWidth >= MIN_AXIS_WIDTH && innerHeight >= MIN_AXIS_HEIGHT;
  return (
    <svg
      data-testid={`plot-mark-${kind}`}
      width={Math.max(0, width)}
      height={Math.max(0, height)}
      role={interactive ? 'group' : 'img'}
      aria-label={`${kind} plot`}
    >
      <Group left={margin.left} top={margin.top}>
        {axes?.zeroLine && showAxes && zeroInDomain(yScale) ? (
          <line
            data-testid="plot-zero-line"
            x1={0}
            x2={innerWidth}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke="var(--bf-border-strong)"
            strokeWidth={1}
          />
        ) : null}
        {children}
        {showAxes && axes?.xTitle ? (
          <text
            data-testid="plot-x-title"
            x={innerWidth / 2}
            y={innerHeight + 30}
            textAnchor="middle"
            fill={axisLabelColor}
            style={{ fontSize: axisLabelSize, fontFamily: proseFontFamily }}
          >
            {axes.xTitle}
          </text>
        ) : null}
        {showAxes && axes?.yTitle ? (
          <text
            data-testid="plot-y-title"
            transform={`translate(${-margin.left + 10}, ${innerHeight / 2}) rotate(-90)`}
            textAnchor="middle"
            fill={axisLabelColor}
            style={{ fontSize: axisLabelSize, fontFamily: proseFontFamily }}
          >
            {axes.yTitle}
          </text>
        ) : null}
        {showAxes && (
          <Group pointerEvents="none">
            <AxisLeft
              scale={yScale as never}
              numTicks={4}
              stroke={gridColor}
              tickStroke={gridColor}
              tickLabelProps={() => ({
                ...tickLabelProps(),
                textAnchor: 'end',
                dx: '-0.25em',
                dy: '0.25em',
              })}
            />
            {xScale && (
              <AxisBottom
                top={innerHeight}
                scale={xScale as never}
                numTicks={4}
                {...((axes?.xIntegerTicks && 'ticks' in xScale ? integerTicks(xScale as LinearScale) : {}) as object)}
                stroke={gridColor}
                tickStroke={gridColor}
                tickLabelProps={tickLabelProps}
              />
            )}
          </Group>
        )}
      </Group>
    </svg>
  );
}

function zeroInDomain(yScale: LinearScale): boolean {
  const [a, b] = yScale.domain();
  return Math.min(a, b) < 0 && Math.max(a, b) > 0;
}

/** Integer tick values (every integer when ≤ 12, else about 6) with integer labels. */
function integerTicks(xScale: LinearScale) {
  const [a, b] = xScale.domain();
  const lo = Math.ceil(Math.min(a, b));
  const hi = Math.floor(Math.max(a, b));
  const span = hi - lo;
  const step = span <= 12 ? 1 : Math.ceil(span / 6);
  const tickValues: number[] = [];
  for (let v = lo; v <= hi; v += step) tickValues.push(v);
  return { tickValues, tickFormat: (v: unknown) => String(Math.round(Number(v))) };
}

// ---------------------------------------------------------------------------
// Continuous marks (line / area / point)
// ---------------------------------------------------------------------------

interface ContinuousMarkProps extends MarkRenderProps {
  readonly kind: 'line' | 'area' | 'point';
}

function ContinuousMark({ kind, frame, spec, width, height, context }: ContinuousMarkProps) {
  const yName = spec.encoding.y;
  const xName = spec.encoding.x;
  const band = spec.band;

  // Categorical x (member axis of a cross-set trace, factor level, …): a
  // nominal/ordinal x column places points on a categorical `scalePoint` axis
  // rather than a numeric linear one. Temporal/quantitative x stays linear.
  const catMode = useMemo(() => {
    const col = xName ? getColumn(frame, xName) : undefined;
    return !!col && (col.role === 'nominal' || col.role === 'ordinal');
  }, [frame, xName]);

  const points = useMemo<SeriesPoint[]>(
    () => (yName ? seriesPoints(frame, xName, yName, catMode, band) : []),
    [frame, xName, yName, catMode, band],
  );

  const axes: AxisOptions = {
    xTitle: typeof spec.params.xTitle === 'string' ? spec.params.xTitle : undefined,
    yTitle: typeof spec.params.yTitle === 'string' ? spec.params.yTitle : undefined,
    xIntegerTicks: spec.params.xIntegerTicks === true,
    zeroLine: spec.params.zeroLine === true,
  };
  const margin = {
    ...MARGIN,
    bottom: MARGIN.bottom + (axes.xTitle ? 14 : 0),
    left: MARGIN.left + (axes.yTitle ? 14 : 0),
  };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);

  const scales = useMemo(() => {
    // The y-domain spans the values AND the band bounds, so a wide CI ribbon is
    // never clipped by the line's own extent.
    const yValues: number[] = [];
    for (const p of points) {
      if (Number.isFinite(p.y)) yValues.push(p.y);
      if (Number.isFinite(p.lo)) yValues.push(p.lo);
      if (Number.isFinite(p.hi)) yValues.push(p.hi);
    }
    const declaredDomain = spec.params.yDomain;
    const yDomain =
      Array.isArray(declaredDomain) &&
      declaredDomain.length === 2 &&
      declaredDomain.every(Number.isFinite)
        ? ([Number(declaredDomain[0]), Number(declaredDomain[1])] as [number, number])
        : paddedDomain(yValues);
    if (context?.datumLink) {
      const pad = (yDomain[1] - yDomain[0]) * 0.05;
      yDomain[0] -= pad;
      yDomain[1] += pad;
    }
    const yScale = scaleLinear<number>({
      domain: yDomain,
      range: [innerHeight, 0],
    });
    if (catMode) {
      const xScale = scalePoint<string>({
        domain: Array.isArray(spec.params.xCategories)
          ? (spec.params.xCategories as string[])
          : context?.datumLink && xName
            ? columnValues(frame, xName).map((value) => String(value ?? ''))
            : points.map((p) => p.cat),
        range: [0, innerWidth],
        padding: 0.5,
      });
      return { xScale, yScale, catMode: true as const };
    }
    // An index axis (lag, frame) pads half a step each side, so the first
    // and last points sit off the axis lines (v1 visual 6f).
    const halfStep = typeof spec.params.xPadHalfStep === 'number' ? spec.params.xPadHalfStep / 2 : null;
    const xs = points.map((p) => p.xNum).filter(Number.isFinite);
    const xScale = scaleLinear<number>({
      domain: Array.isArray(spec.params.xDomain)
        ? (spec.params.xDomain as [number, number])
        : halfStep !== null && xs.length
          ? [Math.min(...xs) - halfStep, Math.max(...xs) + halfStep]
          : paddedDomain(points.map((p) => p.xNum)),
      range: [0, innerWidth],
    });
    return { xScale, yScale, catMode: false as const };
  }, [points, innerWidth, innerHeight, catMode, context?.datumLink, frame, xName, spec.params]);

  // Empty / degenerate: line & area need >=2 finite points; point needs >=1.
  const minPoints = kind === 'point' ? 1 : 2;
  if (frame.rows.length === 0 || points.filter((p) => Number.isFinite(p.y)).length < minPoints) {
    return <EmptyMark kind={kind} width={width} height={height} />;
  }

  // Too small to draw the plot area: render the bare svg, never crash.
  if (innerWidth <= 0 || innerHeight <= 0) {
    return (
      <svg
        data-testid={`plot-mark-${kind}`}
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        role="img"
        aria-label={`${kind} plot`}
      />
    );
  }

  const { yScale } = scales;
  const py = (v: number) => yScale(v) ?? 0;
  const baseX = scales.catMode
    ? (p: SeriesPoint) => scales.xScale(p.cat) ?? 0
    : (p: SeriesPoint) => scales.xScale(p.xNum) ?? 0;

  const px = (p: SeriesPoint) => {
    if (!spec.params.jitter || !scales.catMode || p.rowIndex === undefined) return baseX(p);
    const id = String(frame.rows[p.rowIndex].member ?? p.rowIndex);
    let hash = 2166136261;
    for (const c of id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    const width = Math.min(40, (innerWidth / Math.max(1, scales.xScale.domain().length)) * 0.6);
    return baseX(p) + ((hash >>> 0) / 4294967295 - 0.5) * width;
  };

  const groups = new Map<string, SeriesPoint[]>();
  const colorFor = (p: SeriesPoint) => {
    if (!spec.encoding.color) return lineColor;
    const label = String(frame.rows[p.rowIndex!]?.[spec.encoding.color] ?? '(missing)');
    return populationCategoryColor(label);
  };
  for (const p of points) {
    const row = frame.rows[p.rowIndex!];
    const key = JSON.stringify([
      spec.encoding.detail ? row[spec.encoding.detail] : null,
      spec.encoding.color ? row[spec.encoding.color] : null,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  // Points carry their band as error bars (a window mean: one value per
  // condition, v1 user 3); lines and areas as a ribbon.
  const whiskers =
    band && kind === 'point'
      ? points
          .filter((p) => Number.isFinite(p.lo) && Number.isFinite(p.hi))
          .map((p, i) => {
            const x = px(p);
            return (
              <Group key={`w${i}`} data-testid="plot-error-bar">
                <line x1={x} x2={x} y1={py(p.lo)} y2={py(p.hi)} stroke={colorFor(p)} strokeWidth={1.5} />
                <line x1={x - 4} x2={x + 4} y1={py(p.lo)} y2={py(p.lo)} stroke={colorFor(p)} strokeWidth={1.5} />
                <line x1={x - 4} x2={x + 4} y1={py(p.hi)} y2={py(p.hi)} stroke={colorFor(p)} strokeWidth={1.5} />
              </Group>
            );
          })
      : null;
  const ribbon = band && kind !== 'point'
    ? [...groups].map(([key, data]) => (
        <Group key={key} data-testid="plot-band">
          <Area<SeriesPoint>
            data={data}
            defined={(p) => Number.isFinite(p.lo) && Number.isFinite(p.hi)}
            x={px}
            y0={(p) => py(p.lo)}
            y1={(p) => py(p.hi)}
            fill={colorFor(data[0])}
            fillOpacity={0.15}
            stroke="none"
          />
        </Group>
      ))
    : null;

  // Datum links (phase 4 v1 function 3/6): ONE tab stop for the point set,
  // roving focus inside (Left/Right along a line, Up/Down across lines,
  // Home/End), keys kept from the viewer's shortcuts.
  const link = context?.datumLink;
  const linkedIds = (p: SeriesPoint) => (link && p.rowIndex !== undefined ? frame.rows[p.rowIndex][link.idColumn] : null);
  const lines = [...groups.values()].map((g) =>
    g.filter((p) => Number.isFinite(p.y) && typeof linkedIds(p) === 'string').sort((a, b) => a.xNum - b.xNum),
  );
  const allLinked = lines.flat();
  const tabStopId =
    link && allLinked.some((p) => linkedIds(p) === link.focusedId)
      ? link.focusedId
      : allLinked.length
        ? (linkedIds(allLinked[0]) as string)
        : null;
  const selectable = link?.selectable !== false;
  const moveFrom = (event: React.KeyboardEvent<SVGElement>, id: string) => {
    if (!link) return;
    const li = lines.findIndex((g) => g.some((p) => linkedIds(p) === id));
    if (li < 0) return;
    const pi = lines[li].findIndex((p) => linkedIds(p) === id);
    let target: SeriesPoint | undefined;
    if (event.key === 'ArrowRight') target = lines[li][pi + 1];
    else if (event.key === 'ArrowLeft') target = lines[li][pi - 1];
    else if (event.key === 'Home') target = lines[li][0];
    else if (event.key === 'End') target = lines[li][lines[li].length - 1];
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const g = lines[li + (event.key === 'ArrowDown' ? 1 : -1)];
      target = g?.[Math.min(pi, g.length - 1)];
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey && selectable) link.onToggleSelection(id);
      else link.onFocus(id);
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    if (!target) return;
    const nextId = linkedIds(target) as string;
    const svg = (event.currentTarget as SVGElement).ownerSVGElement;
    (svg?.querySelector(`[data-datum-id="${CSS.escape(nextId)}"]`) as SVGElement | null)?.focus();
    if (link.activateOnMove) link.onFocus(nextId);
  };

  const markers = points
    .filter((p) => Number.isFinite(p.y))
    .map((p, i) => {
      const id = linkedIds(p);
      if (!link || typeof id !== 'string')
        return <Circle key={i} cx={px(p)} cy={py(p.y)} r={2} fill={colorFor(p)} />;
      const focused = id === link.focusedId;
      const selected = link.selectedIds.has(id);
      const name = link.label && p.rowIndex !== undefined ? link.label(p.rowIndex) : `${id}: ${p.y}`;
      return (
        <Circle
          key={id}
          cx={px(p)}
          cy={py(p.y)}
          r={focused ? 5 : 3.5}
          fill={colorFor(p)}
          fillOpacity={selected ? 1 : 0.3}
          stroke={focused ? 'var(--app-text-primary)' : 'none'}
          strokeWidth={1.5}
          role="button"
          tabIndex={id === tabStopId ? 0 : -1}
          data-datum-id={id}
          aria-label={name}
          aria-pressed={selectable ? selected : undefined}
          aria-current={focused ? 'true' : undefined}
          onClick={(event) => (event.shiftKey && selectable ? link.onToggleSelection(id) : link.onFocus(id))}
          onKeyDown={(event) => moveFrom(event, id)}
        >
          <title>
            {name} · {selectable ? 'Click to focus; Shift-click to select' : 'Click to focus'}
          </title>
        </Circle>
      );
    });

  let geometry: ReactNode = null;
  if (kind === 'line') {
    geometry = [...groups].map(([key, data]) => (
      <LinePath<SeriesPoint>
        key={key}
        data-testid="plot-series"
        data={data}
        defined={(p) => Number.isFinite(p.y)}
        x={px}
        y={(p) => py(p.y)}
        stroke={colorFor(data[0])}
        strokeWidth={1.5}
        fill="none"
      />
    ));
  } else if (kind === 'area') {
    geometry = (
      <AreaClosed<SeriesPoint>
        data={points}
        defined={(p) => Number.isFinite(p.y)}
        x={px}
        y={(p) => py(p.y)}
        yScale={yScale}
        stroke={lineColor}
        strokeWidth={1.5}
        fill={lineColor}
        fillOpacity={0.18}
      />
    );
  } else {
    // scatter, plus an optional least-squares fit line when the spec carries an
    // `lmFit` transform (covariate scatter). The fit is only meaningful on a
    // numeric x axis.
    const fit =
      !scales.catMode && spec.transforms?.some((t) => t.kind === 'lmFit')
        ? linearFit(points.map((p) => ({ x: p.xNum, y: p.y })))
        : null;
    let fitLine: SeriesPoint[] | null = null;
    if (fit && !scales.catMode) {
      const [xMin, xMax] = scales.xScale.domain() as [number, number];
      fitLine = [
        { cat: '', xNum: xMin, y: fit.slope * xMin + fit.intercept, lo: NaN, hi: NaN },
        { cat: '', xNum: xMax, y: fit.slope * xMax + fit.intercept, lo: NaN, hi: NaN },
      ];
    }
    geometry = (
      <>
        {markers}
        {fitLine && (
          <LinePath<SeriesPoint>
            data={fitLine}
            x={px}
            y={(p) => py(p.y)}
            stroke={lineColor}
            strokeWidth={1}
            strokeDasharray="4 3"
            fill="none"
          />
        )}
      </>
    );
  }

  return (
    <CartesianMark
      axes={axes}
      margin={margin}
      interactive={!!context?.datumLink}
      kind={kind}
      width={width}
      height={height}
      xScale={scales.xScale}
      yScale={yScale}
      innerWidth={innerWidth}
      innerHeight={innerHeight}
    >
      {ribbon}
      {whiskers}
      {geometry}
      {kind !== 'point' && context?.datumLink ? markers : null}
    </CartesianMark>
  );
}

// ---------------------------------------------------------------------------
// Categorical bar mark
// ---------------------------------------------------------------------------

function BarMark({ frame, spec, width, height }: MarkRenderProps) {
  const yName = spec.encoding.y;
  const xName = spec.encoding.x;

  const categories = useMemo<string[]>(() => {
    if (xName) return columnValues(frame, xName).map((v) => String(v));
    return frame.rows.map((_, i) => String(i));
  }, [frame, xName]);

  const ys = useMemo<number[]>(() => (yName ? numericColumn(frame, yName) : []), [frame, yName]);

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const scales = useMemo(() => {
    // Bar y-domain always includes zero.
    const finiteYs = ys.filter((y) => Number.isFinite(y));
    const [dMin, dMax] = paddedDomain([...finiteYs, 0]);
    return {
      xScale: scaleBand<string>({
        domain: Array.isArray(spec.params.xCategories)
          ? (spec.params.xCategories as string[])
          : categories,
        range: [0, innerWidth],
        padding: 0.2,
      }),
      yScale: scaleLinear<number>({
        domain: [Math.min(dMin, 0), Math.max(dMax, 0)],
        range: [innerHeight, 0],
      }),
    };
  }, [categories, ys, innerWidth, innerHeight, spec.params.xCategories]);

  if (frame.rows.length === 0 || !yName) {
    return <EmptyMark kind="bar" width={width} height={height} />;
  }

  if (innerWidth <= 0 || innerHeight <= 0) {
    return (
      <svg
        data-testid="plot-mark-bar"
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        role="img"
        aria-label="bar plot"
      />
    );
  }

  const { xScale, yScale } = scales;
  const zeroY = yScale(0) ?? innerHeight;
  const bandWidth = xScale.bandwidth();

  return (
    <CartesianMark
      kind="bar"
      width={width}
      height={height}
      xScale={xScale}
      yScale={yScale}
      innerWidth={innerWidth}
      innerHeight={innerHeight}
    >
      {categories.map((cat, i) => {
        const value = ys[i];
        if (!Number.isFinite(value)) return null;
        const left = xScale(cat);
        if (left === undefined) return null;
        const valueY = yScale(value) ?? zeroY;
        const top = Math.min(valueY, zeroY);
        const barHeight = Math.abs(valueY - zeroY);
        return (
          <Bar
            key={`${cat}-${i}`}
            x={left}
            y={top}
            width={bandWidth}
            height={barHeight}
            fill={lineColor}
          />
        );
      })}
    </CartesianMark>
  );
}

// ---------------------------------------------------------------------------
// Box-and-whisker mark (by-factor distributions)
// ---------------------------------------------------------------------------

function BoxMark({ frame, spec, width, height }: MarkRenderProps) {
  const xName = spec.encoding.x;
  const yName = spec.encoding.y;

  const groups = useMemo<{ cat: string; stats: BoxStats }[]>(() => {
    if (!xName || !yName) return [];
    const cats = columnValues(frame, xName).map((v) => String(v));
    const ys = numericColumn(frame, yName);
    const byCat = new Map<string, number[]>();
    const order: string[] = [];
    cats.forEach((c, i) => {
      if (!byCat.has(c)) {
        byCat.set(c, []);
        order.push(c);
      }
      byCat.get(c)!.push(ys[i]);
    });
    return order
      .map((cat) => ({ cat, stats: boxStats(byCat.get(cat) ?? []) }))
      .filter((g): g is { cat: string; stats: BoxStats } => g.stats !== null);
  }, [frame, xName, yName]);

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const scales = useMemo(() => {
    const allVals = groups.flatMap((g) => [
      g.stats.whiskerLo,
      g.stats.whiskerHi,
      ...g.stats.outliers,
    ]);
    const [dMin, dMax] = paddedDomain(allVals);
    return {
      xScale: scaleBand<string>({
        domain: Array.isArray(spec.params.xCategories)
          ? (spec.params.xCategories as string[])
          : groups.map((g) => g.cat),
        range: [0, innerWidth],
        padding: 0.3,
      }),
      yScale: scaleLinear<number>({
        domain: Array.isArray(spec.params.yDomain)
          ? (spec.params.yDomain as [number, number])
          : [dMin, dMax],
        range: [innerHeight, 0],
      }),
    };
  }, [groups, innerWidth, innerHeight, spec.params.xCategories, spec.params.yDomain]);

  if (frame.rows.length === 0 || !xName || !yName || groups.length === 0) {
    return <EmptyMark kind="box" width={width} height={height} />;
  }
  if (innerWidth <= 0 || innerHeight <= 0) {
    return (
      <svg
        data-testid="plot-mark-box"
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        role="img"
        aria-label="box plot"
      />
    );
  }

  const { xScale, yScale } = scales;
  const bw = xScale.bandwidth();
  const y = (v: number) => yScale(v) ?? 0;

  return (
    <CartesianMark
      kind="box"
      width={width}
      height={height}
      xScale={xScale}
      yScale={yScale}
      innerWidth={innerWidth}
      innerHeight={innerHeight}
    >
      {groups.map(({ cat, stats }) => {
        const left = xScale(cat);
        if (left === undefined) return null;
        const cx = left + bw / 2;
        const boxTop = Math.min(y(stats.q1), y(stats.q3));
        const boxHeight = Math.max(Math.abs(y(stats.q1) - y(stats.q3)), 1);
        return (
          <Group key={cat}>
            <line
              x1={cx}
              y1={y(stats.whiskerLo)}
              x2={cx}
              y2={y(stats.whiskerHi)}
              stroke={gridColor}
              strokeWidth={1}
            />
            <Bar
              x={left}
              y={boxTop}
              width={bw}
              height={boxHeight}
              fill={lineColor}
              fillOpacity={0.25}
              stroke={lineColor}
              strokeWidth={1}
            />
            <line
              x1={left}
              y1={y(stats.median)}
              x2={left + bw}
              y2={y(stats.median)}
              stroke={lineColor}
              strokeWidth={1.5}
            />
            {stats.outliers.map((o, i) => (
              <Circle key={i} cx={cx} cy={y(o)} r={1.5} fill={mutedColor} />
            ))}
          </Group>
        );
      })}
    </CartesianMark>
  );
}

// ---------------------------------------------------------------------------
// Heatmap / carpet (grayplot) mark
// ---------------------------------------------------------------------------

/** Clamp to the unit interval. */
function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Grayscale ramp for the carpet cells: normalized `t` in [0, 1] -> a gray in a
 * visible band (dark for low, light for high — the grayplot convention). Kept
 * as an explicit `rgb(...)` string so cell fills are deterministic and testable.
 */
function grayRamp(t: number): string {
  const g = Math.round(30 + clamp01(t) * (220 - 30));
  return `rgb(${g}, ${g}, ${g})`;
}

/**
 * Heatmap / carpet (grayplot) mark: one contiguous cell per category along x,
 * shaded by a quantitative value. The value channel is `color` when bound, else
 * `y` — so the cross-set trace (`{ x: member, y: value }`) renders as a colored
 * strip of members without any extra rebind. A row with a non-finite value
 * draws as a hollow outline rather than a filled cell.
 */
function HeatmapMark({ frame, spec, width, height }: MarkRenderProps) {
  const xName = spec.encoding.x;
  const valueName = spec.encoding.color ?? spec.encoding.y;

  const cells = useMemo<{ cat: string; value: number }[]>(() => {
    if (!valueName) return [];
    const cats = xName
      ? columnValues(frame, xName).map((v, i) => String(v ?? i))
      : frame.rows.map((_, i) => String(i));
    const vals = numericColumn(frame, valueName);
    return cats.map((cat, i) => ({ cat, value: vals[i] }));
  }, [frame, xName, valueName]);

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const { xScale, domain } = useMemo(() => {
    const finite = cells.map((c) => c.value).filter((v) => Number.isFinite(v));
    let min = finite.length ? Math.min(...finite) : 0;
    let max = finite.length ? Math.max(...finite) : 1;
    if (min === max) {
      // A flat trace still needs a non-zero span so every cell is mid-ramp.
      min -= 0.5;
      max += 0.5;
    }
    return {
      xScale: scaleBand<string>({
        domain: cells.map((c) => c.cat),
        range: [0, innerWidth],
        padding: 0,
      }),
      domain: [min, max] as [number, number],
    };
  }, [cells, innerWidth]);

  if (frame.rows.length === 0 || !valueName || cells.length === 0) {
    return <EmptyMark kind="heatmap" width={width} height={height} />;
  }
  if (innerWidth <= 0 || innerHeight <= 0) {
    return (
      <svg
        data-testid="plot-mark-heatmap"
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        role="img"
        aria-label="heatmap plot"
      />
    );
  }

  const bw = xScale.bandwidth();
  const [dMin, dMax] = domain;
  const norm = (v: number) => (dMax > dMin ? (v - dMin) / (dMax - dMin) : 0.5);
  const showAxis = innerWidth >= MIN_AXIS_WIDTH && innerHeight >= MIN_AXIS_HEIGHT;

  return (
    <svg
      data-testid="plot-mark-heatmap"
      width={Math.max(0, width)}
      height={Math.max(0, height)}
      role="img"
      aria-label="heatmap plot"
    >
      <Group left={MARGIN.left} top={MARGIN.top}>
        {cells.map((c, i) => {
          const left = xScale(c.cat);
          if (left === undefined) return null;
          if (!Number.isFinite(c.value)) {
            return (
              <rect
                key={`${c.cat}-${i}`}
                data-testid="plot-heatmap-cell"
                data-cat={c.cat}
                x={left}
                y={0}
                width={bw}
                height={innerHeight}
                fill="none"
                stroke={gridColor}
                strokeDasharray="2 2"
              />
            );
          }
          return (
            <Bar
              key={`${c.cat}-${i}`}
              data-testid="plot-heatmap-cell"
              data-cat={c.cat}
              data-value={c.value}
              x={left}
              y={0}
              width={bw}
              height={innerHeight}
              fill={grayRamp(norm(c.value))}
            />
          );
        })}
        {showAxis && (
          <AxisBottom
            top={innerHeight}
            scale={xScale as never}
            numTicks={4}
            stroke={gridColor}
            tickStroke={gridColor}
            tickLabelProps={tickLabelProps}
          />
        )}
      </Group>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Exported renderers
// ---------------------------------------------------------------------------

export const lineMark: MarkRenderer = (props) => <ContinuousMark {...props} kind="line" />;

export const areaMark: MarkRenderer = (props) => <ContinuousMark {...props} kind="area" />;

export const pointMark: MarkRenderer = (props) => <ContinuousMark {...props} kind="point" />;

export const barMark: MarkRenderer = (props) => <BarMark {...props} />;

export const boxMark: MarkRenderer = (props) => <BoxMark {...props} />;

export const heatmapMark: MarkRenderer = (props) => <HeatmapMark {...props} />;
