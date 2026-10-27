/**
 * Composited export (UI redesign phase 3, item 8): the viewport frame drawn
 * onto a 2D canvas at a scale factor, so an exported image reads like the
 * screen: the rendered slice, the canvas crosshair (the user's style), the
 * slice header (plane, mm, layer), the orientation letters and a colorbar
 * with its statistic caption (or a Regions legend for a label map).
 *
 * It reuses the frame's own formatters (frameFormat: header parts, colorbar
 * ticks, hidden band, threshold wording; anatomicalLabels; crosshairUtils'
 * stroke) so the export and the frame agree on every number and word. Only
 * the drawing (canvas instead of DOM) is new. Sizes are the frame's CSS
 * sizes times the scale.
 */
import type { ViewPlane } from '@/types/coordinates';
import type { AtlasPaletteLegendEntry } from '@/types/atlasPalette';
import type { ColorbarLayer } from '@/components/views/viewportFrame/ViewportColorbar';
import {
  colorbarTicks,
  hiddenBand,
  middleTruncate,
  shortLayerLabel,
  formatSlicePosition,
  PLANE_NAME,
  type FramePlane,
  colorbarBlockModel,
  nameWrapPieces,
} from '@/components/views/viewportFrame/frameFormat';
import { anatomicalLabels } from '@/utils/anatomicalLabels';
import { END_ON, projectGizmoAxes, type CameraBasis } from '@/utils/orientationGizmo';
import {
  adaptCrosshairStyleToViewport,
  buildActiveCrosshairStyle,
  drawCrosshair,
  type ActiveCrosshairSettings,
} from '@/utils/crosshairUtils';
import { colormaps } from '@/components/ui/colormapOptions';
import { formatLayerValue } from '@/utils/valueFormat';
import { INFERRED_MARK } from '@/utils/statistic';
import { formatRegionLabel } from '@/services/atlasRegionLookup';

export type ExportBackground = 'black' | 'white' | 'transparent';

/** What the exported frame includes (the dialog's Include row and background). */
export interface FrameIncludes {
  crosshair: boolean;
  header: boolean;
  orientation: boolean;
  /** Colorbar with its statistic caption, or the Regions legend of a label map. */
  colorbar: boolean;
  /** A 10 mm scale bar, bottom-right of each pane. */
  scaleBar: boolean;
  background: ExportBackground;
}

export interface CompositeOptions extends FrameIncludes {
  /**
   * Chrome unit: output pixels per CSS pixel at 96 dpi (dpi / 96). Text,
   * strokes and margins are sized from it, so their POINT size depends on
   * the output (its dpi), never on the source pane (v3 user critic).
   */
  unit: number;
  /** Align each row's panes left (montages) instead of centring them. */
  alignRows?: 'center' | 'start';
  /** Gap between panes in CSS px at 96 dpi. */
  paneGap?: number;
  /**
   * Exact output width (print): the composition is centred in it, so integer
   * pane widths never make the file a pixel wider or narrower than asked.
   */
  targetWidth?: number;
}

/** Figure text sizes in points. */
export const TEXT_PT = { label: 8, tick: 7, header: 8, letter: 8, tile: 7 } as const;

/** Output pixels for a size in points at the composition's chrome unit. */
export function ptToPx(pt: number, unit: number): number {
  return (pt / 72) * 96 * unit;
}

/** Chrome unit for a size: dpi / 96 for print, the screen multiple otherwise. */
export function chromeUnit(size: SizeSpec): number {
  return size.kind === 'print' ? size.dpi / 96 : size.scale;
}

export type ExportPreset = 'shown' | 'figure';

/**
 * "As shown": what the frame shows (crosshair included, canvas black).
 * "Figure": everything but the crosshair (header, letters, colorbar /
 * legend, scale bar) on white. "Figure" is the default (v2 user critic).
 */
export const EXPORT_PRESETS: Record<ExportPreset, FrameIncludes> = {
  shown: {
    crosshair: true,
    header: true,
    orientation: true,
    colorbar: true,
    scaleBar: false,
    background: 'black',
  },
  figure: {
    crosshair: false,
    header: true,
    orientation: true,
    colorbar: true,
    scaleBar: true,
    background: 'white',
  },
};

export function presetOf(options: FrameIncludes): ExportPreset | null {
  const names = Object.keys(EXPORT_PRESETS) as ExportPreset[];
  const keys: Array<keyof FrameIncludes> = [
    'crosshair',
    'header',
    'orientation',
    'colorbar',
    'scaleBar',
    'background',
  ];
  return names.find((name) => keys.every((k) => EXPORT_PRESETS[name][k] === options[k])) ?? null;
}

/**
 * Output size: a multiple of the screen, or a print width at a resolution
 * (journal columns: 89 mm single, 183 mm double; 300 or 600 dpi).
 */
export type SizeSpec =
  | { kind: 'screen'; scale: number }
  | { kind: 'print'; widthMm: number; dpi: number };

export const PRINT_WIDTHS_MM = [89, 183] as const;
export const PRINT_DPI = [300, 600] as const;

/** Target width in device pixels for a print size (null for a screen multiple). */
export function printWidthPx(size: SizeSpec): number | null {
  return size.kind === 'print' ? Math.round((size.widthMm / 25.4) * size.dpi) : null;
}

/** Scale bar length (mm) and its length in device pixels for a pane's plane. */
export const SCALE_BAR_MM = 10;
export function scaleBarPx(plane: Pick<ViewPlane, 'u_mm'>, mm = SCALE_BAR_MM): number {
  const mmPerPx = Math.hypot(plane.u_mm[0], plane.u_mm[1], plane.u_mm[2]);
  return mmPerPx > 0 ? mm / mmPerPx : 0;
}

/** One pane of a composition: a rendered slice and what its frame shows. */
export interface ExportPane {
  /** The rendered slice, `width` x `height` device pixels (scale applied). */
  image: CanvasImageSource;
  width: number;
  height: number;
  /** The view plane refitted to width x height (u/v per device pixel); null for a surface pane. */
  plane: ViewPlane | null;
  framePlane: FramePlane | null;
  /** World position of the slice along its axis (header). */
  positionMm: number;
  layerName: string | null;
  crosshairWorld: [number, number, number] | null;
  /** Small label at the pane's bottom-left (mosaic tiles: "z 50.5"). */
  tileLabel?: { text: string; emphasis: boolean } | null;
  /** False: no orientation letters on this pane (a montage letters its first tile only). */
  orientation?: boolean;
  /** False: no scale bar on this pane (a montage shows one, on its last tile). */
  scaleBar?: boolean;
  /**
   * A surface pose (phase 4, D4): its header ("Left lateral  overlay",
   * richest first) and the camera for the orientation glyph that replaces
   * the letters. Surface panes have no scale bar and no crosshair.
   */
  surface?: { header: HeaderRun[][]; basis: CameraBasis | null } | null;
}

export interface ExportSideBar {
  colorbar: ColorbarLayer | null;
  /** Value at the crosshair, drawn as a caret like the frame (As shown only). */
  value?: number | null;
  legend?: AtlasPaletteLegendEntry[] | null;
}

/** Colours for text drawn on the page (header band, colorbar column). */
interface PageTheme {
  ground: string | null;
  text: string;
  muted: string;
  rule: string;
  /** Ground under the colorbar's hidden band. */
  bandGround: string;
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function pageTheme(background: ExportBackground): PageTheme {
  if (background === 'white') {
    return { ground: '#ffffff', text: '#16171a', muted: '#5b5e66', rule: '#9a9da4', bandGround: '#ffffff' };
  }
  return {
    ground: background === 'black' ? cssVar('--bf-bg-canvas', '#000000') : null,
    text: cssVar('--bf-text-secondary', '#c4c6cb'),
    muted: cssVar('--bf-text-muted', '#a4a7ad'),
    rule: cssVar('--bf-border-strong', '#55585e'),
    bandGround: '#000000',
  };
}

/**
 * Text drawn ON an image pane (letters, scale bar). On a black or
 * transparent page: light with a dark halo. On a white page the pane is
 * matted onto the page (utils/exportMatte.ts: outside the head is white), so
 * the letters are dark with a light halo, readable on page and tissue alike.
 */
interface OnImageStyle {
  text: string;
  halo: string;
}
const ON_IMAGE_DARK: OnImageStyle = { text: '#e6e7ea', halo: 'rgba(0,0,0,0.85)' };
const ON_IMAGE_LIGHT: OnImageStyle = { text: '#16171a', halo: 'rgba(255,255,255,0.9)' };

export function onImageStyle(background: ExportBackground): OnImageStyle {
  return background === 'white' ? ON_IMAGE_LIGHT : ON_IMAGE_DARK;
}

const SANS = '"IBM Plex Sans", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

/** Width of the colorbar column in CSS px at 96 dpi (bar + ticks + caption). */
export const SIDEBAR_W = 120;
/**
 * Clear gutter between the image grid and the colorbar column (CSS px at
 * 96 dpi): the colorbar is its own column, never on the image (native check).
 */
export const SIDE_GAP = 14;

/** Gutter before the side column in output px, at least the pane gap. */
export function sideGapPx(unit: number, paneGap = 4): number {
  return Math.max(paneGap, SIDE_GAP) * unit;
}
const BAR_W = 10;
const MAX_BAR_H = 160;
/**
 * Tick mark length and the clear gap from its end to the label, in chrome
 * units: a 2-unit gap made "3.1" read "-3.1" and "0" read "-0" (v4 visual).
 */
export const TICK_LEN = 4;
export const TICK_LABEL_GAP = 5;
/** Inset of page text (header) and on-image text (scale bar) from a pane edge. */
export const EDGE_INSET = 4;

function font(px: number, family: string, weight = 400, italic = false): string {
  return `${italic ? 'italic ' : ''}${weight} ${px}px ${family}`;
}

/** Colormap gradient stops for a canvas gradient (the Inspector strip's colours). */
function colormapStops(name: string): string[] {
  const option = colormaps.find((c) => c.name === name);
  return option?.gradient.match(/#[0-9a-f]{3,8}/gi) ?? ['#000000', '#ffffff'];
}

/**
 * Label strip under a mosaic tile (output px): the "z 50.5" label sits on
 * the page, never on tissue, as on screen (v4 user critic).
 */
export function tileStripPx(unit: number): number {
  return Math.round(ptToPx(TEXT_PT.tile, unit) * 1.6 + 2 * unit);
}

/** Header band height above a pane (CSS px at 96 dpi). */
export function headerBandPx(unit: number): number {
  return Math.round(ptToPx(TEXT_PT.header, unit) * 1.9);
}

type Rect = { x: number; y: number; width: number; height: number };

/** The box of text drawn with the context's current font / align / baseline, padded for its halo. */
function textBox(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, u: number): Rect {
  const m = ctx.measureText(text);
  const w = m.width;
  const h = (m.actualBoundingBoxAscent ?? 0) + (m.actualBoundingBoxDescent ?? 0) || ptToPx(8, u);
  const left =
    ctx.textAlign === 'center' ? x - w / 2 : ctx.textAlign === 'right' || ctx.textAlign === 'end' ? x - w : x;
  const top =
    ctx.textBaseline === 'top' ? y : ctx.textBaseline === 'bottom' ? y - h : y - h / 2;
  const pad = 2 * u;
  return { x: left - pad, y: top - pad, width: w + 2 * pad, height: h + 2 * pad };
}

// ── pane ───────────────────────────────────────────────────────────────────

function drawPane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pane: ExportPane,
  options: CompositeOptions,
  settings: ActiveCrosshairSettings,
  theme: PageTheme,
  /** Image offset below the header (a shorter pane centred in its row). */
  imageDy = 0,
): void {
  const u = options.unit;
  // Header band above the image: plane, position and layer never cover the
  // image or its top letter (v3: "A" and "S" were hidden under the header).
  const band = options.header && !pane.tileLabel ? headerBandPx(u) : 0;
  if (band) drawHeaderBand(ctx, x, y, pane, u, band, theme);
  const iy = y + band + imageDy;
  // On a black page the pane sits on black (as on screen). On a white or
  // transparent page the capture has already matted the pane onto the page
  // (utils/exportMatte.ts): outside the head is page, with no dark rim.
  if (options.background === 'black') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, iy, pane.width, pane.height);
  }
  ctx.drawImage(pane.image, x, iy, pane.width, pane.height);
  const onImage = onImageStyle(options.background);

  // Everything on the image first, collecting boxes the crosshair skips.
  const knockouts: Rect[] = [];

  // Orientation letters, measured first: the scale bar is placed clear of them.
  const letterFont = font(ptToPx(TEXT_PT.letter, u), SANS, 600);
  const letters: Array<{ text: string; x: number; y: number; align: CanvasTextAlign; baseline: CanvasTextBaseline; box: Rect }> = [];
  if (options.orientation && pane.orientation !== false && pane.plane) {
    const labels = anatomicalLabels(pane.plane);
    if (labels) {
      const off = 5 * u;
      const specs: Array<[string, number, number, CanvasTextAlign, CanvasTextBaseline]> = [
        [labels.top, x + pane.width / 2, iy + off, 'center', 'top'],
        [labels.bottom, x + pane.width / 2, iy + pane.height - off, 'center', 'bottom'],
        [labels.left, x + off, iy + pane.height / 2, 'left', 'middle'],
        [labels.right, x + pane.width - off, iy + pane.height / 2, 'right', 'middle'],
      ];
      ctx.save();
      ctx.font = letterFont;
      for (const [text, lx, ly, align, baseline] of specs) {
        ctx.textAlign = align;
        ctx.textBaseline = baseline;
        letters.push({ text, x: lx, y: ly, align, baseline, box: textBox(ctx, text, lx, ly, u) });
      }
      ctx.restore();
    }
  }

  const bar =
    options.scaleBar && pane.scaleBar !== false && pane.plane
      ? planScaleBar(ctx, x, iy, pane, u, letters.map((l) => l.box))
      : null;
  // A letter the scale bar must cover (a pane too small for both) is left
  // out: text never overlaps text (the top letter still orients the pane).
  ctx.save();
  ctx.font = letterFont;
  ctx.fillStyle = onImage.text;
  ctx.shadowColor = onImage.halo;
  ctx.shadowBlur = 3 * u;
  for (const l of letters) {
    if (bar && intersects(l.box, bar.box)) continue;
    ctx.textAlign = l.align;
    ctx.textBaseline = l.baseline;
    ctx.fillText(l.text, l.x, l.y);
    knockouts.push(l.box);
  }
  ctx.restore();
  if (bar) {
    paintScaleBar(ctx, bar, u, onImage);
    knockouts.push(bar.box);
  }

  if (pane.tileLabel) {
    // In the strip under the tile, on the page (left-aligned with the tile).
    ctx.save();
    ctx.font = font(ptToPx(TEXT_PT.tile, u), MONO, pane.tileLabel.emphasis ? 600 : 400);
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(pane.tileLabel.text, x + 1 * u, iy + pane.height + tileStripPx(u) / 2);
    ctx.restore();
  }

  if (options.orientation && pane.surface?.basis) {
    drawGizmo(ctx, x + EDGE_INSET * u, iy + pane.height - EDGE_INSET * u, pane.surface.basis, u, onImage);
  }

  if (options.crosshair && pane.crosshairWorld && pane.plane) {
    const point = projectToImage(pane.crosshairWorld, pane.plane);
    if (point) {
      // The user's stroke at the frame's CSS size, in chrome units; it
      // skips the letters, labels and scale bar like on screen.
      const base = adaptCrosshairStyleToViewport(
        buildActiveCrosshairStyle(settings),
        pane.width / u,
        pane.height / u,
      );
      const style = {
        ...base,
        lineWidth: base.lineWidth * u,
        lineDash: base.lineDash?.map((d) => d * u),
        centerGap: base.centerGap ? base.centerGap * u : base.centerGap,
      };
      drawCrosshair({
        ctx,
        canvasX: x + point[0],
        canvasY: iy + point[1],
        bounds: { x, y: iy, width: pane.width, height: pane.height },
        style,
        knockouts,
      });
    }
  }
}

/** Side of the orientation glyph's box, in chrome units (D5). */
export const GIZMO_SIZE = 40;

/**
 * The orientation glyph (D5) in the pane's bottom-left corner (x, bottom):
 * R / A / S as the pose's camera sees them, back to front, axes pointing
 * away dimmed. On-image style, like the letters it replaces.
 */
function drawGizmo(
  ctx: CanvasRenderingContext2D,
  x: number,
  bottom: number,
  basis: CameraBasis,
  u: number,
  style: OnImageStyle,
): void {
  const size = GIZMO_SIZE * u;
  const c = { x: x + size / 2, y: bottom - size / 2 };
  const r = size * 0.3;
  ctx.save();
  ctx.strokeStyle = style.text;
  ctx.fillStyle = style.text;
  ctx.shadowColor = style.halo;
  ctx.shadowBlur = 3 * u;
  ctx.lineWidth = 1.25 * u;
  ctx.lineCap = 'round';
  ctx.font = font(ptToPx(TEXT_PT.tick, u), SANS, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const axis of projectGizmoAxes(basis)) {
    const away = axis.depth < -0.05;
    if (Math.hypot(axis.x, axis.y) < END_ON) {
      // Along the line of sight: a ring (away) or a dot (toward), the letter beside it.
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2.5 * u, 0, 2 * Math.PI);
      if (away) ctx.stroke();
      else ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillText(axis.label, c.x + 5 * u, c.y + 6 * u);
      ctx.textAlign = 'center';
      continue;
    }
    ctx.globalAlpha = away ? 0.55 : 1;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + axis.x * r, c.y + axis.y * r);
    ctx.stroke();
    ctx.fillText(axis.label, c.x + axis.x * (r + 6 * u), c.y + axis.y * (r + 6 * u));
  }
  ctx.restore();
}

interface ScaleBarPlan {
  barX: number;
  base: number;
  length: number;
  text: string;
  textRight: number;
  box: Rect;
}

/**
 * 10 mm bar, bottom-right of the pane, its length from the pane's own mm/px.
 * Placed clear of the orientation letters: bottom-right; else raised above
 * the letter it would cover (a narrow figure-row pane: "10 mm" ran into the
 * bottom "P"); else bottom-right (the caller drops the covered letter).
 */
function planScaleBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pane: ExportPane,
  u: number,
  avoid: readonly Rect[],
): ScaleBarPlan | null {
  if (!pane.plane) return null;
  const length = scaleBarPx(pane.plane);
  if (!(length > 4) || length > pane.width * 0.6) return null;
  const right = x + pane.width - 8 * u;
  ctx.save();
  ctx.font = font(ptToPx(TEXT_PT.tick, u), MONO);
  // Centred over the bar, but never past the pane edge: a short bar (a
  // mosaic tile) right-aligns its label to the bar's end instead.
  const text = `${SCALE_BAR_MM} mm`;
  const textW = ctx.measureText(text).width;
  ctx.restore();
  const textRight = Math.min(right - length / 2 + textW / 2, x + pane.width - EDGE_INSET * u);
  const h = ptToPx(TEXT_PT.tick, u) * 1.4 + 6 * u;
  const left = Math.min(right - length, textRight - textW) - 2 * u;
  const boxAt = (b: number): Rect => ({ x: left, y: b - h, width: right + 2 * u - left, height: h + 2 * u });
  const clear = (b: number) => b - h >= y && !avoid.some((other) => intersects(boxAt(b), other));
  const bottom = y + pane.height - 8 * u;
  let base = bottom;
  if (!clear(bottom)) {
    const blocker = avoid.find((other) => intersects(boxAt(bottom), other));
    if (blocker && clear(blocker.y - 3 * u)) base = blocker.y - 3 * u;
  }
  return { barX: right - length, base, length, text, textRight, box: boxAt(base) };
}

function paintScaleBar(ctx: CanvasRenderingContext2D, plan: ScaleBarPlan, u: number, style: OnImageStyle): void {
  ctx.save();
  ctx.fillStyle = style.text;
  ctx.shadowColor = style.halo;
  ctx.shadowBlur = 3 * u;
  ctx.fillRect(plan.barX, plan.base - 2 * u, plan.length, 2 * u);
  ctx.font = font(ptToPx(TEXT_PT.tick, u), MONO);
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right';
  ctx.fillText(plan.text, plan.textRight, plan.base - 4 * u);
  ctx.restore();
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** One run of a slice header. */
export interface HeaderRun {
  text: string;
  italic?: boolean;
  muted?: boolean;
  /** Space before this run, in em (default: the 6-unit word gap). */
  gapEm?: number;
}

/**
 * The slice header, richest first: each candidate is tried in turn and the
 * first that fits the pane is drawn, so headers never run together or past
 * their pane (native check, figure row at 89 mm):
 *   "Axial  z = −10.0 mm  zmap"  →  "Axial  z = −10.0 mm"  →  "z = −10.0 mm"
 *   →  "z −10.0 mm"  →  "z −10.0"  →  nothing.
 * The layer name is whole or absent (never ellipsized, v5 critics).
 */
export function headerCandidates(
  plane: FramePlane,
  positionMm: number,
  layerName: string | null,
): HeaderRun[][] {
  const position = formatSlicePosition(plane, positionMm);
  const match = /^([xyz]) (.*)$/.exec(position);
  const planeRun: HeaderRun = { text: PLANE_NAME[plane] };
  if (!match) {
    const plain: HeaderRun[] = [planeRun, { text: position }];
    return [plain, [{ text: position }], []];
  }
  const [, axis, value] = match;
  const bare = value.replace(/\s*mm$/, '');
  const full: HeaderRun[] = [
    planeRun,
    { text: axis, italic: true },
    { text: `= ${value}`, gapEm: 0.3 },
  ];
  const out: HeaderRun[][] = [];
  if (layerName) out.push([...full, { text: shortLayerLabel(layerName), muted: true }]);
  out.push(full);
  out.push(full.slice(1));
  out.push([{ text: axis, italic: true }, { text: value, gapEm: 0.3 }]);
  out.push([{ text: axis, italic: true }, { text: bare, gapEm: 0.3 }]);
  out.push([]);
  return out;
}

function drawHeaderBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pane: ExportPane,
  u: number,
  band: number,
  theme: PageTheme,
): void {
  // "Axial  z = 50.5 mm  zmap_synthetic": sans throughout, the axis variable
  // italic, the layer muted; shortened until it fits inside the pane with an
  // inset at both ends.
  const px = ptToPx(TEXT_PT.header, u);
  const gap = 6 * u;
  const room = pane.width - 2 * EDGE_INSET * u;
  ctx.save();
  const styled = (runs: HeaderRun[]) =>
    runs.map((r) => ({
      text: r.text,
      font: font(px, SANS, 400, !!r.italic),
      color: r.muted ? theme.muted : theme.text,
      gap: r.gapEm != null ? px * r.gapEm : undefined,
    }));
  const measure = (list: ReturnType<typeof styled>) =>
    list.reduce((sum, p, i) => {
      ctx.font = p.font;
      return sum + ctx.measureText(p.text).width + (i > 0 ? (p.gap ?? gap) : 0);
    }, 0);
  const candidates = pane.surface
    ? pane.surface.header
    : pane.framePlane
      ? headerCandidates(pane.framePlane, pane.positionMm, pane.layerName)
      : [];
  const parts =
    candidates
      .map(styled)
      .find((list) => measure(list) <= room) ?? [];
  ctx.textBaseline = 'middle';
  // Inset from the pane's left edge (the header is page text, not flush).
  let cx = x + EDGE_INSET * u;
  parts.forEach((p, i) => {
    if (i > 0) cx += p.gap ?? gap;
    ctx.font = p.font;
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, cx, y + band / 2);
    cx += ctx.measureText(p.text).width;
  });
  ctx.restore();
}

function projectToImage(
  world: [number, number, number],
  plane: ViewPlane,
): [number, number] | null {
  const [u, v, o] = [plane.u_mm, plane.v_mm, plane.origin_mm];
  const d = [world[0] - o[0], world[1] - o[1], world[2] - o[2]];
  // Least squares in the plane (u, v orthogonal for slice views).
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (!(uu > 0) || !(vv > 0)) return null;
  return [
    (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / uu,
    (d[0] * v[0] + d[1] * v[1] + d[2] * v[2]) / vv,
  ];
}

// ── side bar: colorbar or legend (one ColorbarBlock model with the frame) ──

/** Draw runs of [text, italic, mono] left to right; returns the advance. */
function drawRuns(
  ctx: CanvasRenderingContext2D,
  runs: Array<{ text: string; italic?: boolean; mono?: boolean }>,
  x: number,
  y: number,
  px: number,
): number {
  let cx = x;
  for (const r of runs) {
    ctx.font = font(px, r.mono ? MONO : SANS, 400, !!r.italic);
    ctx.fillText(r.text, cx, y);
    cx += ctx.measureText(r.text).width;
  }
  return cx - x;
}

function measureRuns(
  ctx: CanvasRenderingContext2D,
  runs: Array<{ text: string; italic?: boolean; mono?: boolean }>,
  px: number,
): number {
  return runs.reduce((w, r) => {
    ctx.font = font(px, r.mono ? MONO : SANS, 400, !!r.italic);
    return w + ctx.measureText(r.text).width;
  }, 0);
}

/** Smallest bar the export draws (CSS px at 96 dpi). */
const MIN_EXPORT_BAR = 60;

interface ColorbarBlockLayout {
  /** Room left of the bar for the crosshair caret and its value (output px). */
  caretRoom: number;
  prefix: string;
  nameInline: boolean;
  nameLines: string[];
  /** Space above the bar: caption (and name lines). */
  headroom: number;
  footerTwoLines: boolean;
  noteLines: string[];
  /** Space below the bar: footer lines, then the inferred-statistic note. */
  footBlock: number;
}

/**
 * The colorbar block's text, measured once: drawing and the composition's
 * height both use it, so the canvas always holds the whole block, footnote
 * included (v5 fidelity: "z* inferred from file name" fell below the canvas
 * in figure rows and short panes).
 */
function colorbarBlockLayout(ctx: CanvasRenderingContext2D, side: ExportSideBar, u: number): ColorbarBlockLayout {
  const layer = side.colorbar!;
  const block = colorbarBlockModel(layer);
  const labelPx = ptToPx(TEXT_PT.label, u);
  const tickPx = ptToPx(TEXT_PT.tick, u);
  const colW = SIDEBAR_W * u;
  ctx.save();
  // The value beside the caret is right-aligned 7 units left of the bar: the
  // room before the bar holds all of it, so it never reaches into the image
  // grid left of the column (native check: the colorbar on the image).
  let caretRoom = 4 * u;
  if (side.value != null && Number.isFinite(side.value)) {
    ctx.font = font(tickPx, MONO);
    caretRoom = Math.max(30 * u, ctx.measureText(formatLayerValue(side.value)).width + 9 * u);
  }
  const room = colW - caretRoom - 2 * u;
  ctx.font = font(labelPx, SANS);
  const symbolW = measureRuns(ctx, block.symbol, labelPx);
  const prefix = block.symbol.length ? ' · ' : '';
  ctx.font = font(labelPx, SANS);
  const nameInline = !!block.name && symbolW + ctx.measureText(prefix + block.name).width <= room;
  const nameLines = block.name && !nameInline ? wrapAtBoundaries(ctx, block.name, room, 2) : [];
  const footerTwoLines = block.footer.length > 0 && measureRuns(ctx, block.footer, tickPx) > colW - caretRoom;
  const note = inferredStatisticNote(layer.units);
  ctx.font = font(tickPx, SANS);
  const noteLines = note ? wrapWords(ctx, note, colW - caretRoom) : [];
  ctx.restore();
  const lineH = labelPx * 1.25;
  const headroom = labelPx * 2 + nameLines.length * lineH;
  const footerLines = block.footer.length ? (footerTwoLines ? 2 : 1) : 0;
  const footBlock =
    6 * u + footerLines * tickPx * 1.4 + (noteLines.length ? 2 * u + noteLines.length * tickPx * 1.3 : 0) + 4 * u;
  return { caretRoom, prefix, nameInline, nameLines, headroom, footerTwoLines, noteLines, footBlock };
}

/** Height the side column needs (colorbar block, and a legend below it). */
export function sideColumnMinHeight(ctx: CanvasRenderingContext2D, side: ExportSideBar, u: number): number {
  if (!side.colorbar) return 0;
  const l = colorbarBlockLayout(ctx, side, u);
  const block = l.headroom + MIN_EXPORT_BAR * u + l.footBlock;
  // With a legend the colorbar gets the top 60% of the column.
  return side.legend && side.legend.length > 0 ? block / 0.6 : block;
}

function drawColorbar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  side: ExportSideBar,
  u: number,
  theme: PageTheme,
): void {
  const layer = side.colorbar!;
  const block = colorbarBlockModel(layer);
  const labelPx = ptToPx(TEXT_PT.label, u);
  const tickPx = ptToPx(TEXT_PT.tick, u);
  const [wMin, wMax] = layer.intensity;
  // The layer name, never ellipsized (v5 critics): beside the symbol when it
  // fits, else whole on its own line(s) above, wrapped at name boundaries
  // (_ - .); a name that needs more than two lines is left to the file name.
  // The bar takes what the caption above and the footer below leave.
  const layout = colorbarBlockLayout(ctx, side, u);
  const caretRoom = layout.caretRoom;
  const barX = x + caretRoom;
  const { prefix, nameInline, nameLines } = layout;
  const lineH = labelPx * 1.25;
  const free = height - layout.headroom - layout.footBlock;
  const barH = Math.max(24 * u, Math.min(MAX_BAR_H * u, free));
  const top = y + layout.headroom + Math.max(0, (free - barH) / 2);

  ctx.save();
  // Caption: the statistic symbol; the layer name only when it fits whole
  // enough to identify the layer (>= 8 characters), never a stub ("Mo.").
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.text;
  // Clear of the top tick label, which is centred on the bar's top edge.
  const captionY = top - tickPx / 2 - 5 * u;
  const symbolRuns = block.symbol;
  const cx = barX + drawRuns(ctx, symbolRuns, barX, captionY, labelPx);
  ctx.font = font(labelPx, SANS);
  // Full ink: a figure's colorbar title must stay ≥ 4.5:1 on white at print size (v1 F1).
  ctx.fillStyle = theme.text;
  if (nameInline && block.name) {
    ctx.fillText(prefix + block.name, cx, captionY);
  } else {
    nameLines.forEach((line, i) =>
      ctx.fillText(line, barX, captionY - (nameLines.length - i) * lineH),
    );
  }

  // Bar: the colormap gradient, min at the bottom.
  const gradient = ctx.createLinearGradient(0, top + barH, 0, top);
  const stops = colormapStops(layer.colormap);
  stops.forEach((c, i) =>
    gradient.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c),
  );
  const bw = BAR_W * u;
  ctx.fillStyle = gradient;
  ctx.fillRect(barX, top, bw, barH);

  // Hidden threshold band: the ground with a faint hatch (the frame's cut-out).
  const band = hiddenBand(layer.intensity, layer.threshold);
  if (band) {
    const y0 = top + (1 - band[1]) * barH;
    const y1 = top + (1 - band[0]) * barH;
    ctx.fillStyle = theme.bandGround;
    ctx.fillRect(barX, y0, bw, y1 - y0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(barX, y0, bw, y1 - y0);
    ctx.clip();
    ctx.strokeStyle = theme.rule;
    ctx.lineWidth = 1 * u;
    for (let k = -bw; k < y1 - y0 + bw; k += 4 * u) {
      ctx.beginPath();
      ctx.moveTo(barX, y0 + k + bw);
      ctx.lineTo(barX + bw, y0 + k);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.strokeStyle = theme.rule;
  ctx.lineWidth = 1 * u;
  ctx.strokeRect(barX, top, bw, barH);

  // Ticks and labels (the frame's own tick selection and wording), close
  // to their marks.
  const ticks = colorbarTicks(layer.intensity, layer.threshold, barH / u, 12, layer.dataRange);
  ctx.font = font(tickPx, MONO);
  ctx.fillStyle = theme.text;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const t of ticks) {
    const ty = top + (1 - t.fraction) * barH;
    ctx.fillRect(barX + bw, ty - 0.5 * u, TICK_LEN * u, 1 * u);
    ctx.fillText(t.label, barX + bw + (TICK_LEN + TICK_LABEL_GAP) * u, ty);
  }

  // Crosshair value as a caret, clamped to the bar.
  if (side.value != null && Number.isFinite(side.value) && wMax > wMin) {
    const f = Math.max(0, Math.min(1, (side.value - wMin) / (wMax - wMin)));
    const cy = top + (1 - f) * barH;
    ctx.beginPath();
    ctx.moveTo(barX - 1 * u, cy);
    ctx.lineTo(barX - 5 * u, cy - 3.5 * u);
    ctx.lineTo(barX - 5 * u, cy + 3.5 * u);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'right';
    ctx.fillText(formatLayerValue(side.value), barX - 7 * u, cy);
  }

  // Footer: one line, the variable italic, numbers mono ("|z| ≤ 3.1 hidden").
  if (block.footer.length) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.muted;
    const fy = top + barH + 6 * u;
    if (!layout.footerTwoLines) {
      drawRuns(ctx, block.footer, barX, fy, tickPx);
    } else {
      // Too narrow for one line: expression, then "hidden".
      const cut = block.footer.length - 1;
      drawRuns(ctx, block.footer.slice(0, cut), barX, fy, tickPx);
      drawRuns(ctx, [{ text: block.footer[cut].text.trim() }], barX, fy + tickPx * 1.4, tickPx);
    }
  }

  // A statistic guessed from the file name is explained on the figure: on
  // paper "z*" usually means a critical value (v4 fidelity critic).
  if (layout.noteLines.length) {
    const lines = block.footer.length ? (layout.footerTwoLines ? 2 : 1) : 0;
    const ny = top + barH + 6 * u + lines * tickPx * 1.4 + 2 * u;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.muted;
    ctx.font = font(tickPx, SANS);
    layout.noteLines.forEach((line, i) => ctx.fillText(line, barX, ny + i * tickPx * 1.3));
  }
  ctx.restore();
}

/** "z* inferred from file name" for a guessed statistic, else null. */
export function inferredStatisticNote(units: string | null | undefined): string | null {
  return units && units.endsWith(INFERRED_MARK) ? `${units} inferred from file name` : null;
}

/**
 * A name broken at its own boundaries (after _ - . or a space) into at most
 * `maxLines` lines of `width`; [] when it does not fit whole that way.
 */
/** Wrap a layer name at its boundaries to `width` px (null-free: [] when it does not fit). */
export function wrapAtBoundaries(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  width: number,
  maxLines: number,
): string[] {
  // The same wrap points as the on-screen colorbar: "(lh, rh)" stays whole (round 3 S1).
  const pieces = nameWrapPieces(text);
  const lines: string[] = [];
  let line = '';
  for (const piece of pieces) {
    if (line && ctx.measureText(line + piece).width > width) {
      lines.push(line);
      line = piece;
    } else line += piece;
  }
  if (line) lines.push(line);
  return lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= width) ? lines : [];
}

/** Greedy word wrap to `width` with the context's current font. */
function wrapWords(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  legend: AtlasPaletteLegendEntry[],
  u: number,
  theme: PageTheme,
): void {
  const px = ptToPx(TEXT_PT.label, u);
  const line = px * 1.6;
  const rows = legend.slice(0, Math.max(1, Math.floor((height - 16 * u) / line)));
  let ty = y + (height - rows.length * line) / 2;
  const room = SIDEBAR_W * u - 26 * u;
  ctx.save();
  ctx.font = font(px, SANS);
  ctx.textBaseline = 'middle';
  for (const entry of rows) {
    ctx.fillStyle = `rgb(${entry.color[0]}, ${entry.color[1]}, ${entry.color[2]})`;
    ctx.fillRect(x + 8 * u, ty + line / 2 - 3 * u, 6 * u, 6 * u);
    ctx.fillStyle = theme.text;
    // Truncated with an ellipsis, never squashed to fit.
    const full = formatRegionLabel(entry);
    let name = full;
    for (let chars = full.length; chars >= 4 && ctx.measureText(name).width > room; chars -= 1) {
      name = middleTruncate(full, chars, 4) ?? full;
    }
    ctx.fillText(name, x + 20 * u, ty + line / 2);
    ty += line;
  }
  ctx.restore();
}

// ── composition ────────────────────────────────────────────────────────────

/** Where each pane goes: rows of panes. */
export type PaneLayout = ExportPane[][];

export interface Composition {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
}

/** Composition size for a layout (the capture solves pane sizes with it). */
export function compositionSize(
  rows: Array<Array<{ width: number; height: number; tile?: boolean }>>,
  options: Pick<CompositeOptions, 'unit' | 'header' | 'colorbar' | 'paneGap' | 'targetWidth'>,
  hasSide: boolean,
  /** The side column's measured height (sideColumnMinHeight): the canvas holds it all. */
  sideMinHeight = 0,
): { width: number; height: number; gridW: number; offsetX: number } {
  const { width, height, gridW, offsetX } = compositionLayout(rows, options, hasSide, sideMinHeight);
  return { width, height, gridW, offsetX };
}

/** A box in output px (canvas coordinates). */
export type Box = { x: number; y: number; width: number; height: number };

export interface CompositionLayout {
  width: number;
  height: number;
  gridW: number;
  offsetX: number;
  /** Per row, per pane: the header band / tile strip and the image box (canvas coordinates). */
  panes: Array<Array<{ x: number; y: number; band: number; imageDy: number; image: Box }>>;
  /** The colorbar / legend column (canvas coordinates), or null. */
  side: Box | null;
}

/**
 * Where everything goes: one layout for the size check, the drawing and the
 * geometry tests. The side column starts a clear gutter (SIDE_GAP) right of
 * the widest row, so it never overlaps an image.
 */
export function compositionLayout(
  rows: Array<Array<{ width: number; height: number; tile?: boolean }>>,
  options: Pick<CompositeOptions, 'unit' | 'header' | 'colorbar' | 'paneGap' | 'targetWidth' | 'alignRows'>,
  hasSide: boolean,
  sideMinHeight = 0,
): CompositionLayout {
  const u = options.unit;
  const gap = (options.paneGap ?? 4) * u;
  const band = (p: { tile?: boolean }) =>
    p.tile ? tileStripPx(u) : options.header ? headerBandPx(u) : 0;
  const rowWidths = rows.map(
    (r) => r.reduce((w, p) => w + p.width, 0) + gap * Math.max(0, r.length - 1),
  );
  const rowHeights = rows.map((r) => Math.max(0, ...r.map((p) => p.height + band(p))));
  const gridW = Math.max(0, ...rowWidths);
  const gridH = rowHeights.reduce((a, b) => a + b, 0) + gap * Math.max(0, rows.length - 1);
  const sideGap = sideGapPx(u, options.paneGap ?? 4);
  const sideW = hasSide ? SIDEBAR_W * u + sideGap : 0;
  const natural = Math.max(1, Math.round(gridW + sideW));
  const width = options.targetWidth && options.targetWidth > 0 ? Math.round(options.targetWidth) : natural;
  const height = Math.max(1, Math.round(gridH), hasSide ? Math.ceil(sideMinHeight) : 0);
  const offsetX = Math.max(0, Math.floor((width - (gridW + sideW)) / 2));

  let y = 0;
  const panes = rows.map((row, r) => {
    let x = options.alignRows === 'start' ? 0 : (gridW - rowWidths[r]) / 2;
    const placed = row.map((pane) => {
      const b = band(pane);
      // Shorter images sit centred in the row (no ragged bottoms in a figure
      // row: axial is taller than coronal and sagittal), while every header
      // stays at the row's top: one shared baseline (native v6 recheck).
      const dy = Math.max(0, Math.round((rowHeights[r] - (pane.height + b)) / 2));
      const at = { x: offsetX + x, y, band: b, imageDy: dy };
      x += pane.width + gap;
      return {
        ...at,
        image: { x: at.x, y: y + (pane.tile ? 0 : b) + dy, width: pane.width, height: pane.height },
      };
    });
    y += rowHeights[r] + gap;
    return placed;
  });
  const side = hasSide ? { x: offsetX + gridW + sideGap, y: 0, width: SIDEBAR_W * u, height } : null;
  return { width, height, gridW, offsetX, panes, side };
}

export function compose(
  rows: PaneLayout,
  side: ExportSideBar,
  options: CompositeOptions,
  settings: ActiveCrosshairSettings,
): Composition {
  const u = options.unit;
  const theme = pageTheme(options.background);
  const hasSide =
    options.colorbar && (!!side.colorbar || (!!side.legend && side.legend.length > 0));
  // The side column's height, measured with the same fonts (a scratch
  // context): a short figure row grows to hold the whole colorbar block.
  const measureCtx = hasSide && side.colorbar ? (makeCanvas(1, 1).getContext('2d') as CanvasRenderingContext2D | null) : null;
  const sideMin = measureCtx ? sideColumnMinHeight(measureCtx, side, u) : 0;
  const layout = compositionLayout(
    rows.map((r) => r.map((p) => ({ width: p.width, height: p.height, tile: !!p.tileLabel }))),
    options,
    hasSide,
    sideMin,
  );
  const { width, height } = layout;

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Export: no 2D canvas context');
  if (theme.ground) {
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, width, height);
  }

  rows.forEach((row, r) => {
    row.forEach((pane, c) => {
      const at = layout.panes[r][c];
      drawPane(ctx, at.x, at.y, pane, options, settings, theme, at.imageDy);
    });
  });

  if (layout.side) {
    const { x: sx, height: sh } = layout.side;
    const legend = side.legend && side.legend.length > 0 ? side.legend : null;
    if (side.colorbar && legend) {
      // A statistic over a label map: the colorbar above, the regions below.
      const split = Math.round(sh * 0.6);
      drawColorbar(ctx, sx, 0, split, side, u, theme);
      drawLegend(ctx, sx, split, sh - split, legend, u, theme);
    } else if (side.colorbar) drawColorbar(ctx, sx, 0, sh, side, u, theme);
    else if (legend) drawLegend(ctx, sx, 0, sh, legend, u, theme);
  }
  return { canvas, width, height };
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return new OffscreenCanvas(width, height);
}

export interface EncodeMeta {
  /** Written into the file (PNG pHYs, JPEG JFIF density) so it opens at its print size. */
  dpi?: number | null;
  /** Provenance JSON, embedded as a PNG tEXt chunk / JPEG comment. */
  provenance?: string | null;
}

/**
 * Encode a composition. JPEG has no alpha: it is flattened onto the chosen
 * background (black for a transparent one).
 */
export async function encodeComposition(
  composition: Composition,
  format: 'png' | 'jpg',
  background: ExportBackground,
  meta: EncodeMeta = {},
): Promise<Uint8Array> {
  let source = composition.canvas;
  if (format === 'jpg' && background === 'transparent') {
    const flat = makeCanvas(composition.width, composition.height);
    const ctx = flat.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, composition.width, composition.height);
    ctx.drawImage(source as CanvasImageSource, 0, 0);
    source = flat;
  }
  const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const blob =
    'convertToBlob' in source
      ? await (source as OffscreenCanvas).convertToBlob({ type, quality: 0.95 })
      : await new Promise<Blob>((resolve, reject) =>
          (source as HTMLCanvasElement).toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Export: the canvas could not be encoded'))),
            type,
            0.95,
          ),
        );
  let bytes = new Uint8Array(await blob.arrayBuffer());
  if (format === 'png') {
    bytes = withPngMetadata(bytes, meta);
  } else {
    bytes = withJpegMetadata(bytes, meta);
  }
  return bytes;
}

// ── file metadata (no dependencies) ──────────────────────────────────────────

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const latin1 = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
const utf8 = (text: string) => new TextEncoder().encode(text);

/**
 * Insert a pHYs chunk (pixels per metre from dpi) and an iTXt
 * "brainflow:provenance" chunk after IHDR, replacing an existing pHYs.
 */
export function withPngMetadata(png: Uint8Array, meta: EncodeMeta): Uint8Array {
  if (!meta.dpi && !meta.provenance) return png;
  const SIG = 8;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ihdrEnd = SIG + 12 + view.getUint32(SIG);
  const chunks: Uint8Array[] = [png.subarray(0, ihdrEnd)];
  if (meta.dpi && meta.dpi > 0) {
    const ppm = Math.round(meta.dpi / 0.0254);
    const data = new Uint8Array(9);
    const dv = new DataView(data.buffer);
    dv.setUint32(0, ppm);
    dv.setUint32(4, ppm);
    data[8] = 1; // unit: metre
    chunks.push(pngChunk('pHYs', data));
  }
  if (meta.provenance) {
    // iTXt: keyword \0 compression-flag compression-method lang \0 translated \0 text (UTF-8).
    const keyword = latin1('brainflow:provenance');
    const text = utf8(meta.provenance);
    const data = new Uint8Array(keyword.length + 5 + text.length);
    data.set(keyword, 0);
    data.set(text, keyword.length + 5);
    chunks.push(pngChunk('iTXt', data));
  }
  // Rest of the file, dropping an existing pHYs when we wrote one.
  let offset = ihdrEnd;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (!(type === 'pHYs' && meta.dpi)) chunks.push(png.subarray(offset, end));
    offset = end;
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** dpi in the JFIF APP0 density fields, provenance as a COM segment. */
export function withJpegMetadata(jpeg: Uint8Array, meta: EncodeMeta): Uint8Array {
  let out = jpeg;
  if (meta.dpi && meta.dpi > 0 && jpeg[2] === 0xff && jpeg[3] === 0xe0) {
    // FFD8 FFE0 len(2) "JFIF\0" version(2) units(1) Xdensity(2) Ydensity(2)
    const isJfif = String.fromCharCode(...jpeg.subarray(6, 10)) === 'JFIF';
    if (isJfif) {
      out = jpeg.slice();
      const dpi = Math.min(65535, Math.round(meta.dpi));
      out[13] = 1; // dots per inch
      out[14] = dpi >> 8;
      out[15] = dpi & 0xff;
      out[16] = dpi >> 8;
      out[17] = dpi & 0xff;
    }
  }
  if (meta.provenance) {
    const text = utf8(meta.provenance).subarray(0, 65533);
    const segment = new Uint8Array(4 + text.length);
    segment[0] = 0xff;
    segment[1] = 0xfe;
    segment[2] = (text.length + 2) >> 8;
    segment[3] = (text.length + 2) & 0xff;
    segment.set(text, 4);
    // After the APP0 JFIF segment (JFIF requires APP0 to follow SOI).
    let at = 2;
    if (out[2] === 0xff && out[3] === 0xe0) at = 4 + ((out[4] << 8) | out[5]);
    const merged = new Uint8Array(out.length + segment.length);
    merged.set(out.subarray(0, at), 0);
    merged.set(segment, at);
    merged.set(out.subarray(at), at + segment.length);
    out = merged;
  }
  return out;
}

/** "1050 × 840 px · 89 × 71 mm at 300 dpi" for the dialog. */
export function outputSizeText(width: number, height: number, dpi = 300): string {
  const mm = (px: number) => Math.round((px / dpi) * 25.4);
  return `${width} × ${height} px · ${mm(width)} × ${mm(height)} mm at ${dpi} dpi`;
}
