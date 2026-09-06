/**
 * Grammar-of-graphics-lite plotting primitives.
 *
 * The plotting subsystem is built on a single pipeline:
 *
 *     sample (a spatial locus over a dataset)
 *        -> SampleFrame  (a tidy / long-form table whose columns carry roles)
 *        -> PlotSpec     (a mark + an encoding that binds columns to channels)
 *
 * Every plot — histogram, voxel time-series, by-factor boxplot, covariate
 * scatter, ROI bar — is the SAME extraction producing a frame whose columns
 * differ only in their roles, rendered by a mark whose default encoding is
 * inferred from those roles.
 *
 * Step 1 (this module) ships the data half of the pipeline: SampleFrame,
 * Locus, SampleRequest and the reduce vocabulary, plus forward-looking stubs
 * for PlotSpec / Encoding / Transform that later steps flesh out. See
 * docs/plans/plot-grammar-sample-frame.md for the full build order.
 */

// ---------------------------------------------------------------------------
// Tidy frame
// ---------------------------------------------------------------------------

/**
 * Grammar-of-graphics variable role for a frame column. Roles — not concrete
 * types — drive default encoding inference: a single `quantitative` column
 * defaults to a histogram, `temporal × quantitative` to a line, `quantitative
 * ⋈ nominal` to a boxplot, and so on.
 */
export type ColumnRole = 'quantitative' | 'nominal' | 'ordinal' | 'temporal' | 'index';

/** A single column descriptor in a {@link SampleFrame}. */
export interface FrameColumn {
  /** Column key; matches the keys used in each {@link FrameRow}. */
  readonly name: string;
  /** Variable role; see {@link ColumnRole}. */
  readonly role: ColumnRole;
  /** Optional physical unit, e.g. `'s'` for a temporal axis or `'mm'`. */
  readonly unit?: string;
  /**
   * Optional decode table for `nominal`/`index` columns whose cells store a
   * numeric code (e.g. atlas label id -> region name).
   */
  readonly labels?: readonly string[];
}

/** A single tidy-frame cell value. */
export type CellValue = number | string | null;

/** One row of a {@link SampleFrame}, keyed by column name. */
export type FrameRow = Readonly<Record<string, CellValue>>;

/** Identity and validity of a sampled observation's source snapshot. */
export interface SampleSourceIdentity {
  readonly memberId: string;
  readonly sourceRevision: { readonly sha256: string; readonly sourceBytes: number } | null;
  readonly stackIndex: number | null;
  readonly validCount: number | null;
  readonly error: string | null;
}

/**
 * A tidy (long-form) table: the universal currency between sampling and
 * plotting. Columns carry roles; rows are records keyed by column name. The
 * shape of the columns — not which plot mode produced them — determines how a
 * frame is rendered.
 */
export interface SampleFrame {
  readonly columns: readonly FrameColumn[];
  readonly rows: readonly FrameRow[];
  /** Provenance / summary stats (datasetId, locus, value range, …). */
  readonly meta?: Readonly<Record<string, unknown>> & {
    readonly sources?: readonly SampleSourceIdentity[];
  };
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** Position in the preserved volume world frame, `[x, y, z]` mm (+R, +A, +S for NIfTI). */
export type WorldMm = readonly [number, number, number];

/**
 * Where to sample. A discriminated union so new loci (sphere, ROI, …) are
 * added without widening every call site. Step 1 implements `point`, `sphere`
 * and `wholeVolume`; step 3 adds `roi` (one atlas region) and `regions` (all
 * regions of an atlas → a region × stat frame).
 */
export type Locus =
  | { readonly kind: 'point'; readonly worldMm: WorldMm }
  | {
      readonly kind: 'sphere';
      readonly worldMm: WorldMm;
      readonly radiusMm: number;
    }
  | {
      readonly kind: 'roi';
      readonly atlasLayerId: string;
      readonly labelId: number;
    }
  | { readonly kind: 'regions'; readonly atlasLayerId: string }
  | {
      readonly kind: 'set';
      readonly worldMm: WorldMm;
      readonly radiusMm: number;
      readonly members: readonly {
        readonly memberId: string;
        readonly sourcePath: string;
        /** Explicit zero-based frame for 4D sources; never a physical time coordinate. */
        readonly stackIndex?: number;
        /** Require the exact decoded-source snapshot used by a frozen query. */
        readonly expectedSha256?: string;
        /** Optional ontology-aware label for member-axis display. */
        readonly displayLabel?: string;
        /** Optional ontology axes, e.g. subject / condition / contrast. */
        readonly designValues?: readonly {
          readonly column: string;
          readonly value: string;
        }[];
      }[];
    }
  | { readonly kind: 'wholeVolume' };

/**
 * How multiple voxels gathered by a locus collapse into one value per
 * stack-index (e.g. per timepoint for a 4D volume). `'none'` is only valid for
 * single-voxel loci.
 */
export type ReduceOp = 'mean' | 'median' | 'min' | 'max' | 'sum' | 'none';

/**
 * Dispersion band around a `set`-locus member's ROI-reduced value, for CI/error
 * ribbons in the cross-set trace. Mirrors the backend `sample_set_trace_at_world`
 * `band` argument:
 *   - `'sem95'` — 95% CI of the mean (`center ± 1.96·SD/√n`).
 *   - `'sd'`    — one standard deviation.
 *   - `'ci95'`  — the 2.5% / 97.5% sample quantiles.
 *   - `'iqr'`   — the 25% / 75% sample quantiles.
 *   - `'none'`  — a degenerate band collapsed to the center value.
 */
export type TraceBand = 'sem95' | 'sd' | 'ci95' | 'iqr' | 'none';

/** A request to sample a dataset at a locus into a {@link SampleFrame}. */
export interface SampleRequest {
  /** Dataset id. For step 1 this is a UI layer id. */
  readonly datasetId: string;
  /** Where to sample. */
  readonly locus: Locus;
  /** Voxel reducer for multi-voxel loci. Defaults to `'mean'`. */
  readonly reduce?: ReduceOp;
  /** Bin count for whole-volume (histogram) sampling. Defaults to 256. */
  readonly binCount?: number;
  /**
   * When set, a `set` locus is sampled as a cross-set *trace*: each member
   * carries a dispersion band (`lower`/`upper`) for CI/error ribbons, via
   * `sample_set_trace_at_world`. Undefined keeps the plain scalar-per-member
   * path (`sample_set_at_world`). Ignored for non-`set` loci.
   */
  readonly band?: TraceBand;
}

// ---------------------------------------------------------------------------
// Plot spec (grammar-of-graphics-lite) — STUBS fleshed out in steps 2 / 4.
// ---------------------------------------------------------------------------

/**
 * Visual mark. Step 1 renders `line`/`hist` implicitly via the existing
 * mode renderers; step 2 introduces the generic mark switch.
 */
export type Mark = 'line' | 'point' | 'bar' | 'box' | 'violin' | 'hist' | 'heatmap' | 'area';

/** Binds frame columns (by name) to visual channels. */
export interface Encoding {
  readonly x?: string;
  readonly y?: string;
  readonly color?: string;
  readonly facet?: string;
  readonly detail?: string;
}

/** A data transform applied to a frame before encoding. */
export type Transform =
  | { readonly kind: 'bin'; readonly field: string; readonly maxbins?: number }
  | {
      readonly kind: 'aggregate';
      readonly field: string;
      readonly op: ReduceOp;
      readonly groupby?: readonly string[];
    }
  | {
      readonly kind: 'normalize';
      readonly field: string;
      readonly method: 'zscore' | 'percentChange';
    }
  | { readonly kind: 'lmFit'; readonly x: string; readonly y: string };

/**
 * A plot specification: a mark plus an encoding over a {@link SampleFrame},
 * with optional transforms. Step 1 defines the shape; steps 2/4 wire the
 * generic encoder and role-based default inference.
 */
export interface PlotSpec {
  readonly mark: Mark;
  readonly encoding: Encoding;
  readonly transforms?: readonly Transform[];
  readonly params?: Readonly<Record<string, unknown>>;
}
