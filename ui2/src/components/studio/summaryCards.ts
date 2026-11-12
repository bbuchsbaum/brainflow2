import { useEffect, useMemo, useState } from 'react';
import type { ViewPlane } from '@/types/coordinates';
import {
  POSITIVE_FRACTION_CENTRE,
  populationHiddenBand,
  robustPopulationLimit,
  type PopulationSliceDisplay,
  type PopulationSummary,
} from '@/services/studio/PopulationSliceService';
import {
  clearTileBackground,
  montageBackground,
  montageSharedCrop,
  stableMontageCrop,
  summaryCropKey,
  type MontageCrop,
  type MontageCropMemory,
} from './montageTileSupport';
import { differenceRgba, subjectDifference } from './summaryPaneModel';

/** The "All" card's statistics, in the order its switch offers them. */
export const ALL_CARD_STATISTICS: readonly { value: PopulationSummary; label: string; name: string }[] = [
  { value: 'mean', label: 'Mean', name: 'mean' },
  { value: 'oneSampleT', label: 't', name: 't' },
  { value: 'positiveFraction', label: '% positive', name: '% positive' },
];

/** The statistic the "All" card shows: the request's, when it is one the card offers. */
export function allCardStatistic(summary: PopulationSummary): PopulationSummary {
  return ALL_CARD_STATISTICS.some((option) => option.value === summary) ? summary : 'mean';
}

/**
 * A card's colour scale in words: "colour ±0.0145" for a signed map on a
 * symmetric scale; the sign share always runs 0–100 %.
 */
export function cardScaleText(summary: PopulationSummary, limit: number): string {
  if (summary === 'positiveFraction') return 'colour 0–100 %';
  return `colour ±${formatLimit(limit)}`;
}

function formatLimit(limit: number) {
  if (!Number.isFinite(limit)) return '—';
  return Number(limit.toPrecision(3)).toString();
}

/** "Similarity group 2" and "Group 2" read "G2"; a factor level keeps its name. */
export function shortGroupLabel(label: string): string {
  return label.replace(/^(?:similarity\s+)?group\s+(?=\S)/i, 'G');
}

/**
 * One header line, never truncated: "G1 · 29", "All · 35", "All · 35 · t"
 * (a statistic other than the mean is named). The colour scale is stated by
 * the card's own bar, or by the shared one below the cards.
 */
export function cardHeader(label: string, count: number | string, statistic?: string) {
  return `${label} · ${count}${statistic ? ` · ${statistic}` : ''}`;
}

/** The difference card's header: "G1 − G2 · 29 vs 6". */
export function differenceCardHeader(
  first: { label: string; count: number },
  second: { label: string; count: number },
) {
  return `${first.label} − ${second.label} · ${first.count} vs ${second.count}`;
}

/** A card's label row and its scale row under the image (px). */
export const CARD_HEADER_PX = 28;
export const CARD_SCALE_PX = 18;

/**
 * How the grouped Summary's cards fill the pane: the column count that
 * draws the brains largest with every card on screen (the montage's fit),
 * and each card's image height. Without a known height the cards take the
 * width alone (1–3 columns).
 */
export function fitSummaryCards({
  count,
  width,
  height,
  aspect,
  gap,
  minImage = 80,
  maxImage = 520,
}: {
  count: number;
  width: number;
  height: number | null;
  /** Crop width / height. */
  aspect: number;
  gap: number;
  minImage?: number;
  maxImage?: number;
}): { columns: number; cellWidth: number; imageHeight: number } {
  // A width not yet measured (NaN, ±Infinity, negative) fits as zero: the
  // narrowest layout, never NaN-sized cells.
  width = Number.isFinite(width) && width > 0 ? width : 0;
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const cell = (columns: number) =>
    Math.max(60, Math.floor((width - (columns - 1) * gap) / columns));
  if (height === null || !(height > 0) || count < 1) {
    const columns = Math.min(Math.max(1, count), width < 600 ? 1 : width < 960 ? 2 : 3);
    const cellWidth = cell(columns);
    return {
      columns,
      cellWidth,
      imageHeight: Math.round(Math.min(260, Math.max(120, cellWidth / ratio))),
    };
  }
  let best: { columns: number; cellWidth: number; imageHeight: number; drawn: number } | null =
    null;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = cell(columns);
    const room = Math.floor(
      (height - rows * (CARD_HEADER_PX + CARD_SCALE_PX) - (rows - 1) * gap) / rows,
    );
    const imageHeight = Math.max(minImage, Math.min(maxImage, room, Math.ceil(cellWidth / ratio)));
    // The brain's drawn width: the image keeps its aspect inside the cell.
    const drawn = Math.min(cellWidth, imageHeight * ratio);
    if (!best || drawn > best.drawn + 0.5) best = { columns, cellWidth, imageHeight, drawn };
  }
  const { columns, cellWidth, imageHeight } = best!;
  return { columns, cellWidth, imageHeight };
}

/**
 * The one crop every Summary card is drawn with: the montage's shared crop
 * (`montageSharedCrop`) over the plane, from the head (the anatomy, cleared
 * outside it) and any map value drawn outside it. The whole plane without
 * anatomy or maps. Null background without anatomy. With a `memory` the crop
 * is the largest seen on this plane's frame (`summaryCropKey`): stepping the
 * slice never resizes or shifts the cards.
 */
export function summaryCardCrop(
  display: PopulationSliceDisplay,
  maps: readonly (readonly (number | null)[])[],
  memory: MontageCropMemory | null = null,
): { crop: MontageCrop; background: Uint8Array | null } {
  const [w, h] = display.data.plane.dim_px;
  const anatomy = display.data.underlay?.values;
  const background =
    anatomy && anatomy.length === w * h ? montageBackground([w, h], anatomy, true) : null;
  const band = Number.isFinite(display.effectLimit) ? populationHiddenBand(display.effectLimit) : 0;
  const crop = montageSharedCrop(
    [w, h],
    maps.map((values) => ({ values })),
    background,
    undefined,
    band,
  );
  return {
    crop: memory ? stableMontageCrop(memory, summaryCropKey(display), crop) : crop,
    background,
  };
}

/** The plane of a crop: the same pixels and geometry, its corner moved. */
export function croppedPlane(plane: ViewPlane, crop: MontageCrop): ViewPlane {
  const origin = plane.origin_mm.map(
    (o, i) => o + crop.x * plane.u_mm[i] + crop.y * plane.v_mm[i],
  ) as ViewPlane['origin_mm'];
  return { ...plane, origin_mm: origin, dim_px: [crop.width, crop.height] };
}

const canCrop = () =>
  typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined';

/**
 * What a card shows, apart from the slice depth: the dataset, the statistic,
 * the context, the orientation and the card itself (a group id, a difference
 * pair, "all"). A card may keep its previous picture on screen while the next
 * is drawn only when this is unchanged; any other change shows nothing until
 * the new picture is ready, never another card's or another statistic's data.
 */
export function summaryCardIdentity(display: PopulationSliceDisplay, cardId: string): string {
  const request = display.query.request;
  return JSON.stringify([
    display.query.datasetKey,
    request.summary,
    request.contextKey,
    request.orientation,
    cardId,
  ]);
}

const sameCrop = (a: MontageCrop, b: MontageCrop) =>
  a === b || (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

type CardCut = {
  source: ImageBitmap;
  crop: MontageCrop;
  background: Uint8Array | null;
  identity: string;
  /** Null when the cut failed: the whole, uncut image is shown instead. */
  image: ImageBitmap | null;
  plane: ViewPlane;
};

/**
 * A card's bitmap cut to the shared crop with the anatomy outside the head
 * cleared (the panel shows through, as in the montage), and its plane. A cut
 * is used only for the image, crop and background it was made from. While a
 * new cut is made the previous one stays shown only if the card's `identity`
 * (`summaryCardIdentity`) is unchanged, i.e. only the slice moved; otherwise
 * nothing is shown until the cut is ready. If a cut cannot be made (no 2D
 * context, or the bitmap is refused) the whole image and plane are shown,
 * never a permanent blank. Cut bitmaps are left to the garbage collector
 * (ui2/CLAUDE.md).
 */
export function useCroppedCard(
  image: ImageBitmap | null,
  plane: ViewPlane,
  crop: MontageCrop,
  background: Uint8Array | null,
  identity: string,
): { image: ImageBitmap | null; plane: ViewPlane } {
  const [cut, setCut] = useState<CardCut | null>(null);
  const [w, h] = plane.dim_px;
  const whole = crop.x === 0 && crop.y === 0 && crop.width === w && crop.height === h;
  const needsCut = !!image && !(whole && !background) && canCrop();
  const shownPlane = useMemo(() => croppedPlane(plane, crop), [plane, crop]);
  useEffect(() => {
    if (!needsCut || !image) {
      setCut(null);
      return;
    }
    let alive = true;
    const settle = (bitmap: ImageBitmap | null) =>
      setCut({ source: image, crop, background, identity, image: bitmap, plane: shownPlane });
    try {
      const canvas = new OffscreenCanvas(crop.width, crop.height);
      const context = canvas.getContext('2d');
      if (!context) {
        settle(null);
        return;
      }
      context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      if (background) {
        const pixels = context.getImageData(0, 0, crop.width, crop.height);
        clearTileBackground(pixels.data, crop, w, background, false);
        context.putImageData(pixels, 0, 0);
      }
      createImageBitmap(canvas).then(
        (bitmap) => {
          if (alive) settle(bitmap);
          else bitmap.close?.();
        },
        () => {
          if (alive) settle(null);
        },
      );
    } catch {
      settle(null);
    }
    return () => {
      alive = false;
    };
  }, [image, crop, background, identity, needsCut, w, shownPlane]);
  if (!needsCut) return { image, plane };
  const current =
    cut && cut.source === image && sameCrop(cut.crop, crop) && cut.background === background;
  if (current) return cut.image ? { image: cut.image, plane: shownPlane } : { image, plane };
  // Double-buffered for slice steps only: while the new cut is being made the
  // last one stays on screen if it is this card's picture at another depth;
  // otherwise nothing (never a stale card, and never a frame of the whole,
  // uncut plane fitted to the card at another scale).
  if (cut?.image && cut.identity === identity) return { image: cut.image, plane: cut.plane };
  return { image: null, plane: shownPlane };
}

/**
 * The difference of two group means, pixel by pixel on the plane both were
 * sampled on (none where either has no value), on its own symmetric scale,
 * drawn as every signed population map is. The bitmap is null until drawn,
 * and is only ever the bitmap of the values and limit returned with it. While
 * a new difference is drawn the previous one (with its own values and limit)
 * stays shown only when `identity` is unchanged, i.e. only the slice moved.
 */
export function useGroupMeanDifference(
  display: PopulationSliceDisplay,
  first: readonly (number | null)[] | null,
  second: readonly (number | null)[] | null,
  identity: string,
) {
  const computed = useMemo(() => {
    if (!first || !second) return null;
    const values = subjectDifference(first, second);
    return { values, limit: robustPopulationLimit(values, true) };
  }, [first, second]);
  const [drawn, setDrawn] = useState<{
    key: typeof computed;
    identity: string;
    image: ImageBitmap | null;
  } | null>(null);
  useEffect(() => {
    if (!computed || computed.limit === null || typeof createImageBitmap === 'undefined') {
      setDrawn({ key: computed, identity, image: null });
      return;
    }
    const [width, height] = display.data.plane.dim_px;
    let alive = true;
    const settle = (image: ImageBitmap | null) => setDrawn({ key: computed, identity, image });
    try {
      const rgba = differenceRgba(computed.values, computed.limit, display.underlay);
      createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), width, height)).then(
        (bitmap) => {
          if (alive) settle(bitmap ?? null);
          else bitmap?.close?.();
        },
        () => {
          if (alive) settle(null);
        },
      );
    } catch {
      settle(null);
    }
    return () => {
      alive = false;
    };
  }, [computed, display, identity]);
  const current = { values: computed?.values ?? null, limit: computed?.limit ?? null };
  if (drawn && drawn.key === computed && drawn.identity === identity)
    return { ...current, image: drawn.image };
  if (drawn?.image && drawn.key && drawn.identity === identity)
    return { values: drawn.key.values, limit: drawn.key.limit, image: drawn.image };
  return { ...current, image: null };
}

/** The sign share's colour bar ticks: the even split in the middle. */
export function positiveFractionTick(value: number): string {
  return `${Math.round((value + POSITIVE_FRACTION_CENTRE) * 100)} %`;
}
