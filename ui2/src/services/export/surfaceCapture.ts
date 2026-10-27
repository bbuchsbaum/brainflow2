/**
 * Surface figures through the composer (phase 4, D4): "Surface" (the view as
 * the user left it) and "Surface lateral + medial" (both poses per
 * hemisphere: left above right in columns, lateral above medial in rows).
 *
 * Each pane is a pose rendered on the live viewer at its print size
 * (SurfaceCanvasExporter.capturePose: controls paused, other hemisphere
 * hidden, anatomical view, camera restored after). The composer adds the
 * frame header, its colorbar (threshold band, interior ticks) and an
 * orientation glyph per pane; surfaces get no scale bar, letters or
 * crosshair.
 */
import type {
  SurfaceExportPose,
  SurfaceFigureInfo,
} from '@brainflow/visualization/surface';
import type { ExportFormat } from '@/services/ViewExportService';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';
import { activeSurfaceFigureExporter } from './surfaceExporter';
import { surfaceColorbarLayer } from '@/components/views/surfaceFrame/surfaceColorbar';
import { shortLayerLabel } from '@/components/views/viewportFrame/frameFormat';
import { overlayMapName, pairedOverlayLayers } from '@/utils/hemisphereOverlays';
import { surfaceFileName } from '@/utils/exportFileName';
import {
  chromeUnit,
  compose,
  compositionSize,
  encodeComposition,
  printWidthPx,
  SIDEBAR_W,
  sideGapPx,
  type CompositeOptions,
  type ExportPane,
  type ExportSideBar,
  type HeaderRun,
  type SizeSpec,
} from './compositeExport';
import {
  compositionFits,
  ExportTooLargeError,
  type CompositeCapture,
  type CompositeRequest,
} from './compositeCapture';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';

export type SurfaceExportTarget = 'surface' | 'surface-lat-med';

/** Lateral and medial views of a hemisphere are about 3:2 (A-P by S-I). */
export const HEMISPHERE_POSE_ASPECT = 1.5;

const HEMI_NAME = { left: 'Left', right: 'Right' } as const;

export interface PlannedPose {
  pose: SurfaceExportPose;
  /** Header text ("Left lateral"). */
  title: string;
}

/** The poses of a surface figure, as rows (pure: tested on its own). */
export function surfacePosePlan(
  target: SurfaceExportTarget,
  hemispheres: ReadonlyArray<'left' | 'right'>,
): PlannedPose[][] {
  if (target === 'surface') {
    const title = hemispheres.length === 1 ? `${HEMI_NAME[hemispheres[0]]} hemisphere` : 'Surface';
    return [[{ pose: { view: 'current' }, title }]];
  }
  const views = ['lateral', 'medial'] as const;
  const viewName = { lateral: 'lateral', medial: 'medial' };
  if (hemispheres.length === 0) {
    // Hemisphere unknown: the poses of the first visible surface.
    return [
      views.map((view) => ({ pose: { view }, title: view[0].toUpperCase() + view.slice(1) })),
    ];
  }
  if (hemispheres.length === 1) {
    const hemi = hemispheres[0];
    return [
      views.map((view) => ({
        pose: { view, hemisphere: hemi },
        title: `${HEMI_NAME[hemi]} ${viewName[view]}`,
      })),
    ];
  }
  // Both: lateral row above the medial row, left hemisphere on the left.
  return views.map((view) =>
    (['left', 'right'] as const).map((hemi) => ({
      pose: { view, hemisphere: hemi },
      title: `${HEMI_NAME[hemi]} ${viewName[view]}`,
    })),
  );
}

/** Pane size (device px) for every pane of a plan. */
export function surfacePaneSize(
  plan: PlannedPose[][],
  size: SizeSpec,
  info: Pick<SurfaceFigureInfo, 'viewport'>,
  chrome: { unit: number; paneGap: number; sideW: number },
): { width: number; height: number } {
  const current = plan.length === 1 && plan[0].length === 1 && plan[0][0].pose.view === 'current';
  const aspect = current
    ? info.viewport.width / Math.max(1, info.viewport.height)
    : HEMISPHERE_POSE_ASPECT;
  const cols = Math.max(1, ...plan.map((row) => row.length));
  const target = printWidthPx(size);
  const width =
    target !== null
      ? Math.floor((target - chrome.sideW - chrome.paneGap * chrome.unit * (cols - 1)) / cols)
      : Math.round((current ? info.viewport.width : info.viewport.width / 2) * chrome.unit);
  const w = Math.max(16, width);
  return { width: w, height: Math.max(16, Math.round(w / aspect)) };
}

function findSurface(handleLower: string): LoadedSurface | null {
  for (const [handle, surface] of useSurfaceStore.getState().surfaces) {
    if (handle.toLowerCase() === handleLower) return surface;
  }
  return null;
}

/** The overlay the colorbar describes: the view's surface's, else any visible surface's. */
function figureColorbar(
  anchor: LoadedSurface | null,
  hemispheres: ReadonlyArray<'left' | 'right'>,
): ReturnType<typeof surfaceColorbarLayer> {
  let base = surfaceColorbarLayer(anchor);
  if (!base) {
    for (const surface of useSurfaceStore.getState().surfaces.values()) {
      if (surface.visible === false) continue;
      base = surfaceColorbarLayer(surface);
      if (base) break;
    }
  }
  if (!base || hemispheres.length < 2) return base;
  // Both hemispheres under one bar (v1 F1): the paired layers must share one
  // window, and the bar is titled with the map, not one hemisphere's file.
  const visible = [...useSurfaceStore.getState().surfaces.values()].filter((s) => s.visible !== false);
  const baseSurface = visible.find((s) => s.layers.has(base.layerId));
  const baseLayer = baseSurface?.layers.get(base.layerId);
  const pairs = pairedOverlayLayers(visible, baseLayer ?? base.name, baseSurface?.handle);
  if (pairs.length < 2) return base;
  const [first] = pairs;
  const differs = pairs.some(
    ({ layer }) =>
      layer.range[0] !== first.layer.range[0] ||
      layer.range[1] !== first.layer.range[1] ||
      layer.colormap !== first.layer.colormap ||
      (layer.threshold?.[0] ?? 0) !== (first.layer.threshold?.[0] ?? 0) ||
      (layer.threshold?.[1] ?? 0) !== (first.layer.threshold?.[1] ?? 0),
  );
  if (differs)
    throw new Error(
      `The hemispheres show ${overlayMapName(base.name)} with different colour ranges, colormaps or thresholds; ` +
        'give them the same window to share one colorbar.',
    );
  const name = `${overlayMapName(base.name)} (lh, rh)`;
  return { ...base, name, nameLabel: name };
}

function headerRuns(title: string, layerName: string | null): HeaderRun[][] {
  const base: HeaderRun[] = [{ text: title }];
  return layerName
    ? [[...base, { text: shortLayerLabel(layerName), muted: true }], base, []]
    : [base, []];
}

const PAGE_COLOUR = { black: '#000000', white: '#ffffff' } as const;

export async function captureSurfaceComposite(
  target: SurfaceExportTarget,
  format: ExportFormat,
  request: CompositeRequest,
): Promise<CompositeCapture> {
  if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready;
  const found = activeSurfaceFigureExporter();
  if (!found) throw new Error('The surface view cannot capture figure poses');
  const { exporter, surfaceHandle } = found;
  const info = exporter.figureInfo();
  // Surfaces have no slice crosshair or scale bar in a figure.
  const frame = { ...request.frame, crosshair: false, scaleBar: false };
  const unit = chromeUnit(request.size);
  const paneGap = 6;

  const anchor = findSurface(surfaceHandle);
  const colorbar = figureColorbar(anchor, info.hemispheres);
  const side: ExportSideBar = { colorbar, value: null, legend: null };
  const hasSide = frame.colorbar && !!colorbar;
  const layerName = colorbar?.name ?? null;

  const plan = surfacePosePlan(target, info.hemispheres);
  const paneCount = plan.reduce((n, row) => n + row.length, 0);
  const pane = surfacePaneSize(plan, request.size, info, {
    unit,
    paneGap,
    sideW: hasSide ? SIDEBAR_W * unit + sideGapPx(unit, paneGap) : 0,
  });
  const planned = compositionSize(
    plan.map((row) => row.map(() => pane)),
    {
      unit,
      header: frame.header,
      colorbar: frame.colorbar,
      paneGap,
      targetWidth: printWidthPx(request.size) ?? undefined,
    },
    hasSide,
  );
  if (!compositionFits(planned.width, planned.height))
    throw new ExportTooLargeError(planned.width, planned.height);
  if (pane.width > info.maxSide || pane.height > info.maxSide) {
    throw new Error(
      `Each surface pane would be ${pane.width} × ${pane.height} px, over this GPU's ${info.maxSide} px limit: ` +
        'use a narrower width or 300 dpi.',
    );
  }

  const transparent = frame.background === 'transparent';
  const images: ExportPane[][] = [];
  try {
    for (const row of plan) {
      const out: ExportPane[] = [];
      for (const { pose, title } of row) {
        if (request.signal?.aborted)
          throw new DOMException('Export capture superseded', 'AbortError');
        const captured = await exporter.capturePose({
          pose,
          width: pane.width,
          height: pane.height,
          transparentBackground: transparent,
          background: transparent ? undefined : PAGE_COLOUR[frame.background as 'black' | 'white'],
        });
        const image = await createImageBitmap(
          new Blob([captured.bytes as BlobPart], { type: 'image/png' }),
        );
        out.push({
          image,
          width: pane.width,
          height: pane.height,
          plane: null,
          framePlane: null,
          positionMm: 0,
          layerName: null,
          crosshairWorld: null,
          scaleBar: false,
          // The layer is named once: in the colorbar caption, else on a lone pane.
          surface: {
            header: headerRuns(title, hasSide || paneCount > 1 ? null : layerName),
            basis: captured.basis,
          },
        });
      }
      images.push(out);
    }
  } catch (error) {
    for (const p of images.flat()) (p.image as Partial<ImageBitmap>).close?.();
    throw error;
  }

  const options: CompositeOptions = {
    ...frame,
    unit,
    alignRows: 'center',
    paneGap,
    targetWidth: printWidthPx(request.size) ?? undefined,
  };
  let composition: ReturnType<typeof compose>;
  try {
    composition = compose(images, side, options, useCrosshairSettingsStore.getState().settings);
  } finally {
    for (const p of images.flat()) (p.image as Partial<ImageBitmap>).close?.();
  }
  const dpi = request.size.kind === 'print' ? request.size.dpi : null;
  const provenance = request.provenance
    ? JSON.stringify(
        {
          app: 'Brainflow',
          exportedAt: new Date().toISOString(),
          view: { target, poses: plan.flat().map((p) => p.pose) },
          size: { ...request.size, widthPx: composition.width, heightPx: composition.height },
          surface: anchor ? { name: anchor.name, file: anchor.metadata.path } : null,
          overlay: colorbar
            ? {
                name: colorbar.name,
                colormap: colorbar.colormap,
                window: colorbar.intensity,
                threshold: colorbar.threshold,
              }
            : null,
          underlay: anchor?.curvatureSource ?? null,
        },
        null,
        2,
      )
    : null;
  const bytes = await encodeComposition(composition, format, frame.background, { dpi, provenance });
  const label = target === 'surface' ? 'Surface' : 'Surface lateral + medial';
  return {
    bytes,
    mime: format === 'jpg' ? 'image/jpeg' : 'image/png',
    suggestedName: surfaceFileName(
      layerName ?? anchor?.name ?? null,
      target === 'surface' ? 'surface' : 'lat_med',
      info.hemispheres,
      format,
    ),
    exportTarget: target,
    width: composition.width,
    height: composition.height,
    dpi,
    warning: null,
    target: { label, viewType: null, aspect: composition.width / composition.height },
  };
}
