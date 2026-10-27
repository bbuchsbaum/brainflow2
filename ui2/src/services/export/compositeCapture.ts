/**
 * Composited capture (UI redesign phase 3, item 8): what the export dialog
 * previews and saves. Renders the slice(s) with render_view at the chosen
 * scale and composes the frame on top (services/export/compositeExport.ts).
 *
 * Targets:
 * - a slice view (axial / sagittal / coronal): one pane;
 * - "orthogonal": the three panes stitched like the default grid (axial
 *   above, sagittal | coronal below);
 * - "mosaic": the visible tiles in grid order with their position labels,
 *   from the mosaic view's registered source.
 * Each composition gets one colorbar (or a Regions legend for a label map).
 */
import type { ViewState } from '@/types/viewState';
import type { ViewPlane, ViewType } from '@/types/coordinates';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { activeVolumeLayerId } from '@/utils/activeLayer';
import { sampleLayerValue } from '@/hooks/useLayerValueAtWorld';
import {
  chooseColorbarLayerId,
  resolveColorbarLayer,
} from '@/components/views/viewportFrame/useOverlayColorbar';
import { PLANE_AXIS_INDEX } from '@/components/views/viewportFrame/frameFormat';
import { formatWorldMm } from '@/utils/valueFormat';
import { isInferredStatistic, statisticUnits } from '@/utils/statistic';
import {
  getViewExportService,
  type CaptureTarget,
  type ExportFormat,
} from '@/services/ViewExportService';
import { layoutFileName, mosaicFileName, sliceFileName } from '@/utils/exportFileName';
import { matteOntoPage } from '@/utils/exportMatte';
import {
  chromeUnit,
  compose,
  compositionSize,
  encodeComposition,
  headerBandPx,
  printWidthPx,
  SIDEBAR_W,
  sideGapPx,
  type CompositeOptions,
  type ExportPane,
  type ExportSideBar,
  type FrameIncludes,
  type PaneLayout,
  type SizeSpec,
} from './compositeExport';
import { brainFraming, getNonzeroBbox } from '@/services/mosaic/brainBounds';
import { getApiService } from '@/services/apiService';

export type ExportTarget =
  | 'axial'
  | 'sagittal'
  | 'coronal'
  | 'orthogonal'
  | 'orthogonal-row'
  | 'mosaic';

const SLICE_TARGETS: ViewType[] = ['axial', 'sagittal', 'coronal'];

export const EXPORT_TARGET_LABEL: Record<ExportTarget, string> = {
  axial: 'Axial',
  sagittal: 'Sagittal',
  coronal: 'Coronal',
  orthogonal: 'Orthogonal layout',
  'orthogonal-row': 'Figure row (axial | coronal | sagittal)',
  mosaic: 'Mosaic',
};

/** Which mosaic slices to export: the page on screen, or a range. */
export type MosaicTileSpec =
  | { kind: 'page' }
  | { kind: 'range'; fromMm: number; toMm: number; every: number };

/** At most this many tiles in one exported montage. */
export const MAX_EXPORT_TILES = 100;

/** The visible tiles of a mosaic, in grid order (registered by the mosaic view). */
export interface MosaicExportSource {
  workspaceId: string;
  axis: ViewType;
  cols: number;
  /**
   * The cropped slice sampling, for a range export: slice i of the
   * reference sits at `min + i·step`; [first, last] is the brain's range.
   */
  sampling?: { min: number; step: number; first: number; last: number } | null;
  tiles: Array<{
    /** The tile's view plane as rendered on screen (cell size). */
    plane: ViewPlane | undefined;
    positionMm: number;
    label: string;
    atCrosshair: boolean;
  }>;
}

const mosaicSources = new Map<string, () => MosaicExportSource | null>();

/** The mosaic view registers how to read its visible tiles; returns the unregister. */
export function registerMosaicExportSource(
  workspaceId: string,
  read: () => MosaicExportSource | null,
): () => void {
  mosaicSources.set(workspaceId, read);
  return () => {
    if (mosaicSources.get(workspaceId) === read) mosaicSources.delete(workspaceId);
  };
}

function activeMosaicSource(): MosaicExportSource | null {
  const active = useActiveRenderContextStore.getState().activeId;
  if (typeof active === 'string' && active.toLowerCase().startsWith('mosaic:')) {
    const id = active.slice('mosaic:'.length);
    for (const [ws, read] of mosaicSources) {
      if (ws.toLowerCase() === id.toLowerCase()) return read();
    }
  }
  const workspaceId = useWorkspaceStore.getState().getActiveWorkspace?.()?.id;
  const read = workspaceId ? mosaicSources.get(workspaceId) : undefined;
  return read ? read() : null;
}

/** Targets the current workspace can export. */
export function availableExportTargets(): ExportTarget[] {
  if (activeMosaicSource()) return ['mosaic'];
  // Compare panels render their own states, and a surface is not a slice:
  // those keep the plain capture of the active view.
  const workspaceType = useWorkspaceStore.getState().getActiveWorkspace?.()?.type;
  if (workspaceType === 'comparison' || workspaceType === 'set-studio') return [];
  const active = useActiveRenderContextStore.getState().activeId;
  if (typeof active === 'string' && active.toLowerCase().startsWith('surface')) return [];
  const views = useViewStateStore.getState().viewState;
  const hasVolume = views.layers.some((l) => l.visible && l.volumeId);
  return hasVolume ? [...SLICE_TARGETS, 'orthogonal', 'orthogonal-row'] : [];
}

/** Default target: the view last interacted with, else axial. */
export function defaultExportTarget(): ExportTarget | null {
  const available = availableExportTargets();
  if (available.length === 0) return null;
  if (available.includes('mosaic')) return 'mosaic';
  const active = useActiveRenderContextStore.getState().activeId;
  const id = typeof active === 'string' ? active.toLowerCase() : '';
  return (SLICE_TARGETS as string[]).includes(id) ? (id as ExportTarget) : 'axial';
}

async function decode(bytes: Uint8Array): Promise<CanvasImageSource> {
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

/**
 * A pane for a white or transparent page: outside the head becomes the page
 * (utils/exportMatte.ts explains the matte and why it is built from the
 * render's look on black rather than from the backend alpha alone). A black
 * page keeps the render as is, on black.
 */
async function decodeForPage(
  bytes: Uint8Array,
  width: number,
  height: number,
  background: FrameIncludes['background'],
): Promise<CanvasImageSource> {
  const bitmap = await decode(bytes);
  if (background === 'black') return bitmap;
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!ctx || typeof ctx.getImageData !== 'function') return bitmap;
  ctx.drawImage(bitmap, 0, 0, width, height);
  // Our own decode (above), drawn and no longer needed: safe to close.
  (bitmap as Partial<ImageBitmap>).close?.();
  const pixels = ctx.getImageData(0, 0, width, height);
  pixels.data.set(
    matteOntoPage(pixels.data, width, height, { page: background === 'white' ? [255, 255, 255] : null }),
  );
  ctx.putImageData(pixels, 0, 0);
  const matted = await createImageBitmap(canvas);
  // Release the scratch backing store at once (600 dpi panes are large).
  canvas.width = 0;
  canvas.height = 0;
  return matted;
}

function layerNameOf(viewState: ViewState): string | null {
  const id = activeVolumeLayerId(viewState.layers);
  if (!id) return null;
  return useLayerStore.getState().layers.find((l) => l.id === id)?.name ?? null;
}

/** Slice positions (mm) of a range export, on the reference grid, capped. */
export function mosaicRangePositions(
  sampling: NonNullable<MosaicExportSource['sampling']>,
  spec: Extract<MosaicTileSpec, { kind: 'range' }>,
): number[] {
  const index = (mm: number) => Math.round((mm - sampling.min) / sampling.step);
  const lo = Math.max(sampling.first, Math.min(index(spec.fromMm), index(spec.toMm)));
  const hi = Math.min(sampling.last, Math.max(index(spec.fromMm), index(spec.toMm)));
  const every = Math.max(1, Math.round(spec.every));
  const out: number[] = [];
  for (let i = lo; i <= hi && out.length < MAX_EXPORT_TILES; i += every) {
    out.push(sampling.min + i * sampling.step);
  }
  return out;
}

/** A range spec clamped to the reference grid's brain slices (the dialog shows these values). */
export function clampMosaicRange(
  sampling: NonNullable<MosaicExportSource['sampling']>,
  spec: Extract<MosaicTileSpec, { kind: 'range' }>,
): Extract<MosaicTileSpec, { kind: 'range' }> {
  const lo = sampling.min + sampling.first * sampling.step;
  const hi = sampling.min + sampling.last * sampling.step;
  const snap = (mm: number) =>
    sampling.min + Math.round((Math.min(hi, Math.max(lo, mm)) - sampling.min) / sampling.step) * sampling.step;
  const fromMm = snap(spec.fromMm);
  const every = Math.max(1, Math.round(spec.every));
  // "To" is the last slice actually taken (from + k × every slices), so
  // the field never names a slice the figure leaves out.
  const stride = sampling.step * every;
  const span = snap(spec.toMm) - fromMm;
  const toMm = stride > 0 ? fromMm + Math.round(Math.floor(span / stride + 1e-9) * stride * 1e6) / 1e6 : fromMm;
  return { kind: 'range', fromMm, toMm, every };
}

/**
 * The dialog's default range: the whole cropped brain (the mosaic's own
 * slices), every n-th slice so the figure stays near 24 tiles.
 */
export function defaultMosaicRange(
  sampling: NonNullable<MosaicExportSource['sampling']>,
): Extract<MosaicTileSpec, { kind: 'range' }> {
  const count = sampling.last - sampling.first + 1;
  return clampMosaicRange(sampling, {
    kind: 'range',
    fromMm: sampling.min + sampling.first * sampling.step,
    toMm: sampling.min + sampling.last * sampling.step,
    every: Math.max(1, Math.ceil(count / 24)),
  });
}

/** Export source of the active mosaic (null when none is shown). */
export function currentMosaicExportSource(): MosaicExportSource | null {
  return activeMosaicSource();
}

// ── pane geometry: crop and one mm per pixel ──────────────────────────────

type Vec3 = [number, number, number];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);

/** In-plane rectangle (mm along the plane's unit u / v, from its origin). */
export interface PlaneRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Brain margin around a crop, as a fraction of its extent (each side). */
export const CROP_MARGIN = 0.06;

/**
 * The rectangle a pane shows: its full field of view, or (crop) the brain's
 * box projected onto the plane plus a 6% margin each side.
 */
export function paneRect(
  plane: Pick<ViewPlane, 'origin_mm' | 'u_mm' | 'v_mm' | 'dim_px'>,
  bbox: { worldMinMm: readonly number[]; worldMaxMm: readonly number[] } | null,
): PlaneRect {
  const uLen = norm(plane.u_mm);
  const vLen = norm(plane.v_mm);
  const full = { u0: 0, u1: uLen * plane.dim_px[0], v0: 0, v1: vLen * plane.dim_px[1] };
  if (!bbox || !(uLen > 0) || !(vLen > 0)) return full;
  const uHat = plane.u_mm.map((x) => x / uLen);
  const vHat = plane.v_mm.map((x) => x / vLen);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let k = 0; k < 8; k += 1) {
    const corner = [0, 1, 2].map((a) => ((k >> a) & 1 ? bbox.worldMaxMm[a] : bbox.worldMinMm[a]));
    const d = corner.map((c, a) => c - plane.origin_mm[a]);
    u0 = Math.min(u0, dot(d, uHat));
    u1 = Math.max(u1, dot(d, uHat));
    v0 = Math.min(v0, dot(d, vHat));
    v1 = Math.max(v1, dot(d, vHat));
  }
  const mu = (u1 - u0) * CROP_MARGIN;
  const mv = (v1 - v0) * CROP_MARGIN;
  return { u0: u0 - mu, u1: u1 + mu, v0: v0 - mv, v1: v1 + mv };
}

/** The plane that renders `rect` at `mmPerPx` (square pixels). */
export function rectPlane(plane: ViewPlane, rect: PlaneRect, mmPerPx: number): ViewPlane {
  const uLen = norm(plane.u_mm);
  const vLen = norm(plane.v_mm);
  const uHat = plane.u_mm.map((x) => x / uLen) as Vec3;
  const vHat = plane.v_mm.map((x) => x / vLen) as Vec3;
  const origin = [0, 1, 2].map(
    (a) => plane.origin_mm[a] + rect.u0 * uHat[a] + rect.v0 * vHat[a],
  ) as Vec3;
  return {
    ...plane,
    origin_mm: origin,
    u_mm: uHat.map((x) => x * mmPerPx) as Vec3,
    v_mm: vHat.map((x) => x * mmPerPx) as Vec3,
    dim_px: [
      Math.max(1, Math.round((rect.u1 - rect.u0) / mmPerPx)),
      Math.max(1, Math.round((rect.v1 - rect.v0) / mmPerPx)),
    ],
  };
}

/** One spec per pane, before sizing. */
interface PaneSpec {
  viewType: ViewType;
  plane: ViewPlane;
  extra?: Partial<ExportPane>;
}

/**
 * ONE mm per pixel for every pane of a composition (v3 fidelity: mixed
 * scales across panes), so scale bars are identical. Screen sizes keep the
 * finest on-screen resolution times the multiple; print sizes fit the
 * widest row of rects (plus gaps and the colorbar column) to the width.
 */
export function solveMmPerPx(
  rows: Array<Array<{ plane: Pick<ViewPlane, 'u_mm'>; rect: PlaneRect }>>,
  size: SizeSpec,
  chrome: { unit: number; paneGap: number; sideW: number },
): number {
  if (size.kind === 'screen') {
    const finest = Math.min(...rows.flat().map((p) => norm(p.plane.u_mm)));
    return finest / Math.max(1e-6, size.scale);
  }
  const target = printWidthPx(size)!;
  // The widest row decides (others are narrower at the same mm/px).
  let best = 0;
  for (const row of rows) {
    const mm = row.reduce((sum, p) => sum + (p.rect.u1 - p.rect.u0), 0);
    const px = target - chrome.sideW - chrome.paneGap * chrome.unit * Math.max(0, row.length - 1);
    best = Math.max(best, mm / Math.max(1, px));
  }
  return best;
}

async function renderPane(
  viewState: ViewState,
  spec: PaneSpec,
  rect: PlaneRect,
  mmPerPx: number,
  background: FrameIncludes['background'],
  layerName: string | null,
): Promise<ExportPane> {
  const plane = rectPlane(spec.plane, rect, mmPerPx);
  const [width, height] = plane.dim_px;
  const state: ViewState = { ...viewState, views: { ...viewState.views, [spec.viewType]: plane } };
  // Ask for a transparent clear off a black page; the matte also handles a
  // pass that clears to opaque black (decodeForPage).
  const bytes = await getViewExportService().renderViewToBytes(
    state,
    spec.viewType,
    width,
    height,
    'png',
    background !== 'black',
  );
  const crosshair = viewState.crosshair.world_mm;
  return {
    image: await decodeForPage(bytes, width, height, background),
    width,
    height,
    plane,
    framePlane: spec.viewType,
    positionMm: crosshair[PLANE_AXIS_INDEX[spec.viewType]],
    layerName,
    crosshairWorld: viewState.crosshair.visible ? [crosshair[0], crosshair[1], crosshair[2]] : null,
    ...spec.extra,
  };
}

async function sideBar(viewState: ViewState, withValue: boolean): Promise<ExportSideBar> {
  const { layers, layerMetadata } = useLayerStore.getState();
  const activeId = activeVolumeLayerId(viewState.layers);
  const colorbarId = chooseColorbarLayerId(layers, viewState.layers, activeId);
  const viewLayer = colorbarId ? viewState.layers.find((l) => l.id === colorbarId) : undefined;
  const show = colorbarId
    ? useDisplayOptionsStore.getState().options.get(colorbarId)?.showColorbar !== false
    : false;
  const colorbar = colorbarId
    ? resolveColorbarLayer(layers, colorbarId, viewLayer, show, layerMetadata.get(colorbarId))
    : null;
  let value: number | null = null;
  if (colorbar && withValue) {
    const c = viewState.crosshair.world_mm;
    // At the layer's current timepoint (the backend samples it): a default
    // of 0 would cache another timepoint's value under t = 0 (review D4).
    const timepoint = layers.find((l) => l.id === colorbar.layerId)?.currentTimepoint ?? 0;
    value = await sampleLayerValue(colorbar.layerId, [c[0], c[1], c[2]], timepoint);
  }
  // The topmost visible label map's regions (beside or below the colorbar).
  const labelLayer = [...viewState.layers]
    .reverse()
    .map((l) => (l.visible && l.opacity > 0 ? layers.find((x) => x.id === l.id) : undefined))
    .find((info) => info?.type === 'label' && (info.atlasPaletteLegend?.length ?? 0) > 0);
  const legend = labelLayer?.atlasPaletteLegend ?? null;
  return { colorbar, value, legend };
}

/**
 * The layer a figure is about (header and file name): the one its colorbar
 * describes (the top visible statistic / overlay), else the active layer.
 */
function figureLayerName(viewState: ViewState, side: ExportSideBar): string | null {
  if (side.colorbar) return side.colorbar.name;
  const { layers } = useLayerStore.getState();
  const top = [...viewState.layers]
    .reverse()
    .find((l) => l.visible && l.opacity > 0 && l.volumeId);
  return (top && layers.find((l) => l.id === top.id)?.name) ?? layerNameOf(viewState);
}

/**
 * Volumes whose non-zero voxels "Crop to brain" frames: the union of the
 * visible volume layers (the mosaic's rule), else the reference (bottom
 * volume) layer. The union is order-free, so it is the same whether the
 * anatomy or the statistic was loaded first, and it never cuts into either:
 * the head (anatomy) and every visible statistic voxel stay in the frame.
 * Cropping to one layer picked by stack position cut into the head when that
 * layer was the overlay (native check).
 */
export function cropVolumeIds(
  layers: ReadonlyArray<{ volumeId?: string | null; visible: boolean; opacity: number }>,
): string[] {
  const visible = layers.filter((l) => l.visible && l.opacity > 0 && l.volumeId).map((l) => l.volumeId!);
  if (visible.length > 0) return [...new Set(visible)];
  const reference = layers.find((l) => l.volumeId);
  return reference?.volumeId ? [reference.volumeId] : [];
}

/**
 * Per volume, the |value| a voxel must exceed to count for the crop: a
 * statistic layer's display threshold (its hidden band), else 0. A volume
 * shown by several layers takes the smallest.
 */
export function cropThresholdsByVolume(
  layers: ReadonlyArray<{ id: string; volumeId?: string | null; threshold?: readonly [number, number] }>,
  isStatistic: (layerId: string) => boolean,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of layers) {
    if (!l.volumeId) continue;
    const t = isStatistic(l.id) && l.threshold ? Math.max(Math.abs(l.threshold[0]), Math.abs(l.threshold[1])) : 0;
    const cut = Number.isFinite(t) ? t : 0;
    out.set(l.volumeId, Math.min(out.get(l.volumeId) ?? Infinity, cut));
  }
  return out;
}

/**
 * The crop box (voxel edges, as the mosaic frames the brain): the union of
 * the volumes' non-zero boxes, each padded by half its own voxel.
 */
export async function cropBox(
  volumeIds: readonly string[],
  fetch: {
    nonzero: (id: string) => Promise<{ worldMinMm: readonly number[]; worldMaxMm: readonly number[] } | null>;
    bounds: (id: string) => Promise<{ min: number[]; max: number[]; dims?: number[] } | null>;
  },
): Promise<{ worldMinMm: number[]; worldMaxMm: number[] } | null> {
  let min: number[] | null = null;
  let max: number[] | null = null;
  for (const id of volumeIds) {
    const [box, bounds] = await Promise.all([fetch.nonzero(id), fetch.bounds(id)]);
    if (!box) continue;
    const voxel = [0, 1, 2].map((d) => {
      const n = bounds?.dims?.[d] ?? 0;
      return bounds && n > 1 ? Math.abs(bounds.max[d] - bounds.min[d]) / (n - 1) : 0;
    }) as [number, number, number];
    const edges = brainFraming(
      {
        worldMinMm: [0, 1, 2].map((a) => Math.min(box.worldMinMm[a], box.worldMaxMm[a])),
        worldMaxMm: [0, 1, 2].map((a) => Math.max(box.worldMinMm[a], box.worldMaxMm[a])),
      } as never,
      voxel,
    );
    min = min ? min.map((v, a) => Math.min(v, edges.min[a])) : edges.min;
    max = max ? max.map((v, a) => Math.max(v, edges.max[a])) : edges.max;
  }
  return min && max ? { worldMinMm: min, worldMaxMm: max } : null;
}

export interface CompositeCapture {
  bytes: Uint8Array;
  mime: string;
  suggestedName: string;
  target: CaptureTarget;
  exportTarget: ExportTarget;
  width: number;
  height: number;
  /** Resolution written into the file (print sizes), else null. */
  dpi: number | null;
  /** Something the user should know about the output (e.g. a very tall montage). */
  warning: string | null;
}

export interface CompositeRequest {
  frame: FrameIncludes;
  size: SizeSpec;
  /** Embed a provenance record (layers, files, display, crosshair) in the file. */
  provenance?: boolean;
  mosaicTiles?: MosaicTileSpec;
  /** Crop each pane to the brain (+6%), the mosaic's rule. */
  cropToBrain?: boolean;
  /** Montage columns (null: a default for the size). */
  mosaicColumns?: number | null;
  /** Abandon the capture (a newer preview superseded it): no more renders. */
  signal?: AbortSignal;
}

/** Pane renders in flight at once: the backend serialises renders on one
 * mutex, so more only queues work that blocks the live views (review R3). */
const PANE_RENDER_CONCURRENCY = 2;

/**
 * Largest composition: WebKit refuses (late, as "could not be encoded")
 * canvases past its area limit. Checked before any pane renders (review R5).
 */
export const MAX_COMPOSITION_SIDE = 16384;
export const MAX_COMPOSITION_AREA = 100_000_000;

export class ExportTooLargeError extends Error {
  constructor(width: number, height: number) {
    super(
      `The figure would be ${width} × ${height} px, over the ${MAX_COMPOSITION_AREA / 1e6} megapixel limit: ` +
        'use fewer slices (a larger step), more columns, a narrower width or 300 dpi.',
    );
    this.name = 'ExportTooLargeError';
  }
}

/** True when a composition of this size can be drawn. */
export function compositionFits(width: number, height: number): boolean {
  return width <= MAX_COMPOSITION_SIDE && height <= MAX_COMPOSITION_SIDE && width * height <= MAX_COMPOSITION_AREA;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Export capture superseded', 'AbortError');
}

/** Map `items` through `fn` with at most `limit` calls in flight, in order. */
async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Montage columns: the user's choice, else 6 at a 2-column print width, 4 at 1 column, else the screen grid's. */
export function defaultMosaicColumns(size: SizeSpec, screenCols: number): number {
  if (size.kind === 'print') return size.widthMm >= 150 ? 6 : 4;
  return Math.max(1, screenCols);
}

async function appVersion(): Promise<string | null> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return (await getVersion()) ?? null;
  } catch {
    return null;
  }
}

/** Byte budget for the provenance record (a PNG iTXt / JPEG COM payload). */
const PROVENANCE_MAX_CHARS = 60_000;

/**
 * Keep a record under the budget by STRUCTURE (v3 function critic): long
 * arrays are replaced by a marker with their length, never cut mid-JSON.
 */
export function boundedProvenance(record: unknown, maxChars = PROVENANCE_MAX_CHARS): string {
  let text = JSON.stringify(record, null, 2);
  if (text.length <= maxChars) return text;
  for (const limit of [50, 10, 0]) {
    const pruned = JSON.parse(text, (_key, value) =>
      Array.isArray(value) && value.length > limit
        ? { truncated: true, count: value.length, kept: value.slice(0, limit) }
        : value,
    );
    text = JSON.stringify(pruned, null, 2);
    if (text.length <= maxChars) return text;
  }
  return JSON.stringify({ app: 'Brainflow', truncated: true });
}

/** The provenance record embedded in an export (PNG iTXt / JPEG comment). */
async function provenanceRecord(
  viewState: ViewState,
  target: ExportTarget,
  label: string,
  request: CompositeRequest,
  composition: { width: number; height: number },
): Promise<string> {
  const { layers, layerMetadata } = useLayerStore.getState();
  return boundedProvenance({
    app: 'Brainflow',
    version: await appVersion(),
    exportedAt: new Date().toISOString(),
    view: { target, label, cropToBrain: !!request.cropToBrain },
    size: { ...request.size, widthPx: composition.width, heightPx: composition.height },
    crosshairMm: [...viewState.crosshair.world_mm],
    layers: viewState.layers.map((l) => {
      const info = layers.find((x) => x.id === l.id);
      return {
        name: info?.name ?? l.name,
        file: info?.sourcePath ?? null,
        visible: l.visible && l.opacity > 0,
        opacity: l.opacity,
        colormap: l.colormap,
        window: l.intensity,
        threshold: l.threshold,
        statistic: statisticUnits(info?.statistic, layerMetadata.get(l.id)?.dataRange) ?? null,
        statisticSource: info?.statistic
          ? isInferredStatistic(info.statistic)
            ? 'file name'
            : info.statistic.fromDescription
              ? 'description'
              : `intent ${info.statistic.intentCode}`
          : null,
      };
    }),
  });
}

/** Render and compose `target`, then encode it. */
export async function captureComposite(
  target: ExportTarget,
  format: ExportFormat,
  request: CompositeRequest,
): Promise<CompositeCapture> {
  // Captions are drawn with the app's fonts: wait for them (preview = file).
  if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready;
  const settings = useCrosshairSettingsStore.getState().settings;
  const frame = { ...request.frame, crosshair: request.frame.crosshair && settings.visible };
  const unit = chromeUnit(request.size);

  let viewState: ViewState;
  let specRows: PaneSpec[][];
  let label: string;
  let mosaic: { first: number; last: number; axis: ViewType } | null = null;
  let alignRows: CompositeOptions['alignRows'] = 'center';
  let paneGap = 4;

  if (target === 'mosaic') {
    const source = activeMosaicSource();
    if (!source || source.tiles.length === 0) throw new Error('No mosaic tiles to export');
    viewState = useViewStateStore.getState().getWorkspaceViewState(source.workspaceId);
    const d = PLANE_AXIS_INDEX[source.axis];
    const template = source.tiles.find((t) => t.plane)?.plane;
    if (!template) throw new Error('The mosaic tiles have not rendered yet');
    const crossAt = viewState.crosshair.world_mm[d];
    // This page, or a range on the reference grid (same in-plane framing).
    const spec = request.mosaicTiles ?? { kind: 'page' };
    const tiles =
      spec.kind === 'range' && source.sampling
        ? mosaicRangePositions(source.sampling, spec).map((positionMm) => {
            const origin = [...template.origin_mm] as Vec3;
            origin[d] = positionMm;
            return {
              plane: { ...template, origin_mm: origin } as ViewPlane,
              positionMm,
              label: `${'xyz'[d]} ${formatWorldMm(positionMm)}`,
              atCrosshair: Math.abs(crossAt - positionMm) < source.sampling!.step / 2,
            };
          })
        : source.tiles;
    const usable = tiles.filter((t) => t.plane);
    if (usable.length === 0) throw new Error('The slice range holds no slices');
    const cols = Math.max(
      1,
      Math.min(request.mosaicColumns ?? defaultMosaicColumns(request.size, source.cols), usable.length),
    );
    const last = usable.length - 1;
    const specs: PaneSpec[] = usable.map((tile, index) => ({
      viewType: source.axis,
      plane: tile.plane!,
      extra: {
        positionMm: tile.positionMm,
        tileLabel: { text: tile.label, emphasis: tile.atCrosshair },
        orientation: index === 0,
        scaleBar: index === last,
        crosshairWorld: tile.atCrosshair ? viewState.crosshair.world_mm : null,
      },
    }));
    specRows = [];
    for (let i = 0; i < specs.length; i += cols) specRows.push(specs.slice(i, i + cols));
    mosaic = { first: usable[0].positionMm, last: usable[last].positionMm, axis: source.axis };
    label = `Mosaic · ${EXPORT_TARGET_LABEL[source.axis as ExportTarget]} · ${usable.length} slices · ${cols} columns`;
    alignRows = 'start';
    paneGap = 6;
  } else if (target === 'orthogonal' || target === 'orthogonal-row') {
    viewState = useViewStateStore.getState().viewState;
    const v = viewState.views;
    const spec = (t: ViewType): PaneSpec => ({ viewType: t, plane: v[t] });
    specRows =
      target === 'orthogonal'
        ? [[spec('axial')], [spec('sagittal'), spec('coronal')]]
        : [[spec('axial'), spec('coronal'), spec('sagittal')]];
    label = EXPORT_TARGET_LABEL[target];
  } else {
    viewState = useViewStateStore.getState().viewState;
    specRows = [[{ viewType: target, plane: viewState.views[target] }]];
    label = EXPORT_TARGET_LABEL[target];
  }

  const side = await sideBar(viewState, frame.crosshair);
  const hasSide = frame.colorbar && (!!side.colorbar || (side.legend?.length ?? 0) > 0);
  const headerName = figureLayerName(viewState, side);

  // Crop to the brain: the visible volumes' non-zero voxels (cropVolumeIds),
  // measured from the voxel EDGES as the mosaic frames the brain (v4
  // fidelity), then one mm/px for all panes.
  // A statistic layer counts only its shown voxels (|v| above its display
  // threshold): a dense noisy map would otherwise widen the crop to the
  // whole field of view. Anatomy and labels count every non-zero voxel.
  const cropThresholds = cropThresholdsByVolume(viewState.layers, (layerId) => {
    const { layers, layerMetadata } = useLayerStore.getState();
    const info = layers.find((l) => l.id === layerId);
    return statisticUnits(info?.statistic, layerMetadata.get(layerId)?.dataRange) !== null;
  });
  const bbox = request.cropToBrain
    ? await cropBox(cropVolumeIds(viewState.layers), {
        nonzero: (id) => getNonzeroBbox(id, cropThresholds.get(id) ?? 0),
        bounds: (id) => getApiService().getVolumeBounds(id).catch(() => null),
      })
    : null;
  const rects = specRows.map((row) => row.map((p) => paneRect(p.plane, bbox)));
  const mmPerPx = solveMmPerPx(
    specRows.map((row, r) => row.map((p, c) => ({ plane: p.plane, rect: rects[r][c] }))),
    request.size,
    { unit, paneGap, sideW: hasSide ? SIDEBAR_W * unit + sideGapPx(unit, paneGap) : 0 },
  );
  // Size check before any render: too large fails now, with a reason.
  const planned = compositionSize(
    specRows.map((row, r) =>
      row.map((p, c) => {
        const [w, h] = rectPlane(p.plane, rects[r][c], mmPerPx).dim_px;
        return { width: w, height: h, tile: !!p.extra?.tileLabel };
      }),
    ),
    { unit, header: mosaic ? false : frame.header, colorbar: frame.colorbar, paneGap, targetWidth: printWidthPx(request.size) ?? undefined },
    !!hasSide,
  );
  if (!compositionFits(planned.width, planned.height)) throw new ExportTooLargeError(planned.width, planned.height);

  // Pane renders, a few at a time, abandoned as soon as a newer preview
  // supersedes this one.
  const flat = specRows.flatMap((row, r) => row.map((p, c) => ({ p, r, c })));
  const rendered = await mapBounded(flat, PANE_RENDER_CONCURRENCY, async ({ p, r, c }) => {
    throwIfAborted(request.signal);
    return renderPane(
      viewState,
      p,
      rects[r][c],
      mmPerPx,
      frame.background,
      // A multi-pane figure names the layer once: in the shared colorbar
      // caption, or (no colorbar) the first pane's header. Never per pane
      // (v5: three differently truncated names).
      flat.length > 1 && (hasSide || r + c > 0) ? null : headerName,
    );
  });
  // Safe to close (ui2/CLAUDE.md MosaicView rule 3 forbids closing bitmaps
  // an on-screen canvas may still draw): every pane image here is created by
  // this capture alone (renderPane → ViewExportService.renderViewToBytes, a
  // direct render_view call returning bytes, then decode / decodeForPage →
  // createImageBitmap). None comes from MosaicRenderService, useRenderCanvas
  // or the EventBus 'render.complete' path, and none is shared outside this
  // function.
  const closeImages = () => {
    for (const pane of rendered) (pane.image as Partial<ImageBitmap>).close?.();
  };
  if (request.signal?.aborted) {
    closeImages();
    throwIfAborted(request.signal);
  }
  let k = 0;
  const rows: PaneLayout = specRows.map((row) => row.map(() => rendered[k++]));

  const options: CompositeOptions = {
    ...frame,
    header: mosaic ? false : frame.header,
    unit,
    alignRows,
    paneGap,
    // Print: exactly the column width (89 mm at 300 dpi is 1051 px, not the
    // 1052 that integer pane widths can sum to).
    targetWidth: printWidthPx(request.size) ?? undefined,
  };
  let composition: ReturnType<typeof compose>;
  try {
    composition = compose(rows, side, options, settings);
  } finally {
    // The decoded tiles are drawn: release them (up to ~200 MB at 600 dpi).
    closeImages();
  }
  const dpi = request.size.kind === 'print' ? request.size.dpi : null;
  const provenance = request.provenance
    ? await provenanceRecord(viewState, target, label, request, composition)
    : null;
  const bytes = await encodeComposition(composition, format, frame.background, { dpi, provenance });

  const c = viewState.crosshair.world_mm;
  const suggestedName = mosaic
    ? mosaicFileName(headerName, mosaic.axis, mosaic.first, mosaic.last, format)
    : target === 'orthogonal' || target === 'orthogonal-row'
      ? layoutFileName(headerName, target === 'orthogonal' ? 'orthogonal' : 'row', c, format)
      : sliceFileName(headerName, target as ViewType, c[PLANE_AXIS_INDEX[target as ViewType]], format);
  const warning =
    composition.height > composition.width * 3
      ? `Tall output (${composition.width} × ${composition.height} px): use more columns or a larger step.`
      : null;
  return {
    bytes,
    mime: format === 'jpg' ? 'image/jpeg' : 'image/png',
    suggestedName,
    exportTarget: target,
    width: composition.width,
    height: composition.height,
    dpi,
    warning,
    target: {
      label,
      viewType: (SLICE_TARGETS as string[]).includes(target) ? (target as ViewType) : null,
      aspect: composition.width / composition.height,
    },
  };
}

/** Width in px a print size asks for (for the dialog's size line). */
export { printWidthPx };

/** For tests: the size a layout of pane rects would compose to. */
export { compositionSize, headerBandPx };
