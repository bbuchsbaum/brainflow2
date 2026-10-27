/**
 * Default file names for composited exports: readable and filesystem-safe.
 *
 * A position is written with its axis letter before the signed value
 * ("z-10.0", "x42.0"), so a name never shows "_-" (a separator followed by
 * a sign reads as a typo and some shells treat "-…" fields as options):
 *
 *   zmap_synthetic_axial_z-10.0mm.png
 *   zmap_synthetic_row_x42.0_y-60.0_z-10.0mm.png
 *   zmap_synthetic_mosaic_axial_z-3.0_to_z11.0mm.png
 *
 * Only [A-Za-z0-9_.-] survive; runs of anything else become one "_".
 */
import type { ViewType } from '@/types/coordinates';
import { formatWorldMmAscii } from '@/utils/valueFormat';

type ImageExt = 'png' | 'jpg';

const AXIS_OF: Record<ViewType, 'x' | 'y' | 'z'> = { sagittal: 'x', coronal: 'y', axial: 'z' };
const AXES = ['x', 'y', 'z'] as const;

/** A layer name as a file-name stem: no image extension, safe characters only. */
export function exportFileBase(name: string | null | undefined, fallback = 'view'): string {
  const stem = (name ?? '')
    .replace(/\.(nii\.gz|nii|gii|mgz|mgh|png|jpe?g)$/i, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '');
  return stem || fallback;
}

/** "z-10.0", "x42.0", "y0.0" (negative zero folded). */
export function axisPositionToken(axis: 'x' | 'y' | 'z', mm: number): string {
  const value = Number.isFinite(mm) ? formatWorldMmAscii(mm) : '0.0';
  return `${axis}${value}`;
}

/** One slice: "<layer>_<plane>_<axis><mm>mm.<ext>". */
export function sliceFileName(
  name: string | null,
  viewType: ViewType,
  mm: number,
  format: ImageExt,
): string {
  return `${exportFileBase(name)}_${viewType}_${axisPositionToken(AXIS_OF[viewType], mm)}mm.${format}`;
}

/** The orthogonal layout or the figure row, named by the crosshair: "<layer>_row_x…_y…_z…mm.<ext>". */
export function layoutFileName(
  name: string | null,
  kind: 'orthogonal' | 'row',
  crosshairMm: readonly number[],
  format: ImageExt,
): string {
  const position = AXES.map((axis, d) => axisPositionToken(axis, crosshairMm[d])).join('_');
  return `${exportFileBase(name)}_${kind}_${position}mm.${format}`;
}

/** A montage: "<layer>_mosaic_<plane>_<axis><first>_to_<axis><last>mm.<ext>". */
export function mosaicFileName(
  name: string | null,
  viewType: ViewType,
  firstMm: number,
  lastMm: number,
  format: ImageExt,
): string {
  const axis = AXIS_OF[viewType];
  return `${exportFileBase(name, 'mosaic')}_mosaic_${viewType}_${axisPositionToken(axis, firstMm)}_to_${axisPositionToken(axis, lastMm)}mm.${format}`;
}

/** A surface figure: "<layer>_<kind>_<lh|rh|lh_rh>.<ext>" (D4). */
export function surfaceFileName(
  name: string | null,
  kind: 'surface' | 'lat_med',
  hemispheres: ReadonlyArray<'left' | 'right'>,
  format: ImageExt,
): string {
  const hemi = hemispheres.map((h) => (h === 'left' ? 'lh' : 'rh')).join('_');
  return `${exportFileBase(name, 'surface')}_${kind}${hemi ? `_${hemi}` : ''}.${format}`;
}
