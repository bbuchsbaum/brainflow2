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
import { refitToPx } from '@/utils/sliceGeometry';
import { activeVolumeLayerId } from '@/utils/activeLayer';
import { sampleLayerValue } from '@/hooks/useLayerValueAtWorld';
import {
  chooseColorbarLayerId,
  resolveColorbarLayer,
} from '@/components/views/viewportFrame/useOverlayColorbar';
import { PLANE_AXIS_INDEX } from '@/components/views/viewportFrame/frameFormat';
import { formatWorldMm, formatWorldMmAscii } from '@/utils/valueFormat';
import { isInferredStatistic, statisticUnits } from '@/utils/statistic';
import {
  getViewExportService,
  sliceExportFileName,
  type CaptureTarget,
  type ExportFormat,
} from '@/services/ViewExportService';
import {
  compose,
  encodeComposition,
  printWidthPx,
  resolveScale,
  SIDEBAR_W,
  type CompositeOptions,
  type ExportPane,
  type ExportSideBar,
  type FrameIncludes,
  type PaneLayout,
  type SizeSpec,
} from './compositeExport';

export type ExportTarget = 'axial' | 'sagittal' | 'coronal' | 'orthogonal' | 'mosaic';

const SLICE_TARGETS: ViewType[] = ['axial', 'sagittal', 'coronal'];

export const EXPORT_TARGET_LABEL: Record<ExportTarget, string> = {
  axial: 'Axial',
  sagittal: 'Sagittal',
  coronal: 'Coronal',
  orthogonal: 'Orthogonal layout',
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
  return hasVolume ? [...SLICE_TARGETS, 'orthogonal'] : [];
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

/** Export source of the active mosaic (null when none is shown). */
export function currentMosaicExportSource(): MosaicExportSource | null {
  return activeMosaicSource();
}

async function slicePane(
  viewState: ViewState,
  viewType: ViewType,
  plane: ViewPlane,
  options: CompositeOptions,
  extra: Partial<ExportPane> = {},
): Promise<ExportPane> {
  const [w0, h0] = plane.dim_px?.[0] > 0 ? plane.dim_px : [512, 512];
  const width = Math.max(1, Math.round(w0 * options.scale));
  const height = Math.max(1, Math.round(h0 * options.scale));
  const state: ViewState = { ...viewState, views: { ...viewState.views, [viewType]: plane } };
  const bytes = await getViewExportService().renderViewToBytes(
    state,
    viewType,
    width,
    height,
    'png',
    options.background !== 'black',
  );
  const crosshair = viewState.crosshair.world_mm;
  return {
    image: await decode(bytes),
    width,
    height,
    plane: refitToPx(plane, width, height),
    framePlane: viewType,
    positionMm: crosshair[PLANE_AXIS_INDEX[viewType]],
    layerName: layerNameOf(viewState),
    crosshairWorld: viewState.crosshair.visible ? [crosshair[0], crosshair[1], crosshair[2]] : null,
    ...extra,
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
    value = await sampleLayerValue(colorbar.layerId, [c[0], c[1], c[2]]);
  }
  // The topmost visible label map's regions (beside or below the colorbar).
  const labelLayer = [...viewState.layers]
    .reverse()
    .map((l) => (l.visible && l.opacity > 0 ? layers.find((x) => x.id === l.id) : undefined))
    .find((info) => info?.type === 'label' && (info.atlasPaletteLegend?.length ?? 0) > 0);
  const legend = labelLayer?.atlasPaletteLegend ?? null;
  return { colorbar, value, legend };
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
}

export interface CompositeRequest {
  frame: FrameIncludes;
  size: SizeSpec;
  /** Embed a provenance record (layers, files, display, crosshair) in the file. */
  provenance?: boolean;
  mosaicTiles?: MosaicTileSpec;
}

/** Width (CSS px at scale 1) of a layout of planes plus its side column. */
function baseWidth(rows: ViewPlane[][], side: boolean): number {
  const w = (p: ViewPlane) => (p.dim_px?.[0] > 0 ? p.dim_px[0] : 512);
  const gridW = Math.max(0, ...rows.map((r) => r.reduce((n, p) => n + w(p), 0) + Math.max(0, r.length - 1)));
  return gridW + (side ? SIDEBAR_W : 0);
}

async function appVersion(): Promise<string | null> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return (await getVersion()) ?? null;
  } catch {
    return null;
  }
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
  return JSON.stringify(
    {
      app: 'Brainflow',
      version: await appVersion(),
      exportedAt: new Date().toISOString(),
      view: { target, label },
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
          statistic:
            statisticUnits(info?.statistic, layerMetadata.get(l.id)?.dataRange) ?? null,
          statisticSource: info?.statistic
            ? isInferredStatistic(info.statistic)
              ? 'file name'
              : info.statistic.fromDescription
                ? 'description'
                : `intent ${info.statistic.intentCode}`
            : null,
        };
      }),
    },
    null,
    2,
  );
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
  let rows: PaneLayout;
  let viewState: ViewState;
  let suggestedName: string;
  let label: string;

  const sideFor = async (vs: ViewState) => sideBar(vs, frame.crosshair);
  const sizeFor = (planes: ViewPlane[][], side: ExportSideBar): CompositeOptions => {
    const hasSide = frame.colorbar && (!!side.colorbar || (side.legend?.length ?? 0) > 0);
    return { ...frame, scale: resolveScale(request.size, baseWidth(planes, hasSide)) };
  };
  let side: ExportSideBar;
  let options: CompositeOptions;

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
            const origin = [...template.origin_mm] as [number, number, number];
            origin[d] = positionMm;
            return {
              plane: { ...template, origin_mm: origin } as ViewPlane,
              positionMm,
              label: `${'xyz'[d]} ${formatWorldMm(positionMm)}`,
              atCrosshair: Math.abs(crossAt - positionMm) < source.sampling!.step / 2,
            };
          })
        : source.tiles;
    if (tiles.length === 0) throw new Error('The slice range holds no slices');
    side = await sideFor(viewState);
    const cols = Math.max(1, Math.min(source.cols, tiles.length));
    const planeRows: ViewPlane[][] = [];
    const usable = tiles.filter((t) => t.plane);
    for (let i = 0; i < usable.length; i += cols) planeRows.push(usable.slice(i, i + cols).map((t) => t.plane!));
    options = { ...sizeFor(planeRows, side), header: false };
    const last = usable.length - 1;
    const panes = await Promise.all(
      usable.map((tile, index) =>
        slicePane(viewState, source.axis, tile.plane!, options, {
          positionMm: tile.positionMm,
          tileLabel: { text: tile.label, emphasis: tile.atCrosshair },
          orientation: index === 0,
          scaleBar: index === last,
          crosshairWorld: tile.atCrosshair ? viewState.crosshair.world_mm : null,
        }),
      ),
    );
    rows = [];
    for (let i = 0; i < panes.length; i += cols) rows.push(panes.slice(i, i + cols));
    const first = tiles[0].positionMm;
    const lastMm = tiles[tiles.length - 1].positionMm;
    const base = (layerNameOf(viewState) ?? 'mosaic')
      .replace(/\.(nii\.gz|nii)$/i, '')
      .replace(/[^A-Za-z0-9_.-]+/g, '_');
    suggestedName = `${base}_mosaic_${source.axis}_${formatWorldMmAscii(first)}_to_${formatWorldMmAscii(lastMm)}mm.${format}`;
    label = `Mosaic · ${EXPORT_TARGET_LABEL[source.axis as ExportTarget]} · ${tiles.length} slices`;
  } else if (target === 'orthogonal') {
    viewState = useViewStateStore.getState().viewState;
    side = await sideFor(viewState);
    const v = viewState.views;
    options = sizeFor([[v.axial], [v.sagittal, v.coronal]], side);
    const [axial, sagittal, coronal] = await Promise.all(
      SLICE_TARGETS.map((t) => slicePane(viewState, t, viewState.views[t], options)),
    );
    rows = [[axial], [sagittal, coronal]];
    const c = viewState.crosshair.world_mm;
    const base = (layerNameOf(viewState) ?? 'view')
      .replace(/\.(nii\.gz|nii)$/i, '')
      .replace(/[^A-Za-z0-9_.-]+/g, '_');
    suggestedName = `${base}_orthogonal_${c.map((x) => formatWorldMmAscii(x)).join('_')}mm.${format}`;
    label = 'Orthogonal layout';
  } else {
    viewState = useViewStateStore.getState().viewState;
    side = await sideFor(viewState);
    options = sizeFor([[viewState.views[target]]], side);
    const pane = await slicePane(viewState, target, viewState.views[target], options);
    rows = [[pane]];
    suggestedName = sliceExportFileName(pane.layerName, target, pane.positionMm, format);
    label = EXPORT_TARGET_LABEL[target];
  }

  const composition = compose(rows, side, options, settings);
  const dpi = request.size.kind === 'print' ? request.size.dpi : null;
  const provenance = request.provenance
    ? await provenanceRecord(viewState, target, label, request, composition)
    : null;
  const bytes = await encodeComposition(composition, format, frame.background, { dpi, provenance });
  return {
    bytes,
    mime: format === 'jpg' ? 'image/jpeg' : 'image/png',
    suggestedName,
    exportTarget: target,
    width: composition.width,
    height: composition.height,
    dpi,
    target: {
      label,
      viewType: (SLICE_TARGETS as string[]).includes(target) ? (target as ViewType) : null,
      aspect: composition.width / composition.height,
    },
  };
}

/** Width in px a print size asks for (for the dialog's size line). */
export { printWidthPx };
