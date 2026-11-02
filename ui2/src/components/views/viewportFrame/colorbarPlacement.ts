/**
 * Where the on-image colorbar goes in a slice pane: one placement rule for
 * every slice view (Orthogonal, Integrated, Compare, Studio). QA 2026-10-31
 * N16, re-opened in run 5: the old rule measured margins against the drawn
 * bitmap, which fills the pane, so it never found one and fell back to a
 * corner over the brain.
 *
 * The "image" is the volume's projected bounds in the pane (after zoom, pan
 * and the radiological mirror); it may run past the pane's edges.
 *
 * 1. A free margin outside the image: the largest one that holds the block
 *    (right, left, bottom, top on ties). Off the image the block needs no
 *    backing. The full block first; else the compact form (bar and window
 *    ends) in a margin, rather than the full block over the image.
 * 2. No margin fits (zoomed in, small pane): the pane corner whose block
 *    overlaps the image least, never one the crosshair is under, on a faint
 *    backing.
 * 3. A very short pane (below ~120 px): a compact bar of 16 px or more in a corner,
 *    across the side letters' band (the letters themselves stay clear), so
 *    the bar never vanishes.
 *
 * A pane narrower or shorter than COLORBAR_COMPACT_BELOW always takes the
 * compact form. The orientation letters, the header row and the radiological
 * badge are kept clear. A previous slot is kept while it still fits and no
 * other slot is clearly better (hysteresis), so the block does not hop on
 * small resizes.
 *
 * All rectangles are in canvas-area CSS px.
 */

export interface PaneRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type ColorbarMarginSlot = 'right' | 'left' | 'bottom' | 'top';
export type ColorbarCornerSlot = 'corner-br' | 'corner-tr' | 'corner-bl' | 'corner-tl';
export type ColorbarSlot = ColorbarMarginSlot | ColorbarCornerSlot;

export interface ColorbarPlacement {
  slot: ColorbarSlot;
  left: number;
  top: number;
  barH: number;
  /** On the image: draw on a partial-opacity backing. */
  scrim: boolean;
  /** A margin's free area; for a corner, the area of the image under the block. */
  room: number;
}

/** One form of the block: its height without the bar, and its width for a bar height. */
export interface ColorbarForm {
  /** Height of the block without the bar (captions, padding). */
  chromeH: number;
  /** Width of the block for a bar of this height. */
  boxWidth: (barH: number) => number;
  minBarH: number;
  maxBarH: number;
}

export interface ColorbarPaneInput {
  /** Canvas-area size. */
  width: number;
  height: number;
  /**
   * The volume's projected bounds in the pane; the whole pane when unknown
   * (then only corners are possible).
   */
  imageRect?: PaneRect | null;
  /**
   * The drawn bitmap's rectangle, when the image rectangle is not known
   * separately: the image is then `dataRect ∩ imageRect` (legacy callers).
   */
  dataRect?: PaneRect | null;
  /** The crosshair centre: never under the block. */
  avoidPoint?: { x: number; y: number } | null;
  /** Kept clear at the top right (pane actions, layout button). */
  topReserve?: number;
  /** Distance of the top orientation letter from the top (a header row above it). */
  topLetterInset?: number;
  /** Centre line of the side orientation letters; the pane's middle by default. */
  sideLetterY?: number;
  /** Other rectangles to keep clear. */
  reserved?: readonly PaneRect[];
  /**
   * The pane draws letters, a header and the badge (default). False for a
   * column of its own (Mosaic) with none of them.
   */
  paneChrome?: boolean;
  /** The slot used last time (hysteresis). */
  previousSlot?: ColorbarSlot | null;
  /** The compact form was used last time: the full block needs a little more room to return. */
  previousCompact?: boolean;
}

export type ColorbarPlacementInput = ColorbarPaneInput & ColorbarForm;

export const COLORBAR_EDGE = 8; // from the pane edges
export const COLORBAR_GAP = 12; // between the image and the block
/** Below this pane width or height the colorbar takes its compact form. */
export const COLORBAR_COMPACT_BELOW = 160;
/** The left/right orientation letters (offset 6 + glyph + gap). */
export const SIDE_LETTER_CLEAR = 24;
/** The top/bottom orientation letters (offset 6 + glyph + gap). */
export const BOTTOM_LETTER_CLEAR = 22;
/** Half-height of the band at the pane's vertical centre where the side letters sit. */
export const SIDE_LETTER_BAND = 14;
/** Half-width of the band at the pane's horizontal centre where the top/bottom letters sit. */
export const END_LETTER_BAND = 12;
/** The pane header (plane, slice position, layer) at the top left. */
export const HEADER_CLEAR_H = 22;
/** The radiological badge ("R | L") at the bottom left. */
export const BADGE_CLEAR = { width: 44, height: 20 };
/** Margin around the crosshair centre the block keeps clear. */
export const CROSSHAIR_CLEAR = 12;
/** Another margin must be this much larger to take over from the previous one. */
export const MARGIN_HYSTERESIS = 1.25;
/** Extra bar height the full block needs to replace a compact one (form hysteresis). */
export const FORM_HYSTERESIS = 8;
/** The last-resort compact bar's shortest height (a very short pane). */
export const LAST_RESORT_MIN_BAR_H = 16;

const width = (r: PaneRect) => Math.max(0, r.right - r.left);
const height = (r: PaneRect) => Math.max(0, r.bottom - r.top);
const area = (r: PaneRect) => width(r) * height(r);

function intersect(a: PaneRect, b: PaneRect): PaneRect {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

const overlaps = (a: PaneRect, b: PaneRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function covers(box: PaneRect, point: { x: number; y: number } | null | undefined): boolean {
  if (!point) return false;
  return (
    point.x >= box.left - CROSSHAIR_CLEAR &&
    point.x <= box.right + CROSSHAIR_CLEAR &&
    point.y >= box.top - CROSSHAIR_CLEAR &&
    point.y <= box.bottom + CROSSHAIR_CLEAR
  );
}

export const isMarginSlot = (slot: ColorbarSlot | null | undefined): slot is ColorbarMarginSlot =>
  slot === 'right' || slot === 'left' || slot === 'bottom' || slot === 'top';

/**
 * The image rectangle placement works from: the volume's bounds (within the
 * bitmap, when both are given). Not clipped to the pane: an image running
 * past an edge leaves no margin on that side.
 */
export function paneImageRect(input: ColorbarPaneInput): PaneRect | null {
  let image = input.imageRect ?? null;
  if (input.dataRect) image = image ? intersect(image, input.dataRect) : input.dataRect;
  return image && width(image) > 0 && height(image) > 0 ? image : null;
}

/** Rectangles the block never covers: orientation letters, header, badge, caller's own. */
export function colorbarKeepClear(input: ColorbarPaneInput): PaneRect[] {
  const { width: w, height: h } = input;
  const cx = w / 2;
  const cy = input.sideLetterY ?? h / 2;
  const topLetter = input.topLetterInset ?? 0;
  if (input.paneChrome === false) return [...(input.reserved ?? [])];
  return [
    // Orientation letters.
    {
      left: cx - END_LETTER_BAND,
      top: 0,
      right: cx + END_LETTER_BAND,
      bottom: topLetter + BOTTOM_LETTER_CLEAR,
    },
    {
      left: cx - END_LETTER_BAND,
      top: h - BOTTOM_LETTER_CLEAR,
      right: cx + END_LETTER_BAND,
      bottom: h,
    },
    {
      left: 0,
      top: cy - SIDE_LETTER_BAND,
      right: SIDE_LETTER_CLEAR,
      bottom: cy + SIDE_LETTER_BAND,
    },
    {
      left: w - SIDE_LETTER_CLEAR,
      top: cy - SIDE_LETTER_BAND,
      right: w,
      bottom: cy + SIDE_LETTER_BAND,
    },
    // Header row (top left, up to the top letter) and the top-right reserve.
    { left: 0, top: 0, right: cx - END_LETTER_BAND, bottom: HEADER_CLEAR_H },
    { left: cx, top: 0, right: w, bottom: input.topReserve ?? 0 },
    // Radiological badge.
    { left: 0, top: h - BADGE_CLEAR.height, right: BADGE_CLEAR.width, bottom: h },
    ...(input.reserved ?? []),
  ];
}

interface Candidate extends ColorbarPlacement {
  box: PaneRect;
  order: number;
}

const MARGIN_ORDER: ColorbarMarginSlot[] = ['right', 'left', 'bottom', 'top'];
const CORNER_ORDER: ColorbarCornerSlot[] = ['corner-br', 'corner-tr', 'corner-bl', 'corner-tl'];

/** Positions to try along one axis: `preferred` first, then outward in 8 px steps within [lo, hi]. */
function positions(preferred: number, lo: number, hi: number): number[] {
  if (hi < lo) return [];
  const start = Math.max(lo, Math.min(hi, preferred));
  const out = [start];
  for (let d = 8; start - d >= lo || start + d <= hi; d += 8) {
    if (start + d <= hi) out.push(start + d);
    if (start - d >= lo) out.push(start - d);
  }
  for (const end of [hi, lo]) if (!out.includes(end)) out.push(end);
  return out;
}

/** Bar heights to try, largest first: `upper` down to `min` in 4 px steps (`min` always last). */
function barHeights(upper: number, min: number): number[] {
  const out: number[] = [];
  for (let h = upper; h > min; h -= 4) out.push(h);
  if (upper >= min) out.push(min);
  return out;
}

/** The first box of size w×h at (xs × ys) clear of `clear` and the crosshair. */
function firstClear(
  xs: readonly number[],
  ys: readonly number[],
  w: number,
  h: number,
  clear: readonly PaneRect[],
  avoid: ColorbarPaneInput['avoidPoint'],
): PaneRect | null {
  for (const y of ys) {
    for (const x of xs) {
      const box = {
        left: Math.round(x),
        top: Math.round(y),
        right: Math.round(x) + w,
        bottom: Math.round(y) + h,
      };
      if (!clear.some((r) => overlaps(box, r)) && !covers(box, avoid)) return box;
    }
  }
  return null;
}

/** Every margin that holds the block, each with the largest bar it allows. */
function marginCandidates(
  input: ColorbarPlacementInput,
  image: PaneRect,
  clear: PaneRect[],
): Candidate[] {
  const { width: w, height: h, chromeH, boxWidth, minBarH, maxBarH } = input;
  const inner = {
    left: COLORBAR_EDGE,
    top: COLORBAR_EDGE,
    right: w - COLORBAR_EDGE,
    bottom: h - COLORBAR_EDGE,
  };
  const regions: Record<ColorbarMarginSlot, PaneRect> = {
    right: { ...inner, left: image.right + COLORBAR_GAP },
    left: { ...inner, right: image.left - COLORBAR_GAP },
    bottom: { ...inner, top: image.bottom + COLORBAR_GAP },
    top: { ...inner, bottom: image.top - COLORBAR_GAP },
  };
  // The image's visible rows set the side block's centre and height cap.
  const rows = { top: Math.max(0, image.top), bottom: Math.min(h, image.bottom) };
  const imageMidY = (rows.top + rows.bottom) / 2;
  const out: Candidate[] = [];
  MARGIN_ORDER.forEach((slot, order) => {
    const region = regions[slot];
    if (width(region) <= 0 || height(region) <= 0) return;
    const side = slot === 'right' || slot === 'left';
    // Beside the image the bar is at most 60% of the image's height.
    const cap = side ? Math.max(minBarH, Math.floor(Math.max(0, rows.bottom - rows.top) * 0.6)) : maxBarH;
    for (const barH of barHeights(
      Math.min(maxBarH, cap, Math.floor(height(region) - chromeH)),
      minBarH,
    )) {
      const boxW = boxWidth(barH);
      const boxH = barH + chromeH;
      if (boxW > width(region)) continue;
      // Beside the image: hug it, centred on it. Above or below: hug it,
      // right-aligned (clear of the centred letter), sliding left if needed.
      const xs = side
        ? [slot === 'right' ? region.left : region.right - boxW]
        : positions(region.right - boxW, region.left, region.right - boxW);
      const ys = side
        ? positions(Math.round(imageMidY - boxH / 2), region.top, region.bottom - boxH)
        : [slot === 'bottom' ? region.top : region.bottom - boxH];
      const box = firstClear(xs, ys, boxW, boxH, clear, input.avoidPoint);
      if (box) {
        out.push({
          slot,
          left: box.left,
          top: box.top,
          barH,
          scrim: false,
          box,
          room: area(region),
          order,
        });
        return;
      }
    }
  });
  return out;
}

/** The largest margin; the previous one while no other is clearly larger. */
function pickMargin(
  candidates: Candidate[],
  previous: ColorbarSlot | null | undefined,
): Candidate | null {
  if (candidates.length === 0) return null;
  const best = [...candidates].sort((a, b) => b.room - a.room || a.order - b.order)[0];
  const kept = previous ? candidates.find((c) => c.slot === previous) : undefined;
  return kept && best.room <= kept.room * MARGIN_HYSTERESIS ? kept : best;
}

/** The pane corners: off the crosshair first, then the least overlap with the image. */
function cornerCandidate(
  input: ColorbarPlacementInput,
  image: PaneRect | null,
  clear: PaneRect[],
  acrossBand = false,
): Candidate | null {
  const { width: w, height: h, chromeH, boxWidth, minBarH, maxBarH } = input;
  const cy = input.sideLetterY ?? h / 2;
  // Each corner owns its half of the pane, away from the side letters' band
  // (the last resort spans the band; the letters stay in the keep-clear set);
  // top corners start below the header (left) or the top-right reserve.
  const bottomEnd = h - COLORBAR_EDGE;
  const topEnd = acrossBand ? bottomEnd : cy - SIDE_LETTER_BAND;
  const bottomStart = acrossBand ? COLORBAR_EDGE : cy + SIDE_LETTER_BAND;
  const candidates: Candidate[] = [];
  CORNER_ORDER.forEach((slot, order) => {
    const isTop = slot === 'corner-tr' || slot === 'corner-tl';
    const isRight = slot === 'corner-br' || slot === 'corner-tr';
    const topStart = isRight ? Math.max(COLORBAR_EDGE, input.topReserve ?? 0) : HEADER_CLEAR_H;
    const room = isTop ? topEnd - topStart : bottomEnd - bottomStart;
    for (const barH of barHeights(Math.min(maxBarH, Math.floor(room - chromeH)), minBarH)) {
      const boxW = boxWidth(barH);
      const boxH = barH + chromeH;
      if (boxW > w - 2 * COLORBAR_EDGE) continue;
      // Hug the corner; slide toward the middle past a letter or the badge.
      const xs = positions(
        isRight ? w - COLORBAR_EDGE - boxW : COLORBAR_EDGE,
        COLORBAR_EDGE,
        w - COLORBAR_EDGE - boxW,
      );
      const ys = isTop
        ? positions(topStart, topStart, topEnd - boxH)
        : positions(bottomEnd - boxH, bottomStart, bottomEnd - boxH);
      // At most 24 px in from the side. The crosshair is scored below, not refused.
      const box = firstClear(xs.slice(0, 4), ys, boxW, boxH, clear, null);
      if (box) {
        const overlap = image ? area(intersect(box, image)) : area(box);
        candidates.push({
          slot,
          left: box.left,
          top: box.top,
          barH,
          scrim: overlap > 0,
          box,
          room: overlap,
          order,
        });
        return;
      }
    }
  });
  if (candidates.length === 0) return null;
  const crosshair = (c: Candidate) => Number(covers(c.box, input.avoidPoint));
  // The share of the block over the image, in hundredths (a shorter block is
  // not "clearer" for being shorter).
  const covered = (c: Candidate) => Math.round((100 * c.room) / Math.max(1, area(c.box)));
  candidates.sort((a, b) => crosshair(a) - crosshair(b) || covered(a) - covered(b) || a.order - b.order);
  const best = candidates[0];
  // Keep the previous corner while it is about as clear (within a tenth of the block).
  const kept = input.previousSlot ? candidates.find((c) => c.slot === input.previousSlot) : undefined;
  if (kept && crosshair(kept) === crosshair(best) && covered(kept) <= covered(best) + 10) {
    return kept;
  }
  return best;
}

const strip = (c: Candidate | null): ColorbarPlacement | null =>
  c ? { slot: c.slot, left: c.left, top: c.top, barH: c.barH, scrim: c.scrim, room: c.room } : null;

/** A margin placement for this form, or null when no margin holds it. */
export function placeColorbarInMargin(input: ColorbarPlacementInput): ColorbarPlacement | null {
  const image = paneImageRect(input);
  if (!image) return null;
  return strip(
    pickMargin(marginCandidates(input, image, colorbarKeepClear(input)), input.previousSlot),
  );
}

/** A corner placement for this form (off the crosshair, least image overlap), or null. */
export function placeColorbarInCorner(input: ColorbarPlacementInput): ColorbarPlacement | null {
  return strip(cornerCandidate(input, paneImageRect(input), colorbarKeepClear(input)));
}

/** One form: a margin when one holds it, else a corner; null when neither fits. */
export function placeColorbar(input: ColorbarPlacementInput): ColorbarPlacement | null {
  return placeColorbarInMargin(input) ?? placeColorbarInCorner(input);
}

/** How well a pane holds the colorbar: the Orthogonal host choice compares these. */
export const ColorbarFit = {
  None: 0,
  Corner: 1,
  CompactMargin: 2,
  FullMargin: 3,
} as const;
export type ColorbarFit = (typeof ColorbarFit)[keyof typeof ColorbarFit];

export interface ColorbarBlockPlacement extends ColorbarPlacement {
  compact: boolean;
  fit: ColorbarFit;
}

/**
 * The whole rule, both forms: the full block in a margin; else the compact
 * form in a margin; else a corner (full, or compact in a small pane or when
 * the full block fits nowhere); else a short compact bar across the side
 * letters' band. Null only when not even that fits (a pane under ~40 px).
 */
export function placeColorbarBlock(
  pane: ColorbarPaneInput,
  forms: { full: ColorbarForm; compact: ColorbarForm },
): ColorbarBlockPlacement | null {
  const small = pane.width < COLORBAR_COMPACT_BELOW || pane.height < COLORBAR_COMPACT_BELOW;
  const full = { ...pane, ...forms.full };
  const compact = { ...pane, ...forms.compact };
  // Form hysteresis: back from compact only when the full block's bar has
  // a little room to spare (the margin's largest bar, not the shortest).
  const fullNeeds = full.minBarH + (pane.previousCompact ? FORM_HYSTERESIS : 0);
  const fullFit = small ? null : placeColorbarInMargin(full);
  const fullMargin = fullFit && fullFit.barH >= Math.min(full.maxBarH, fullNeeds) ? fullFit : null;
  if (fullMargin) return { ...fullMargin, compact: false, fit: ColorbarFit.FullMargin };
  const compactMargin = placeColorbarInMargin(compact);
  if (compactMargin) return { ...compactMargin, compact: true, fit: ColorbarFit.CompactMargin };
  const fullCorner = small ? null : placeColorbarInCorner(full);
  if (fullCorner) return { ...fullCorner, compact: false, fit: ColorbarFit.Corner };
  const compactCorner = placeColorbarInCorner(compact);
  if (compactCorner) return { ...compactCorner, compact: true, fit: ColorbarFit.Corner };
  // Last resort (a very short pane): a short compact bar across the band.
  const tiny = { ...compact, minBarH: Math.min(compact.minBarH, LAST_RESORT_MIN_BAR_H) };
  const lastResort = strip(cornerCandidate(tiny, paneImageRect(tiny), colorbarKeepClear(tiny), true));
  return lastResort ? { ...lastResort, compact: true, fit: ColorbarFit.Corner } : null;
}

/**
 * The held placement while the pane is being resized or zoomed (a splitter
 * drag): the block stays in the slot and form it had, following the image
 * and clamped to the pane, instead of re-choosing a slot per frame. Mid-drag
 * the image and pane disagree for a frame or two (the bitmap is re-rendered
 * after the resize), and re-choosing flickered the bar to the other side of
 * the brain before it settled. The full rule runs again once it is quiet.
 */
export function holdColorbarSlot(
  input: ColorbarPlacementInput,
  held: { slot: ColorbarSlot; barH: number },
): ColorbarPlacement {
  const { width: w, height: h, chromeH, boxWidth, minBarH } = input;
  const image = paneImageRect(input);
  // The same bar if it still fits the pane's height, else the tallest that does.
  const barH = Math.max(minBarH, Math.min(held.barH, Math.floor(h - 2 * COLORBAR_EDGE - chromeH)));
  const boxW = boxWidth(barH);
  const boxH = barH + chromeH;
  const clampX = (x: number) => Math.max(COLORBAR_EDGE, Math.min(w - COLORBAR_EDGE - boxW, x));
  const clampY = (y: number) => Math.max(COLORBAR_EDGE, Math.min(h - COLORBAR_EDGE - boxH, y));
  const midY = image ? (Math.max(0, image.top) + Math.min(h, image.bottom)) / 2 : h / 2;
  let x: number;
  let y: number;
  switch (held.slot) {
    case 'right':
      x = image ? image.right + COLORBAR_GAP : w - COLORBAR_EDGE - boxW;
      y = midY - boxH / 2;
      break;
    case 'left':
      x = image ? image.left - COLORBAR_GAP - boxW : COLORBAR_EDGE;
      y = midY - boxH / 2;
      break;
    case 'bottom':
      x = w - COLORBAR_EDGE - boxW;
      y = image ? image.bottom + COLORBAR_GAP : h - COLORBAR_EDGE - boxH;
      break;
    case 'top':
      x = w - COLORBAR_EDGE - boxW;
      y = image ? image.top - COLORBAR_GAP - boxH : COLORBAR_EDGE;
      break;
    default: {
      const isRight = held.slot === 'corner-br' || held.slot === 'corner-tr';
      const isTop = held.slot === 'corner-tr' || held.slot === 'corner-tl';
      x = isRight ? w - COLORBAR_EDGE - boxW : COLORBAR_EDGE;
      y = isTop ? Math.max(COLORBAR_EDGE, HEADER_CLEAR_H) : h - COLORBAR_EDGE - boxH;
    }
  }
  const box = { left: Math.round(clampX(x)), top: Math.round(clampY(y)), right: 0, bottom: 0 };
  box.right = box.left + boxW;
  box.bottom = box.top + boxH;
  const overlap = image ? area(intersect(box, image)) : 0;
  return { slot: held.slot, left: box.left, top: box.top, barH, scrim: overlap > 0, room: overlap };
}
