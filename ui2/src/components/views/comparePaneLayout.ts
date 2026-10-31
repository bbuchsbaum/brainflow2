/** Layout of the Compare pane header (ComparePaneHeader). */
import {
  formatSlicePosition,
  formatSlicePositionUnitOnly,
  type FramePlane,
} from './viewportFrame/frameFormat';

/** Narrowest picker (a few characters and the chevron). */
export const PANE_PICKER_MIN_PX = 72;
/**
 * Width the name keeps before the position or the pane controls get any
 * (about 14 characters; QA 2026-10-31 F7.3: names cut to "Free…").
 */
export const PANE_NAME_PREFERRED_PX = 140;
const LETTER_PX = 24;
const POSITION_CH_PX = 6.6;
/** Header inset from the left edge and a gap before the right slot. */
const EDGE_PX = 12;

export interface PaneHeaderLayoutOptions {
  /** Width of the pane's right slot (its value, link glyph) the header must leave free. */
  rightReservePx?: number;
  /** Width of the pane controls that replace the position on hover / focus. */
  controlsPx?: number;
}

/**
 * Which parts fit, the name first: the picker keeps
 * {@link PANE_NAME_PREFERRED_PX} (or all there is); the trailing slot holds
 * the position (full, unit-only or none) and, on hover, the pane controls,
 * so the controls take the position's room, never the name's.
 */
export function paneHeaderLayout(
  width: number,
  positionMm: number,
  plane: FramePlane,
  hasLetter: boolean,
  rangeMm: readonly [number, number] | null = null,
  { rightReservePx = 0, controlsPx = 0 }: PaneHeaderLayoutOptions = {},
) {
  const budget = Math.max(
    PANE_PICKER_MIN_PX,
    width - EDGE_PX - rightReservePx - (hasLetter ? LETTER_PX : 0),
  );
  const nameFloor = Math.min(PANE_NAME_PREFERRED_PX, budget);
  // Sized for the widest position of the range, so scrubbing never re-flows it.
  const values = [positionMm, ...(rangeMm ?? [])].filter(Number.isFinite);
  const widest = (format: (mm: number) => string) =>
    Math.max(...values.map((mm) => format(mm).length)) * POSITION_CH_PX + 8;
  const fullRoom = widest((mm) => formatSlicePosition(plane, mm));
  const shortRoom = widest(formatSlicePositionUnitOnly);
  const fits = (room: number) => budget - Math.max(room, controlsPx) >= nameFloor;
  const room = fits(fullRoom) ? fullRoom : fits(shortRoom) ? shortRoom : 0;
  const position =
    room === 0
      ? null
      : room === fullRoom
        ? formatSlicePosition(plane, positionMm)
        : formatSlicePositionUnitOnly(positionMm);
  // The controls never squeeze the name below its floor (they clip instead).
  const trailingPx = Math.min(Math.max(room, controlsPx), Math.max(0, budget - nameFloor));
  const pickerMax = Math.max(PANE_PICKER_MIN_PX, budget - trailingPx);
  return { position, pickerMax, trailingPx };
}
