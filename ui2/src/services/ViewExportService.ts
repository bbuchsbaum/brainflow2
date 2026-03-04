/**
 * ViewExportService
 *
 * Centralized "export active view to image" logic. Views can optionally
 * register custom exporters keyed by componentType and an optional id.
 */

import { getTransport } from './transport';
import { getEventBus } from '@/events/EventBus';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import type { ViewState } from '@/types/viewState';
import type { ViewType } from '@/types/coordinates';

export type ExportFormat = 'png' | 'jpg';

export interface ExportOptions {
  format?: ExportFormat;
  transparentBackground?: boolean;
}

type NormalizedExportOptions = Required<Pick<ExportOptions, 'format' | 'transparentBackground'>>;
type ExporterFn = (options: NormalizedExportOptions) => Promise<Uint8Array>;

class ViewExportService {
  private exporters = new Map<string, ExporterFn>();
  private transport = getTransport();
  private eventBus = getEventBus();

  async captureActiveView(options: ExportOptions = {}): Promise<{
    bytes: Uint8Array;
    mime: string;
    suggestedName: string;
    componentType: string;
    componentState: Record<string, unknown> | null;
  }> {
    const format: ExportFormat = options.format ?? 'png';
    const transparentBackground =
      format === 'png' ? (options.transparentBackground ?? false) : false;
    const normalized: NormalizedExportOptions = { format, transparentBackground };

    // Prefer the last interacted renderable (slice/mosaic/surface) over layout focus.
    const activeRenderableRaw = useActiveRenderContextStore.getState().activeId;
    const activeRenderable =
      typeof activeRenderableRaw === 'string' ? activeRenderableRaw.toLowerCase() : null;

    if (activeRenderable) {
      if (activeRenderable === 'axial' || activeRenderable === 'sagittal' || activeRenderable === 'coronal') {
        const bytes = await this.renderSliceToBytes(activeRenderable as ViewType, normalized);
        const suggestedName = this.suggestFileNameForActiveId(activeRenderable, format);
        const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
        return {
          bytes,
          mime,
          suggestedName,
          componentType: 'slice',
          componentState: { viewType: activeRenderable }
        };
      }

      const customExporter = this.exporters.get(activeRenderable);
      if (customExporter) {
        const bytes = await customExporter(normalized);
        const suggestedName = this.suggestFileNameForActiveId(activeRenderable, format);
        const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
        const prefix = activeRenderable.split(':')[0] || activeRenderable;
        return {
          bytes,
          mime,
          suggestedName,
          componentType: prefix,
          componentState: null
        };
      }
    }

    const { componentType, componentState } = useActivePanelStore.getState();
    if (!componentType) {
      throw new Error('No active view to capture');
    }

    const exporterKey = this.makeExporterKey(componentType, componentState);
    const customExporter = exporterKey ? this.exporters.get(exporterKey) : undefined;

    const bytes = customExporter
      ? await customExporter(normalized)
      : await this.exportBuiltIn(componentType, componentState, normalized);

    const suggestedName = this.suggestFileName(componentType, componentState, format);
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';

    return { bytes, mime, suggestedName, componentType, componentState };
  }

  registerExporter(key: string, exporter: ExporterFn): void {
    this.exporters.set(key.toLowerCase(), exporter);
  }

  unregisterExporter(key: string): void {
    this.exporters.delete(key.toLowerCase());
  }

  async exportActiveView(options: ExportOptions = {}): Promise<void> {
    try {
      const { bytes, suggestedName } = await this.captureActiveView(options);
      const savedPath = await this.transport.invoke<string | null>('save_image_bytes', {
        bytes: Array.from(bytes),
        suggestedName
      });

      if (savedPath) {
        this.notify('info', `Saved image to ${savedPath}`);
      }
    } catch (err) {
      console.error('[ViewExportService] Export failed:', err);
      this.notify('error', (err as Error).message || 'Export failed');
    }
  }

  private async exportBuiltIn(
    componentType: string,
    componentState: Record<string, unknown> | null,
    options: NormalizedExportOptions
  ): Promise<Uint8Array> {
    const typeLower = componentType.toLowerCase();

    if (typeLower === 'workspace') {
      const wsType = componentState?.workspaceType;
      const wsTypeLower = typeof wsType === 'string' ? wsType.toLowerCase() : null;

      if (wsTypeLower === 'mosaic' || wsTypeLower === 'lightbox') {
        throw new Error(`No exporter registered for workspace type '${wsTypeLower}'`);
      }

      if (wsTypeLower?.startsWith('orthogonal') || wsTypeLower === 'flexible') {
        const viewType = this.resolveSliceViewType('orthogonalview');
        return this.renderSliceToBytes(viewType, options);
      }
    }

    if (this.isSliceComponent(typeLower)) {
      const viewType = this.resolveSliceViewType(typeLower);
      return this.renderSliceToBytes(viewType, options);
    }

    throw new Error(`No exporter registered for component '${componentType}'`);
  }

  private isSliceComponent(typeLower: string): boolean {
    return (
      typeLower === 'axialview' ||
      typeLower === 'sagittalview' ||
      typeLower === 'coronalview' ||
      typeLower === 'sliceview' ||
      typeLower === 'orthogonalview'
    );
  }

  private resolveSliceViewType(typeLower: string): ViewType {
    if (typeLower === 'axialview') return 'axial';
    if (typeLower === 'sagittalview') return 'sagittal';
    if (typeLower === 'coronalview') return 'coronal';

    // For OrthogonalView / generic SliceView, fall back to the last mouse-active slice.
    const mouseActive = useMouseCoordinateStore.getState().activeView;
    return mouseActive ?? 'axial';
  }

  private async renderSliceToBytes(
    viewType: ViewType,
    options: NormalizedExportOptions
  ): Promise<Uint8Array> {
    const viewState = useViewStateStore.getState().viewState;
    const viewPlane = viewState.views[viewType];
    const width = viewPlane?.dim_px?.[0] ?? 512;
    const height = viewPlane?.dim_px?.[1] ?? 512;

    const payload = this.buildDeclarativeViewState(viewState, viewType, width, height, options.transparentBackground);
    const result = await this.transport.invoke<any>('render_view', {
      stateJson: JSON.stringify(payload),
      format: options.format
    });

    if (result instanceof Uint8Array && result.length > 0) {
      return result;
    }
    if (result instanceof ArrayBuffer && result.byteLength > 0) {
      return new Uint8Array(result);
    }
    if (Array.isArray(result) && result.length > 0) {
      return new Uint8Array(result);
    }

    throw new Error('render_view returned empty data');
  }

  private buildDeclarativeViewState(
    viewState: ViewState,
    viewType: ViewType,
    width: number,
    height: number,
    transparentBackground: boolean
  ): any {
    const visibleLayers = viewState.layers.filter(l => l.visible && l.opacity > 0);
    if (visibleLayers.length === 0) {
      throw new Error('No visible layers to export');
    }

    const view = viewState.views[viewType];
    const payload: any = {
      views: viewState.views,
      crosshair: viewState.crosshair,
      layers: visibleLayers.map(layer => ({
        id: layer.id,
        volumeId: layer.volumeId,
        colormap: layer.colormap,
        blendMode: layer.blendMode || 'alpha',
        opacity: layer.opacity,
        intensity: layer.intensity,
        threshold: layer.threshold,
        interpolation: layer.interpolation || 'linear',
        visible: true
      })),
      timepoint: viewState.timepoint
    };

    if (view) {
      payload.requestedView = {
        type: viewType,
        origin_mm: [...view.origin_mm, 1.0],
        u_mm: [
          view.u_mm[0] * width,
          view.u_mm[1] * width,
          view.u_mm[2] * width,
          0.0
        ],
        v_mm: [
          view.v_mm[0] * height,
          view.v_mm[1] * height,
          view.v_mm[2] * height,
          0.0
        ],
        width,
        height
      };
    }

    if (transparentBackground) {
      payload.transparentBackground = true;
    }

    return payload;
  }

  private makeExporterKey(
    componentType: string,
    componentState: Record<string, unknown> | null
  ): string | null {
    const typeLower = componentType.toLowerCase();

    if (typeLower === 'workspace') {
      const wsType = componentState?.workspaceType;
      const wsId = componentState?.workspaceId;
      if (typeof wsType === 'string') {
        const wsTypeLower = wsType.toLowerCase();
        if (wsTypeLower === 'mosaic') {
          return typeof wsId === 'string' ? `mosaic:${wsId}`.toLowerCase() : 'mosaic';
        }
        if (wsTypeLower === 'lightbox') {
          return typeof wsId === 'string' ? `lightbox:${wsId}`.toLowerCase() : 'lightbox';
        }
      }
    }

    if (typeLower === 'surfaceview') {
      const handle = componentState?.surfaceHandle;
      if (typeof handle === 'string') {
        return `surfaceview:${handle}`.toLowerCase();
      }
    }

    return null;
  }

  private suggestFileName(
    componentType: string,
    componentState: Record<string, unknown> | null,
    format: ExportFormat
  ): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const typeLower = componentType.toLowerCase();

    if (typeLower === 'workspace') {
      const wsType = componentState?.workspaceType;
      const wsId = componentState?.workspaceId;
      if (typeof wsType === 'string') {
        const safeType = wsType.toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (typeof wsId === 'string') {
          return `${safeType}-${wsId}-${ts}.${format}`;
        }
        return `${safeType}-${ts}.${format}`;
      }
    }

    if (typeLower === 'surfaceview') {
      const handle = componentState?.surfaceHandle;
      if (typeof handle === 'string') {
        return `surface-${handle}-${ts}.${format}`;
      }
    }

    return `view-${typeLower}-${ts}.${format}`;
  }

  private suggestFileNameForActiveId(activeId: string, format: ExportFormat): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const idLower = activeId.toLowerCase();
    const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, '');

    if (idLower === 'axial' || idLower === 'sagittal' || idLower === 'coronal') {
      return `slice-${idLower}-${ts}.${format}`;
    }

    if (idLower.startsWith('mosaic:')) {
      const wsId = sanitize(idLower.slice('mosaic:'.length));
      return wsId ? `mosaic-${wsId}-${ts}.${format}` : `mosaic-${ts}.${format}`;
    }

    if (idLower.startsWith('lightbox:')) {
      const wsId = sanitize(idLower.slice('lightbox:'.length));
      return wsId ? `lightbox-${wsId}-${ts}.${format}` : `lightbox-${ts}.${format}`;
    }

    if (idLower.startsWith('surfaceview:')) {
      const handle = sanitize(idLower.slice('surfaceview:'.length));
      return handle ? `surface-${handle}-${ts}.${format}` : `surface-${ts}.${format}`;
    }

    const safeId = sanitize(idLower.replace(/:/g, '-'));
    return safeId ? `view-${safeId}-${ts}.${format}` : `view-${ts}.${format}`;
  }

  private notify(type: 'info' | 'warning' | 'error', message: string) {
    this.eventBus.emit('ui.notification', { type, message });
  }
}

let viewExportService: ViewExportService | null = null;

export function getViewExportService(): ViewExportService {
  if (!viewExportService) {
    viewExportService = new ViewExportService();
  }
  return viewExportService;
}
