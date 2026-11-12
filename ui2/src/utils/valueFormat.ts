/**
 * The product's numeric formatters. Every number SHOWN in the frame, the
 * status bar, the colorbar and Inspector readouts goes through these, so one
 * value always reads the same way.
 *
 * Display strings use the true minus sign (U+2212), which has the width of a
 * digit in Plex Mono, so signed columns align. Anything a user edits or a
 * parser reads (inputs, `aria-valuetext`, draft text) uses the `*Ascii`
 * variants with the ASCII hyphen-minus, which `Number.parseFloat` accepts.
 */

export const MINUS = "−";

/** U+2212 for ASCII hyphen-minus (display only). */
export function displayMinus(text: string): string {
  return text.replace(/-/g, MINUS);
}

/**
 * Dash-like characters that people (or other apps) paste where a minus is
 * meant: U+2212 minus, U+2013 en dash, U+2012 figure dash, U+FE63 small
 * hyphen-minus, U+FF0D fullwidth hyphen-minus.
 */
export const MINUS_LIKE = /[\u2212\u2013\u2012\uFE63\uFF0D]/g;

/**
 * Inverse of `displayMinus`, for parsing displayed or pasted numbers: every
 * minus-like dash (`MINUS_LIKE`) becomes the ASCII hyphen-minus.
 */
export function asciiMinus(text: string): string {
  return text.replace(MINUS_LIKE, "-");
}

/** The empty-reading glyph shared by every readout ("Value —", "Mouse —"). */
export const EMPTY_VALUE = "—";

/**
 * A value range for display: "−4.58 to 6.15". The word "to" cannot be read
 * as subtraction (a dash between two U+2212 numbers can). Use for every
 * range readout: Inspector chips, the Data card, colorbar labels.
 */
export function formatRange(
  low: number,
  high: number,
  format: (value: number) => string = formatLayerValue,
): string {
  return `${format(low)} to ${format(high)}`;
}

/**
 * Compact numeric formatting for layer values, ASCII ("-2.3"): for inputs.
 *
 *   0 → "0", 600 → "600", 3.125 → "3.13", -2.3 → "-2.3", 12345 → "1.2e+4"
 */
export function formatLayerValueAscii(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  // Large values read as whole numbers with digit grouping ("59,000"), not
  // "5.9e+4" (v4 user critic, surface ticks); exponents only past a million.
  if (abs >= 10000 && abs < 1e6) return Math.round(value).toLocaleString('en-US');
  if (abs >= 1e6 || (abs > 0 && abs < 0.01)) return value.toExponential(1);
  // Strip trailing zeros from fixed-2 (e.g. 100.00 → 100, 3.13 → 3.13).
  const fixed = value.toFixed(2);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}

/** Layer value for display ("−2.3"): Inspector chips, colorbar, status Value. */
export function formatLayerValue(value: number): string {
  return displayMinus(formatLayerValueAscii(value));
}

/**
 * A voxel value for the status bar: fixed decimals, never an exponent (QA
 * 2026-10-31: "9.2e-3"). Below 1000, four significant digits by default on
 * both sides of 1, the precision every pointer value in the Set studio uses
 * (0.01718, 0.00920 → "0.0092", 0.9876, 1.235, 12.35, 123.5);
 * `significant` sets another (scale ends and colorbar ticks use 3). Trailing
 * zeros are trimmed (0.4560 → "0.456", 2.300 → "2.3"). A value that rounds up
 * to 1000 or beyond (999.96 → 1000) takes the large-magnitude rule; from 1000,
 * the layer formatter (2 decimals, grouped thousands from 10,000); from 1e6,
 * grouped integers. A non-zero value smaller than 1e-6 reads "<0.000001" (or
 * ">−0.000001"), never a misleading zero; zero (either sign) reads "0".
 * Display minus.
 */
export function formatReadoutValue(value: number, significant = 4): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1e6) return displayMinus(Math.round(value).toLocaleString('en-US'));
  if (abs < 1e-6) return value > 0 ? "<0.000001" : `>${MINUS}0.000001`;
  if (abs < 1000) {
    // Number() of the rounded text trims trailing zeros and folds the
    // exponent form toPrecision uses at the boundary ("1.00e+3"); String()
    // stays in fixed notation for 1e-6 <= |v| < 1e21.
    const rounded = Number(value.toPrecision(significant));
    if (Math.abs(rounded) < 1000) return displayMinus(String(rounded));
    // Rounded up across the boundary (999.96 → 1000): the large rule.
    return formatLayerValue(rounded);
  }
  return formatLayerValue(value);
}

/** World mm at 0.1 mm, ASCII, negative zero folded ("-0.0" never shows). */
export function formatWorldMmAscii(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(1);
  return Number(fixed) === 0 ? "0.0" : fixed;
}

/**
 * World mm for display ("−18.5"): status-bar crosshair / mouse readouts and
 * the viewport header, so the same position always reads the same.
 */
export function formatWorldMm(value: number): string {
  return displayMinus(formatWorldMmAscii(value));
}

/** The separator of a shape or per-axis size: "96 × 114 × 96". */
export const DIM_SEPARATOR = " × ";

/**
 * A shape (voxel counts) for display: "96 × 114 × 96" (and "… × 200" for a
 * 4D series). One form for the Inspector Data card and the Image header.
 */
export function formatDims(dims: readonly number[]): string {
  return dims.map((d) => (Number.isFinite(d) ? String(d) : EMPTY_VALUE)).join(DIM_SEPARATOR);
}

/**
 * Per-axis sizes for display ("2.00 × 2.00 × 2.00"), each through
 * `format` (default: fixed 2 decimals with U+2212).
 */
export function formatPerAxis(
  values: readonly number[],
  format: (value: number) => string = (v) => formatFixed(v, 2),
): string {
  return values.map(format).join(DIM_SEPARATOR);
}

/** Fixed decimals for display with U+2212 ("−95.50"); "—" when not finite. */
export function formatFixed(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const fixed = value.toFixed(decimals);
  return Number(fixed) === 0 ? fixed.replace(/^-/, "") : displayMinus(fixed);
}

/** A world point for display: "−95.5, −131.5, −77.5" (0.1 mm, U+2212). */
export function formatWorldPoint(point: readonly number[]): string {
  return point.map(formatWorldMm).join(", ");
}

/**
 * A layer's data range for display: "0 to 255", "−4.58 to 6.15". Auto
 * precision through `formatLayerValue`. One rule for the Inspector Data card
 * and the Image header.
 */
export function formatDataRange(min: number, max: number): string {
  return formatRange(min, max, formatLayerValue);
}

/**
 * Voxel size for display, without the unit: "2.00 × 2.00 × 2.00" (fixed 2
 * decimals). One rule for the Inspector Data card and the Image header;
 * callers append "mm".
 */
export function formatVoxelSize(spacing: readonly number[]): string {
  return formatPerAxis(spacing.slice(0, 3), (v) => formatFixed(v, 2));
}
