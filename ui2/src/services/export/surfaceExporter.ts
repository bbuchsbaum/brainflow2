/**
 * The active surface view's figure exporter (phase 4, D4), when the viewer
 * can capture poses. Its own module: compositeCapture (targets) and
 * surfaceCapture (the capture) both need it.
 */
import type { SurfaceCanvasExporter } from '@brainflow/visualization/surface';
import { getViewExportService } from '@/services/ViewExportService';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { parseSurfaceViewContextId } from '@/utils/surfaceViewContext';

/** The active surface view's figure exporter, when it can capture poses. */
export function activeSurfaceFigureExporter(): {
  exporter: SurfaceCanvasExporter &
    Required<Pick<SurfaceCanvasExporter, 'capturePose' | 'figureInfo'>>;
  surfaceHandle: string;
} | null {
  const active = useActiveRenderContextStore.getState().activeId;
  const context = parseSurfaceViewContextId(active);
  if (!context || typeof active !== 'string') return null;
  const exporter = getViewExportService().getExporter(active) as SurfaceCanvasExporter | undefined;
  if (!exporter?.capturePose || !exporter.figureInfo) return null;
  return {
    exporter: exporter as SurfaceCanvasExporter &
      Required<Pick<SurfaceCanvasExporter, 'capturePose' | 'figureInfo'>>,
    surfaceHandle: context.surfaceHandle,
  };
}

