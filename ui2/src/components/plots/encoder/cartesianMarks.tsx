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

import { useMemo, type ReactNode } from "react";
import { scaleBand, scaleLinear } from "@visx/scale";
import { AreaClosed, Bar, Circle, LinePath } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";

import type { BoxStats, SampleFrame } from "@/plotting";
import { boxStats, columnValues, linearFit, numericColumn } from "@/plotting";

import type { MarkRenderer, MarkRenderProps } from "./types";

// ---------------------------------------------------------------------------
// Tokens / layout
// ---------------------------------------------------------------------------

const lineColor = "var(--app-plot-line)";
const gridColor = "var(--app-plot-grid)";
const mutedColor = "var(--app-text-muted)";
const axisFontFamily = "var(--app-font-mono, monospace)";

const MARGIN = { top: 8, right: 10, bottom: 22, left: 36 } as const;

/** Below these inner sizes the axes are too cramped to label. */
const MIN_AXIS_WIDTH = 60;
const MIN_AXIS_HEIGHT = 40;

type MarkKind = "line" | "area" | "point" | "bar" | "box";

/** A finite (x, y) data point in domain space. */
interface XYPoint {
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------
// Channel reading helpers
// ---------------------------------------------------------------------------

/**
 * Build finite numeric (x, y) points for line/area/point marks. If `x` is
 * undefined, the row index is used as x. Pairs with a non-finite x or y are
 * dropped.
 */
function numericPoints(
  frame: SampleFrame,
  xName: string | undefined,
  yName: string,
): XYPoint[] {
  const ys = numericColumn(frame, yName);
  const xs = xName ? numericColumn(frame, xName) : ys.map((_, i) => i);
  const points: XYPoint[] = [];
  for (let i = 0; i < ys.length; i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (Number.isFinite(x) && Number.isFinite(y)) {
      points.push({ x, y });
    }
  }
  return points;
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

function EmptyMark({
  kind,
  width,
  height,
}: {
  kind: MarkKind;
  width: number;
  height: number;
}) {
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
        fontSize={9}
        fontFamily={axisFontFamily}
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

interface CartesianMarkProps {
  readonly kind: MarkKind;
  readonly width: number;
  readonly height: number;
  /** Scales for the plot area; provided by the host renderer. */
  readonly xScale?: LinearScale | BandScale;
  readonly yScale: LinearScale;
  readonly innerWidth: number;
  readonly innerHeight: number;
  /** The mark geometry, drawn inside the translated plot group. */
  readonly children: ReactNode;
}

const tickLabelProps = () => ({
  fill: mutedColor,
  fontSize: 9,
  fontFamily: axisFontFamily,
});

/**
 * Shared chrome for the cartesian marks: the `<svg>` wrapper, the margin
 * group, and light left/bottom axes. The host renderer supplies the scales,
 * inner dimensions and the geometry children.
 */
function CartesianMark({
  kind,
  width,
  height,
  xScale,
  yScale,
  innerWidth,
  innerHeight,
  children,
}: CartesianMarkProps) {
  const showAxes =
    innerWidth >= MIN_AXIS_WIDTH && innerHeight >= MIN_AXIS_HEIGHT;
  return (
    <svg
      data-testid={`plot-mark-${kind}`}
      width={Math.max(0, width)}
      height={Math.max(0, height)}
      role="img"
      aria-label={`${kind} plot`}
    >
      <Group left={MARGIN.left} top={MARGIN.top}>
        {children}
        {showAxes && (
          <>
            <AxisLeft
              scale={yScale as never}
              numTicks={4}
              stroke={gridColor}
              tickStroke={gridColor}
              tickLabelProps={tickLabelProps}
            />
            {xScale && (
              <AxisBottom
                top={innerHeight}
                scale={xScale as never}
                numTicks={4}
                stroke={gridColor}
                tickStroke={gridColor}
                tickLabelProps={tickLabelProps}
              />
            )}
          </>
        )}
      </Group>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Continuous marks (line / area / point)
// ---------------------------------------------------------------------------

interface ContinuousMarkProps extends MarkRenderProps {
  readonly kind: "line" | "area" | "point";
}

function ContinuousMark({
  kind,
  frame,
  spec,
  width,
  height,
}: ContinuousMarkProps) {
  const yName = spec.encoding.y;
  const xName = spec.encoding.x;

  const points = useMemo<XYPoint[]>(
    () => (yName ? numericPoints(frame, xName, yName) : []),
    [frame, xName, yName],
  );

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const scales = useMemo(() => {
    const xDomain = paddedDomain(points.map((p) => p.x));
    const yDomain = paddedDomain(points.map((p) => p.y));
    return {
      xScale: scaleLinear<number>({
        domain: xDomain,
        range: [0, innerWidth],
      }),
      yScale: scaleLinear<number>({
        domain: yDomain,
        range: [innerHeight, 0],
      }),
    };
  }, [points, innerWidth, innerHeight]);

  // Empty / degenerate: line & area need >=2 finite points; point needs >=1.
  const minPoints = kind === "point" ? 1 : 2;
  if (frame.rows.length === 0 || points.length < minPoints) {
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

  const { xScale, yScale } = scales;
  const px = (p: XYPoint) => xScale(p.x) ?? 0;
  const py = (p: XYPoint) => yScale(p.y) ?? 0;

  let geometry: ReactNode = null;
  if (kind === "line") {
    geometry = (
      <LinePath<XYPoint>
        data={points}
        x={px}
        y={py}
        stroke={lineColor}
        strokeWidth={1.5}
        fill="none"
      />
    );
  } else if (kind === "area") {
    geometry = (
      <AreaClosed<XYPoint>
        data={points}
        x={px}
        y={py}
        yScale={yScale}
        stroke={lineColor}
        strokeWidth={1.5}
        fill={lineColor}
        fillOpacity={0.18}
      />
    );
  } else {
    // scatter, plus an optional least-squares fit line when the spec carries
    // an `lmFit` transform (covariate scatter).
    const fit = spec.transforms?.some((t) => t.kind === "lmFit")
      ? linearFit(points)
      : null;
    const [xMin, xMax] = xScale.domain() as [number, number];
    const fitLine: XYPoint[] | null = fit
      ? [
          { x: xMin, y: fit.slope * xMin + fit.intercept },
          { x: xMax, y: fit.slope * xMax + fit.intercept },
        ]
      : null;
    geometry = (
      <>
        {points.map((p, i) => (
          <Circle key={i} cx={px(p)} cy={py(p)} r={2} fill={lineColor} />
        ))}
        {fitLine && (
          <LinePath<XYPoint>
            data={fitLine}
            x={px}
            y={py}
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
      kind={kind}
      width={width}
      height={height}
      xScale={xScale}
      yScale={yScale}
      innerWidth={innerWidth}
      innerHeight={innerHeight}
    >
      {geometry}
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

  const ys = useMemo<number[]>(
    () => (yName ? numericColumn(frame, yName) : []),
    [frame, yName],
  );

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const scales = useMemo(() => {
    // Bar y-domain always includes zero.
    const finiteYs = ys.filter((y) => Number.isFinite(y));
    const [dMin, dMax] = paddedDomain([...finiteYs, 0]);
    return {
      xScale: scaleBand<string>({
        domain: categories,
        range: [0, innerWidth],
        padding: 0.2,
      }),
      yScale: scaleLinear<number>({
        domain: [Math.min(dMin, 0), Math.max(dMax, 0)],
        range: [innerHeight, 0],
      }),
    };
  }, [categories, ys, innerWidth, innerHeight]);

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
        domain: groups.map((g) => g.cat),
        range: [0, innerWidth],
        padding: 0.3,
      }),
      yScale: scaleLinear<number>({
        domain: [dMin, dMax],
        range: [innerHeight, 0],
      }),
    };
  }, [groups, innerWidth, innerHeight]);

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
// Exported renderers
// ---------------------------------------------------------------------------

export const lineMark: MarkRenderer = (props) => (
  <ContinuousMark {...props} kind="line" />
);

export const areaMark: MarkRenderer = (props) => (
  <ContinuousMark {...props} kind="area" />
);

export const pointMark: MarkRenderer = (props) => (
  <ContinuousMark {...props} kind="point" />
);

export const barMark: MarkRenderer = (props) => <BarMark {...props} />;

export const boxMark: MarkRenderer = (props) => <BoxMark {...props} />;
