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
  if (abs >= 10000 || (abs > 0 && abs < 0.01)) return value.toExponential(1);
  // Strip trailing zeros from fixed-2 (e.g. 100.00 → 100, 3.13 → 3.13).
  const fixed = value.toFixed(2);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}

/** Layer value for display ("−2.3"): Inspector chips, colorbar, status Value. */
export function formatLayerValue(value: number): string {
  return displayMinus(formatLayerValueAscii(value));
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
