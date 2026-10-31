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
import type { AtlasPaletteLegendEntry } from '@/types/atlasPalette';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { mirrorsView, useViewDisplaySettingsStore } from '@/stores/viewDisplaySettingsStore';
import { activeVolumeLayerId } from '@/utils/activeLayer';
import { sampleLayerValue } from '@/hooks/useLayerValueAtWorld';
import {
  chooseColorbarLayerId,
  isRunGroupMember,
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
  exportDpi,
  chromeUnit,
  compose,
  compositionSize,
  encodeComposition,
  headerBandPx,
  printWidthPx,
  ptToPx,
  SIDEBAR_W,
  sideGapPx,
  TEXT_PT,
  type CompositeOptions,
  type ExportPane,
  type ExportSideBar,
  type FrameIncludes,
  type LegendGroup,
  type PaneLayout,
  type SizeSpec,
} from './compositeExport';
import { brainFraming, getNonzeroBbox } from '@/services/mosaic/brainBounds';
import { getApiService } from '@/services/apiService';
import { activeSurfaceFigureExporter } from './surfaceExporter';
import { legendInPanes, LEGEND_PROBE_MAX_PX, LEGEND_PROBE_TILE_MAX_PX } from './legendPresence';

export type ExportTarget =
  | 'axial'
  | 'sagittal'
  | 'coronal'
  | 'orthogonal'
  | 'orthogonal-row'
  | 'mosaic'
  | 'surface'
  | 'surface-lat-med';

const SLICE_TARGETS: ViewType[] = ['axial', 'sagittal', 'coronal'];

export const EXPORT_TARGET_LABEL: Record<ExportTarget, string> = {
  axial: 'Axial',
  sagittal: 'Sagittal',
  coronal: 'Coronal',
  orthogonal: 'Orthogonal layout',
  'orthogonal-row': 'Figure row (axial | coronal | sagittal)',
  mosaic: 'Mosaic',
  surface: 'Surface',
  'surface-lat-med': 'Surface lateral + medial',
};

/** Surface figure targets (phase 4, D4: services/export/surfaceCapture.ts). */
export function isSurfaceExportTarget(target: ExportTarget | null | undefined): target is 'surface' | 'surface-lat-med' {
  return target === 'surface' || target === 'surface-lat-med';
}

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
  // A mosaic mounting is the tab's content changing (a layout pill switches
  // the tab in place, with no workspace switch): a view focused before it
  // is gone (QA 2026-10-30 F26: Export from a Mosaic tab defaulted to the
  // sagittal view focused before the switch).
  workspaceSeq = ++seq;
  return () => {
    if (mosaicSources.get(workspaceId) === read) mosaicSources.delete(workspaceId);
  };
}

/**
 * The view last focused, by kind. It decides the export target before the
 * active workspace does (native R2-5: a Mosaic or Set Studio tab left open
 * kept the export on Mosaic, or a surface-only dialog, while the user worked
 * in another view).
 */
// Which came last: focusing a view, or switching workspace (a tab)? A view
// focused before the switch belongs to the tab the user left.
let focusSeq = 0;
let workspaceSeq = 0;
let seq = 0;
let tracking = false;
function trackRecency(): void {
  if (tracking) return;
  tracking = true;
  useActiveRenderContextStore.subscribe((state, prev) => {
    if (state.activeId !== prev.activeId) focusSeq = ++seq;
  });
  useWorkspaceStore.subscribe((state, prev) => {
    if (state.activeWorkspaceId !== prev.activeWorkspaceId) workspaceSeq = ++seq;
  });
}
trackRecency();

/** Test hook: forget the recency of focus and workspace switches. */
export function resetExportFocusRecency(): void {
  focusSeq = 0;
  workspaceSeq = 0;
}

function focusedViewKind(): 'mosaic' | 'surface' | 'slice' | null {
  // A workspace switch after the last focus: the focused view is in another tab.
  if (workspaceSeq > focusSeq) return null;
  const active = useActiveRenderContextStore.getState().activeId;
  const id = typeof active === 'string' ? active.toLowerCase() : '';
  if (id.startsWith('mosaic:')) return 'mosaic';
  if (id.startsWith('surface')) return 'surface';
  if ((SLICE_TARGETS as string[]).includes(id)) return 'slice';
  return null;
}

function activeMosaicSource(): MosaicExportSource | null {
  const active = useActiveRenderContextStore.getState().activeId;
  const kind = focusedViewKind();
  if (kind === 'mosaic' && typeof active === 'string') {
    const id = active.slice('mosaic:'.length);
    for (const [ws, read] of mosaicSources) {
      if (ws.toLowerCase() === id.toLowerCase()) return read();
    }
  }
  // Another view has focus: a mosaic elsewhere is not the target.
  if (kind) return null;
  const workspaceId = useWorkspaceStore.getState().getActiveWorkspace?.()?.id;
  const read = workspaceId ? mosaicSources.get(workspaceId) : undefined;
  return read ? read() : null;
}

/** Targets the focused view (else the current workspace) can export. */
export function availableExportTargets(): ExportTarget[] {
  if (activeMosaicSource()) return ['mosaic'];
  // A focused surface view composes its own poses (D4), whatever workspace
  // is marked active.
  if (focusedViewKind() === 'surface') {
    return activeSurfaceFigureExporter() ? ['surface', 'surface-lat-med'] : [];
  }
  // Compare panels render their own states: those keep the plain capture of
  // the active view. A focused slice view in another tab is exported as such.
  const workspaceType = useWorkspaceStore.getState().getActiveWorkspace?.()?.type;
  if (focusedViewKind() !== 'slice' && (workspaceType === 'comparison' || workspaceType === 'set-studio')) return [];
  const views = useViewStateStore.getState().viewState;
  const hasVolume = views.layers.some((l) => l.visible && l.volumeId);
  return hasVolume ? [...SLICE_TARGETS, 'orthogonal', 'orthogonal-row'] : [];
}

/**
 * Default target: what the tab shows (QA features 2026-10-31 §3). A mosaic
 * tab exports its tiles; a slice view focused in this tab, that view; else an
 * orthogonal tab exports its orthogonal layout, any other one axial.
 */
export function defaultExportTarget(): ExportTarget | null {
  const available = availableExportTargets();
  if (available.length === 0) return null;
  if (available.includes('mosaic')) return 'mosaic';
  if (available.includes('surface')) return 'surface';
  // A view focused in a tab since left (or replaced) is not the default.
  if (focusedViewKind() !== 'slice') {
    const type = useWorkspaceStore.getState().getActiveWorkspace?.()?.type;
    const orthogonalTab =
      type === 'orthogonal-locked' || type === 'orthogonal-flexible' || type === 'integrated';
    return orthogonalTab && available.includes('orthogonal') ? 'orthogonal' : 'axial';
  }
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

/** Room for an orientation letter at a pane edge: its inset, cap height and a gap (px). */
export function letterBandPx(unit: number): number {
  return 5 * unit + ptToPx(TEXT_PT.letter, unit) + 3 * unit;
}

/** `rect` grown by `bandMm` on every side. */
export function letterBandRect(rect: PlaneRect, bandMm: number): PlaneRect {
  return { u0: rect.u0 - bandMm, u1: rect.u1 + bandMm, v0: rect.v0 - bandMm, v1: rect.v1 + bandMm };
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
    // As the screen shows it: axial and coronal mirrored under the
    // radiological convention (the backend render is never flipped).
    mirrored: mirrorsView(spec.viewType, useViewDisplaySettingsStore.getState().radiological),
    ...spec.extra,
  };
}

/**
 * The base layer as the figure's colorbar when no overlay has one (native
 * R2-4: a z map loaded alone exported without its scale). Rule: a visible
 * scalar base that is a statistic (header or file-name statistic) or is drawn
 * with a colour map other than grey, or is one of several runs (their bars
 * follow the focused run, native R4-1); a plain grey anatomical base is skipped.
 */
export function baseColorbarLayerId(
  layers: ReturnType<typeof useLayerStore.getState>['layers'],
  viewLayers: ViewState['layers'],
  metadata: ReturnType<typeof useLayerStore.getState>['layerMetadata'],
): string | null {
  const isAtlas = (l: (typeof layers)[number]) => l.source === 'atlas' || l.isLabelMap === true;
  const base = layers.find((l) => !isAtlas(l));
  const view = base ? viewLayers.find((l) => l.id === base.id) : undefined;
  if (!base || !view || !view.visible || (view.layerMode ?? 'scalar') !== 'scalar') return null;
  const statistic = statisticUnits(base.statistic, metadata.get(base.id)?.dataRange) !== null;
  const coloured = !!view.colormap && !/^gr[ae]y(scale)?$/i.test(view.colormap);
  return statistic || coloured || isRunGroupMember(base.id) ? base.id : null;
}

async function sideBar(
  viewState: ViewState,
  withValue: boolean,
): Promise<{ side: ExportSideBar; legendLayers: LegendLayer[] }> {
  const { layers, layerMetadata } = useLayerStore.getState();
  const activeId = activeVolumeLayerId(viewState.layers);
  const overlayId = chooseColorbarLayerId(layers, viewState.layers, activeId);
  const colorbarId = overlayId ?? baseColorbarLayerId(layers, viewState.layers, layerMetadata);
  const viewLayer = colorbarId ? viewState.layers.find((l) => l.id === colorbarId) : undefined;
  const show = colorbarId
    ? useDisplayOptionsStore.getState().options.get(colorbarId)?.showColorbar !== false
    : false;
  const colorbar = colorbarId
    ? resolveColorbarLayer(layers, colorbarId, viewLayer, show, layerMetadata.get(colorbarId), {
        allowBase: !overlayId,
      })
    : null;
  let value: number | null = null;
  if (colorbar && withValue) {
    const c = viewState.crosshair.world_mm;
    // At the layer's current timepoint (the backend samples it): a default
    // of 0 would cache another timepoint's value under t = 0 (review D4).
    const timepoint = layers.find((l) => l.id === colorbar.layerId)?.currentTimepoint ?? 0;
    value = await sampleLayerValue(colorbar.layerId, [c[0], c[1], c[2]], timepoint);
  }
  // Every visible label map's regions, topmost first (beside or below the
  // colorbar). Only the topmost was listed while the label maps under it
  // were drawn too (QA 2026-10-30 F26: Olsen listed over drawn ASEG outlines).
  const legendLayers = [...viewState.layers]
    .reverse()
    .map((l) => (l.visible && l.opacity > 0 ? layers.find((x) => x.id === l.id) : undefined))
    .filter((info) => info?.type === 'label' && (info.atlasPaletteLegend?.length ?? 0) > 0)
    .map((info) => ({ id: info!.id, name: info!.name, legend: info!.atlasPaletteLegend! }));
  const legend = legendLayers.length > 0 ? legendLayers.flatMap((l) => l.legend) : null;
  // Grouped by layer: two atlases' regions (same names, same colours) are
  // told apart under each layer's name (review of F26).
  const legendGroups = legendLayers.map((l) => ({ name: l.name, entries: l.legend }));
  return { side: { colorbar, value, legend, legendGroups }, legendLayers };
}

/** A visible label layer and its full Regions legend. */
interface LegendLayer {
  id: string;
  name: string;
  legend: AtlasPaletteLegendEntry[];
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

/** What a volume layer is, for choosing the crop's support. */
export type CropKind = 'mask' | 'anatomical' | 'statistic' | 'label';

/**
 * The volume whose support "Crop to brain" frames (native R3-3: with a z map
 * as the base the crop shrank to its suprathreshold blobs and the header lost
 * its view name). The crop follows the head, never the rendered or thresholded
 * pixels: a loaded brain mask (any visibility) first, else the bottom
 * anatomical volume, else the bottom volume whatever it is; its finite
 * non-zero voxels at threshold 0 (cropBox). Statistics and labels never set
 * the crop when an anatomy or mask is loaded.
 */
export function cropVolumeIds(
  layers: ReadonlyArray<{ id?: string; volumeId?: string | null }>,
  kindOf: (layerId: string | undefined) => CropKind = () => 'anatomical',
): string[] {
  const volumes = layers.filter((l) => l.volumeId);
  const pick =
    volumes.find((l) => kindOf(l.id) === 'mask') ??
    volumes.find((l) => kindOf(l.id) === 'anatomical') ??
    volumes[0];
  return pick?.volumeId ? [pick.volumeId] : [];
}

/** A layer's crop kind from its store record (mask name token or binary flag, statistic, label). */
export function cropKind(
  layer: { name?: string; sourcePath?: string; type?: string; isLabelMap?: boolean } | undefined,
  options: { isStatistic: boolean; isBinaryLike?: boolean },
): CropKind {
  const base = (p?: string) => (p ?? '').split(/[\\/]/).pop() ?? '';
  const masky = (n?: string) => /(?:^|[^a-z])(?:brain)?mask(?:[^a-z]|$)/i.test(n ?? '');
  if (options.isBinaryLike === true || masky(layer?.name) || masky(base(layer?.sourcePath))) return 'mask';
  if (layer?.type === 'label' || layer?.isLabelMap) return 'label';
  if (options.isStatistic) return 'statistic';
  return 'anatomical';
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

/**
 * The crop of a statistic map exported with no anatomy or mask under it
 * (native R4-3): its whole support framed a mostly empty page with the blobs
 * in one corner, since nothing below threshold is drawn. Instead: the box of
 * its visible voxels (|v| above the hidden band, all slices), padded by
 * max(15 mm, a quarter of its extent), at least half the support's extent
 * per axis (so the letters and header keep their room), kept inside the
 * support. The support box alone when nothing is visible.
 */
export function statisticCropBox(
  support: { worldMinMm: number[]; worldMaxMm: number[] },
  visible: { worldMinMm: number[]; worldMaxMm: number[] } | null,
): { worldMinMm: number[]; worldMaxMm: number[] } {
  if (!visible) return support;
  const min: number[] = [];
  const max: number[] = [];
  for (let a = 0; a < 3; a += 1) {
    const s0 = support.worldMinMm[a];
    const s1 = support.worldMaxMm[a];
    const extent = visible.worldMaxMm[a] - visible.worldMinMm[a];
    const pad = Math.max(15, extent / 4);
    let lo = visible.worldMinMm[a] - pad;
    let hi = visible.worldMaxMm[a] + pad;
    const floor = (s1 - s0) / 2;
    if (hi - lo < floor) {
      const centre = (lo + hi) / 2;
      lo = centre - floor / 2;
      hi = centre + floor / 2;
    }
    // Inside the support: shift first (keep the size), then clip.
    if (lo < s0) [lo, hi] = [s0, hi + (s0 - lo)];
    if (hi > s1) [lo, hi] = [lo - (hi - s1), s1];
    min.push(Math.max(s0, lo));
    max.push(Math.min(s1, hi));
  }
  return { worldMinMm: min, worldMaxMm: max };
}

/** |v| at or below this is hidden by a symmetric band (lo ≤ 0 ≤ hi); else 0. */
export function hiddenBandMagnitude(threshold: readonly number[] | undefined): number {
  const [lo, hi] = threshold ?? [0, 0];
  return lo <= 0 && hi >= 0 ? Math.max(0, Math.min(-lo, hi)) : 0;
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
  if (isSurfaceExportTarget(target)) {
    const { captureSurfaceComposite } = await import('./surfaceCapture');
    return captureSurfaceComposite(target, format, request);
  }
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

  const { side, legendLayers } = await sideBar(viewState, frame.crosshair);

  // Crop to the brain: the support (finite non-zero voxels, threshold 0) of a
  // brain mask, else the bottom anatomy, else the bottom volume (cropVolumeIds,
  // native R3-3), measured from the voxel EDGES as the mosaic frames the
  // brain (v4 fidelity), then one mm/px for all panes.
  const cropKindOf = (layerId: string | undefined): CropKind => {
    const { layers, layerMetadata } = useLayerStore.getState();
    const info = layers.find((l) => l.id === layerId);
    const meta = layerId ? layerMetadata.get(layerId) : undefined;
    return cropKind(info, {
      isStatistic: statisticUnits(info?.statistic, meta?.dataRange) !== null,
      isBinaryLike: meta?.isBinaryLike,
    });
  };
  const cropFetch = (threshold: number) => ({
    nonzero: (id: string) => getNonzeroBbox(id, threshold),
    bounds: (id: string) => getApiService().getVolumeBounds(id).catch(() => null),
  });
  const cropIds = request.cropToBrain ? cropVolumeIds(viewState.layers, cropKindOf) : [];
  let bbox = request.cropToBrain ? await cropBox(cropIds, cropFetch(0)) : null;
  // A statistic with nothing under it: frame its visible voxels (statisticCropBox).
  const cropLayer = viewState.layers.find((l) => l.volumeId === cropIds[0]);
  if (bbox && cropLayer && cropKindOf(cropLayer.id) === 'statistic') {
    const band = hiddenBandMagnitude(cropLayer.threshold);
    if (band > 0) bbox = statisticCropBox(bbox, await cropBox(cropIds, cropFetch(band)));
  }
  const cropped = specRows.map((row) => row.map((p) => paneRect(p.plane, bbox)));
  const solveWith = (withSide: boolean) => (rs: PlaneRect[][]) =>
    solveMmPerPx(
      specRows.map((row, r) => row.map((p, c) => ({ plane: p.plane, rect: rs[r][c] }))),
      request.size,
      { unit, paneGap, sideW: withSide ? SIDEBAR_W * unit + sideGapPx(unit, paneGap) : 0 },
    );
  // A cropped pane leaves a band for its orientation letters on every side,
  // so they sit beside the brain, not on it (native R4: "S" over the cortex).
  const letterBands = bbox && frame.orientation && !mosaic;

  // The Regions legend lists only the labels drawn in the exported slices
  // (QA 2026-10-29 §13), probed over each pane's field of view (with the
  // widest letter band: the side column only narrows it).
  if (side.legend && side.legend.length > 0 && legendLayers.length > 0) {
    throwIfAborted(request.signal);
    const bandMm = letterBands ? letterBandPx(unit) * solveWith(true)(cropped) : 0;
    const panes = specRows.flatMap((row, r) =>
      row.map((p, c) => {
        const rect = letterBandRect(cropped[r][c], bandMm);
        const extent = Math.max(rect.u1 - rect.u0, rect.v1 - rect.v0);
        const maxPx = mosaic ? LEGEND_PROBE_TILE_MAX_PX : LEGEND_PROBE_MAX_PX;
        return { viewType: p.viewType, plane: rectPlane(p.plane, rect, extent / maxPx) };
      }),
    );
    // Each label layer is probed alone (their colours may coincide); one
    // that cannot be read keeps its full legend.
    const groups: LegendGroup[] = [];
    for (const layer of legendLayers) {
      const found = await legendInPanes(viewState, layer.id, layer.legend, panes, {
        signal: request.signal,
      });
      groups.push({ name: layer.name, entries: found ?? layer.legend });
    }
    side.legendGroups = groups;
    side.legend = groups.flatMap((g) => g.entries);
  }
  const hasSide = frame.colorbar && (!!side.colorbar || (side.legend?.length ?? 0) > 0);
  const headerName = figureLayerName(viewState, side);
  const solve = solveWith(!!hasSide);

  // The band is in px, the rect in mm: a few passes settle the scale.
  let rects = cropped;
  let mmPerPx = solve(rects);
  if (letterBands) {
    for (let pass = 0; pass < 3; pass += 1) {
      rects = cropped.map((row) => row.map((rect) => letterBandRect(rect, letterBandPx(unit) * mmPerPx)));
      mmPerPx = solve(rects);
    }
  }
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
  // Every export carries its resolution (screen presets too, native R3-4).
  const dpi = exportDpi(request.size);
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
