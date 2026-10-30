/**
 * The Regions legend of an export lists only the labels drawn in its slices
 * (QA 2026-10-29 §13: every ASEG region was listed for axial slices at
 * z = 48, where no ASEG label is present).
 *
 * The label layer is rendered alone over each exported pane (filled, at full
 * opacity, as raw RGBA so no colour conversion touches the pixels) and a
 * legend entry is kept when its colour appears (±1 per channel). Each region is drawn with its
 * exact LUT colour, so a colour match means the region is in the slice;
 * regions that share a colour are kept together. A region hidden in the LUT
 * draws nothing, so it leaves the legend too.
 */
import type { ViewPlane, ViewType } from '@/types/coordinates';
import type { ViewState } from '@/types/viewState';
import type { AtlasPaletteLegendEntry } from '@/types/atlasPalette';
import { getViewExportService } from '@/services/ViewExportService';

/** Longest side of a probe render: finer than 0.5 mm over a 256 mm field. */
export const LEGEND_PROBE_MAX_PX = 512;

/**
 * A mosaic tile's: finer than 1 mm over a 256 mm field, so every 1 mm voxel
 * the plane cuts holds a pixel centre, at a quarter of the renders' cost.
 */
export const LEGEND_PROBE_TILE_MAX_PX = 256;

/** One exported pane: the view it renders and its plane at export scale. */
export interface LegendProbePane {
  viewType: ViewType;
  plane: ViewPlane;
}

/** Renders a view state as raw RGBA (render_view `rgba`: 8-byte size header). */
export type ProbeRender = (
  state: ViewState,
  viewType: ViewType,
  width: number,
  height: number,
) => Promise<Uint8Array>;

const defaultRender: ProbeRender = (state, viewType, width, height) =>
  getViewExportService().renderViewToBytes(state, viewType, width, height, 'rgba', true);

/** The view state that draws only `labelLayerId`, filled and opaque. */
export function labelProbeViewState(viewState: ViewState, labelLayerId: string): ViewState {
  return {
    ...viewState,
    crosshair: { ...viewState.crosshair, visible: false },
    layers: viewState.layers.map((layer) =>
      layer.id === labelLayerId
        ? {
            ...layer,
            visible: true,
            opacity: 1,
            labelDisplay: 'fill' as const,
            outline: layer.outline ? { ...layer.outline, enabled: false } : undefined,
            alphaMod: undefined,
          }
        : { ...layer, visible: false, opacity: 0 },
    ),
  };
}

/** `plane` with the same field of view, at most `maxPx` pixels on its longest side. */
export function probePlane(plane: ViewPlane, maxPx = LEGEND_PROBE_MAX_PX): ViewPlane {
  const [w, h] = plane.dim_px;
  const scale = Math.max(w, h) / maxPx;
  if (!(scale > 1)) return plane;
  const dim: [number, number] = [
    Math.max(1, Math.round(w / scale)),
    Math.max(1, Math.round(h / scale)),
  ];
  // Keep the field of view: the pixel steps grow by the per-axis ratio.
  const su = w / dim[0];
  const sv = h / dim[1];
  return {
    ...plane,
    u_mm: plane.u_mm.map((x) => x * su) as ViewPlane['u_mm'],
    v_mm: plane.v_mm.map((x) => x * sv) as ViewPlane['v_mm'],
    dim_px: dim,
  };
}

/** The RGBA pixels of a raw render_view frame, or null when it is malformed. */
export function rawFramePixels(bytes: Uint8Array): Uint8Array | null {
  if (bytes.byteLength < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  if (bytes.byteLength !== 8 + width * height * 4) return null;
  return bytes.subarray(8);
}

const rgbKey = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

/** Per-channel slack of a colour match (8-bit rounding of the LUT). */
export const LEGEND_COLOR_TOLERANCE = 1;

/**
 * The legend entries whose colour (±{@link LEGEND_COLOR_TOLERANCE} per
 * channel) is drawn fully opaque in any raster; partly transparent pixels
 * are edges or halos, not a region's colour. Null when regions were drawn
 * but none matched a legend colour: the colours are not the legend's (a LUT
 * the probe cannot read back), so nothing can be said about presence.
 */
export function presentLegendEntries(
  legend: readonly AtlasPaletteLegendEntry[],
  rasters: readonly Uint8Array[],
): AtlasPaletteLegendEntry[] | null {
  const drawn = new Set<number>();
  for (const pixels of rasters) {
    for (let i = 0; i + 3 < pixels.length; i += 4) {
      if (pixels[i + 3] === 255) drawn.add(rgbKey(pixels[i], pixels[i + 1], pixels[i + 2]));
    }
  }
  const t = LEGEND_COLOR_TOLERANCE;
  const isDrawn = ([r, g, b]: number[]) => {
    for (let dr = -t; dr <= t; dr += 1) {
      for (let dg = -t; dg <= t; dg += 1) {
        for (let db = -t; db <= t; db += 1) {
          const [cr, cg, cb] = [r + dr, g + dg, b + db];
          if (cr < 0 || cg < 0 || cb < 0 || cr > 255 || cg > 255 || cb > 255) continue;
          if (drawn.has(rgbKey(cr, cg, cb))) return true;
        }
      }
    }
    return false;
  };
  const present = legend.filter((entry) => isDrawn(entry.color.map((c) => Math.round(c))));
  return present.length === 0 && drawn.size > 0 ? null : present;
}

/**
 * The entries of `legend` drawn by `labelLayerId` in the exported panes, or
 * null when a probe fails or its colours match no entry (the caller keeps
 * the full legend).
 */
export async function legendInPanes(
  viewState: ViewState,
  labelLayerId: string,
  legend: readonly AtlasPaletteLegendEntry[],
  panes: readonly LegendProbePane[],
  options: { render?: ProbeRender; signal?: AbortSignal } = {},
): Promise<AtlasPaletteLegendEntry[] | null> {
  const render = options.render ?? defaultRender;
  if (legend.length === 0 || panes.length === 0) return [...legend];
  const probe = labelProbeViewState(viewState, labelLayerId);
  const rasters: Uint8Array[] = [];
  try {
    // One at a time: the backend serialises renders (compositeCapture).
    for (const pane of panes) {
      if (options.signal?.aborted) throw new DOMException('Export capture superseded', 'AbortError');
      const plane = probePlane(pane.plane);
      const state: ViewState = { ...probe, views: { ...probe.views, [pane.viewType]: plane } };
      const pixels = rawFramePixels(
        await render(state, pane.viewType, plane.dim_px[0], plane.dim_px[1]),
      );
      if (!pixels) return null;
      rasters.push(pixels);
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn(
      '[export] Could not find the regions in the exported slices; the legend lists them all:',
      error,
    );
    return null;
  }
  return presentLegendEntries(legend, rasters);
}
