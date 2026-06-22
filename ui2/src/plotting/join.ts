/**
 * Design-table join — augment a sampled {@link SampleFrame} with per-member
 * covariates from a design table (subject / group / age / session / …), keyed
 * by a member-id column. This is the "table join" primitive that unlocks
 * by-factor box plots, covariate scatter, and faceting (step 4 presets).
 *
 * Pure and source-agnostic: the design table is passed in the shape the
 * Set-Studio preview already exposes (`{ columns, rows: { id, cells }[] }`), so
 * a caller can hand it `activeSet.designTablePreview` directly. Column roles are
 * inferred per design column (all-numeric -> quantitative, else nominal) unless
 * given explicitly.
 *
 * NOTE (step 3): the per-member *values* this joins onto do not yet have a live
 * backend source (no set-sampling fan-out exists — see
 * docs/plans/plot-grammar-sample-frame.md). This transform is the tested
 * primitive that path will feed once it lands.
 */

import { column, getColumn } from "./frame";
import type {
  CellValue,
  ColumnRole,
  FrameColumn,
  FrameRow,
  SampleFrame,
} from "./types";

/** A design table in the shape Set-Studio's preview exposes. */
export interface DesignTable {
  /** Design column names (the covariates to join in). */
  readonly columns: readonly string[];
  /** One row per member; `id` is the join key, `cells` align to `columns`. */
  readonly rows: readonly {
    readonly id: string;
    readonly cells: readonly CellValue[];
  }[];
}

export interface JoinDesignTableOptions {
  /** Explicit role per design column; otherwise inferred from the values. */
  readonly roles?: Readonly<Record<string, ColumnRole>>;
  /** Keep base rows with no matching design row (cells become null). Default true. */
  readonly keep?: boolean;
}

/** Parse a cell to a finite number, or null. */
function asNumber(v: CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Join `table`'s columns onto `base`, matching `base[keyColumn]` against each
 * design row's `id`. Returns a new frame with the design columns appended.
 */
export function joinDesignTable(
  base: SampleFrame,
  keyColumn: string,
  table: DesignTable,
  opts: JoinDesignTableOptions = {},
): SampleFrame {
  if (!getColumn(base, keyColumn)) {
    throw new Error(
      `joinDesignTable: base frame has no key column "${keyColumn}".`,
    );
  }
  const keep = opts.keep ?? true;

  // Index design rows by id, and collect each column's raw cells for role
  // inference.
  const byId = new Map<string, readonly CellValue[]>();
  for (const row of table.rows) byId.set(row.id, row.cells);

  const colValues: CellValue[][] = table.columns.map(() => []);
  for (const row of table.rows) {
    table.columns.forEach((_, c) => colValues[c].push(row.cells[c] ?? null));
  }

  // Infer a role per design column: all present cells numeric -> quantitative.
  const roleFor = (name: string, values: CellValue[]): ColumnRole => {
    const explicit = opts.roles?.[name];
    if (explicit) return explicit;
    const present = values.filter((v) => v !== null && v !== "");
    if (present.length > 0 && present.every((v) => asNumber(v) !== null))
      return "quantitative";
    return "nominal";
  };
  const roles = table.columns.map((name, c) => roleFor(name, colValues[c]));

  // Left-join semantics: the base (sampled) frame is authoritative. Drop any
  // design column whose name collides with a base column, so it cannot clobber
  // base data or emit a duplicate schema entry.
  const baseColNames = base.columns.map((c) => c.name);
  const baseColSet = new Set(baseColNames);
  const include = table.columns.map((name) => !baseColSet.has(name));

  const rows: FrameRow[] = [];
  for (const baseRow of base.rows) {
    const key = baseRow[keyColumn];
    const cells = typeof key === "string" ? byId.get(key) : undefined;
    if (!cells && !keep) continue;
    const joined: Record<string, CellValue> = {};
    for (const name of baseColNames) joined[name] = baseRow[name] ?? null;
    table.columns.forEach((name, c) => {
      if (!include[c]) return;
      const raw = cells ? (cells[c] ?? null) : null;
      joined[name] =
        roles[c] === "quantitative"
          ? asNumber(raw)
          : raw === null
            ? null
            : String(raw);
    });
    rows.push(joined);
  }

  const designColumns: FrameColumn[] = table.columns
    .map((name, c) => (include[c] ? column(name, roles[c]) : null))
    .filter((c): c is FrameColumn => c !== null);
  return {
    columns: [...base.columns, ...designColumns],
    rows,
    meta: base.meta,
  };
}
