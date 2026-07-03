/**
 * API Service - High-level interface to backend commands
 * Uses the transport layer and provides typed methods
 *
 * The single-view render path uses `render_view`.
 */

import type { BackendTransport } from './transport';
import { getTransport } from './transport';
import type { ViewState } from '@/types/viewState';
import type { WorldCoordinates, ViewPlane, ViewType } from '@/types/coordinates';
import {
  RenderClient,
  configureInvoker,
  decodePngPacket,
  decodeRawRgbaPacket,
  validateRenderViewPayload,
  type DecodedRenderFrame,
  type RenderOutputFormat,
  type RenderViewDiagnostics,
  type VolumeBounds,
} from '@brainflow/api';
import { useRenderStore } from '@/stores/renderStore';
import { RenderSession, createRenderSession } from './RenderSession';
import type { AtlasStats } from '@/types/atlas';

const DEBUG_API_SERVICE =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.localStorage.getItem('brainflow2-debug-api-service') === 'true';

const apiDebugLog = (...args: unknown[]) => {
  if (DEBUG_API_SERVICE) {
    console.log(...args);
  }
};

import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';

// Domain service imports
import { renderFlags } from './render/RenderFeatureFlags';

function hexToRgba(hex: string, alpha = 1.0): [number, number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return [r, g, b, alpha];
}
import { getFilesystemService } from './filesystem/FilesystemService';
import { getVolumeApiService } from './volume/VolumeApiService';
import { getLayerGpuService } from './layer/LayerGpuService';
import { getBatchRenderService } from './mosaic/BatchRenderService';
import { recordRenderDiagnostic } from './render/RenderDiagnostics';
import { buildRequestedViewPayload } from '@/utils/viewGeometry';

// Re-export interfaces for backward compatibility
export type { VolumeHandle } from './volume/VolumeApiService';
export type { FileNode } from './filesystem/FilesystemService';
export type { SampleResult, NiftiHeaderInfo } from './volume/VolumeApiService';

export type {
  FrameReadbackMode,
  FrameRenderDiagnostics,
  RenderViewDiagnostics,
} from '@brainflow/api';

export class ApiService {
  private transport: BackendTransport;
  private renderClient: RenderClient;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
    configureInvoker((cmd, args) => this.transport.invoke(cmd, args));
    this.renderClient = new RenderClient(this.transport);
    apiDebugLog(
      `[ApiService] Initialized with unified render_view API (RGBA mode: ${renderFlags.useRawRGBA ? 'ENABLED' : 'DISABLED'})`,
    );
  }

  private getVisibleRenderLayers(viewState: ViewState) {
    const visibleLayers = viewState.layers.filter((layer) => layer.visible && layer.opacity > 0);
    const payloadLayers = visibleLayers.map((layer) => {
      apiDebugLog(`[ApiService] DEBUG: Converting layer for backend:`, {
        id: layer.id,
        volumeId: layer.volumeId,
        isSame: layer.id === layer.volumeId,
      });
      return {
        id: layer.id,
        volumeId: layer.volumeId,
        colormap: layer.colormap,
        // Explicit registered colormap slot (e.g. a categorical atlas palette).
        // The backend prefers this over name-based resolution for label layers.
        colormapId: layer.colormapId,
        blendMode: layer.blendMode || 'alpha',
        opacity: layer.opacity,
        intensity: layer.intensity,
        threshold: layer.threshold,
        interpolation: layer.interpolation || 'linear',
        layerMode: layer.layerMode ?? 'scalar',
        outline: layer.outline,
        alphaMod: layer.alphaMod,
        visible: true,
      };
    });

    return { visibleLayers, payloadLayers };
  }

  private buildSingleViewRenderPayload(
    viewState: ViewState,
    viewType?: 'axial' | 'sagittal' | 'coronal',
    width = 512,
    height = 512,
    sliceOverride?: { axis: 'x' | 'y' | 'z'; position: number },
  ) {
    let crosshairToUse = viewState.crosshair;

    if (sliceOverride && viewType) {
      const axisIndex = sliceOverride.axis === 'x' ? 0 : sliceOverride.axis === 'y' ? 1 : 2;
      const newWorldMm = [...viewState.crosshair.world_mm] as [number, number, number];
      newWorldMm[axisIndex] = sliceOverride.position;

      crosshairToUse = {
        ...viewState.crosshair,
        world_mm: newWorldMm,
      };

      apiDebugLog(
        `[ApiService] Using slice override: ${sliceOverride.axis}=${sliceOverride.position}mm`,
      );
      apiDebugLog(`[ApiService] Original crosshair: [${viewState.crosshair.world_mm}]`);
      apiDebugLog(`[ApiService] Modified crosshair: [${newWorldMm}]`);
    }

    const { visibleLayers, payloadLayers } = this.getVisibleRenderLayers(viewState);
    const crosshairColor = hexToRgba(
      useCrosshairSettingsStore.getState().settings.activeColor,
      0.8,
    );
    const payload: any = {
      views: viewState.views,
      crosshair: { ...crosshairToUse, color: crosshairColor },
      layers: payloadLayers,
      timepoint: viewState.timepoint,
    };

    if (viewType && viewState.views[viewType]) {
      const view = viewState.views[viewType];
      payload.requestedView = buildRequestedViewPayload(viewType, view, width, height);
    }

    return {
      payload,
      visibleLayerCount: visibleLayers.length,
    };
  }

  private async requestSingleViewBytes(
    declarativeViewState: unknown,
    format: RenderOutputFormat,
    diagnostics: {
      viewType: string;
      width: number;
      height: number;
      layerCount: number;
    },
    markId?: string,
  ): Promise<{ imageData: Uint8Array; frame: DecodedRenderFrame }> {
    performance.mark(`${markId}-serialize-start`);
    const stateJson = JSON.stringify(declarativeViewState);
    performance.mark(`${markId}-serialize-end`);
    performance.measure(`render:serialize`, `${markId}-serialize-start`, `${markId}-serialize-end`);
    performance.clearMarks(`${markId}-serialize-start`);
    performance.clearMarks(`${markId}-serialize-end`);
    apiDebugLog(`[ApiService] render_view payload serialized to ${stateJson.length} bytes`);

    const startTime = performance.now();
    const cmd = 'render_view';
    const stage = 'api.render_view';

    performance.mark(`${markId}-ipc-start`);
    try {
      const response = await this.renderClient.renderView(declarativeViewState as any, { format });
      performance.mark(`${markId}-ipc-end`);
      performance.measure(`render:ipc`, `${markId}-ipc-start`, `${markId}-ipc-end`);
      performance.clearMarks(`${markId}-ipc-start`);
      performance.clearMarks(`${markId}-ipc-end`);

      recordRenderDiagnostic(stage, performance.now() - startTime, {
        format,
        viewType: diagnostics.viewType,
        width: diagnostics.width,
        height: diagnostics.height,
        layerCount: diagnostics.layerCount,
        ok: true,
        command: cmd,
      });

      return {
        imageData: response.packet,
        frame: response.frame,
      };
    } catch (error) {
      performance.clearMarks(`${markId}-ipc-start`);
      recordRenderDiagnostic(stage, performance.now() - startTime, {
        format,
        viewType: diagnostics.viewType,
        width: diagnostics.width,
        height: diagnostics.height,
        layerCount: diagnostics.layerCount,
        ok: false,
        command: cmd,
      });
      throw error;
    }
  }

  /**
   * Apply view state and render - the core operation
   */
  async applyAndRenderViewStateCore(
    viewState: ViewState,
    viewType?: 'axial' | 'sagittal' | 'coronal',
    width = 512,
    height = 512,
    sliceOverride?: { axis: 'x' | 'y' | 'z'; position: number },
  ): Promise<ImageBitmap> {
    const startTime = performance.now();
    apiDebugLog(`[ApiService ${startTime.toFixed(0)}ms] applyAndRenderViewStateCore called`);
    apiDebugLog(`  - Total layers: ${viewState.layers.length}`);
    apiDebugLog(`  - ViewType: ${viewType || 'none'}`);
    apiDebugLog(
      `  - All layers:`,
      viewState.layers.map((l) => ({
        id: l.id,
        volumeId: l.volumeId,
        visible: l.visible,
        opacity: l.opacity,
        intensity: l.intensity,
      })),
    );

    const renderStore = useRenderStore.getState();
    if (renderStore.shouldBlockRender()) {
      console.warn('[ApiService] Blocking render - render target not ready');
      apiDebugLog('  Render target state:', renderStore.getRenderTargetState());
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#666';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Render target not ready', width / 2, height / 2);
      }
      return createImageBitmap(canvas);
    }

    if (!viewState.layers || viewState.layers.length === 0) {
      console.warn('[ApiService] No layers in ViewState - returning empty image');
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
      }
      return createImageBitmap(canvas);
    }

    const { payload: declarativeViewState, visibleLayerCount } = this.buildSingleViewRenderPayload(
      viewState,
      viewType,
      width,
      height,
      sliceOverride,
    );
    apiDebugLog(
      `[ApiService ${performance.now() - startTime}ms] Filtered to ${visibleLayerCount} visible layers`,
    );

    if (visibleLayerCount === 0) {
      console.warn(`[ApiService] WARNING: No visible layers to render! Returning empty image`);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
      }
      return createImageBitmap(canvas);
    }

    apiDebugLog(`[ApiService ${performance.now() - startTime}ms] Sending to backend:`);
    apiDebugLog(`  - layers in JSON: ${declarativeViewState.layers.length}`);
    apiDebugLog(`  - View vectors:`, {
      u_mm: declarativeViewState.requestedView?.u_mm,
      v_mm: declarativeViewState.requestedView?.v_mm,
      width: declarativeViewState.requestedView?.width,
      height: declarativeViewState.requestedView?.height,
    });

    if (viewType && viewState.views[viewType]) {
      const view = viewState.views[viewType];
      apiDebugLog(`  - Original view vectors (per-pixel):`, {
        u_mm: view.u_mm,
        v_mm: view.v_mm,
        dim_px: view.dim_px,
      });
    }

    apiDebugLog(`  - Full ViewState:`, JSON.stringify(declarativeViewState, null, 2));

    const validation = validateRenderViewPayload(declarativeViewState);
    if (!validation.ok) {
      console.error('[ApiService] Invalid render_view payload detected:', validation.errors);
      if (import.meta.env.DEV) {
        throw new Error(`render_view payload validation failed: ${validation.errors.join('; ')}`);
      }

      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#401010';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#ff8080';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Invalid render payload', width / 2, height / 2 - 10);
        ctx.fillText('Check console logs', width / 2, height / 2 + 16);
      }
      return createImageBitmap(canvas);
    }

    const format = renderFlags.useRawRGBA ? 'rgba' : 'png';
    const markId = `render-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    performance.mark(`${markId}-start`);
    try {
      const { imageData, frame } = await this.requestSingleViewBytes(
        declarativeViewState,
        format,
        {
          viewType: viewType ?? 'axial',
          width,
          height,
          layerCount: visibleLayerCount,
        },
        markId,
      );

      apiDebugLog(`[ApiService] render_view completed (${format}, ${imageData.length} bytes)`);

      performance.mark(`${markId}-decode-start`);
      const bitmap = await this.decodeRenderFrameToBitmap(frame);
      performance.mark(`${markId}-decode-end`);
      performance.measure(`render:decode`, `${markId}-decode-start`, `${markId}-decode-end`);
      performance.measure(`render:total`, `${markId}-start`, `${markId}-decode-end`);
      performance.clearMarks(`${markId}-start`);
      performance.clearMarks(`${markId}-decode-start`);
      performance.clearMarks(`${markId}-decode-end`);
      return bitmap;
    } catch (error) {
      performance.clearMarks(`${markId}-start`);
      performance.clearMarks(`${markId}-decode-start`);
      console.error('[ApiService] render_view failed:', error);
      console.error(`[ApiService] Error type: ${(error as any)?.constructor?.name}`);
      console.error(`[ApiService] Error message: ${(error as any)?.message}`);
      throw error;
    }
  }

  async decodeImageBuffer(imageData: Uint8Array, isRawRGBAFormat: boolean): Promise<ImageBitmap> {
    apiDebugLog('[ApiService] Decoding render buffer:', {
      type: Object.prototype.toString.call(imageData),
      size: imageData?.length ?? 0,
      isRawRGBAFormat,
      useRawRGBA: renderFlags.useRawRGBA,
    });

    if (!imageData || !(imageData instanceof Uint8Array) || imageData.length === 0) {
      throw new Error('Invalid or empty image data received from backend');
    }

    if (isRawRGBAFormat) {
      return this.decodeRenderFrameToBitmap(decodeRawRgbaPacket(imageData));
    }

    try {
      return await this.decodeRenderFrameToBitmap(decodePngPacket(imageData));
    } catch (error) {
      if (imageData.length > 8) {
        const view = new DataView(imageData.buffer, imageData.byteOffset, imageData.byteLength);
        const possibleWidth = view.getUint32(0, true);
        const possibleHeight = view.getUint32(4, true);

        if (
          possibleWidth > 0 &&
          possibleWidth < 10000 &&
          possibleHeight > 0 &&
          possibleHeight < 10000
        ) {
          console.warn(
            '[ApiService] Data appears to be raw RGBA despite PNG expectation; attempting recovery',
          );
          return this.decodeRenderFrameToBitmap(decodeRawRgbaPacket(imageData));
        }
      }
      throw error;
    }
  }

  private async decodeRenderFrameToBitmap(frame: DecodedRenderFrame): Promise<ImageBitmap> {
    if (frame.format === 'rgba') {
      let processedRgba: Uint8Array | Uint8ClampedArray = frame.rgba;
      if (renderFlags.debugBrighten) {
        const brightenedRgba = new Uint8ClampedArray(frame.rgba.length);
        const brightenFactor = 10;
        for (let i = 0; i < frame.rgba.length; i += 4) {
          brightenedRgba[i] = Math.min(255, frame.rgba[i] * brightenFactor);
          brightenedRgba[i + 1] = Math.min(255, frame.rgba[i + 1] * brightenFactor);
          brightenedRgba[i + 2] = Math.min(255, frame.rgba[i + 2] * brightenFactor);
          brightenedRgba[i + 3] = frame.rgba[i + 3];
        }
        processedRgba = brightenedRgba;
      }

      const imageDataObj = new ImageData(
        new Uint8ClampedArray(processedRgba),
        frame.width,
        frame.height,
      );
      return createImageBitmap(imageDataObj);
    }

    try {
      const blob = new Blob([frame.png], { type: 'image/png' });
      return await createImageBitmap(blob);
    } catch (error) {
      throw new Error(
        `PNG decoding failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Filesystem delegation ──────────────────────────────────────────────────

  async listDirectory(
    path: string,
    maxDepth = 1,
  ): Promise<import('./filesystem/FilesystemService').FileNode[]> {
    return getFilesystemService().listDirectory(path, maxDepth);
  }

  // ── Volume delegation ──────────────────────────────────────────────────────

  async loadFile(path: string): Promise<import('./volume/VolumeApiService').VolumeHandle> {
    return getVolumeApiService().loadFile(path);
  }

  async getVolumeBounds(volumeId: string): Promise<VolumeBounds> {
    return getVolumeApiService().getVolumeBounds(volumeId);
  }

  async unloadVolume(volumeId: string): Promise<void> {
    return getVolumeApiService().unloadVolume(volumeId);
  }

  async getNiftiHeaderInfo(
    volumeId: string,
  ): Promise<import('./volume/VolumeApiService').NiftiHeaderInfo> {
    return getVolumeApiService().getNiftiHeaderInfo(volumeId);
  }

  async getInitialViews(
    volumeId: string,
    maxPx: [number, number],
  ): Promise<Record<string, ViewPlane>> {
    return getVolumeApiService().getInitialViews(volumeId, maxPx);
  }

  async recalculateViewForDimensions(
    volumeId: string,
    viewType: 'axial' | 'sagittal' | 'coronal',
    dimensions: [number, number],
    crosshairMm: [number, number, number],
  ): Promise<ViewPlane> {
    return getVolumeApiService().recalculateViewForDimensions(
      volumeId,
      viewType,
      dimensions,
      crosshairMm,
    );
  }

  async recalculateAllViews(
    volumeId: string,
    dimensionsByView: Record<ViewType, [number, number]>,
    crosshairMm: [number, number, number],
  ): Promise<Record<ViewType, ViewPlane>> {
    return getVolumeApiService().recalculateAllViews(volumeId, dimensionsByView, crosshairMm);
  }

  async sampleWorldCoordinate(
    worldCoord: WorldCoordinates,
  ): Promise<import('./volume/VolumeApiService').SampleResult> {
    return getVolumeApiService().sampleWorldCoordinate(worldCoord);
  }

  async setVolumeTimepoint(volumeId: string, timepoint: number): Promise<void> {
    return getVolumeApiService().setVolumeTimepoint(volumeId, timepoint);
  }

  async getVolumeTimepoint(volumeId: string): Promise<number | null> {
    return getVolumeApiService().getVolumeTimepoint(volumeId);
  }

  async querySliceAxisMeta(
    volumeId: string,
    axis: 'axial' | 'sagittal' | 'coronal',
  ): Promise<{
    sliceCount: number;
    sliceSpacing: number;
    axisLength: number;
  }> {
    return getVolumeApiService().querySliceAxisMeta(volumeId, axis);
  }

  // ── Layer GPU delegation ───────────────────────────────────────────────────

  async requestLayerGpuResources(
    layerId: string,
    volumeId: string,
    metadataOnly?: boolean,
  ): Promise<any> {
    return getLayerGpuService().requestLayerGpuResources(layerId, volumeId, metadataOnly);
  }

  async releaseLayerGpuResources(layerId: string): Promise<void> {
    return getLayerGpuService().releaseLayerGpuResources(layerId);
  }

  async waitForLayerReady(
    layerId: string,
    timeoutMs: number = 5000,
    pollIntervalMs: number = 25,
  ): Promise<boolean> {
    return getLayerGpuService().waitForLayerReady(layerId, timeoutMs, pollIntervalMs);
  }

  async patchLayer(layerId: string, patch: Record<string, any>): Promise<void> {
    return getLayerGpuService().patchLayer(layerId, patch);
  }

  async updateSliceOutline(options: {
    enabled: boolean;
    outlineLayerIndex: number;
    selectedLabelId: number;
    color: [number, number, number, number];
    thicknessPx: number;
  }): Promise<void> {
    await this.transport.invoke('update_slice_outline', {
      enabled: options.enabled,
      outlineLayerIndex: options.outlineLayerIndex,
      selectedLabelId: options.selectedLabelId,
      color: options.color,
      thicknessPx: options.thicknessPx,
    });
  }

  /**
   * @deprecated Use layer service instead
   */
  async addRenderLayer(layerId: string, volumeId: string): Promise<void> {
    return getLayerGpuService().addRenderLayer(layerId, volumeId);
  }

  async getAtlasStats(): Promise<AtlasStats> {
    return getLayerGpuService().getAtlasStats();
  }

  // ── Batch render delegation ────────────────────────────────────────────────

  async batchRenderSlices(
    viewStates: any[],
    widthPerSlice: number,
    heightPerSlice: number,
  ): Promise<ArrayBuffer> {
    return getBatchRenderService().batchRenderSlices(viewStates, widthPerSlice, heightPerSlice);
  }

  // ── Render methods (stay in ApiService - complex and tightly coupled) ──────

  /**
   * Apply view state and render a specific view
   */
  async applyAndRenderViewState(
    viewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal',
    width?: number,
    height?: number,
  ): Promise<ImageBitmap | null> {
    try {
      const renderWidth = width ?? 512;
      const renderHeight = height ?? 512;
      const result = await this.applyAndRenderViewStateCore(
        viewState,
        viewType,
        renderWidth,
        renderHeight,
      );
      apiDebugLog(`[ApiService] applyAndRenderViewState result:`, {
        hasResult: !!result,
        isImageBitmap: result instanceof ImageBitmap,
        type: result ? Object.prototype.toString.call(result) : 'null',
      });
      return result;
    } catch (error) {
      console.error(`Failed to render ${viewType} view:`, error);
      console.error(`Error stack:`, (error as Error).stack);
      return null;
    }
  }

  /**
   * Promise-based rendering method that returns ImageBitmap directly
   */
  async renderViewState(
    viewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal',
    width = 512,
    height = 512,
  ): Promise<ImageBitmap> {
    return this.applyAndRenderViewStateCore(viewState, viewType, width, height);
  }

  async submitViewState(
    viewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal',
    width = 512,
    height = 512,
    sliceOverride?: { axis: 'x' | 'y' | 'z'; position: number },
  ): Promise<RenderViewDiagnostics> {
    const startTime = performance.now();
    const { payload: declarativeViewState, visibleLayerCount } = this.buildSingleViewRenderPayload(
      viewState,
      viewType,
      width,
      height,
      sliceOverride,
    );

    const validation = validateRenderViewPayload(declarativeViewState);
    if (!validation.ok) {
      throw new Error(`submit_view payload validation failed: ${validation.errors.join('; ')}`);
    }

    try {
      const diagnostics = await this.renderClient.submitView(declarativeViewState as any);
      recordRenderDiagnostic('api.submit_view', performance.now() - startTime, {
        format: diagnostics.format,
        viewType,
        width,
        height,
        layerCount: visibleLayerCount,
        ok: true,
        readbackMode: diagnostics.frame.readback_mode,
      });
      return diagnostics;
    } catch (error) {
      recordRenderDiagnostic('api.submit_view', performance.now() - startTime, {
        format: 'rgba',
        viewType,
        width,
        height,
        layerCount: visibleLayerCount,
        ok: false,
      });
      throw error;
    }
  }

  async renderViewStateMulti(
    viewState: ViewState,
    viewTypes: ViewType[],
  ): Promise<Record<ViewType, ImageBitmap | null>> {
    const startTime = performance.now();
    const { visibleLayers, payloadLayers } = this.getVisibleRenderLayers(viewState);

    if (visibleLayers.length === 0) {
      console.warn('[ApiService] renderViewStateMulti called with no visible layers');
      const empty: Record<ViewType, ImageBitmap | null> = {
        axial: null,
        sagittal: null,
        coronal: null,
      };
      return empty;
    }

    const multiCrosshairColor = hexToRgba(
      useCrosshairSettingsStore.getState().settings.activeColor,
      0.8,
    );
    const payload: any = {
      views: viewState.views,
      crosshair: { ...viewState.crosshair, color: multiCrosshairColor },
      layers: payloadLayers,
      timepoint: viewState.timepoint,
      requestedViews: viewTypes.map((viewType) => {
        const view = viewState.views[viewType];
        if (!view) {
          throw new Error(`Requested view '${viewType}' missing from view state`);
        }
        const [w, h] = view.dim_px || [512, 512];
        return {
          type: viewType,
          origin_mm: [...view.origin_mm, 1.0] as [number, number, number, number],
          u_mm: [view.u_mm[0] * w, view.u_mm[1] * w, view.u_mm[2] * w, 0.0] as [
            number,
            number,
            number,
            number,
          ],
          v_mm: [view.v_mm[0] * h, view.v_mm[1] * h, view.v_mm[2] * h, 0.0] as [
            number,
            number,
            number,
            number,
          ],
          width: w,
          height: h,
        };
      }),
    };

    const validation = validateRenderViewPayload(payload);
    if (!validation.ok) {
      console.error('[ApiService] Invalid multi-view render payload detected:', validation.errors);
      throw new Error(`render_views payload validation failed: ${validation.errors.join('; ')}`);
    }

    const format = renderFlags.useRawRGBA ? 'rgba' : 'png';
    const response = await this.renderClient.renderViews(payload as any, {
      format,
    });
    recordRenderDiagnostic('api.render_views', performance.now() - startTime, {
      format,
      viewCount: viewTypes.length,
      layerCount: visibleLayers.length,
    });

    const results: Partial<Record<ViewType, ImageBitmap | null>> = {};

    for (const frame of response.frames) {
      try {
        results[frame.viewType] = await this.decodeRenderFrameToBitmap(frame);
      } catch (error) {
        console.error(
          `[ApiService] Failed to decode ${frame.viewType} view from render_views:`,
          error,
        );
        results[frame.viewType] = null;
      }
    }

    const elapsed = performance.now() - startTime;
    apiDebugLog(
      `[ApiService] renderViewStateMulti decoded ${response.frames.length} views in ${elapsed.toFixed(1)}ms`,
    );

    return results as Record<ViewType, ImageBitmap | null>;
  }

  /**
   * Promise-based batch rendering for MosaicView
   */
  async renderViewStateBatch(
    baseViewState: ViewState,
    sliceConfigs: Array<{
      viewType: 'axial' | 'sagittal' | 'coronal';
      sliceIndex: number;
      width: number;
      height: number;
    }>,
  ): Promise<ImageBitmap[]> {
    const renderPromises = sliceConfigs.map((config) => {
      const sliceViewState = this.createSliceViewState(
        baseViewState,
        config.viewType,
        config.sliceIndex,
      );
      return this.renderViewState(sliceViewState, config.viewType, config.width, config.height);
    });

    return Promise.all(renderPromises);
  }

  private createSliceViewState(
    baseViewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal',
    sliceIndex: number,
  ): ViewState {
    const sliceViewState = JSON.parse(JSON.stringify(baseViewState));

    const axisIndex = viewType === 'axial' ? 2 : viewType === 'sagittal' ? 0 : 1;

    // TODO: Get actual bounds from volume metadata
    const bounds = {
      min: [-96, -132, -78],
      max: [96, 96, 114],
    };

    const range = bounds.max[axisIndex] - bounds.min[axisIndex];
    const totalSlices = Math.ceil(range);
    const slicePosition = bounds.min[axisIndex] + (sliceIndex * range) / totalSlices;

    const newCrosshair = [...sliceViewState.crosshair.world_mm];
    newCrosshair[axisIndex] = slicePosition;
    sliceViewState.crosshair.world_mm = newCrosshair;

    return sliceViewState;
  }

  // ── Feature flag setters (delegate to renderFlags singleton) ───────────────

  setBinaryIPC(enable: boolean) {
    renderFlags.useBinaryIPC = enable;
    apiDebugLog(`[ApiService] Binary IPC ${enable ? 'enabled' : 'disabled'}`);
  }

  setRawRGBA(enable: boolean) {
    renderFlags.useRawRGBA = enable;
    apiDebugLog(`[ApiService] Raw RGBA transfer ${enable ? 'enabled' : 'disabled'}`);
  }

  setDebugBrighten(enable: boolean) {
    renderFlags.debugBrighten = enable;
    apiDebugLog(`[ApiService] Debug brightening ${enable ? 'enabled' : 'disabled'}`);
  }

  /**
   * Create a new isolated render session
   */
  createRenderSession(sessionId?: string): RenderSession {
    return createRenderSession(this, sessionId);
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let globalApiService: ApiService | null = null;

export function getApiService(): ApiService {
  if (!globalApiService) {
    globalApiService = new ApiService();
  }
  return globalApiService;
}

export function setApiService(apiService: ApiService) {
  globalApiService = apiService;
}

// ── Module-level setters (delegate to renderFlags) ────────────────────────────

export function setBinaryIPC(enable: boolean) {
  renderFlags.useBinaryIPC = enable;
  apiDebugLog(`[ApiService] Binary IPC ${enable ? 'enabled' : 'disabled'}`);
}

export function setRawRGBA(enable: boolean) {
  renderFlags.useRawRGBA = enable;
  apiDebugLog(`[ApiService] Raw RGBA transfer ${enable ? 'enabled' : 'disabled'}`);
}

export function setDebugBrighten(enable: boolean) {
  renderFlags.debugBrighten = enable;
  apiDebugLog(`[ApiService] Debug brightening ${enable ? 'enabled' : 'disabled'}`);
}

// Window globals are registered in RenderFeatureFlags.ts
// Also expose getApiService for debugging
if (typeof window !== 'undefined') {
  (window as any).getApiService = getApiService;
}
