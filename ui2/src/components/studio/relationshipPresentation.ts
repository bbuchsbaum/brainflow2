/**
 * Pure presentation helpers for the relationship section (W1 UI): number
 * formatting, peek placement and peek slice stepping. Kept out of the
 * component files so they stay fast-refresh friendly and unit-testable.
 */
import {
  populationSliceStepPoint,
  type PopulationOrientation,
} from '@/services/studio/PopulationSliceService';
import type { RelationshipFit } from '@/services/studio/PopulationRelationshipService';
import { shortImageNames } from '@/services/studio/designPanelModel';
import type { ViewPlane } from '@/types/coordinates';

/** The peek's own slice: where it is and which plane it shows. */
export interface PopulationPeekView {
  crosshairMm: [number, number, number];
  orientation: PopulationOrientation;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/**
 * A distance to three significant figures. Values below a millionth of
 * `scale` (the fit's largest distance) print as 0: they are rounding, not
 * resolvable differences (see the tie rule in relationshipNeighbours.ts).
 */
export function formatRelationshipDistance(d: number, scale = 0): string {
  return d === 0 || d <= scale * 1e-6 ? '0' : d.toPrecision(3);
}

/** The largest declared distance of a fit, the scale for `formatRelationshipDistance`. */
export function relationshipDistanceScale(fit: RelationshipFit): number {
  let max = 0;
  for (const row of fit.geometry.distances) for (const d of row) if (d > max) max = d;
  return max;
}

/**
 * The declared distance in full: the measure's one name with its formula
 * ("correlation (√(2−2r))"), as captions, tooltips and screen readers say it.
 */
export function distanceDefinition(distance: RelationshipFit['request']['distance']): string {
  return distance === 'effect' ? 'amplitude (RMS difference, map units)' : 'correlation (√(2−2r))';
}

/** Hover delay before the peek opens. */
export const PEEK_HOVER_DELAY_MS = 150;
/** Grace period to move from a point into its peek before it closes. */
export const PEEK_DISMISS_DELAY_MS = 150;

/** Outer width of the peek, px; the placement logic keeps it inside its bounds. */
export const PEEK_WIDTH = 232;
/** Approximate outer height of the peek, px, for placement. */
export const PEEK_HEIGHT = 330;

/** Peek position inside `bounds` (px, relative to it), beside the anchor point. */
export function placePeek(
  anchor: { x: number; y: number },
  bounds: { width: number; height: number },
  size = { width: PEEK_WIDTH, height: PEEK_HEIGHT },
): { left: number; top: number } {
  const gap = 12;
  let left = anchor.x + gap;
  if (left + size.width > bounds.width) left = anchor.x - gap - size.width;
  left = Math.max(0, Math.min(left, bounds.width - size.width));
  const top = Math.max(0, Math.min(anchor.y - size.height / 2, bounds.height - size.height));
  return { left, top };
}

/** Millimetres per wheel notch, as the lens's slice buttons step. */
const WHEEL_STEP_MM = 1;

export const NORMAL_AXIS: Record<PopulationOrientation, { index: number; name: string }> = {
  axial: { index: 2, name: 'z' },
  coronal: { index: 1, name: 'y' },
  sagittal: { index: 0, name: 'x' },
};

/**
 * The plane to step along: the shown raster's, but only when it was read in
 * the view's orientation (after a plane switch the old plane's normal is wrong).
 */
export function peekStepPlane(
  raster: { orientation: PopulationOrientation; plane: ViewPlane } | null | undefined,
  view: PopulationPeekView,
): ViewPlane | null {
  return raster && raster.orientation === view.orientation ? raster.plane : null;
}

/** The view after one wheel step (`direction` +1 towards +R/+A/+S). */
export function steppedPeekView(
  view: PopulationPeekView,
  direction: number,
  plane: ViewPlane | null,
): PopulationPeekView {
  const moved = plane
    ? populationSliceStepPoint(plane, view.crosshairMm, direction * WHEEL_STEP_MM)
    : null;
  if (moved) return { ...view, crosshairMm: moved };
  const crosshairMm = [...view.crosshairMm] as [number, number, number];
  crosshairMm[NORMAL_AXIS[view.orientation].index] += direction * WHEEL_STEP_MM;
  return { ...view, crosshairMm };
}

/** The measure's one name, short enough for a column header ("correlation", "amplitude"). */
export function distanceUnit(distance: RelationshipFit['request']['distance']): string {
  return distance === 'effect' ? 'amplitude' : 'correlation';
}

/** Where one subject's value stands among the others at the pin. */
export interface ValueStanding {
  /** 1 = lowest, among finite values (ties share the lower rank). */
  rank: number;
  /** Finite values ranked. */
  of: number;
  /** Leave-one-out z: (value − mean of the others) / SD of the others; null when undefined. */
  z: number | null;
}

/**
 * The rank of `value` among the finite `values` (which include it) and its
 * leave-one-out z against the others. Null when `value` is not finite.
 */
export function valueStanding(
  value: number | null | undefined,
  values: readonly (number | null | undefined)[],
): ValueStanding | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const rank = finite.filter((v) => v < value).length + 1;
  // The others: every finite value but one copy of this one.
  const at = finite.indexOf(value);
  const others = at < 0 ? finite : [...finite.slice(0, at), ...finite.slice(at + 1)];
  let z: number | null = null;
  if (others.length >= 2) {
    const mean = others.reduce((a, v) => a + v, 0) / others.length;
    const variance = others.reduce((a, v) => a + (v - mean) ** 2, 0) / (others.length - 1);
    z = variance > 0 ? (value - mean) / Math.sqrt(variance) : null;
  }
  return { rank, of: Math.max(finite.length, rank), z };
}

/** A signed number with a true minus sign ("−0.1"). */
export function signed(text: string): string {
  return text.replace(/^-/, '−');
}

/**
 * A metadata value that lists several file paths ("a/x.nii.gz,a/y.nii.gz"):
 * their short names, in order. Null when the value is not such a list.
 */
export function pathListNames(value: string): { path: string; name: string }[] | null {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || !parts.every((part) => /[\\/]|\.[A-Za-z0-9]{1,8}$/.test(part)))
    return null;
  const names = shortImageNames(parts);
  return parts.map((path) => ({ path, name: names.get(path) ?? path }));
}
