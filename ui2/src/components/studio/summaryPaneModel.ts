import {
  populationHiddenBand,
  populationOverlayRgba,
} from '@/services/studio/PopulationSliceService';
import { worldToSliceImagePoint } from '@/components/views/sliceViewer/geometry';

/** What the Summary arrangement's second pane shows of the focused subject. */
export type SubjectPaneView = 'map' | 'difference';

/** "Group mean", "Group median", "Group coverage": the statistic the Summary select names. */
export function groupStatisticTitle(statistic: string): string {
  return `Group ${statistic.charAt(0).toLowerCase()}${statistic.slice(1)}`;
}

const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * What the statistic was computed over, named as truthfully as the set
 * allows. Averaged per participant: "3 participants". Each observation its
 * own declared participant: "35 subjects". Several observations of some
 * participants (runs, sessions): "80 observations from 41 participants".
 * With no participant identity declared nothing says who is who (names never
 * imply people), so: "80 observations".
 */
export function unitCountText(
  count: number,
  units: { aggregated: boolean; participants: number | null },
): string {
  if (units.aggregated) return counted(count, 'participant');
  if (units.participants === null) return counted(count, 'observation');
  if (units.participants === count) return counted(count, 'subject');
  return `${counted(count, 'observation')} from ${counted(units.participants, 'participant')}`;
}

/**
 * The focused subject's map minus the group statistic, pixel by pixel on the
 * plane both were sampled on. Where either has no value the difference has none.
 */
export function subjectDifference(
  subject: readonly (number | null)[],
  group: readonly (number | null)[],
): (number | null)[] {
  return subject.map((value, i) => {
    const reference = group[i];
    return value === null ||
      reference === null ||
      reference === undefined ||
      !Number.isFinite(value) ||
      !Number.isFinite(reference)
      ? null
      : value - reference;
  });
}

/** The difference drawn as every signed population map is: diverging, over the anatomy. */
export function differenceRgba(
  difference: readonly (number | null)[],
  limit: number,
  underlay: Float32Array | null | undefined,
): Uint8ClampedArray {
  return populationOverlayRgba(difference, limit, true, {
    band: populationHiddenBand(limit),
    underlay: underlay ?? null,
  });
}

/** The subject before (−1) or after (+1) `focusedId` in the order shown, or null at an end. */
export function neighbouringSubject(
  ids: readonly string[],
  focusedId: string | null,
  direction: -1 | 1,
): string | null {
  const index = ids.indexOf(focusedId ?? '');
  if (index < 0) return direction > 0 ? (ids[0] ?? null) : null;
  return ids[index + direction] ?? null;
}

/**
 * The value of a plane's raster at a world point (the pixel it falls in), or
 * null off the plane, outside it, or where there is no value.
 */
export function planeValueAt(
  values: readonly (number | null)[],
  plane: {
    origin_mm: readonly number[];
    u_mm: readonly number[];
    v_mm: readonly number[];
    dim_px: readonly number[];
  },
  worldMm: readonly number[],
): number | null {
  const point = worldToSliceImagePoint(
    [worldMm[0], worldMm[1], worldMm[2]],
    plane as Parameters<typeof worldToSliceImagePoint>[1],
  );
  if (!point) return null;
  const x = Math.round(point[0]),
    y = Math.round(point[1]);
  const [width, height] = plane.dim_px;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const value = values[y * width + x];
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}
