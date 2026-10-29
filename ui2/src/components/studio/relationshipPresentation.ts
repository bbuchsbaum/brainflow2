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

/** The declared distance, as a column header. */
export function distanceDefinition(distance: RelationshipFit['request']['distance']): string {
  return distance === 'effect' ? 'RMS difference, map units' : 'pattern shape, √(2 − 2r)';
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
