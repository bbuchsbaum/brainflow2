/**
 * Where a newly opened volume goes in the layer stack (index 0 = bottom,
 * drawn first) and the opacity it starts with (QA design decisions
 * 2026-10-30 §2; QA 2026-10-29 §5.2: a T1, template, BOLD run or Studio beta
 * opened after an atlas or statistic covered it).
 *
 * - Every layer gets a **band** at load, bottom to top: anatomy, other
 *   continuous images (functional, mean, 4D), statistic maps, labels and
 *   atlases. Within a band the newest layer goes on top.
 * - **Sorting happens only at load.** A layer the user has moved by hand
 *   (`userMoved`) is never re-sorted, and the bands of the layers the rule
 *   placed decide where a new layer goes: it is inserted directly above the
 *   highest rule-placed layer in its band or a lower one, or at the bottom
 *   when there is none. A hand-moved layer therefore keeps its neighbours:
 *   one moved just above a T1 stays above that T1 and any anatomy opened
 *   later. Only when every layer has been moved by hand do their bands
 *   decide.
 * - **Field of view, within an image band:** a new image that covers a
 *   much smaller one of its band (a whole-head T1 opened after an oblique
 *   slab) goes under it rather than hiding it (QA 2026-10-30 F38). It is
 *   then not "on" that image and keeps full opacity.
 * - **Opacity:** a continuous image (band 1 or 2) that lands on a visible
 *   continuous layer of its band, or a band-2 image (BOLD, a mean EPI) that
 *   lands on visible anatomy, opens at {@link STACKED_CONTINUOUS_OPACITY}:
 *   an opaque EPI hides the anatomy it is shown on (QA 2026-10-30 F16). A
 *   categorical overlay (labels, atlas, mask) opened over a visible
 *   statistic or categorical layer starts at {@link STACKED_OVERLAY_OPACITY},
 *   so the layer under it stays readable. Statistics keep full opacity:
 *   their sub-threshold voxels are already transparent.
 */

import { looksLikeSegmentation } from '@/utils/labelTable';

/** The fields of a layer (and its metadata) the rule reads. */
export interface PlacementLayer {
  id: string;
  type?: string;
  source?: string;
  statistic?: unknown;
  isLabelMap?: boolean;
  volumeType?: string;
  visible?: boolean;
  name?: string;
  sourcePath?: string;
  /** Moved by the user in the layer list: never re-sorted. */
  userMoved?: boolean;
}

export interface PlacementMetadata {
  isBinaryLike?: boolean;
  /** Axis-aligned world box of the image (mm), for the field-of-view rule. */
  worldBounds?: { min: readonly number[]; max: readonly number[] };
  dataRange?: { min: number; max: number };
  /** On-disk voxel type of the source ('u8', 'i16', 'float32', …). */
  nativeDtype?: string;
}

export type PlacementRole = 'underlay' | 'overlay';

/** Start opacity of a categorical overlay opened over another overlay. */
export const STACKED_OVERLAY_OPACITY = 0.6;

/** Start opacity of a continuous image opened on one of its own band. */
export const STACKED_CONTINUOUS_OPACITY = 0.5;

/** Stack bands, bottom to top. */
export const PlacementBand = {
  Anatomy: 1,
  Continuous: 2,
  Statistic: 3,
  Label: 4,
} as const;
export type PlacementBand = (typeof PlacementBand)[keyof typeof PlacementBand];

/** Largest value of an integer image read as a small label map (ROI indices). */
export const SMALL_LABEL_MAX = 64;

const INTEGER_DTYPE = /^(u|i|uint|int)(8|16|32|64)$/i;

/**
 * An integer image holding a few non-negative ids (1…{@link SMALL_LABEL_MAX}):
 * an ROI or lesion index map without a label table. Anatomy stored as
 * integers (a uint8 T1, an int16 CT) has a far larger range. The volume's
 * unique-value count is not known at load, so the range stands in for it.
 */
export function isSmallIntegerLabelMap(meta?: PlacementMetadata): boolean {
  const range = meta?.dataRange;
  if (!meta?.nativeDtype || !INTEGER_DTYPE.test(meta.nativeDtype) || !range) return false;
  return range.min >= 0 && range.max >= 1 && range.max <= SMALL_LABEL_MAX && Number.isInteger(range.max);
}

/** The file or layer name reads as a segmentation (dseg, aseg, roi, atlas…). */
function namedLikeSegmentation(layer: Pick<PlacementLayer, 'name' | 'sourcePath'>): boolean {
  const file = layer.sourcePath?.split(/[\\/]/).pop() ?? '';
  return looksLikeSegmentation(file.toLowerCase()) || looksLikeSegmentation((layer.name ?? '').toLowerCase());
}

/**
 * A small-integer image that is evidently a label map: its name says so
 * (roi_3, sub-01_dseg). Without that, the same range is as likely a count
 * or ordinal map (lesion overlap n = 20, subject counts, node degree), which
 * is drawn as values, not categories (review of QA 2026-10-30 F17).
 */
function isNamedSmallLabelMap(layer: PlacementLayer, meta?: PlacementMetadata): boolean {
  return isSmallIntegerLabelMap(meta) && namedLikeSegmentation(layer);
}

function isCategorical(layer: PlacementLayer, meta?: PlacementMetadata): boolean {
  if (layer.type === 'label' || layer.isLabelMap === true || layer.source === 'atlas') return true;
  // A binary image is a mask whatever its name or source (lesion.nii.gz,
  // roi_amygdala.nii.gz, a template brain mask).
  if (meta?.isBinaryLike === true) return true;
  if (layer.type === 'mask') {
    // Templates type tissue maps and skull-stripped brains as 'mask': those
    // (non-binary) are images.
    return layer.source !== 'template';
  }
  return layer.source !== 'template' && isNamedSmallLabelMap(layer, meta);
}

/**
 * The layer type an image opened as plain anatomy takes once its data is
 * known: a true {0, 1} image is drawn as a label map whatever its name (QA
 * 2026-10-30 F17: a uint8 0/1 lesion opened as a grey volume over the
 * head). Other small-integer images are not retyped: a segmentation-named
 * one was typed 'label' at load (inferLayerTypeFromName), and an unnamed one
 * may be a count map. Null when the type stands.
 */
export function categoricalTypeFromData(
  layer: Pick<PlacementLayer, 'type' | 'source' | 'volumeType'>,
  meta?: PlacementMetadata,
): 'label' | null {
  if (layer.type !== 'anatomical' || layer.volumeType === 'TimeSeries4D') return null;
  if (layer.source === 'template' || layer.source === 'atlas' || layer.source === 'parcel-table') return null;
  return meta?.isBinaryLike === true ? 'label' : null;
}

/** The stack band a layer is placed in at load. */
export function placementBand(layer: PlacementLayer, meta?: PlacementMetadata): PlacementBand {
  // A cluster mask named after its statistic (cluster_mask_zstat1) is a mask.
  if (isCategorical(layer, meta)) return PlacementBand.Label;
  // Statistic signals win over the value range: a mostly-positive z map
  // (−2.5…6.1) is not "signed" but is still a statistic. `statistic` carries
  // the NIfTI intent / SPM descrip (backend) and zstat/tstat names.
  if (layer.statistic || looksLikeStatisticName(layer)) return PlacementBand.Statistic;
  // An unnamed small-integer map (lesion overlap, subject counts) is a
  // derived value map shown over the images, like a statistic, and under
  // labels and atlases.
  if (layer.source !== 'template' && isSmallIntegerLabelMap(meta)) return PlacementBand.Statistic;
  // A functional or 4D image is continuous even when signed (demeaned or
  // z-scored BOLD): only a declared or named statistic, above, moves it.
  if (layer.type === 'functional' || layer.volumeType === 'TimeSeries4D') return PlacementBand.Continuous;
  // A signed 3D map (betas, contrasts) is drawn like a statistic. "Signed"
  // means a substantial negative tail, so a T1 or bias-corrected image with
  // a few negative voxels, or a CT in Hounsfield units (−1024…3071), stays
  // anatomy. Templates are always images.
  if (layer.source !== 'template' && isSignedMap(meta?.dataRange)) return PlacementBand.Statistic;
  return PlacementBand.Anatomy;
}

/** Whether a layer sits under overlays (bands 1–2) or over the images below it. */
export function placementRole(layer: PlacementLayer, meta?: PlacementMetadata): PlacementRole {
  return placementBand(layer, meta) <= PlacementBand.Continuous ? 'underlay' : 'overlay';
}

/**
 * A statistic-map file name the display does not claim as a statistic
 * (spmT_0001, spmF, zmap, tmap, zscore): used for placement only.
 */
const STATISTIC_NAME = /(^|[_\-.\s])(spm[tf]|[zt](stat|map|score)s?)([_\-.\s\d]|$)/i;
export function looksLikeStatisticName(layer: Pick<PlacementLayer, 'name' | 'sourcePath'>): boolean {
  const file = layer.sourcePath?.split(/[\\/]/).pop() ?? '';
  return STATISTIC_NAME.test(file) || STATISTIC_NAME.test(layer.name ?? '');
}

/** Negative values reach at least half the positive maximum. */
export function isSignedMap(range: { min: number; max: number } | undefined): boolean {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return false;
  return range.min < 0 && -range.min >= 0.5 * Math.max(range.max, 0);
}

/**
 * Index (into `existing`, bottom first) at which `added` is inserted, and
 * the opacity it starts with when it differs from 1.
 */
export function planLayerPlacement(
  existing: ReadonlyArray<PlacementLayer>,
  added: PlacementLayer,
  metadataOf: (id: string) => PlacementMetadata | undefined = () => undefined,
): { index: number; opacity?: number } {
  const others = existing.filter((layer) => layer.id !== added.id);
  const bandOf = (layer: PlacementLayer) => placementBand(layer, metadataOf(layer.id));
  const band = bandOf(added);
  const placed = others.filter((layer) => !layer.userMoved);
  const reference = placed.length > 0 ? placed : others;
  const anchor = [...reference].reverse().find((layer) => bandOf(layer) <= band);
  let index = anchor ? others.indexOf(anchor) + 1 : 0;

  const visible = (layer: PlacementLayer) => layer.visible !== false;
  if (band <= PlacementBand.Continuous) {
    const box = metadataOf(added.id)?.worldBounds;
    while (index > 0) {
      const below = others[index - 1];
      if (below.userMoved || bandOf(below) !== band || !coversMuchSmaller(box, metadataOf(below.id)?.worldBounds)) break;
      index -= 1;
    }
    const onContinuous = others
      .slice(0, index)
      .some((layer) => visible(layer) && bandOf(layer) <= band);
    return onContinuous ? { index, opacity: STACKED_CONTINUOUS_OPACITY } : { index };
  }
  const overVisibleOverlay = others.some(
    (layer) => visible(layer) && bandOf(layer) >= PlacementBand.Statistic,
  );
  return overVisibleOverlay && band === PlacementBand.Label
    ? { index, opacity: STACKED_OVERLAY_OPACITY }
    : { index };
}

/** A box at least this many times the volume of another "covers" it. */
const COVER_VOLUME_RATIO = 4;

/**
 * `outer` has at least {@link COVER_VOLUME_RATIO} times the volume of
 * `inner` and contains its centre: a whole-head image over a slab or patch.
 */
export function coversMuchSmaller(
  outer: PlacementMetadata['worldBounds'],
  inner: PlacementMetadata['worldBounds'],
): boolean {
  if (!outer || !inner) return false;
  const volume = (b: NonNullable<PlacementMetadata['worldBounds']>) =>
    [0, 1, 2].reduce((v, axis) => v * Math.max(0, b.max[axis] - b.min[axis]), 1);
  const small = volume(inner);
  if (!(small > 0) || !(volume(outer) >= COVER_VOLUME_RATIO * small)) return false;
  return [0, 1, 2].every((axis) => {
    const centre = (inner.min[axis] + inner.max[axis]) / 2;
    return centre >= outer.min[axis] && centre <= outer.max[axis];
  });
}

/**
 * The layer order after placing `layerId` by the rule, or null when it is
 * already where the rule puts it or the user has moved it.
 */
export function placementOrder(
  layers: ReadonlyArray<PlacementLayer>,
  layerId: string,
  metadataOf?: (id: string) => PlacementMetadata | undefined,
): string[] | null {
  const added = layers.find((layer) => layer.id === layerId);
  if (!added || added.userMoved) return null;
  const others = layers.filter((layer) => layer.id !== layerId).map((layer) => layer.id);
  const { index } = planLayerPlacement(layers, added, metadataOf);
  if (layers[index]?.id === layerId) return null;
  return [...others.slice(0, index), layerId, ...others.slice(index)];
}
