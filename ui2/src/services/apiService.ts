/**
 * API Service - High-level interface to backend commands
 * Uses the transport layer and provides typed methods
 *
 * MIGRATION GUIDE - New Unified render_view API:
 *
 * The backend now provides a cleaner render_view API that replaces the
 * confusing apply_and_render_view_state family of methods.
 *
 * To enable the new API:
 * - In code: setUseNewRenderAPI(true)
 * - In console: window.setUseNewRenderAPI(true)
 *
 * Benefits:
 * - Single method with format parameter instead of 3 variants
 * - Cleaner naming (render_view vs apply_and_render_view_state)
 * - Extensible to new formats
 * - Backward compatible - old methods still work
 *
 * The new API defaults to raw RGBA (fastest) but supports PNG as well.
 */

import type { BackendTransport } from './transport';
import { getTransport } from './transport';
import type { ViewState } from '@/types/viewState';
import type { WorldCoordinates, ViewPlane, ViewType } from '@/types/coordinates';
import type { VolumeBounds } from '@brainflow/api';
import { useRenderStore } from '@/stores/renderStore';
import { RenderSession, createRenderSession } from './RenderSession';
import { validateRenderViewPayload } from '@/utils/validateRenderViewPayload';
import type { AtlasStats } from '@/types/atlas';

// Domain service imports
import { renderFlags } from './render/RenderFeatureFlags';
import { getFilesystemService } from './filesystem/FilesystemService';
import { getVolumeApiService } from './volume/VolumeApiService';
import { getLayerGpuService } from './layer/LayerGpuService';
import { getRenderTargetService } from './renderTarget/RenderTargetService';
import { getBatchRenderService } from './mosaic/BatchRenderService';

// Re-export interfaces for backward compatibility
export type { VolumeHandle } from './volume/VolumeApiService';
export type { FileNode } from './filesystem/FilesystemService';
export type { SampleResult, NiftiHeaderInfo } from './volume/VolumeApiService';

export class ApiService {
  private transport: BackendTransport;
  private lastLayerState: string = '';

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
    console.log(`[ApiService] Initialized with unified render_view API (RGBA mode: ${renderFlags.useRawRGBA ? 'ENABLED' : 'DISABLED'})`);
  }

  /**
   * Apply view state and render - the core operation
   */
  async applyAndRenderViewStateCore(
    viewState: ViewState,
    viewType?: 'axial' | 'sagittal' | 'coronal',
    width = 512,
    height = 512,
    sliceOverride?: { axis: 'x' | 'y' | 'z'; position: number }
  ): Promise<ImageBitmap> {
    const startTime = performance.now();
    console.log(`[ApiService ${startTime.toFixed(0)}ms] applyAndRenderViewStateCore called`);
    console.log(`  - Total layers: ${viewState.layers.length}`);
    console.log(`  - ViewType: ${viewType || 'none'}`);
    console.log(`  - All layers:`, viewState.layers.map(l => ({
      id: l.id,
      volumeId: l.volumeId,
      visible: l.visible,
      opacity: l.opacity,
      intensity: l.intensity
    })));

    const renderStore = useRenderStore.getState();
    if (renderStore.shouldBlockRender()) {
      console.warn('[ApiService] Blocking render - render target not ready');
      console.log('  Render target state:', renderStore.getRenderTargetState());
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

    const visibleLayers = viewState.layers.filter(l => l.visible && l.opacity > 0);
    console.log(`[ApiService ${performance.now() - startTime}ms] Filtered to ${visibleLayers.length} visible layers`);

    if (visibleLayers.length === 0) {
      console.warn(`[ApiService] WARNING: No visible layers to render! Returning empty image`);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
      }
      return createImageBitmap(canvas);
    }

    let crosshairToUse = viewState.crosshair;
    let viewsToUse = viewState.views;

    if (sliceOverride && viewType) {
      const axisIndex = sliceOverride.axis === 'x' ? 0 : sliceOverride.axis === 'y' ? 1 : 2;
      const newWorldMm = [...viewState.crosshair.world_mm];
      newWorldMm[axisIndex] = sliceOverride.position;

      crosshairToUse = {
        ...viewState.crosshair,
        world_mm: newWorldMm
      };

      console.log(`[ApiService] Using slice override: ${sliceOverride.axis}=${sliceOverride.position}mm`);
      console.log(`[ApiService] Original crosshair: [${viewState.crosshair.world_mm}]`);
      console.log(`[ApiService] Modified crosshair: [${newWorldMm}]`);
    }

    const declarativeViewState: any = {
      views: viewsToUse,
      crosshair: crosshairToUse,
      layers: visibleLayers.map(layer => {
        console.log(`[ApiService] DEBUG: Converting layer for backend:`, {
          id: layer.id,
          volumeId: layer.volumeId,
          isSame: layer.id === layer.volumeId
        });
        return {
          id: layer.id,
          volumeId: layer.volumeId,
          colormap: layer.colormap,
          blendMode: layer.blendMode || 'alpha',
          opacity: layer.opacity,
          intensity: layer.intensity,
          threshold: layer.threshold,
          interpolation: layer.interpolation || 'linear',
          visible: true
        };
      })
    };

    if (viewType && viewsToUse[viewType]) {
      const view = viewsToUse[viewType];
      declarativeViewState.requestedView = {
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

    console.log(`[ApiService ${performance.now() - startTime}ms] Sending to backend:`);
    console.log(`  - layers in JSON: ${declarativeViewState.layers.length}`);
    console.log(`  - View vectors:`, {
      u_mm: declarativeViewState.requestedView?.u_mm,
      v_mm: declarativeViewState.requestedView?.v_mm,
      width: declarativeViewState.requestedView?.width,
      height: declarativeViewState.requestedView?.height
    });

    if (viewType && viewsToUse[viewType]) {
      const view = viewsToUse[viewType];
      console.log(`  - Original view vectors (per-pixel):`, {
        u_mm: view.u_mm,
        v_mm: view.v_mm,
        dim_px: view.dim_px
      });
    }

    console.log(`  - Full ViewState:`, JSON.stringify(declarativeViewState, null, 2));

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

    const backendCallTime = performance.now();
    let imageData: Uint8Array | undefined;
    let isRawRGBAFormat = false;

    // NEW UNIFIED API PATH
    if (renderFlags.useNewRenderAPI) {
      const format = renderFlags.useRawRGBA ? 'rgba' : 'png';
      try {
        console.log(`[ApiService] Attempting render_view with format: ${format}`);
        const result = await this.transport.invoke<Uint8Array>('render_view', {
          stateJson: JSON.stringify(declarativeViewState),
          format
        });

        console.log(`[ApiService] render_view completed in ${(performance.now() - backendCallTime).toFixed(0)}ms (${format})`);

        if (result instanceof Uint8Array && result.length > 0) {
          imageData = result;
          isRawRGBAFormat = (format === 'rgba');
          console.log(`[ApiService] render_view success: ${imageData.length} bytes, format: ${format}`);
        } else if (result instanceof ArrayBuffer && result.byteLength > 0) {
          imageData = new Uint8Array(result);
          isRawRGBAFormat = (format === 'rgba');
          console.log(`[ApiService] render_view success (ArrayBuffer): ${imageData.length} bytes`);
        } else if (Array.isArray(result) && result.length > 0) {
          imageData = new Uint8Array(result);
          isRawRGBAFormat = (format === 'rgba');
          console.log(`[ApiService] render_view success (Array): ${imageData.length} bytes`);
        } else {
          throw new Error(`render_view returned invalid or empty result: ${typeof result}, length: ${(result as any)?.length || 'N/A'}`);
        }
      } catch (error) {
        console.error(`[ApiService] render_view failed:`, error);
        console.error(`[ApiService] Error type: ${(error as any)?.constructor?.name}`);
        console.error(`[ApiService] Error message: ${(error as any)?.message}`);
        console.warn(`[ApiService] Falling back to legacy API for this request only`);
      }
    }

    // LEGACY API PATHS - Only if render_view failed or not using new API
    if (!imageData && renderFlags.legacyRenderFallbackEnabled && renderFlags.useRawRGBA) {
      try {
        console.log(`[ApiService] Attempting legacy raw RGBA fallback`);
        const rawResult = await this.transport.invoke<Uint8Array>(
          'apply_and_render_view_state_raw',
          { view_state_json: JSON.stringify(declarativeViewState) }
        );

        if (rawResult instanceof Uint8Array && rawResult.length > 0) {
          imageData = rawResult;
          isRawRGBAFormat = true;
          console.log(`[ApiService] Legacy raw RGBA success: ${imageData.length} bytes`);
        } else if (rawResult instanceof ArrayBuffer && rawResult.byteLength > 0) {
          imageData = new Uint8Array(rawResult);
          isRawRGBAFormat = true;
          console.log(`[ApiService] Legacy raw RGBA success (ArrayBuffer): ${imageData.length} bytes`);
        } else if (Array.isArray(rawResult) && rawResult.length > 0) {
          imageData = new Uint8Array(rawResult);
          isRawRGBAFormat = true;
          console.log(`[ApiService] Legacy raw RGBA success (Array): ${imageData.length} bytes`);
        } else {
          throw new Error(`Legacy raw command returned invalid result: ${typeof rawResult}`);
        }
      } catch (error) {
        console.error(`[ApiService] Legacy raw RGBA fallback failed:`, error);
      }
    } else if (!imageData && !renderFlags.legacyRenderFallbackEnabled) {
      console.warn('[ApiService] Legacy raw RGBA fallback skipped (disabled by configuration)');
    }

    // Final PNG fallback
    if (!imageData && renderFlags.legacyRenderFallbackEnabled) {
      try {
        console.log(`[ApiService] Attempting final PNG fallback`);
        const pngResult = await this.transport.invoke<Uint8Array>(
          'apply_and_render_view_state_binary',
          { view_state_json: JSON.stringify(declarativeViewState) }
        );

        if (pngResult instanceof Uint8Array && pngResult.length > 0) {
          imageData = pngResult;
          isRawRGBAFormat = false;
          console.log(`[ApiService] PNG fallback success: ${imageData.length} bytes`);
        } else if (pngResult instanceof ArrayBuffer && pngResult.byteLength > 0) {
          imageData = new Uint8Array(pngResult);
          isRawRGBAFormat = false;
          console.log(`[ApiService] PNG fallback success (ArrayBuffer): ${imageData.length} bytes`);
        } else if (Array.isArray(pngResult) && pngResult.length > 0) {
          imageData = new Uint8Array(pngResult);
          isRawRGBAFormat = false;
          console.log(`[ApiService] PNG fallback success (Array): ${imageData.length} bytes`);
        } else {
          throw new Error(`PNG fallback returned invalid result: ${typeof pngResult}`);
        }
      } catch (error) {
        console.error(`[ApiService] All rendering methods failed:`, error);
        throw new Error(`Complete rendering failure: ${(error as Error)?.message}`);
      }
    } else if (!imageData) {
      console.warn('[ApiService] PNG fallback skipped (legacy fallback disabled)');
    }

    if (!imageData || imageData.length === 0) {
      console.error('❌ Backend returned empty image data!');
      console.error('❌ This means the backend render failed completely');
      console.error('❌ View state sent:', declarativeViewState);
      console.error('❌ isRawRGBAFormat:', isRawRGBAFormat);
      console.error('❌ useRawRGBA:', renderFlags.useRawRGBA);
      console.error('❌ useNewRenderAPI:', renderFlags.useNewRenderAPI);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Backend Error: No Data', width / 2, height / 2);
      }
      return createImageBitmap(canvas);
    }

    return this.decodeImageBuffer(imageData, isRawRGBAFormat);
  }

  async decodeImageBuffer(imageData: Uint8Array, isRawRGBAFormat: boolean): Promise<ImageBitmap> {
    console.log(`📍 [Decoding Section] Starting decode with:`);
    console.log(`  Image data type: ${Object.prototype.toString.call(imageData)}`);
    console.log(`  Image data size: ${imageData?.length || 'undefined'} bytes`);
    console.log(`  isRawRGBAFormat: ${isRawRGBAFormat}`);
    console.log(`  useRawRGBA: ${renderFlags.useRawRGBA}`);

    if (!imageData || !(imageData instanceof Uint8Array) || imageData.length === 0) {
      console.error('[ApiService] CRITICAL: Invalid imageData received');
      console.error(`[ApiService] imageData type: ${typeof imageData}`);
      console.error(`[ApiService] imageData constructor: ${(imageData as any)?.constructor?.name}`);
      console.error(`[ApiService] imageData length: ${(imageData as any)?.length}`);
      console.error(`[ApiService] isRawRGBAFormat: ${isRawRGBAFormat}`);
      throw new Error('Invalid or empty image data received from backend');
    }

    const byteArray = imageData;
    console.log(`[ApiService] Processing valid byteArray: ${byteArray.length} bytes, format: ${isRawRGBAFormat ? 'RGBA' : 'PNG'}`);
    console.log(`🔍 First 16 bytes (hex): ${Array.from(byteArray.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    console.log(`🔍 Processing data: ${byteArray.length} bytes, isRawRGBA: ${isRawRGBAFormat}`);

    if (isRawRGBAFormat && byteArray.length > 8) {
      try {
        const view = new DataView(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
        const imgWidth = view.getUint32(0, true);
        const imgHeight = view.getUint32(4, true);

        if (imgWidth > 10000 || imgHeight > 10000 || imgWidth === 0 || imgHeight === 0) {
          console.error(`❌ Invalid dimensions read from raw RGBA header: ${imgWidth}x${imgHeight}`);
          throw new Error(`Invalid raw RGBA dimensions: ${imgWidth}x${imgHeight}`);
        }

        const rgbaData = byteArray.slice(8);
        console.log(`🚀 Raw RGBA dimensions: ${imgWidth}x${imgHeight}, data size: ${rgbaData.length} bytes`);

        if (rgbaData.length !== imgWidth * imgHeight * 4) {
          console.error(`❌ Invalid raw RGBA data: expected ${imgWidth * imgHeight * 4} bytes, got ${rgbaData.length}`);
          throw new Error(`Raw RGBA validation failed: size mismatch. Expected ${imgWidth * imgHeight * 4}, got ${rgbaData.length}`);
        }

        let processedRgba: Uint8Array | Uint8ClampedArray = rgbaData;
        if (renderFlags.debugBrighten) {
          console.log('🔆 DEBUG: Artificially brightening raw RGBA data');
          const brightenedRgba = new Uint8ClampedArray(rgbaData.length);
          const brightenFactor = 10;
          for (let i = 0; i < rgbaData.length; i += 4) {
            brightenedRgba[i] = Math.min(255, rgbaData[i] * brightenFactor);
            brightenedRgba[i + 1] = Math.min(255, rgbaData[i + 1] * brightenFactor);
            brightenedRgba[i + 2] = Math.min(255, rgbaData[i + 2] * brightenFactor);
            brightenedRgba[i + 3] = rgbaData[i + 3];
          }
          processedRgba = brightenedRgba;
        }

        const imageDataObj = new ImageData(new Uint8ClampedArray(processedRgba), imgWidth, imgHeight);
        const bitmap = await createImageBitmap(imageDataObj);
        console.log('🚀 Successfully created ImageBitmap from raw RGBA data (using browser defaults for color space and alpha)');
        return bitmap;
      } catch (error) {
        console.error('❌ Raw RGBA decoding failed:', error);
        throw error;
      }
    }

    if (!isRawRGBAFormat) {
      const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      const first8Bytes = Array.from(byteArray.slice(0, 8));
      const isPNG = pngSignature.every((byte, i) => byte === first8Bytes[i]);

      if (!isPNG) {
        console.error('🔍 PNG signature validation failed');
        console.error('🔍 Expected:', pngSignature.map(b => b.toString(16).padStart(2, '0')).join(' '));
        console.error('🔍 Actual:', first8Bytes.map(b => b.toString(16).padStart(2, '0')).join(' '));

        if (byteArray.length > 8) {
          const view = new DataView(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
          const possibleWidth = view.getUint32(0, true);
          const possibleHeight = view.getUint32(4, true);

          if (possibleWidth > 0 && possibleWidth < 10000 && possibleHeight > 0 && possibleHeight < 10000) {
            console.warn('🔍 Data appears to be raw RGBA despite PNG expectation - attempting recovery');
            const rgbaData = byteArray.slice(8);
            const imageDataObj = new ImageData(new Uint8ClampedArray(rgbaData), possibleWidth, possibleHeight);
            return createImageBitmap(imageDataObj);
          }
        }
        throw new Error(`Data is not valid PNG and doesn't appear to be raw RGBA either`);
      }

      try {
        const blob = new Blob([byteArray], { type: 'image/png' });
        const bitmap = await createImageBitmap(blob);
        console.log(`🔍 PNG processed successfully: ${bitmap.width}x${bitmap.height}`);
        return bitmap;
      } catch (error) {
        throw new Error(`PNG decoding failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error('Failed to create bitmap from image data');
  }

  // ── Filesystem delegation ──────────────────────────────────────────────────

  async listDirectory(path: string, maxDepth = 1): Promise<import('./filesystem/FilesystemService').FileNode[]> {
    return getFilesystemService().listDirectory(path, maxDepth);
  }

  // ── Volume delegation ──────────────────────────────────────────────────────

  async loadFile(path: string): Promise<import('./volume/VolumeApiService').VolumeHandle> {
    return getVolumeApiService().loadFile(path);
  }

  async getVolumeBounds(volumeId: string): Promise<VolumeBounds> {
    return getVolumeApiService().getVolumeBounds(volumeId);
  }

  async getNiftiHeaderInfo(volumeId: string): Promise<import('./volume/VolumeApiService').NiftiHeaderInfo> {
    return getVolumeApiService().getNiftiHeaderInfo(volumeId);
  }

  async getInitialViews(volumeId: string, maxPx: [number, number]): Promise<Record<string, ViewPlane>> {
    return getVolumeApiService().getInitialViews(volumeId, maxPx);
  }

  async recalculateViewForDimensions(
    volumeId: string,
    viewType: 'axial' | 'sagittal' | 'coronal',
    dimensions: [number, number],
    crosshairMm: [number, number, number]
  ): Promise<ViewPlane> {
    return getVolumeApiService().recalculateViewForDimensions(volumeId, viewType, dimensions, crosshairMm);
  }

  async recalculateAllViews(
    volumeId: string,
    dimensionsByView: Record<ViewType, [number, number]>,
    crosshairMm: [number, number, number]
  ): Promise<Record<ViewType, ViewPlane>> {
    return getVolumeApiService().recalculateAllViews(volumeId, dimensionsByView, crosshairMm);
  }

  async sampleWorldCoordinate(worldCoord: WorldCoordinates): Promise<import('./volume/VolumeApiService').SampleResult> {
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
    axis: 'axial' | 'sagittal' | 'coronal'
  ): Promise<{
    sliceCount: number;
    sliceSpacing: number;
    axisLength: number;
  }> {
    return getVolumeApiService().querySliceAxisMeta(volumeId, axis);
  }

  // ── Layer GPU delegation ───────────────────────────────────────────────────

  async requestLayerGpuResources(layerId: string, volumeId: string, metadataOnly?: boolean): Promise<any> {
    return getLayerGpuService().requestLayerGpuResources(layerId, volumeId, metadataOnly);
  }

  async releaseLayerGpuResources(layerId: string): Promise<void> {
    return getLayerGpuService().releaseLayerGpuResources(layerId);
  }

  async patchLayer(layerId: string, patch: Record<string, any>): Promise<void> {
    return getLayerGpuService().patchLayer(layerId, patch);
  }

  /**
   * @deprecated Use layer service instead
   */
  async addRenderLayer(layerId: string, volumeId: string): Promise<void> {
    return getLayerGpuService().addRenderLayer(layerId, volumeId);
  }

  /**
   * @deprecated Use layer service instead
   */
  async removeRenderLayer(layerId: string): Promise<void> {
    return getLayerGpuService().removeRenderLayer(layerId);
  }

  async getAtlasStats(): Promise<AtlasStats> {
    return getLayerGpuService().getAtlasStats();
  }

  // ── Render target delegation ───────────────────────────────────────────────

  async initRenderLoop(width: number, height: number): Promise<void> {
    return getRenderTargetService().initRenderLoop(width, height);
  }

  async createOffscreenRenderTarget(width: number, height: number): Promise<void> {
    return getRenderTargetService().createOffscreenRenderTarget(width, height);
  }

  async resizeCanvas(width: number, height: number): Promise<void> {
    return getRenderTargetService().resizeCanvas(width, height);
  }

  async updateFrameForSynchronizedView(
    viewWidthMm: number,
    viewHeightMm: number,
    crosshairWorld: [number, number, number],
    planeId: number
  ): Promise<void> {
    return getRenderTargetService().updateFrameForSynchronizedView(viewWidthMm, viewHeightMm, crosshairWorld, planeId);
  }

  /**
   * @deprecated Global render targets removed - backend handles per-view render targets
   */
  isRenderTargetReady(): boolean {
    return getRenderTargetService().isRenderTargetReady();
  }

  /**
   * @deprecated Global render targets removed - backend handles per-view render targets
   */
  getRenderTargetState() {
    return getRenderTargetService().getRenderTargetState();
  }

  // ── Batch render delegation ────────────────────────────────────────────────

  async batchRenderSlices(
    viewStates: any[],
    widthPerSlice: number,
    heightPerSlice: number
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
    height?: number
  ): Promise<ImageBitmap | null> {
    try {
      const renderWidth = width ?? 512;
      const renderHeight = height ?? 512;
      const result = await this.applyAndRenderViewStateCore(viewState, viewType, renderWidth, renderHeight);
      console.log(`[ApiService] applyAndRenderViewState result:`, {
        hasResult: !!result,
        isImageBitmap: result instanceof ImageBitmap,
        type: result ? Object.prototype.toString.call(result) : 'null'
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
    height = 512
  ): Promise<ImageBitmap> {
    return this.applyAndRenderViewStateCore(viewState, viewType, width, height);
  }

  async renderViewStateMulti(
    viewState: ViewState,
    viewTypes: ViewType[]
  ): Promise<Record<ViewType, ImageBitmap | null>> {
    const startTime = performance.now();
    const visibleLayers = viewState.layers.filter(layer => layer.visible && layer.opacity > 0);

    if (visibleLayers.length === 0) {
      console.warn('[ApiService] renderViewStateMulti called with no visible layers');
      const empty: Record<ViewType, ImageBitmap | null> = {
        axial: null,
        sagittal: null,
        coronal: null
      };
      return empty;
    }

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
      requestedViews: viewTypes.map((viewType) => {
        const view = viewState.views[viewType];
        if (!view) {
          throw new Error(`Requested view '${viewType}' missing from view state`);
        }
        const [w, h] = view.dim_px || [512, 512];
        return {
          type: viewType,
          origin_mm: [...view.origin_mm, 1.0] as [number, number, number, number],
          u_mm: [
            view.u_mm[0] * w,
            view.u_mm[1] * w,
            view.u_mm[2] * w,
            0.0
          ] as [number, number, number, number],
          v_mm: [
            view.v_mm[0] * h,
            view.v_mm[1] * h,
            view.v_mm[2] * h,
            0.0
          ] as [number, number, number, number],
          width: w,
          height: h
        };
      })
    };

    const validation = validateRenderViewPayload(payload);
    if (!validation.ok) {
      console.error('[ApiService] Invalid multi-view render payload detected:', validation.errors);
      throw new Error(`render_views payload validation failed: ${validation.errors.join('; ')}`);
    }

    const format = renderFlags.useRawRGBA ? 'rgba' : 'png';
    const response = await this.transport.invoke<Uint8Array>('render_views', {
      stateJson: JSON.stringify(payload),
      format
    });

    const byteArray = response instanceof Uint8Array ? response : new Uint8Array(response);
    if (byteArray.length < 4) {
      throw new Error('render_views returned an empty payload');
    }

    const viewCount = new DataView(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength).getUint32(0, true);
    let offset = 4;

    type ViewMeta = {
      viewType: ViewType;
      width: number;
      height: number;
      length: number;
    };

    const codeToView: Record<number, ViewType> = {
      0: 'axial',
      1: 'sagittal',
      2: 'coronal'
    };

    const segments: ViewMeta[] = [];
    for (let i = 0; i < viewCount; i++) {
      const code = byteArray[offset];
      offset += 1;
      const w = new DataView(byteArray.buffer, byteArray.byteOffset + offset, 4).getUint32(0, true);
      offset += 4;
      const h = new DataView(byteArray.buffer, byteArray.byteOffset + offset, 4).getUint32(0, true);
      offset += 4;
      const length = new DataView(byteArray.buffer, byteArray.byteOffset + offset, 4).getUint32(0, true);
      offset += 4;

      const vt = codeToView[code];
      if (!vt) {
        throw new Error(`Unknown view code returned from backend: ${code}`);
      }

      segments.push({ viewType: vt, width: w, height: h, length });
    }

    const results: Partial<Record<ViewType, ImageBitmap | null>> = {};

    for (const segment of segments) {
      const { viewType, width, height, length } = segment;
      const end = offset + length;
      if (end > byteArray.length) {
        throw new Error(`render_views payload truncated for view ${viewType}`);
      }

      const slice = byteArray.slice(offset, end);
      offset = end;

      try {
        let bitmap: ImageBitmap;
        if (format === 'rgba') {
          const buffer = new ArrayBuffer(8 + slice.length);
          const dv = new DataView(buffer);
          dv.setUint32(0, width, true);
          dv.setUint32(4, height, true);
          new Uint8Array(buffer, 8).set(slice);
          bitmap = await this.decodeImageBuffer(new Uint8Array(buffer), true);
        } else {
          bitmap = await this.decodeImageBuffer(slice, false);
        }
        results[viewType] = bitmap;
      } catch (error) {
        console.error(`[ApiService] Failed to decode ${viewType} view from render_views:`, error);
        results[viewType] = null;
      }
    }

    const elapsed = performance.now() - startTime;
    console.log(`[ApiService] renderViewStateMulti decoded ${segments.length} views in ${elapsed.toFixed(1)}ms`);

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
    }>
  ): Promise<ImageBitmap[]> {
    const renderPromises = sliceConfigs.map(config => {
      const sliceViewState = this.createSliceViewState(
        baseViewState,
        config.viewType,
        config.sliceIndex
      );
      return this.renderViewState(
        sliceViewState,
        config.viewType,
        config.width,
        config.height
      );
    });

    return Promise.all(renderPromises);
  }

  private createSliceViewState(
    baseViewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal',
    sliceIndex: number
  ): ViewState {
    const sliceViewState = JSON.parse(JSON.stringify(baseViewState));

    const axisIndex = viewType === 'axial' ? 2 : viewType === 'sagittal' ? 0 : 1;

    // TODO: Get actual bounds from volume metadata
    const bounds = {
      min: [-96, -132, -78],
      max: [96, 96, 114]
    };

    const range = bounds.max[axisIndex] - bounds.min[axisIndex];
    const totalSlices = Math.ceil(range);
    const slicePosition = bounds.min[axisIndex] + (sliceIndex * range / totalSlices);

    const newCrosshair = [...sliceViewState.crosshair.world_mm];
    newCrosshair[axisIndex] = slicePosition;
    sliceViewState.crosshair.world_mm = newCrosshair;

    return sliceViewState;
  }

  // ── Feature flag setters (delegate to renderFlags singleton) ───────────────

  setBinaryIPC(enable: boolean) {
    renderFlags.useBinaryIPC = enable;
    console.log(`[ApiService] Binary IPC ${enable ? 'enabled' : 'disabled'}`);
  }

  setRawRGBA(enable: boolean) {
    renderFlags.useRawRGBA = enable;
    console.log(`[ApiService] Raw RGBA transfer ${enable ? 'enabled' : 'disabled'}`);
  }

  setDebugBrighten(enable: boolean) {
    renderFlags.debugBrighten = enable;
    console.log(`[ApiService] Debug brightening ${enable ? 'enabled' : 'disabled'}`);
  }

  setUseNewRenderAPI(enable: boolean) {
    renderFlags.useNewRenderAPI = enable;
    console.log(`[ApiService] New render_view API ${enable ? 'enabled' : 'disabled'}`);
  }

  setLegacyRenderFallbackEnabled(enable: boolean) {
    renderFlags.legacyRenderFallbackEnabled = enable;
    console.log(`[ApiService] Legacy render fallbacks ${enable ? 'enabled' : 'disabled'}`);
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
  console.log(`[ApiService] Binary IPC ${enable ? 'enabled' : 'disabled'}`);
}

export function setRawRGBA(enable: boolean) {
  renderFlags.useRawRGBA = enable;
  console.log(`[ApiService] Raw RGBA transfer ${enable ? 'enabled' : 'disabled'}`);
}

export function setDebugBrighten(enable: boolean) {
  renderFlags.debugBrighten = enable;
  console.log(`[ApiService] Debug brightening ${enable ? 'enabled' : 'disabled'}`);
}

export function setUseNewRenderAPI(enable: boolean) {
  renderFlags.useNewRenderAPI = enable;
  console.log(`[ApiService] New render_view API ${enable ? 'enabled' : 'disabled'}`);
}

export function setLegacyRenderFallbackEnabled(enable: boolean) {
  renderFlags.legacyRenderFallbackEnabled = enable;
  console.log(`[ApiService] Legacy render fallbacks ${enable ? 'enabled' : 'disabled'}`);
}

// Window globals are registered in RenderFeatureFlags.ts
// Also expose getApiService for debugging
if (typeof window !== 'undefined') {
  (window as any).getApiService = getApiService;
}

