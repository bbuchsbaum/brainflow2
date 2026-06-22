/**
 * Helpers for building and reading {@link SampleFrame}s. Pure functions only —
 * no React, no I/O — so both the sampling services and the plot renderers can
 * share them.
 */

import type {
  CellValue,
  ColumnRole,
  FrameColumn,
  FrameRow,
  SampleFrame,
} from "./types";

/** Construct a column descriptor. */
export function column(
  name: string,
  role: ColumnRole,
  extra?: Pick<FrameColumn, "unit" | "labels">,
): FrameColumn {
  return extra ? { name, role, ...extra } : { name, role };
}

/** Look up a column descriptor by name. */
export function getColumn(
  frame: SampleFrame,
  name: string,
): FrameColumn | undefined {
  return frame.columns.find((c) => c.name === name);
}

/** Names of every column whose role matches one of `roles`. */
export function columnsByRole(
  frame: SampleFrame,
  ...roles: ColumnRole[]
): FrameColumn[] {
  return frame.columns.filter((c) => roles.includes(c.role));
}

/** Extract the raw cell values for a column, in row order (missing -> null). */
export function columnValues(frame: SampleFrame, name: string): CellValue[] {
  return frame.rows.map((r) => r[name] ?? null);
}

/**
 * Extract a numeric column in row order. Non-numeric / missing cells become
 * `NaN` so callers can decide how to handle gaps without losing row alignment.
 */
export function numericColumn(frame: SampleFrame, name: string): number[] {
  return frame.rows.map((r) => {
    const v = r[name];
    return typeof v === "number" ? v : Number.NaN;
  });
}

/**
 * Heuristic role inference for an array of raw values — used when a frame is
 * built from an untyped source (e.g. a joined design-table column). All-numeric
 * (or null) -> `quantitative`; otherwise `nominal`. Temporal / ordinal / index
 * roles must be declared explicitly by the producer.
 */
export function inferRole(values: readonly CellValue[]): ColumnRole {
  return values.every((v) => v === null || typeof v === "number")
    ? "quantitative"
    : "nominal";
}

/** Options for {@link frameFromSeries}. */
export interface SeriesFrameOptions {
  /** Name of the index/temporal x column. */
  readonly xName: string;
  /** Role of the x column. */
  readonly xRole: "temporal" | "index";
  /** Optional unit for the x column (e.g. `'s'`). */
  readonly xUnit?: string;
  /** Optional explicit x values; defaults to `0..n-1`. */
  readonly xValues?: readonly number[];
  /** Name of the quantitative y column. Defaults to `'value'`. */
  readonly yName?: string;
  /** Frame-level provenance / stats. */
  readonly meta?: Record<string, unknown>;
}

/**
 * Build a frame from a flat numeric series along an index/temporal axis — the
 * canonical shape for point/sphere sampling of a 4D (temporal) stack.
 */
export function frameFromSeries(
  values: readonly number[],
  opts: SeriesFrameOptions,
): SampleFrame {
  const yName = opts.yName ?? "value";
  const columns: FrameColumn[] = [
    column(
      opts.xName,
      opts.xRole,
      opts.xUnit ? { unit: opts.xUnit } : undefined,
    ),
    column(yName, "quantitative"),
  ];
  const rows: FrameRow[] = values.map((v, i) => ({
    [opts.xName]: opts.xValues ? (opts.xValues[i] ?? i) : i,
    [yName]: v,
  }));
  return opts.meta ? { columns, rows, meta: opts.meta } : { columns, rows };
}

/** Build a single-row scalar frame (one quantitative value). */
export function frameFromScalar(
  value: number,
  opts?: { name?: string; meta?: Record<string, unknown> },
): SampleFrame {
  const name = opts?.name ?? "value";
  const columns: FrameColumn[] = [column(name, "quantitative")];
  const rows: FrameRow[] = [{ [name]: value }];
  return opts?.meta ? { columns, rows, meta: opts.meta } : { columns, rows };
}
