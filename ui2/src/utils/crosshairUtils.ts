/**
 * Crosshair rendering utilities
 * Provides reusable functions for drawing crosshairs on canvas elements
 */

export interface CrosshairStyle {
  color: string;
  lineWidth: number;
  lineDash?: number[];
  opacity?: number;
  /**
   * Radius in canvas px around the crosshair point kept clear of core and
   * halo, so the cursor voxel stays visible. 0 / undefined: no gap.
   */
  centerGap?: number;
  /** Halo alpha (black). Defaults to {@link CROSSHAIR_HALO_ALPHA}. */
  haloAlpha?: number;
}

/** An axis-aligned rectangle in canvas coordinates. */
export interface CrosshairRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Default halo alpha: 1px a side at 60% black, under the dashes only. */
export const CROSSHAIR_HALO_ALPHA = 0.6;
/**
 * Halo alpha for compact (small) views. Kept at the regular 60%: a darker halo
 * around a thin core makes the line read as dark rather than as its colour.
 */
export const CROSSHAIR_COMPACT_HALO_ALPHA = CROSSHAIR_HALO_ALPHA;
/** Centre-gap radius (canvas px) for regular views. */
export const CROSSHAIR_CENTER_GAP_PX = 6;
/** Centre-gap radius (canvas px) for compact views. */
export const CROSSHAIR_COMPACT_CENTER_GAP_PX = 4;
/**
 * Below this shorter viewport side (CSS px) the crosshair is drawn compact
 * (shorter dashes, smaller gap). Main orthogonal panes at 1280x800 (~205px)
 * and Integrated side panes stay above it; Studio cards and thumbnails fall
 * below it.
 */
export const CROSSHAIR_COMPACT_VIEW_PX = 140;
/** Below this shorter viewport side (CSS px) the compact core also drops to 1px. */
export const CROSSHAIR_THIN_VIEW_PX = 100;
/** Padding (canvas px) around orientation-letter boxes kept clear of the line. */
export const CROSSHAIR_KNOCKOUT_PAD_PX = 3;

/**
 * Dark halo drawn beneath the coloured crosshair line so it stays legible over
 * bright tissue (white matter, saturated overlays). Styling only: the halo uses
 * exactly the crosshair's geometry and dash pattern. It is kept to 1px a side
 * so the coloured core, not the halo, dominates over tissue.
 */
export const CROSSHAIR_HALO = {
  color: `rgba(0, 0, 0, ${CROSSHAIR_HALO_ALPHA})`,
  /** Extra width added to the crosshair line width (1px each side). */
  extraWidth: 2,
} as const;

// Default styles - will be overridden by CrosshairContext settings
export const DEFAULT_CROSSHAIR_STYLES = {
  active: {
    color: '#5fe0a0', // keep in sync with DEFAULT_CROSSHAIR_COLOR / --bf-crosshair
    lineWidth: 2, // keep in sync with DEFAULT_SETTINGS.activeThickness
    lineDash: [6, 6],
    opacity: 1,
    centerGap: CROSSHAIR_CENTER_GAP_PX,
  },
  mirror: {
    color: '#808080',
    lineWidth: 1,
    lineDash: [4, 4],
    opacity: 0.3
  }
} as const;

/**
 * Convert line style string to canvas dash array. Dashes are 3x the width
 * with a 4px floor: 6/6 at the 2px default, 4/4 at 1px.
 */
export function getLineDash(style: 'solid' | 'dashed' | 'dotted', lineWidth: number): number[] | undefined {
  switch (style) {
    case 'solid':
      return undefined;
    case 'dashed': {
      const dash = Math.max(4, 3 * lineWidth);
      return [dash, dash];
    }
    case 'dotted':
      return [lineWidth, lineWidth * 2];
  }
}

/** Settings subset needed to build the active crosshair style. */
export interface ActiveCrosshairSettings {
  activeColor: string;
  activeThickness: number;
  activeStyle: 'solid' | 'dashed' | 'dotted';
  centerGap?: boolean;
}

/** Build the active crosshair stroke style from the user's settings. */
export function buildActiveCrosshairStyle(settings: ActiveCrosshairSettings): CrosshairStyle {
  return {
    color: settings.activeColor,
    lineWidth: settings.activeThickness,
    lineDash: getLineDash(settings.activeStyle, settings.activeThickness),
    opacity: 1,
    centerGap: settings.centerGap === false ? 0 : CROSSHAIR_CENTER_GAP_PX,
  };
}

/**
 * Step the stroke down for small views (shorter side below
 * {@link CROSSHAIR_COMPACT_VIEW_PX}): 4/4 dashes (or w/2w dots) and a 4px
 * centre gap. The core keeps its width (so its hue survives over tissue) and
 * only drops to 1px below {@link CROSSHAIR_THIN_VIEW_PX}. Larger views are
 * returned unchanged. Styling only: the crosshair position is not affected.
 */
export function adaptCrosshairStyleToViewport(
  style: CrosshairStyle,
  viewportWidth: number,
  viewportHeight: number,
): CrosshairStyle {
  const shortSide = Math.min(viewportWidth, viewportHeight);
  if (!Number.isFinite(shortSide) || shortSide <= 0 || shortSide >= CROSSHAIR_COMPACT_VIEW_PX) {
    return style;
  }
  const lineWidth = shortSide < CROSSHAIR_THIN_VIEW_PX ? Math.min(1, style.lineWidth) : style.lineWidth;
  let lineDash = style.lineDash;
  if (Array.isArray(lineDash) && lineDash.length >= 2) {
    // Equal on/off is the dashed pattern; anything else is dotted.
    lineDash = lineDash[0] === lineDash[1] ? [4, 4] : [lineWidth, lineWidth * 2];
  }
  return {
    ...style,
    lineWidth,
    lineDash,
    haloAlpha: CROSSHAIR_COMPACT_HALO_ALPHA,
    centerGap: style.centerGap ? Math.min(style.centerGap, CROSSHAIR_COMPACT_CENTER_GAP_PX) : style.centerGap,
  };
}

/**
 * Snap the centre of an axis-aligned stroke to the pixel grid so its core is
 * not anti-aliased across a half pixel. An odd integer width is centred on a
 * pixel centre (n + 0.5); an even width on a pixel edge (n). Non-integer widths
 * are left alone. The shift is at most half a pixel: stroke placement only,
 * the crosshair position itself is unchanged.
 */
export function snapStrokeCoord(coord: number, lineWidth: number): number {
  if (!Number.isFinite(coord) || !Number.isInteger(lineWidth) || lineWidth <= 0) return coord;
  return lineWidth % 2 === 1 ? Math.floor(coord) + 0.5 : Math.round(coord);
}

export interface CrosshairDrawOptions {
  ctx: CanvasRenderingContext2D;
  canvasX: number;
  canvasY: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  style: CrosshairStyle;
  /**
   * Rectangles (canvas coordinates, e.g. orientation letters) the stroke must
   * not cross. Padded by {@link CROSSHAIR_KNOCKOUT_PAD_PX}. Styling only.
   */
  knockouts?: CrosshairRect[];
}

type Interval = [number, number];

/** Pieces shorter than this (canvas px) are not drawn. */
const MIN_SEGMENT_PX = 2;

/** Subtract the exclusion intervals from [start, end]; returns sorted pieces. */
export function subtractIntervals(start: number, end: number, cuts: Interval[]): Interval[] {
  let pieces: Interval[] = [[start, end]];
  for (const [c0, c1] of cuts) {
    if (!(c1 > c0)) continue;
    const next: Interval[] = [];
    for (const [a, b] of pieces) {
      if (c1 <= a || c0 >= b) {
        next.push([a, b]);
        continue;
      }
      if (c0 > a) next.push([a, c0]);
      if (c1 < b) next.push([c1, b]);
    }
    pieces = next;
  }
  return pieces.filter(([a, b]) => b - a > 0);
}

/**
 * Visible pieces of the horizontal (axis 'h', at y) and vertical (axis 'v',
 * at x) crosshair strokes after the centre gap and the knockouts.
 */
function strokeSegments(
  axis: 'h' | 'v',
  x: number,
  y: number,
  bounds: CrosshairDrawOptions['bounds'],
  style: CrosshairStyle,
  knockouts: CrosshairRect[] | undefined,
): Interval[] {
  const start = axis === 'h' ? bounds.x : bounds.y;
  const end = axis === 'h' ? bounds.x + bounds.width : bounds.y + bounds.height;
  const along = axis === 'h' ? x : y;
  const across = axis === 'h' ? y : x;
  const cuts: Interval[] = [];
  const gap = style.centerGap ?? 0;
  if (gap > 0) cuts.push([along - gap, along + gap]);
  if (knockouts && knockouts.length > 0) {
    const half = (style.lineWidth + CROSSHAIR_HALO.extraWidth) / 2;
    const pad = CROSSHAIR_KNOCKOUT_PAD_PX;
    for (const r of knockouts) {
      const a0 = (axis === 'h' ? r.x : r.y) - pad;
      const a1 = (axis === 'h' ? r.x + r.width : r.y + r.height) + pad;
      const b0 = (axis === 'h' ? r.y : r.x) - pad;
      const b1 = (axis === 'h' ? r.y + r.height : r.x + r.width) + pad;
      if (across + half > b0 && across - half < b1) cuts.push([a0, a1]);
    }
  }
  // Drop crumbs left between two cuts: a sub-2px fragment reads as noise.
  return subtractIntervals(start, end, cuts).filter(([a, b]) => b - a >= MIN_SEGMENT_PX);
}

/** Normalise a canvas dash array: odd lengths repeat, as canvas does. */
function normaliseDash(dash: number[]): number[] | null {
  const clean = dash.map((d) => (Number.isFinite(d) && d > 0 ? d : 0));
  const pattern = clean.length % 2 === 1 ? [...clean, ...clean] : clean;
  const period = pattern.reduce((a, b) => a + b, 0);
  return period > 0 && pattern.some((d, i) => i % 2 === 0 && d > 0) ? pattern : null;
}

/**
 * Dash intervals along one arm, laid out from `origin` outward in direction
 * `dir` (+1 / -1) until `limit`. Each arm starts with a full dash at the
 * origin, so the pattern is anchored at the crossing rather than at the
 * viewport edge.
 */
function armDashes(origin: number, dir: 1 | -1, limit: number, pattern: number[]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const extent = (limit - origin) * dir;
  if (!(extent > 0)) return out;
  let pos = 0;
  for (let i = 0; pos < extent; i++) {
    const len = pattern[i % pattern.length];
    if (i % 2 === 0 && len > 0) {
      const a = origin + dir * pos;
      const b = origin + dir * Math.min(pos + len, extent);
      out.push([Math.min(a, b), Math.max(a, b), len]);
    }
    pos += len;
  }
  return out;
}

/**
 * Visible dash intervals of one stroke (axis 'h' at y, 'v' at x). The pattern
 * is anchored at the edge of the centre gap on both arms (at the crossing when
 * there is no gap), so the clear zone is symmetric about the crossing and does
 * not shift as the cursor moves. Fragments cut by the gap, the bounds or a
 * knockout that are shorter than {@link MIN_SEGMENT_PX} (and than the dash
 * itself) are dropped, so no 1px stubs are drawn.
 */
export function crosshairDashSegments(
  axis: 'h' | 'v',
  x: number,
  y: number,
  bounds: CrosshairDrawOptions['bounds'],
  style: CrosshairStyle,
  knockouts?: CrosshairRect[],
): Interval[] {
  const pieces = strokeSegments(axis, x, y, bounds, style, knockouts);
  const pattern = Array.isArray(style.lineDash) && style.lineDash.length > 0 ? normaliseDash(style.lineDash) : null;
  if (!pattern) return pieces;

  const start = axis === 'h' ? bounds.x : bounds.y;
  const end = axis === 'h' ? bounds.x + bounds.width : bounds.y + bounds.height;
  const along = axis === 'h' ? x : y;
  const gap = Math.max(0, style.centerGap ?? 0);
  // Round the arm origins outward to whole pixels. With the core snapped to
  // the grid this keeps both origins the same distance from the crossing.
  const lo = gap > 0 ? Math.floor(along - gap) : along;
  const hi = gap > 0 ? Math.ceil(along + gap) : along;
  const dashes = [...armDashes(lo, -1, start, pattern).reverse(), ...armDashes(hi, 1, end, pattern)];

  const out: Interval[] = [];
  for (const [d0, d1, len] of dashes) {
    const minLen = Math.min(MIN_SEGMENT_PX, len);
    for (const [p0, p1] of pieces) {
      const a = Math.max(d0, p0);
      const b = Math.min(d1, p1);
      if (b - a >= minLen) out.push([a, b]);
    }
  }
  return out;
}

/**
 * Stroke the horizontal and vertical crosshair lines. Dashes are laid out
 * explicitly ({@link crosshairDashSegments}) and stroked solid, one path per
 * axis, so the canvas dash phase never comes into play.
 */
function strokeCrosshairLines(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bounds: CrosshairDrawOptions['bounds'],
  style: CrosshairStyle,
  knockouts: CrosshairRect[] | undefined,
): void {
  ctx.setLineDash([]);
  for (const axis of ['h', 'v'] as const) {
    const segments = crosshairDashSegments(axis, x, y, bounds, style, knockouts);
    if (segments.length === 0) continue;
    ctx.beginPath();
    for (const [a, b] of segments) {
      if (axis === 'h') {
        ctx.moveTo(a, y);
        ctx.lineTo(b, y);
      } else {
        ctx.moveTo(x, a);
        ctx.lineTo(x, b);
      }
    }
    ctx.stroke();
  }
}

function isInsideBounds(canvasX: number, canvasY: number, bounds: CrosshairDrawOptions['bounds']) {
  return !(
    canvasX < bounds.x ||
    canvasX > bounds.x + bounds.width ||
    canvasY < bounds.y ||
    canvasY > bounds.y + bounds.height
  );
}

/**
 * Draw a crosshair on a canvas at the specified position
 * Respects the provided bounds to avoid drawing outside the image area
 */
export function drawCrosshair({
  ctx,
  canvasX,
  canvasY,
  bounds,
  style,
  knockouts,
}: CrosshairDrawOptions): void {
  if (!isInsideBounds(canvasX, canvasY, bounds)) return;

  drawCrosshairHalo({ ctx, canvasX, canvasY, bounds, style, knockouts });

  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  if (style.opacity !== undefined) {
    ctx.globalAlpha = style.opacity;
  }

  const x = snapStrokeCoord(canvasX, style.lineWidth);
  const y = snapStrokeCoord(canvasY, style.lineWidth);
  strokeCrosshairLines(ctx, x, y, bounds, style, knockouts);

  ctx.restore();
}

/**
 * Draw the dark halo for a crosshair. Same lines, same dash pattern, same
 * gaps and bounds check as {@link drawCrosshair}; only the stroke is wider
 * and dark. Call it before the coloured stroke.
 */
export function drawCrosshairHalo({
  ctx,
  canvasX,
  canvasY,
  bounds,
  style,
  knockouts,
}: CrosshairDrawOptions): void {
  if (!isInsideBounds(canvasX, canvasY, bounds)) return;

  ctx.save();
  ctx.strokeStyle =
    style.haloAlpha === undefined ? CROSSHAIR_HALO.color : `rgba(0, 0, 0, ${style.haloAlpha})`;
  ctx.lineWidth = style.lineWidth + CROSSHAIR_HALO.extraWidth;
  if (style.opacity !== undefined) {
    ctx.globalAlpha = style.opacity;
  }

  // Halo width = core + 2 has the same parity as the core, so snapping on the
  // core width keeps both strokes on one centre line.
  const x = snapStrokeCoord(canvasX, style.lineWidth);
  const y = snapStrokeCoord(canvasY, style.lineWidth);
  strokeCrosshairLines(ctx, x, y, bounds, style, knockouts);

  ctx.restore();
}

/**
 * Convert client-space rectangles (e.g. from getBoundingClientRect on DOM
 * labels) into the canvas's drawing coordinates.
 */
export function clientRectsToCanvas(
  canvas: HTMLCanvasElement,
  rects: CrosshairRect[],
): CrosshairRect[] {
  if (rects.length === 0) return rects;
  const box = canvas.getBoundingClientRect();
  if (!(box.width > 0) || !(box.height > 0)) return [];
  const sx = canvas.width / box.width;
  const sy = canvas.height / box.height;
  return rects.map((r) => ({
    x: (r.x - box.left) * sx,
    y: (r.y - box.top) * sy,
    width: r.width * sx,
    height: r.height * sy,
  }));
}

/**
 * Transform world coordinates to canvas coordinates for crosshair rendering
 * Takes into account image placement and scaling
 */
export function transformCrosshairCoordinates(
  screenCoord: [number, number],
  imagePlacement: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  }
): { canvasX: number; canvasY: number } | null {
  const [screenX, screenY] = screenCoord;
  
  // Transform screen coordinates to account for image placement
  const scaleX = imagePlacement.width / imagePlacement.imageWidth;
  const scaleY = imagePlacement.height / imagePlacement.imageHeight;
  
  const canvasX = imagePlacement.x + screenX * scaleX;
  const canvasY = imagePlacement.y + screenY * scaleY;
  
  return { canvasX, canvasY };
}

/**
 * Clear and redraw all crosshairs on a canvas
 * Useful when multiple crosshairs need to be rendered (e.g., in MosaicView)
 */
export function redrawCrosshairs(
  ctx: CanvasRenderingContext2D,
  crosshairs: Array<{
    screenCoord: [number, number];
    style: CrosshairStyle;
  }>,
  imagePlacement: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  }
): void {
  // Clear any existing crosshairs by redrawing the image area
  // (This assumes the image has already been drawn)
  
  for (const crosshair of crosshairs) {
    const coords = transformCrosshairCoordinates(
      crosshair.screenCoord,
      imagePlacement
    );
    
    if (coords) {
      drawCrosshair({
        ctx,
        canvasX: coords.canvasX,
        canvasY: coords.canvasY,
        bounds: imagePlacement,
        style: crosshair.style
      });
    }
  }
}