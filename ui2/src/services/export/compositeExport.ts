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
  thresholdExpressionParts,
  formatSlicePosition,
  PLANE_NAME,
  type FramePlane,
} from '@/components/views/viewportFrame/frameFormat';
import { anatomicalLabels } from '@/utils/anatomicalLabels';
import {
  adaptCrosshairStyleToViewport,
  buildActiveCrosshairStyle,
  drawCrosshair,
  type ActiveCrosshairSettings,
} from '@/utils/crosshairUtils';
import { colormaps } from '@/components/ui/colormapOptions';
import { formatLayerValue } from '@/utils/valueFormat';
import { splitStatisticSymbol, statisticVariable } from '@/utils/statistic';
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
  /** Device pixels per on-screen CSS pixel (resolved from the size). */
  scale: number;
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

/** Scale that makes a composition `baseWidth` CSS px wide come out at the size. */
export function resolveScale(size: SizeSpec, baseWidth: number): number {
  const target = printWidthPx(size);
  if (target === null) return size.kind === 'screen' ? size.scale : 1;
  return baseWidth > 0 ? target / baseWidth : 1;
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
  /** The view plane refitted to width x height (u/v per device pixel). */
  plane: ViewPlane;
  framePlane: FramePlane;
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
}

export interface ExportSideBar {
  colorbar: ColorbarLayer | null;
  /** Value at the crosshair, drawn as a caret like the frame (As shown only). */
  value?: number | null;
  legend?: AtlasPaletteLegendEntry[] | null;
}

interface Theme {
  ground: string | null;
  text: string;
  muted: string;
  scrim: string;
  rule: string;
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function themeFor(background: ExportBackground): Theme {
  if (background === 'white') {
    return {
      ground: '#ffffff',
      text: '#16171a',
      muted: '#5b5e66',
      scrim: 'rgba(255,255,255,0.8)',
      rule: '#c9cbd0',
    };
  }
  return {
    ground: background === 'black' ? cssVar('--bf-bg-canvas', '#000000') : null,
    text: cssVar('--bf-text-secondary', '#c4c6cb'),
    muted: cssVar('--bf-text-muted', '#a4a7ad'),
    scrim: 'rgba(0,0,0,0.8)',
    rule: cssVar('--bf-border-strong', '#55585e'),
  };
}

const SANS = '"IBM Plex Sans", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

/** The frame's text sizes (theme.css --bf-text-xs / --bf-text-2xs). */
const TEXT_XS = 11;
const TEXT_2XS = 10;

/** Width / height of the colorbar column at scale 1 (bar + ticks + caption). */
export const SIDEBAR_W = 120;
const BAR_W = 10;
const MAX_BAR_H = 160;

function font(px: number, family: string, weight = 400, italic = false): string {
  return `${italic ? 'italic ' : ''}${weight} ${px}px ${family}`;
}

/** Colormap gradient stops for a canvas gradient (the Inspector strip's colours). */
function colormapStops(name: string): string[] {
  const option = colormaps.find((c) => c.name === name);
  return option?.gradient.match(/#[0-9a-f]{3,8}/gi) ?? ['#000000', '#ffffff'];
}

// ── pane ───────────────────────────────────────────────────────────────────

function drawPane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pane: ExportPane,
  options: CompositeOptions,
  settings: ActiveCrosshairSettings,
  theme: Theme,
): void {
  const s = options.scale;
  ctx.drawImage(pane.image, x, y, pane.width, pane.height);

  if (options.crosshair && pane.crosshairWorld) {
    const point = projectToImage(pane.crosshairWorld, pane.plane);
    if (point) {
      // The on-screen stroke, scaled (style at the frame's CSS size).
      const base = adaptCrosshairStyleToViewport(
        buildActiveCrosshairStyle(settings),
        pane.width / s,
        pane.height / s,
      );
      const style = {
        ...base,
        lineWidth: base.lineWidth * s,
        lineDash: base.lineDash?.map((d) => d * s),
        centerGap: base.centerGap ? base.centerGap * s : base.centerGap,
      };
      drawCrosshair({
        ctx,
        canvasX: x + point[0],
        canvasY: y + point[1],
        bounds: { x, y, width: pane.width, height: pane.height },
        style,
      });
    }
  }

  if (options.orientation && pane.orientation !== false) {
    const labels = anatomicalLabels(pane.plane);
    if (labels) {
      ctx.save();
      ctx.font = font(TEXT_XS * s, SANS, 600);
      ctx.fillStyle = theme.text;
      ctx.shadowColor = options.background === 'white' ? 'transparent' : 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 2 * s;
      const off = 6 * s;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(labels.top, x + pane.width / 2, y + off);
      ctx.textBaseline = 'bottom';
      // A montage tile keeps its position label bottom-left: the bottom
      // letter sits above that row so the two never touch.
      const labelRow = pane.tileLabel ? TEXT_2XS * s * 1.5 + 4 * s : 0;
      ctx.fillText(labels.bottom, x + pane.width / 2, y + pane.height - off - labelRow);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(labels.left, x + off, y + pane.height / 2);
      ctx.textAlign = 'right';
      ctx.fillText(labels.right, x + pane.width - off, y + pane.height / 2);
      ctx.restore();
    }
  }

  if (options.header) {
    drawHeader(ctx, x, y, pane, s, theme);
  }

  if (options.scaleBar && pane.scaleBar !== false) {
    drawScaleBar(ctx, x, y, pane, s, theme);
  }

  if (pane.tileLabel) {
    ctx.save();
    ctx.font = font(TEXT_2XS * s, MONO);
    const text = pane.tileLabel.text;
    const w = ctx.measureText(text).width + 8 * s;
    const h = TEXT_2XS * s * 1.5;
    ctx.fillStyle = theme.scrim;
    ctx.fillRect(x + 4 * s, y + pane.height - 4 * s - h, w, h);
    // The crosshair's tile: the crosshair colour on a dark ground (as on
    // screen); on white that colour may not read, so weight carries it.
    const onWhite = options.background === 'white';
    if (pane.tileLabel.emphasis && onWhite) ctx.font = font(TEXT_2XS * s, MONO, 600);
    ctx.fillStyle = pane.tileLabel.emphasis && !onWhite ? settings.activeColor : theme.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 8 * s, y + pane.height - 4 * s - h / 2);
    ctx.restore();
  }
}

/** 10 mm bar, bottom-right of the pane, its length from the pane's own mm/px. */
function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pane: ExportPane,
  s: number,
  theme: Theme,
): void {
  const length = scaleBarPx(pane.plane);
  if (!(length > 4) || length > pane.width * 0.6) return;
  const right = x + pane.width - 10 * s;
  const base = y + pane.height - 10 * s;
  ctx.save();
  ctx.fillStyle = theme.text;
  ctx.shadowColor = theme.ground === '#ffffff' ? 'transparent' : 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 2 * s;
  ctx.fillRect(right - length, base - 2 * s, length, 2 * s);
  ctx.font = font(TEXT_2XS * s, MONO);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${SCALE_BAR_MM} mm`, right - length / 2, base - 4 * s);
  ctx.restore();
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pane: ExportPane,
  s: number,
  theme: Theme,
): void {
  // "Axial  z 50.5 mm  zmap_synthetic" (frame header: plane, mono position, muted name).
  const parts: Array<{ text: string; font: string; color: string }> = [
    { text: PLANE_NAME[pane.framePlane], font: font(TEXT_XS * s, SANS), color: theme.text },
    {
      // Figure style: "z = 50.5 mm".
      text: formatSlicePosition(pane.framePlane, pane.positionMm).replace(/^([xyz]) /, '$1 = '),
      font: font(TEXT_XS * s, MONO),
      color: theme.text,
    },
  ];
  if (pane.layerName) {
    const name =
      middleTruncate(shortLayerLabel(pane.layerName), 40, 7) ?? shortLayerLabel(pane.layerName);
    parts.push({ text: name, font: font(TEXT_XS * s, SANS), color: theme.muted });
  }
  ctx.save();
  const gap = 8 * s;
  const widths = parts.map((p) => {
    ctx.font = p.font;
    return ctx.measureText(p.text).width;
  });
  const total = widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1) + 8 * s;
  const h = TEXT_XS * s * 1.6;
  const left = x + 6 * s;
  const top = y + 4 * s;
  ctx.fillStyle = theme.scrim;
  ctx.fillRect(left, top, Math.min(total, pane.width - 12 * s), h);
  ctx.beginPath();
  ctx.rect(left, top, pane.width - 12 * s, h);
  ctx.clip();
  let cx = left + 4 * s;
  ctx.textBaseline = 'middle';
  parts.forEach((p, i) => {
    ctx.font = p.font;
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, cx, top + h / 2);
    cx += widths[i] + gap;
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

// ── side bar: colorbar or legend ───────────────────────────────────────────

function drawCaptionSymbol(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  px: number,
): number {
  let cx = x;
  for (const part of splitStatisticSymbol(label)) {
    ctx.font = font(px, SANS, 400, part.italic);
    ctx.fillText(part.text, cx, y);
    cx += ctx.measureText(part.text).width;
  }
  return cx - x;
}

function drawColorbar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  side: ExportSideBar,
  s: number,
  theme: Theme,
): void {
  const layer = side.colorbar!;
  const barH = Math.min(MAX_BAR_H * s, height - 80 * s);
  const top = y + (height - barH) / 2;
  const barX = x + 34 * s; // room for the caret value at the left
  const [wMin, wMax] = layer.intensity;

  ctx.save();
  // Caption: "z · zmap_synthetic", left-aligned to the bar.
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.text;
  let cx = barX;
  const captionY = top - 10 * s;
  if (layer.units) cx += drawCaptionSymbol(ctx, layer.units, cx, captionY, TEXT_2XS * s);
  if (layer.units && layer.unitsFromName) {
    ctx.font = font(TEXT_2XS * s, SANS);
    ctx.fillStyle = theme.muted;
    ctx.fillText(' (from name)', cx, captionY);
    cx += ctx.measureText(' (from name)').width;
    ctx.fillStyle = theme.text;
  }
  if (layer.nameLabel) {
    ctx.font = font(TEXT_2XS * s, SANS);
    ctx.fillStyle = theme.muted;
    const room = x + SIDEBAR_W * s - cx;
    const prefix = layer.units ? ' · ' : '';
    let name = layer.nameLabel;
    while (name.length > 4 && ctx.measureText(prefix + name).width > room) {
      name = middleTruncate(layer.nameLabel, name.length - 1, 4) ?? name.slice(0, -1);
    }
    ctx.fillText(prefix + name, cx, captionY);
  }

  // Bar: the colormap gradient, min at the bottom.
  const gradient = ctx.createLinearGradient(0, top + barH, 0, top);
  const stops = colormapStops(layer.colormap);
  stops.forEach((c, i) =>
    gradient.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c),
  );
  ctx.fillStyle = gradient;
  ctx.fillRect(barX, top, BAR_W * s, barH);

  // Hidden threshold band: canvas ground with a faint hatch (the frame's cut-out).
  const band = hiddenBand(layer.intensity, layer.threshold);
  if (band) {
    const y0 = top + (1 - band[1]) * barH;
    const y1 = top + (1 - band[0]) * barH;
    ctx.fillStyle = theme.ground ?? '#000000';
    ctx.fillRect(barX, y0, BAR_W * s, y1 - y0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(barX, y0, BAR_W * s, y1 - y0);
    ctx.clip();
    ctx.strokeStyle = theme.rule;
    ctx.lineWidth = 1 * s;
    for (let k = -BAR_W * s; k < y1 - y0 + BAR_W * s; k += 4 * s) {
      ctx.beginPath();
      ctx.moveTo(barX, y0 + k + BAR_W * s);
      ctx.lineTo(barX + BAR_W * s, y0 + k);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.strokeStyle = theme.rule;
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(barX, top, BAR_W * s, barH);

  // Ticks and labels (the frame's own tick selection and wording).
  const ticks = colorbarTicks(layer.intensity, layer.threshold, barH / s, 12, layer.dataRange);
  ctx.font = font(TEXT_2XS * s, MONO);
  ctx.fillStyle = theme.text;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const t of ticks) {
    const ty = top + (1 - t.fraction) * barH;
    ctx.fillRect(barX + BAR_W * s, ty - 0.5 * s, 4 * s, 1 * s);
    ctx.fillText(t.label, barX + BAR_W * s + 7 * s, ty);
  }

  // Crosshair value as a caret, clamped to the bar.
  if (
    side.value !== null &&
    side.value !== undefined &&
    Number.isFinite(side.value) &&
    wMax > wMin
  ) {
    const f = Math.max(0, Math.min(1, (side.value - wMin) / (wMax - wMin)));
    const cy = top + (1 - f) * barH;
    ctx.beginPath();
    ctx.moveTo(barX - 1 * s, cy);
    ctx.lineTo(barX - 6 * s, cy - 4 * s);
    ctx.lineTo(barX - 6 * s, cy + 4 * s);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'right';
    ctx.fillText(formatLayerValue(side.value), barX - 8 * s, cy);
  }

  // Threshold wording under the bar ("|z| ≤ 3.1 hidden").
  const expr = thresholdExpressionParts(layer.threshold, statisticVariable(layer.units));
  if (expr) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = font(TEXT_2XS * s, MONO);
    ctx.fillStyle = theme.muted;
    // Two lines like the frame: the expression, then "hidden".
    ctx.fillText(expr.join(' '), barX, top + barH + 8 * s);
    ctx.fillText('hidden', barX, top + barH + 8 * s + TEXT_2XS * s * 1.4);
  }
  ctx.restore();
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  legend: AtlasPaletteLegendEntry[],
  s: number,
  theme: Theme,
): void {
  const line = TEXT_2XS * s * 1.6;
  const rows = legend.slice(0, Math.max(1, Math.floor((height - 16 * s) / line)));
  let ty = y + (height - rows.length * line) / 2;
  ctx.save();
  ctx.font = font(TEXT_2XS * s, SANS);
  ctx.textBaseline = 'middle';
  for (const entry of rows) {
    ctx.fillStyle = `rgb(${entry.color[0]}, ${entry.color[1]}, ${entry.color[2]})`;
    ctx.fillRect(x + 8 * s, ty + line / 2 - 3 * s, 6 * s, 6 * s);
    ctx.fillStyle = theme.text;
    const name = formatRegionLabel(entry);
    ctx.fillText(name, x + 20 * s, ty + line / 2, SIDEBAR_W * s - 24 * s);
    ty += line;
  }
  ctx.restore();
}

// ── composition ────────────────────────────────────────────────────────────

/** Where each pane goes: rows of panes, each row centred. */
export type PaneLayout = ExportPane[][];

export interface Composition {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
}

/** Gap between panes (device px at scale 1): the frame's 1 px hairline. */
const PANE_GAP = 1;

export function compose(
  rows: PaneLayout,
  side: ExportSideBar,
  options: CompositeOptions,
  settings: ActiveCrosshairSettings,
): Composition {
  const s = options.scale;
  const theme = themeFor(options.background);
  const gap = PANE_GAP * s;
  const rowWidths = rows.map(
    (r) => r.reduce((w, p) => w + p.width, 0) + gap * Math.max(0, r.length - 1),
  );
  const rowHeights = rows.map((r) => Math.max(0, ...r.map((p) => p.height)));
  const gridW = Math.max(0, ...rowWidths);
  const gridH = rowHeights.reduce((a, b) => a + b, 0) + gap * Math.max(0, rows.length - 1);
  const hasSide =
    options.colorbar && (!!side.colorbar || (!!side.legend && side.legend.length > 0));
  const sideW = hasSide ? SIDEBAR_W * s : 0;
  const width = Math.max(1, Math.round(gridW + sideW));
  const height = Math.max(1, Math.round(gridH));

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Export: no 2D canvas context');
  if (theme.ground) {
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, width, height);
  }

  let y = 0;
  rows.forEach((row, r) => {
    let x = (gridW - rowWidths[r]) / 2;
    for (const pane of row) {
      drawPane(ctx, x, y + (rowHeights[r] - pane.height) / 2, pane, options, settings, theme);
      x += pane.width + gap;
    }
    y += rowHeights[r] + gap;
  });

  if (hasSide) {
    const legend = side.legend && side.legend.length > 0 ? side.legend : null;
    if (side.colorbar && legend) {
      // A statistic over a label map: the colorbar above, the regions below.
      const split = Math.round(height * 0.6);
      drawColorbar(ctx, gridW, 0, split, side, s, theme);
      drawLegend(ctx, gridW, split, height - split, legend, s, theme);
    } else if (side.colorbar) drawColorbar(ctx, gridW, 0, height, side, s, theme);
    else if (legend) drawLegend(ctx, gridW, 0, height, legend, s, theme);
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
    const merged = new Uint8Array(out.length + segment.length);
    merged.set(out.subarray(0, 2), 0);
    merged.set(segment, 2);
    merged.set(out.subarray(2), 2 + segment.length);
    out = merged;
  }
  return out;
}

/** "1050 × 840 px · 89 × 71 mm at 300 dpi" for the dialog. */
export function outputSizeText(width: number, height: number, dpi = 300): string {
  const mm = (px: number) => Math.round((px / dpi) * 25.4);
  return `${width} × ${height} px · ${mm(width)} × ${mm(height)} mm at ${dpi} dpi`;
}
