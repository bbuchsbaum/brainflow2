/**
 * Where the on-image colorbar goes in a slice pane (QA 2026-10-31 N16: at a
 * fixed fraction of the pane it landed on the brain, under the crosshair,
 * with unreadable labels).
 *
 * 1. Outside the drawn image: the larger side margin (right, then left on a
 *    tie), then the bottom margin, when it holds the whole block (bar,
 *    labels, captions). Off the image the block needs no backing.
 * 2. Otherwise (a zoomed or full-bleed image) a corner of the visible image:
 *    the one covering the least data (the data rectangle, when known), never
 *    one the crosshair is in, preferring bottom-right, top-right,
 *    bottom-left, top-left on ties. On the image the block gets a scrim.
 *
 * All rectangles are in canvas-area CSS px. The image and data rectangles
 * come from the view's own placement, so a mirrored (radiological) or zoomed
 * view is followed.
 */

export interface PaneRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type ColorbarSlot =
  | 'right'
  | 'left'
  | 'bottom'
  | 'corner-br'
  | 'corner-tr'
  | 'corner-bl'
  | 'corner-tl';

export interface ColorbarPlacement {
  slot: ColorbarSlot;
  left: number;
  top: number;
  barH: number;
  /** On the image: draw on a partial-opacity backing. */
  scrim: boolean;
}

export interface ColorbarPlacementInput {
  /** Canvas-area size. */
  width: number;
  height: number;
  /** The drawn image (letterbox) rectangle; the whole area when unknown. */
  imageRect?: PaneRect | null;
  /** Where the data (non-zero voxels / brain) is drawn, when known. */
  dataRect?: PaneRect | null;
  /** The crosshair centre: never under the block. */
  avoidPoint?: { x: number; y: number } | null;
  /** Kept clear at the top (pane header, layout button). */
  topReserve?: number;
  /** Height of the block without the bar (captions, padding). */
  chromeH: number;
  /** Width of the block for a bar of this height. */
  boxWidth: (barH: number) => number;
  minBarH: number;
  maxBarH: number;
}

export const COLORBAR_EDGE = 8; // from the pane edges
export const COLORBAR_GAP = 12; // between the image and the block
/** The left/right orientation letters (offset 6 + glyph + gap). */
export const SIDE_LETTER_CLEAR = 24;
/** The bottom orientation letter. */
export const BOTTOM_LETTER_CLEAR = 18;
/** Half-height of the band at the pane's vertical centre where the side letters sit. */
export const SIDE_LETTER_BAND = 14;
/** Margin around the crosshair centre the block keeps clear. */
export const CROSSHAIR_CLEAR = 12;

const area = (r: PaneRect) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

function intersect(a: PaneRect, b: PaneRect): PaneRect {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

function covers(box: PaneRect, point: { x: number; y: number } | null | undefined): boolean {
  if (!point) return false;
  return (
    point.x >= box.left - CROSSHAIR_CLEAR &&
    point.x <= box.right + CROSSHAIR_CLEAR &&
    point.y >= box.top - CROSSHAIR_CLEAR &&
    point.y <= box.bottom + CROSSHAIR_CLEAR
  );
}

/** The placement, or null when no bar of `minBarH` fits anywhere. */
export function placeColorbar(input: ColorbarPlacementInput): ColorbarPlacement | null {
  const { width, height, chromeH, boxWidth, minBarH, maxBarH, avoidPoint } = input;
  const topReserve = Math.max(COLORBAR_EDGE, input.topReserve ?? 0);
  const pane: PaneRect = { left: 0, top: 0, right: width, bottom: height };
  const image = intersect(input.imageRect ?? pane, pane);
  const imageH = Math.max(0, image.bottom - image.top);

  // ── 1. margins outside the image ──
  const margins: ColorbarPlacement[] = [];
  const sideBarH = Math.min(
    maxBarH,
    Math.floor(Math.min(imageH * 0.6, height - 2 * COLORBAR_EDGE - chromeH)),
  );
  if (input.imageRect && sideBarH >= minBarH) {
    const boxW = boxWidth(sideBarH);
    const boxH = sideBarH + chromeH;
    const top = Math.round(
      // Below the pane's top reserve (header, layout button), review L4c.
      Math.max(topReserve, Math.min(height - COLORBAR_EDGE - boxH, image.top + (imageH - boxH) / 2)),
    );
    const rightRoom = width - SIDE_LETTER_CLEAR - (image.right + COLORBAR_GAP);
    const leftRoom = image.left - COLORBAR_GAP - SIDE_LETTER_CLEAR;
    const sides: Array<{ slot: 'right' | 'left'; room: number; left: number }> = [
      { slot: 'right', room: rightRoom, left: Math.round(image.right + COLORBAR_GAP) },
      { slot: 'left', room: leftRoom, left: Math.round(image.left - COLORBAR_GAP - boxW) },
    ];
    // The larger margin first; right on a tie.
    sides.sort((a, b) => b.room - a.room);
    for (const side of sides) {
      if (side.room < boxW) continue;
      const box = { left: side.left, top, right: side.left + boxW, bottom: top + boxH };
      if (covers(box, avoidPoint)) continue;
      margins.push({ slot: side.slot, left: side.left, top, barH: sideBarH, scrim: false });
    }
  }
  if (margins.length > 0) return margins[0];
  if (input.imageRect) {
    const room = height - BOTTOM_LETTER_CLEAR - (image.bottom + COLORBAR_GAP);
    const barH = Math.min(maxBarH, Math.floor(room - chromeH));
    if (barH >= minBarH) {
      const boxW = boxWidth(barH);
      const left = Math.round(width - SIDE_LETTER_CLEAR - boxW);
      const top = Math.round(image.bottom + COLORBAR_GAP);
      const box = { left, top, right: left + boxW, bottom: top + barH + chromeH };
      if (left >= COLORBAR_EDGE && !covers(box, avoidPoint)) {
        return { slot: 'bottom', left, top, barH, scrim: false };
      }
    }
  }

  // ── 2. a corner of the visible image ──
  const usable: PaneRect = {
    left: Math.max(image.left, COLORBAR_EDGE),
    right: Math.min(image.right, width - COLORBAR_EDGE),
    top: Math.max(image.top, COLORBAR_EDGE),
    bottom: Math.min(image.bottom, height - COLORBAR_EDGE),
  };
  // Corners stay clear of the side orientation letters at the pane's
  // vertical centre (±SIDE_LETTER_BAND), review L4b.
  const centre = height / 2;
  const topStart = Math.max(usable.top, topReserve);
  const barFor = (room: number) => Math.min(maxBarH, Math.floor(room - chromeH));
  const bottomBar = barFor(usable.bottom - Math.max(centre + SIDE_LETTER_BAND, topStart));
  const topBar = barFor(Math.min(centre - SIDE_LETTER_BAND, usable.bottom) - topStart);
  const corners: Array<{ slot: ColorbarSlot; side: 'r' | 'l'; top: number; barH: number }> = [
    { slot: 'corner-br', side: 'r', top: usable.bottom - (bottomBar + chromeH), barH: bottomBar },
    { slot: 'corner-tr', side: 'r', top: topStart, barH: topBar },
    { slot: 'corner-bl', side: 'l', top: usable.bottom - (bottomBar + chromeH), barH: bottomBar },
    { slot: 'corner-tl', side: 'l', top: topStart, barH: topBar },
  ];
  const scored = corners
    .filter((c) => c.barH >= minBarH)
    .map((c, order) => {
      const boxW = boxWidth(c.barH);
      const left = c.side === 'r' ? usable.right - boxW : usable.left;
      const box = { left, top: c.top, right: left + boxW, bottom: c.top + c.barH + chromeH };
      return {
        ...c,
        left,
        order,
        crosshair: covers(box, avoidPoint),
        data: input.dataRect ? area(intersect(box, input.dataRect)) : 0,
      };
    })
    .filter((c) => c.left >= 0);
  if (scored.length === 0) return null;
  scored.sort(
    (a, b) => Number(a.crosshair) - Number(b.crosshair) || a.data - b.data || a.order - b.order,
  );
  const best = scored[0];
  return {
    slot: best.slot,
    left: Math.round(best.left),
    top: Math.round(best.top),
    barH: best.barH,
    scrim: true,
  };
}
