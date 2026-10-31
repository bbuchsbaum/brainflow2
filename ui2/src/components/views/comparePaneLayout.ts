/** Layout of the Compare pane header (ComparePaneHeader). */
import {
  formatSlicePosition,
  formatSlicePositionUnitOnly,
  headerMaxWidth,
  type FramePlane,
} from './viewportFrame/frameFormat';

/** Narrowest picker (a few characters and the chevron). */
export const PANE_PICKER_MIN_PX = 72;
const LETTER_PX = 24;
const POSITION_CH_PX = 6.6;

/** Which parts fit: the picker always; the position full, unit-only or not at all. */
export function paneHeaderLayout(
  width: number,
  positionMm: number,
  plane: FramePlane,
  hasLetter: boolean,
  rangeMm: readonly [number, number] | null = null,
) {
  const budget = Math.max(PANE_PICKER_MIN_PX, headerMaxWidth(width) - (hasLetter ? LETTER_PX : 0));
  // Sized for the widest position of the range, so scrubbing never re-flows it.
  const values = [positionMm, ...(rangeMm ?? [])].filter(Number.isFinite);
  const widest = (format: (mm: number) => string) =>
    Math.max(...values.map((mm) => format(mm).length)) * POSITION_CH_PX + 8;
  const fullRoom = widest((mm) => formatSlicePosition(plane, mm));
  const shortRoom = widest(formatSlicePositionUnitOnly);
  const room =
    budget - fullRoom >= PANE_PICKER_MIN_PX
      ? fullRoom
      : budget - shortRoom >= PANE_PICKER_MIN_PX
        ? shortRoom
        : 0;
  const position =
    room === 0
      ? null
      : room === fullRoom
        ? formatSlicePosition(plane, positionMm)
        : formatSlicePositionUnitOnly(positionMm);
  const pickerMax = Math.max(PANE_PICKER_MIN_PX, budget - room);
  return { position, pickerMax };
}
