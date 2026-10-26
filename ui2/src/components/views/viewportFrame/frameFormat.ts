/**
 * Pure helpers for the viewport frame: header text, threshold wording and
 * colorbar ticks. No React, no stores — unit-tested directly.
 */
import { colormaps } from '@/components/ui/colormapOptions';
import {
  asciiMinus as asciiMinusShared,
  displayMinus,
  formatLayerValue,
  formatWorldMm,
} from '@/utils/valueFormat';

export type FramePlane = 'axial' | 'sagittal' | 'coronal';

export const PLANE_NAME: Record<FramePlane, string> = {
  axial: 'Axial',
  sagittal: 'Sagittal',
  coronal: 'Coronal',
};

/** World axis (RAS) a plane's slice position runs along. */
export const PLANE_AXIS: Record<FramePlane, 'x' | 'y' | 'z'> = {
  sagittal: 'x',
  coronal: 'y',
  axial: 'z',
};

export const PLANE_AXIS_INDEX: Record<FramePlane, 0 | 1 | 2> = {
  sagittal: 0,
  coronal: 1,
  axial: 2,
};

/**
 * Fixed-precision mm with negative zero folded to zero ("-0.0" never shows).
 * At 0.1 mm this is the status bar's formatter (`formatWorldMm`).
 */
export function formatMm(value: number, digits = 1): string {
  if (digits === 1) return formatWorldMm(value);
  if (!Number.isFinite(value)) return '—';
  const fixed = value.toFixed(digits);
  return displayMinus(Number(fixed) === 0 ? (0).toFixed(digits) : fixed);
}

/** U+2212 for ASCII hyphen-minus: negative numbers align with positive ones in Mono. */
export function trueMinus(text: string): string {
  return displayMinus(text);
}

/** Inverse of `trueMinus` for parsing / comparing header text. */
export function asciiMinus(text: string): string {
  return asciiMinusShared(text);
}

/**
 * Full position: "z 17.5 mm" (0.1 mm, true minus). The axis letter binds the
 * number, so there is no "=". Same digits as the status bar (`formatWorldMm`).
 */
export function formatSlicePosition(plane: FramePlane, mm: number): string {
  return `${PLANE_AXIS[plane]} ${trueMinus(formatMm(mm))} mm`;
}

/** Compact position: "z 17.5" — same 0.1 mm digits, only the unit dropped. */
export function formatSlicePositionCompact(plane: FramePlane, mm: number): string {
  return `${PLANE_AXIS[plane]} ${trueMinus(formatMm(mm))}`;
}

export type HeaderDensity = 'full' | 'compact' | 'hidden';

const MONO_CH = 6.6; // Plex Mono 11px advance
const SANS_CH = 6.2; // Plex Sans 11px, average
const PART_GAP = 8; // gap-2
const PAD = 8; // px-1 both sides (full form)
const PAD_COMPACT = 4; // px-0.5 both sides (compact form)
/** Middle-truncated names keep at least this many leading / trailing characters. */
const NAME_HEAD = 6;
const NAME_TAIL = 8;
const MIN_NAME_CHARS = NAME_HEAD + 1 + NAME_TAIL;
/** The widest full form without a name: "Sagittal  x −126.5 mm". */
const FULL_MIN_WIDTH = PAD + 'x -126.5 mm'.length * MONO_CH + 'Sagittal'.length * SANS_CH + PART_GAP;

/** Header width budget inside a canvas area: half the view minus the top-letter margin. */
export function headerMaxWidth(width: number): number {
  return Math.max(0, Math.floor(width / 2) - 14);
}

/**
 * Header density from the canvas-area size. The header is one horizontal
 * line, so the choice is driven by WIDTH: full when the widest full form fits
 * the width budget, compact otherwise. Height only hides it (below 90px the
 * view is too short to carry any annotation over data).
 */
export function headerDensity(width: number, height: number): HeaderDensity {
  if (!(height >= 90) || !(width >= 90)) return 'hidden';
  return headerMaxWidth(width) >= FULL_MIN_WIDTH ? 'full' : 'compact';
}

/**
 * Middle truncation that keeps the distinctive end of a file name:
 * "MNI152_T1_2mm_brain.nii.gz" → "MNI152…brain.nii.gz". Null when fewer than
 * 15 characters fit (6 + "…" + 8): the name is then dropped, the status bar
 * still carries it.
 */
export function middleTruncate(
  name: string,
  maxChars: number,
  minChars: number = MIN_NAME_CHARS,
): string | null {
  const chars = Array.from(name);
  if (chars.length <= maxChars) return name;
  if (maxChars < minChars) return null;
  const keep = maxChars - 1;
  // A third (at least 6, fewer only below the default minimum) for the head,
  // the rest for the distinctive tail.
  const head = Math.min(Math.max(NAME_HEAD, Math.floor(keep / 3)), Math.ceil(keep / 2));
  const tail = keep - head;
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}

export interface HeaderParts {
  plane: string | null;
  position: string;
  name: string | null;
  /** Untruncated layer name (for the accessible label). */
  fullName: string | null;
  density: Exclude<HeaderDensity, 'hidden'>;
}

/** Image-file extensions dropped from header names ("…brain.nii.gz" → "…brain"). */
export function shortLayerLabel(name: string): string {
  const short = name.replace(/\.(nii\.gz|nii|gii|mgz|mgh|img|hdr|nrrd|mnc)$/i, '');
  return short.length > 0 ? short : name;
}

/**
 * Widest position number the header must hold for an axis: the longest of
 * the axis range's formatted ends (and the current value, so a position past
 * the range is never clipped). Without a range: "−000.0", any coordinate in
 * a ±999.9 mm field of view. Layout decisions use this width, not the
 * current value's digit count, so the header does not appear / disappear or
 * re-truncate its name while scrubbing.
 */
export function reservedPositionChars(mm: number, rangeMm?: readonly [number, number] | null): number {
  const current = formatMm(mm).length;
  if (!rangeMm || !Number.isFinite(rangeMm[0]) || !Number.isFinite(rangeMm[1])) {
    return Math.max(current, '-000.0'.length);
  }
  return Math.max(current, formatMm(rangeMm[0]).length, formatMm(rangeMm[1]).length);
}

export interface HeaderOptions {
  /** World range of the plane's axis (e.g. the volume's slice extent). */
  rangeMm?: readonly [number, number] | null;
  /** Show the plane word ("Axial"); Compare states the plane in its toolbar. */
  showPlane?: boolean;
  /**
   * The name is the panel's identity (Compare): when the full form leaves no
   * room for it, keep the name with the compact position instead of dropping it.
   */
  requireName?: boolean;
  /** Previous density, for hysteresis: switching to a roomier form needs `hysteresisPx` spare. */
  previous?: Exclude<HeaderDensity, 'hidden'> | null;
  hysteresisPx?: number;
}

/**
 * Header content for a `maxWidth` budget. Two forms only:
 *   full     "Axial  z −0.5 mm  <name>"  (name middle-truncated or dropped)
 *   compact  "z −0.5"                    (plane and unit dropped, same digits)
 * The position is never truncated or rounded. Which form is used, whether the
 * header shows at all, and the name budget are decided from the RESERVED
 * position width (`reservedPositionChars`), so they are stable while
 * scrubbing. Null when not even the compact form fits (header hidden).
 */
export function headerParts(
  plane: FramePlane,
  mm: number,
  layerName: string | null | undefined,
  maxWidth: number,
  options: HeaderOptions = {},
): HeaderParts | null {
  const { rangeMm = null, showPlane = true, requireName = false, previous = null } = options;
  const hysteresis = options.hysteresisPx ?? 4;
  const posChars = reservedPositionChars(mm, rangeMm);
  const label = layerName ? shortLayerLabel(layerName) : null;
  const fullName = layerName || null;
  const planeWidth = showPlane ? PLANE_NAME[plane].length * SANS_CH + PART_GAP : 0;
  // "z " + number + " mm"
  const fullPosWidth = (2 + posChars + 3) * MONO_CH;
  const compactPosWidth = (2 + posChars) * MONO_CH;
  const fullUsed = PAD + fullPosWidth + planeWidth;
  const nameFor = (used: number) => {
    if (!label) return null;
    const chars = Math.floor((maxWidth - used - PART_GAP) / SANS_CH);
    // A panel's identity keeps a shorter (3…3) truncation rather than none.
    return middleTruncate(label, chars, requireName ? 7 : MIN_NAME_CHARS);
  };

  const fullSlack = previous === 'compact' ? hysteresis : 0;
  if (fullUsed + fullSlack <= maxWidth) {
    const name = nameFor(fullUsed);
    if (name || !requireName || !label) {
      return {
        plane: showPlane ? PLANE_NAME[plane] : null,
        position: formatSlicePosition(plane, mm),
        name,
        fullName,
        density: 'full',
      };
    }
  }
  const compactUsed = PAD_COMPACT + compactPosWidth;
  // 3px tolerance: the budget (half width − 14) already keeps ~5px clear of
  // the top letter, so the compact form still clears it by ≥2px.
  if (compactUsed <= maxWidth + 3) {
    const name = requireName ? nameFor(compactUsed) : null;
    return {
      plane: null,
      position: formatSlicePositionCompact(plane, mm),
      name,
      fullName,
      density: 'compact',
    };
  }
  return null;
}

// ── threshold ───────────────────────────────────────────────────────────────

/**
 * Mirrors the backend's `is_default_no_threshold` (render_bridge_adapter.rs):
 * [0, 0] and [0, 100] mean "no threshold". A non-increasing range hides
 * nothing meaningful either.
 */
export function isThresholdActive(
  threshold: readonly [number, number] | null | undefined,
): boolean {
  if (!threshold) return false;
  const [lo, hi] = threshold;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  if (lo === 0 && (hi === 0 || hi === 100)) return false;
  return hi > lo;
}

/**
 * The render path only sends threshold ranges, and the backend always applies
 * ThresholdMode::Range (shader mode 0): samples with lo ≤ v ≤ hi are hidden,
 * bounds inclusive. A symmetric range therefore hides |v| ≤ hi.
 */
export function thresholdExpressionParts(
  threshold: readonly [number, number] | null | undefined,
  symbol: string = 'value',
): [string, string] | null {
  if (!isThresholdActive(threshold)) return null;
  const [lo, hi] = threshold as readonly [number, number];
  const scale = Math.max(Math.abs(lo), Math.abs(hi));
  const symmetric = hi > 0 && Math.abs(lo + hi) <= 1e-6 * scale;
  if (symmetric) return [`|${symbol}|`, `≤ ${formatLayerValue(hi)}`];
  return [`${formatLayerValue(lo)} ≤ ${symbol}`, `≤ ${formatLayerValue(hi)}`];
}

export function thresholdExpression(
  threshold: readonly [number, number] | null | undefined,
  symbol: string = 'value',
): string | null {
  const parts = thresholdExpressionParts(threshold, symbol);
  return parts ? parts.join(' ') : null;
}

/** Hatch for a hidden (thresholded-out) interval: absent, canvas ground with a faint hatch. */
export const HIDDEN_BAND_BACKGROUND =
  'repeating-linear-gradient(135deg, var(--bf-border-strong) 0 1px, transparent 1px 4px), var(--bf-bg-canvas)';

export function thresholdWording(
  threshold: readonly [number, number] | null | undefined,
  symbol: string = 'value',
): string | null {
  const expr = thresholdExpression(threshold, symbol);
  return expr ? `${expr} hidden` : null;
}

// ── colorbar ────────────────────────────────────────────────────────────────

export interface ColorbarTick {
  value: number;
  label: string;
  /** 0 at the bottom (window min) to 1 at the top (window max). */
  fraction: number;
  kind: 'window' | 'threshold' | 'zero';
}

function fractionOf(value: number, min: number, max: number): number {
  return max > min ? (value - min) / (max - min) : 0;
}

/**
 * Ticks for a vertical colorbar: window ends first, then the threshold edges,
 * then 0 for a signed window; a candidate closer than `minSpacingPx` to an
 * accepted tick is dropped. Returned top to bottom.
 *
 * With `dataRange`, a window end the data runs past carries a clipping cue:
 * "≥ 6" at the top when data max > window max, "≤ -6" at the bottom when
 * data min < window min (those values are drawn in the end colour).
 */
export function colorbarTicks(
  window: readonly [number, number],
  threshold: readonly [number, number] | null | undefined,
  heightPx: number,
  minSpacingPx = 12,
  dataRange?: { min: number; max: number } | null,
): ColorbarTick[] {
  const [min, max] = window;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const candidates: Array<Omit<ColorbarTick, 'label' | 'fraction'>> = [
    { value: max, kind: 'window' },
    { value: min, kind: 'window' },
  ];
  if (isThresholdActive(threshold)) {
    // Upper edge first: when the band is too narrow for both labels, keep +hi.
    for (const v of [...(threshold as readonly [number, number])].reverse()) {
      if (v > min && v < max) candidates.push({ value: v, kind: 'threshold' });
    }
  }
  if (min < 0 && max > 0) candidates.push({ value: 0, kind: 'zero' });

  const accepted: ColorbarTick[] = [];
  for (const c of candidates) {
    const fraction = fractionOf(c.value, min, max);
    const tooClose = accepted.some(
      (t) => t.value === c.value || Math.abs(t.fraction - fraction) * heightPx < minSpacingPx,
    );
    if (tooClose) continue;
    let label = formatLayerValue(c.value);
    if (c.kind === 'window' && dataRange) {
      if (c.value === max && dataRange.max > max) label = `≥ ${label}`;
      else if (c.value === min && dataRange.min < min) label = `≤ ${label}`;
    }
    accepted.push({ ...c, fraction, label });
  }
  return accepted.sort((a, b) => b.fraction - a.fraction);
}

/** Hidden threshold band as bar fractions [from, to] (bottom-up), clipped to the window. */
export function hiddenBand(
  window: readonly [number, number],
  threshold: readonly [number, number] | null | undefined,
): [number, number] | null {
  if (!isThresholdActive(threshold)) return null;
  const [min, max] = window;
  if (!(max > min)) return null;
  const [lo, hi] = threshold as readonly [number, number];
  const from = Math.max(0, fractionOf(lo, min, max));
  const to = Math.min(1, fractionOf(hi, min, max));
  return to > from ? [from, to] : null;
}

/**
 * The Inspector colormap strip's gradient (colormapOptions), turned upright:
 * min at the bottom, max at the top. Null for colormaps the strip does not
 * know (e.g. registered categorical palettes) — no colours are invented.
 */
export function colormapVerticalGradient(name: string | null | undefined): {
  gradient: string;
  label: string;
} | null {
  const option = colormaps.find((c) => c.name === name);
  if (!option) return null;
  return { gradient: option.gradient.replace('to right', 'to top'), label: option.label };
}
