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
import type { WorldCoordinates, ViewPlane } from '@/types/coordinates';
import type { VolumeBounds } from '@brainflow/api';
import { useRenderStore } from '@/stores/renderStore';
import type { RustViewState } from '@/types/rustViewState';
import { isValidRustViewState } from '@/types/rustViewState';
import { RenderSession, createRenderSession } from './RenderSession';

export interface VolumeHandle {
  id: string;
  name: string;
  dims: [number, number, number];
  dtype: string;
}

export interface FileNode {
  id: string;
  name: string;
  isDir: boolean;
  parentIdx: number | null;
  iconId: number;
}

export interface SampleResult {
  value: number;
  coordinate: WorldCoordinates;
}

export class ApiService {
  private transport: BackendTransport;
  private lastLayerState: string = ''; // Track last layer state to avoid redundant updates
  // Feature flag to enable binary IPC optimization
  private useBinaryIPC: boolean = true; // Set to false to revert to slow JSON path
  private useRawRGBA: boolean = true; // Set to true to use raw RGBA instead of PNG
  private debugBrighten: boolean = false; // Set to true to artificially brighten raw RGBA for debugging
  private useNewRenderAPI: boolean = true; // Use the new cleaner render_view API
  
  // Note: Render target state is now managed by RenderCoordinator
  
  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
    console.log(`[ApiService] Initialized with unified render_view API (RGBA mode: ${this.useRawRGBA ? 'ENABLED' : 'DISABLED'})`);
  }
  
  /**
   * Apply view state and render - the core operation
   * Currently the backend only handles crosshair in apply_and_render_view_state,
   * so we need to handle layers separately for now.
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
    
    // Check if render target is ready (now managed by RenderCoordinator)
    const renderStore = useRenderStore.getState();
    if (renderStore.shouldBlockRender()) {
      console.warn('[ApiService] Blocking render - render target not ready');
      console.log('  Render target state:', renderStore.getRenderTargetState());
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#2a2a2a'; // Slightly lighter to indicate render target issue
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#666';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Render target not ready', width / 2, height / 2);
      }
      return createImageBitmap(canvas);
    }
    
    // CRITICAL: Early validation - don't send empty ViewState to backend
    if (!viewState.layers || viewState.layers.length === 0) {
      console.warn('[ApiService] No layers in ViewState - returning empty image');
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1a1a1a'; // Dark background
        ctx.fillRect(0, 0, width, height);
      }
      return createImageBitmap(canvas);
    }
    
    // Format the ViewState for the declarative API
    // The backend expects specific format with frame parameters embedded
    const visibleLayers = viewState.layers.filter(l => l.visible && l.opacity > 0);
    console.log(`[ApiService ${performance.now() - startTime}ms] Filtered to ${visibleLayers.length} visible layers`);
    
    if (visibleLayers.length === 0) {
      console.warn(`[ApiService] WARNING: No visible layers to render! Returning empty image`);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1a1a1a'; // Dark background
        ctx.fillRect(0, 0, width, height);
      }
      return createImageBitmap(canvas);
    }
    
    // Handle slice override if provided - only modify crosshair position
    let crosshairToUse = viewState.crosshair;
    let viewsToUse = viewState.views;
    
    if (sliceOverride && viewType) {
      // Create a copy of the crosshair with the overridden slice position
      const axisIndex = sliceOverride.axis === 'x' ? 0 : sliceOverride.axis === 'y' ? 1 : 2;
      const newWorldMm = [...viewState.crosshair.world_mm];
      newWorldMm[axisIndex] = sliceOverride.position;
      
      // Only update crosshair, let backend calculate view origin
      crosshairToUse = {
        ...viewState.crosshair,
        world_mm: newWorldMm
      };
      
      console.log(`[ApiService] Using slice override: ${sliceOverride.axis}=${sliceOverride.position}mm`);
      console.log(`[ApiService] Original crosshair: [${viewState.crosshair.world_mm}]`);
      console.log(`[ApiService] Modified crosshair: [${newWorldMm}]`);
    }
    
    const declarativeViewState = {
      views: viewsToUse,
      crosshair: crosshairToUse,
      layers: visibleLayers.map(layer => {
        console.log(`[ApiService] DEBUG: Converting layer for backend:`, {
          id: layer.id,
          volumeId: layer.volumeId,
          isSame: layer.id === layer.volumeId
        });
        return {
          id: layer.id,  // Add the id field expected by backend
          volumeId: layer.volumeId,  // Use camelCase to match backend expectation
          colormap: layer.colormap,
          blendMode: layer.blendMode || 'alpha',
          opacity: layer.opacity,
          intensity: layer.intensity,
          threshold: layer.threshold,
          interpolation: layer.interpolation || 'linear',  // Add interpolation support
          visible: true  // Always true since we pre-filtered for visible layers
        };
      })
    };
    
    // // Log the layer properties being sent to backend
    // console.log(`[ApiService] Layer properties being sent to backend:`);
    // declarativeViewState.layers.forEach(layer => {
    //   console.log(`  Layer ${layer.id}:`, {
    //     colormap: layer.colormap,
    //     opacity: layer.opacity,
    //     intensity: layer.intensity,
    //     threshold: layer.threshold
    //   });
    // });
    
    // If a specific view is requested, add frame parameters
    if (viewType && viewsToUse[viewType]) {
      const view = viewsToUse[viewType];
      // Add the specific view's frame parameters to be used by backend
      // IMPORTANT: The shader expects u_mm and v_mm to represent the total extent
      // of the view, not per-pixel vectors. We must scale by viewport dimensions.
      declarativeViewState.requestedView = {
        type: viewType,
        origin_mm: [...view.origin_mm, 1.0],
        // Scale per-pixel vectors by viewport dimensions to get total extent
        // The shader expects view vectors that represent the total world extent,
        // not per-pixel displacement
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
    
    // Log the original view vectors before scaling
    if (viewType && viewsToUse[viewType]) {
      const view = viewsToUse[viewType];
      console.log(`  - Original view vectors (per-pixel):`, {
        u_mm: view.u_mm,
        v_mm: view.v_mm,
        dim_px: view.dim_px
      });
    }
    
    console.log(`  - Full ViewState:`, JSON.stringify(declarativeViewState, null, 2));
    
    // Note: Render target dimension validation is now handled by RenderCoordinator
    
    const backendCallTime = performance.now();
    let imageData: Uint8Array;
    
    // Track which format we're actually using for decoding
    let isRawRGBAFormat = false;
    
    // NEW UNIFIED API PATH
    if (this.useNewRenderAPI) {
      const format = this.useRawRGBA ? 'rgba' : 'png';
      try {
        console.log(`[ApiService] Attempting render_view with format: ${format}`);
        const result = await this.transport.invoke<Uint8Array>(
          'render_view',
          { 
            stateJson: JSON.stringify(declarativeViewState),
            format: format
          }
        );
        
        console.log(`[ApiService] render_view completed in ${(performance.now() - backendCallTime).toFixed(0)}ms (${format})`);
        
        // Robust result handling
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
          throw new Error(`render_view returned invalid or empty result: ${typeof result}, length: ${result?.length || 'N/A'}`);
        }
      } catch (error) {
        console.error(`[ApiService] render_view failed:`, error);
        console.error(`[ApiService] Error type: ${error?.constructor?.name}`);
        console.error(`[ApiService] Error message: ${error?.message}`);
        
        // Don't permanently disable new API - allow retries
        console.warn(`[ApiService] Falling back to legacy API for this request only`);
        // Note: NOT setting this.useNewRenderAPI = false permanently
      }
    }
    
    // LEGACY API PATHS - Only if render_view failed or not using new API
    if (!imageData && this.useRawRGBA) {
      try {
        console.log(`[ApiService] Attempting legacy raw RGBA fallback`);
        const rawResult = await this.transport.invoke<Uint8Array>(
          'apply_and_render_view_state_raw',
          { viewStateJson: JSON.stringify(declarativeViewState) }
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
    }
    
    // Final PNG fallback
    if (!imageData) {
      try {
        console.log(`[ApiService] Attempting final PNG fallback`);
        const pngResult = await this.transport.invoke<Uint8Array>(
          'apply_and_render_view_state_binary',
          { viewStateJson: JSON.stringify(declarativeViewState) }
        );
        
        if (pngResult instanceof Uint8Array && pngResult.length > 0) {
          imageData = pngResult;
          isRawRGBAFormat = false; // PNG format
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
        throw new Error(`Complete rendering failure: ${error?.message}`);
      }
    }
    
    // Check if we got valid data
    if (!imageData || imageData.length === 0) {
      console.error('❌ Backend returned empty image data!');
      console.error('❌ This means the backend render failed completely');
      console.error('❌ View state sent:', declarativeViewState);
      console.error('❌ isRawRGBAFormat:', isRawRGBAFormat);
      console.error('❌ useRawRGBA:', this.useRawRGBA);
      console.error('❌ useNewRenderAPI:', this.useNewRenderAPI);
      // Return a red error image
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Backend Error: No Data', width/2, height/2);
      }
      return createImageBitmap(canvas);
    }
    
    // Log the data type and size
    console.log(`📍 [Decoding Section] Starting decode with:`);
    console.log(`  Image data type: ${Object.prototype.toString.call(imageData)}`);
    console.log(`  Image data size: ${imageData?.length || 'undefined'} bytes`);
    console.log(`  isRawRGBAFormat: ${isRawRGBAFormat}`);
    console.log(`  useRawRGBA: ${this.useRawRGBA}`);
    
    // Defensive byteArray assignment
    const byteArray = imageData;
    
    // Comprehensive validation before proceeding
    if (!byteArray || !(byteArray instanceof Uint8Array) || byteArray.length === 0) {
      console.error(`[ApiService] CRITICAL: Invalid imageData received`);
      console.error(`[ApiService] imageData type: ${typeof imageData}`);
      console.error(`[ApiService] imageData constructor: ${imageData?.constructor?.name}`);
      console.error(`[ApiService] imageData length: ${imageData?.length}`);
      console.error(`[ApiService] isRawRGBAFormat: ${isRawRGBAFormat}`);
      throw new Error(`Invalid or empty image data received from backend`);
    }
    
    console.log(`[ApiService] Processing valid byteArray: ${byteArray.length} bytes, format: ${isRawRGBAFormat ? 'RGBA' : 'PNG'}`);
    
    // Check if this is raw RGBA data or PNG
    let bitmap: ImageBitmap;
    
    // Debug: Log the first few bytes to understand the format
    console.log(`🔍 First 16 bytes (hex): ${Array.from(byteArray.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    console.log(`🔍 Processing data: ${byteArray.length} bytes, isRawRGBA: ${isRawRGBAFormat}`);
    
    if (isRawRGBAFormat && byteArray.length > 8) {
      try {
        // Raw RGBA data format: [width: u32][height: u32][rgba_data...]
        const view = new DataView(byteArray.buffer, byteArray.byteOffset);
        const width = view.getUint32(0, true);  // little-endian
        const height = view.getUint32(4, true); // little-endian
        
        // Sanity check dimensions
        if (width > 10000 || height > 10000 || width === 0 || height === 0) {
          console.error(`❌ Invalid dimensions read from raw RGBA header: ${width}x${height}`);
          console.error(`❌ This suggests we're not getting raw RGBA format`);
          throw new Error(`Invalid raw RGBA dimensions: ${width}x${height}`);
        }
        
        const rgbaData = byteArray.slice(8);
        
        console.log(`🚀 Raw RGBA dimensions: ${width}x${height}, data size: ${rgbaData.length} bytes`);
        console.log(`🚀 Expected size: ${width * height * 4} bytes`);
        
        // Validate dimensions
        if (rgbaData.length !== width * height * 4) {
          console.error(`❌ Invalid raw RGBA data: expected ${width * height * 4} bytes, got ${rgbaData.length}`);
          console.error(`❌ This likely means we're getting PNG data instead of raw RGBA`);
          // Don't fall back to PNG decoding - return error
          throw new Error(`Raw RGBA validation failed: size mismatch. Expected ${width * height * 4}, got ${rgbaData.length}`);
        } else {
          let processedRgba = rgbaData;
          
          // Optional debug brightening to diagnose very dark images
          if (this.debugBrighten) {
            console.log(`🔆 DEBUG: Artificially brightening raw RGBA data`);
            const brightenedRgba = new Uint8ClampedArray(rgbaData.length);
            const brightenFactor = 10; // Multiply RGB values by this factor
            
            for (let i = 0; i < rgbaData.length; i += 4) {
              // Brighten RGB channels, preserve alpha
              brightenedRgba[i]   = Math.min(255, rgbaData[i] * brightenFactor);   // R
              brightenedRgba[i+1] = Math.min(255, rgbaData[i+1] * brightenFactor); // G
              brightenedRgba[i+2] = Math.min(255, rgbaData[i+2] * brightenFactor); // B
              brightenedRgba[i+3] = rgbaData[i+3];                                 // A (unchanged)
            }
            processedRgba = brightenedRgba;
          }
          
          // Create ImageData from raw RGBA
          const imageData = new ImageData(new Uint8ClampedArray(processedRgba), width, height);
          
          // Convert to ImageBitmap using default browser color space handling
          // This allows the browser to properly convert from linear RGB to sRGB
          // and handle alpha premultiplication correctly
          bitmap = await createImageBitmap(imageData);
          console.log(`🚀 Successfully created ImageBitmap from raw RGBA data (using browser defaults for color space and alpha)`);
          return bitmap;
        }
      } catch (error) {
        console.error('❌ Raw RGBA decoding failed:', error);
        console.error('❌ Data might be corrupted or in wrong format');
        // Re-throw the error to propagate it up
        throw error;
      }
    }
    
    if (!isRawRGBAFormat) {
      // Handle PNG format
      const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      const first8Bytes = Array.from(byteArray.slice(0, 8));
      const isPNG = pngSignature.every((byte, i) => byte === first8Bytes[i]);
      
      if (!isPNG) {
        console.error('🔍 PNG signature validation failed');
        console.error('🔍 Expected:', pngSignature.map(b => b.toString(16).padStart(2, '0')).join(' '));
        console.error('🔍 Actual:', first8Bytes.map(b => b.toString(16).padStart(2, '0')).join(' '));
        
        // Try to detect if this might be raw RGBA that slipped through
        if (byteArray.length > 8) {
          const view = new DataView(byteArray.buffer, byteArray.byteOffset);
          const possibleWidth = view.getUint32(0, true);
          const possibleHeight = view.getUint32(4, true);
          
          if (possibleWidth > 0 && possibleWidth < 10000 && 
              possibleHeight > 0 && possibleHeight < 10000) {
            console.warn('🔍 Data appears to be raw RGBA despite PNG expectation - attempting recovery');
            isRawRGBAFormat = true;
            
            try {
              const rgbaData = byteArray.slice(8);
              const imageData = new ImageData(new Uint8ClampedArray(rgbaData), possibleWidth, possibleHeight);
              bitmap = await createImageBitmap(imageData);
              return bitmap;
            } catch (recoveryError) {
              throw new Error(`Format detection failed and recovery attempt unsuccessful: ${recoveryError.message}`);
            }
          } else {
            throw new Error(`Data is not valid PNG and doesn't appear to be raw RGBA either`);
          }
        } else {
          throw new Error(`Data too short to be valid PNG or raw RGBA: ${byteArray.length} bytes`);
        }
      } else {
        // Valid PNG
        try {
          const blob = new Blob([byteArray], { type: 'image/png' });
          bitmap = await createImageBitmap(blob);
          console.log(`🔍 PNG processed successfully: ${bitmap.width}x${bitmap.height}`);
          return bitmap;
        } catch (error) {
          throw new Error(`PNG decoding failed: ${error.message}`);
        }
      }
    }
    
    // We should have a valid bitmap by now
    if (!bitmap) {
      throw new Error('Failed to create bitmap from image data');
    }
    
    return bitmap;
  }
  
  /**
   * Convert colormap name to ID
   */
  private getColormapId(colormap: string): number {
    const colormapIds: Record<string, number> = {
      'gray': 0,
      'hot': 1,
      'cool': 2,
      'red-yellow': 3,
      'blue-lightblue': 4,
      'red': 5,
      'green': 6,
      'blue': 7,
      'yellow': 8,
      'cyan': 9,
      'magenta': 10,
      'warm': 11,
      'cool-warm': 12,
      'spectral': 13,
      'turbo': 14
    };
    return colormapIds[colormap] || 0;
  }
  
  /**
   * Load a volume file
   */
  async loadFile(path: string): Promise<VolumeHandle> {
    return this.transport.invoke<VolumeHandle>('load_file', { path });
  }
  
  /**
   * Get volume bounds in world space
   */
  async getVolumeBounds(volumeId: string): Promise<VolumeBounds> {
    return this.transport.invoke<VolumeBounds>('get_volume_bounds', { volumeId });
  }
  
  /**
   * Get initial views for a volume, properly calculated by the backend
   */
  async getInitialViews(volumeId: string, maxPx: [number, number]): Promise<Record<string, ViewPlane>> {
    const result = await this.transport.invoke<Record<string, any>>('get_initial_views', { 
      volumeId, 
      maxPx 
    });
    
    // Convert backend ViewRectMm format to frontend ViewPlane format
    const views: Record<string, ViewPlane> = {};
    for (const [orientation, viewRect] of Object.entries(result)) {
      views[orientation] = {
        origin_mm: viewRect.origin_mm,
        u_mm: viewRect.u_mm,
        v_mm: viewRect.v_mm,
        dim_px: [viewRect.width_px, viewRect.height_px]
      };
    }
    return views;
  }
  
  /**
   * Recalculate view for new dimensions using backend logic
   * This ensures views always show the full anatomical extent
   */
  async recalculateViewForDimensions(
    volumeId: string,
    viewType: 'axial' | 'sagittal' | 'coronal',
    dimensions: [number, number],
    crosshairMm: [number, number, number]
  ): Promise<ViewPlane> {
    console.log(`[ApiService] recalculateViewForDimensions called:`, {
      volumeId,
      viewType,
      requestedDimensions: dimensions,
      crosshairMm,
      timestamp: performance.now()
    });
    
    const startTime = performance.now();
    
    // Log the exact request being sent to backend
    const request = {
      volumeId,
      viewType,
      dimensions: [dimensions[0], dimensions[1]],
      crosshairMm: [crosshairMm[0], crosshairMm[1], crosshairMm[2]]
    };
    console.log(`[ApiService] Sending to backend:`, JSON.stringify(request, null, 2));
    
    const result = await this.transport.invoke<any>('recalculate_view_for_dimensions', request);
    
    console.log(`[ApiService] Backend response received after ${(performance.now() - startTime).toFixed(1)}ms:`, {
      raw: result,
      hasOrigin: !!result.origin_mm,
      hasU: !!result.u_mm,
      hasV: !!result.v_mm,
      backendDimensions: result.width_px ? [result.width_px, result.height_px] : 'undefined'
    });
    
    // Log detailed backend response
    console.log(`[ApiService] Backend ViewRectMm details:`, {
      origin_mm: result.origin_mm,
      u_mm: result.u_mm,
      v_mm: result.v_mm,
      width_px: result.width_px,
      height_px: result.height_px,
      pixelSizes: {
        u: result.u_mm ? Math.hypot(...result.u_mm) : 'undefined',
        v: result.v_mm ? Math.hypot(...result.v_mm) : 'undefined'
      }
    });
    
    // Convert backend ViewRectMm format to frontend ViewPlane format
    const viewPlane = {
      origin_mm: result.origin_mm,
      u_mm: result.u_mm,
      v_mm: result.v_mm,
      dim_px: [result.width_px, result.height_px] as [number, number]
    };
    
    // CRITICAL LOG: Check if we're using backend dimensions vs requested dimensions
    console.log(`[ApiService] ⚠️ DIMENSION CHECK:`, {
      requested: dimensions,
      backendReturned: [result.width_px, result.height_px],
      usingBackendDims: true, // We're always using backend's calculated dimensions
      match: dimensions[0] === result.width_px && dimensions[1] === result.height_px
    });
    
    if (dimensions[0] !== result.width_px || dimensions[1] !== result.height_px) {
      // This is expected behavior - backend preserves aspect ratios and square pixels
      console.info(`[ApiService] 📐 Backend dimension adjustment: ${dimensions.join('×')} → ${result.width_px}×${result.height_px}`, {
        requestedDimensions: dimensions,
        actualDimensions: [result.width_px, result.height_px],
        reason: 'aspect ratio preservation and square pixel requirements',
        impactOnRendering: 'Using backend dimensions - this is expected medical imaging behavior',
        medicalImagingNote: 'Square pixels preserve anatomical proportions'
      });
    }
    
    console.log(`[ApiService] Returning ViewPlane:`, viewPlane);
    
    return viewPlane;
  }
  
  /**
   * List directory contents
   */
  async listDirectory(path: string, maxDepth = 1): Promise<FileNode[]> {
    const result = await this.transport.invoke<{ nodes: FileNode[] }>(
      'fs_list_directory',
      { path, maxDepth }
    );
    return result.nodes;
  }
  
  /**
   * Sample value at world coordinate
   */
  async sampleWorldCoordinate(worldCoord: WorldCoordinates): Promise<SampleResult> {
    return this.transport.invoke<SampleResult>(
      'sample_world_coordinate',
      { worldCoord }
    );
  }
  
  /**
   * Initialize render loop
   */
  async initRenderLoop(width: number, height: number): Promise<void> {
    return this.transport.invoke('init_render_loop', { width, height });
  }
  
  /**
   * Update frame parameters for synchronized view
   * Tells the backend about new view dimensions for proper aspect ratio handling
   */
  async updateFrameForSynchronizedView(
    viewWidthMm: number,
    viewHeightMm: number,
    crosshairWorld: [number, number, number],
    planeId: number
  ): Promise<void> {
    return this.transport.invoke('update_frame_for_synchronized_view', {
      viewWidthMm,
      viewHeightMm,
      crosshairWorld,
      planeId
    });
  }
  
  /**
   * Create offscreen render target
   * Note: This is now primarily called by RenderCoordinator
   */
  async createOffscreenRenderTarget(width: number, height: number): Promise<void> {
    // Validate dimensions
    if (!width || !height || width <= 0 || height <= 0 || width > 8192 || height > 8192) {
      const error = new Error(`Invalid render target dimensions: ${width}x${height}. Dimensions must be between 1 and 8192.`);
      console.error('[ApiService]', error.message);
      throw error;
    }
    
    console.log(`[ApiService] Creating offscreen render target: ${width}x${height}`);
    
    try {
      await this.transport.invoke('create_offscreen_render_target', { width, height });
      console.log(`[ApiService] Render target created successfully: ${width}x${height}`);
    } catch (error) {
      console.error('[ApiService] Failed to create render target:', error);
      throw error;
    }
  }
  
  /**
   * Check if render target is ready for rendering
   * @deprecated Global render targets removed - backend handles per-view render targets
   */
  isRenderTargetReady(): boolean {
    return useRenderStore.getState().isRenderTargetReady();
  }
  
  /**
   * Get current render target state
   * @deprecated Global render targets removed - backend handles per-view render targets
   */
  getRenderTargetState() {
    return useRenderStore.getState().getRenderTargetState();
  }
  
  /**
   * Resize canvas
   */
  async resizeCanvas(width: number, height: number): Promise<void> {
    return this.transport.invoke('resize_canvas', { width, height });
  }
  
  /**
   * Request GPU resources for a layer
   */
  async requestLayerGpuResources(layerId: string, volumeId: string, metadataOnly?: boolean): Promise<any> {
    console.log(`ApiService: Requesting GPU resources for layer ${layerId}, volume ${volumeId}, metadataOnly: ${metadataOnly}`);
    const result = await this.transport.invoke('request_layer_gpu_resources', { 
      layerSpec: {
        Volume: {
          id: layerId,
          source_resource_id: volumeId,  // Use snake_case for Rust compatibility
          colormap: 'gray'
        }
      },
      metadataOnly: metadataOnly || false
    });
    console.log('ApiService: GPU resources response:', result);
    return result;
  }
  
  /**
   * Release GPU resources for a layer
   */
  async releaseLayerGpuResources(layerId: string): Promise<void> {
    return this.transport.invoke('release_layer_gpu_resources', { layerId });
  }
  
  /**
   * Update layer properties
   */
  async patchLayer(layerId: string, patch: Record<string, any>): Promise<void> {
    // Tauri expects camelCase parameter names from JS and converts to snake_case for Rust
    return this.transport.invoke('patch_layer', { layerId, patch });
  }

  /**
   * Add a render layer
   * @deprecated Use layer service instead
   */
  async addRenderLayer(layerId: string, volumeId: string): Promise<void> {
    // This is a simplified mock for testing - the actual implementation
    // would need to manage texture atlas indices
    await this.transport.invoke('add_render_layer', { layerId, volumeId });
  }

  /**
   * Remove a render layer
   * @deprecated Use layer service instead
   */
  async removeRenderLayer(layerId: string): Promise<void> {
    await this.transport.invoke('remove_render_layer', { layerId });
  }
  
  /**
   * Query metadata about slices along a specific axis
   * Note: Uses the volume from the first visible layer as the reference
   */
  async querySliceAxisMeta(
    volumeId: string,
    axis: 'axial' | 'sagittal' | 'coronal'
  ): Promise<{
    sliceCount: number;
    sliceSpacing: number;
    axisLength: number;
  }> {
    console.log('[ApiService] Querying slice metadata:', { volumeId, axis });
    const result = await this.transport.invoke<{
      slice_count: number;
      slice_spacing: number;
      axis_length_mm: number;
    }>('query_slice_axis_meta', {
      volumeId: volumeId,  // Tauri automatically converts to snake_case
      axis
    });
    
    console.log('[ApiService] Slice metadata result:', result);
    
    // Convert snake_case to camelCase for frontend consistency
    return {
      sliceCount: result.slice_count,
      sliceSpacing: result.slice_spacing,
      axisLength: result.axis_length_mm
    };
  }
  
  /**
   * Batch render multiple slices for MosaicView
   * @param viewStates - Array of view states to render
   * @param widthPerSlice - Width of each slice in pixels
   * @param heightPerSlice - Height of each slice in pixels
   * @returns Raw RGBA buffer containing all rendered slices
   */
  async batchRenderSlices(
    viewStates: any[], // FrontendViewState[] - using any to avoid circular dependencies
    widthPerSlice: number,
    heightPerSlice: number
  ): Promise<ArrayBuffer> {
    // Transform FrontendViewState to render_loop ViewState format
    // The backend expects a specific JSON structure with different field names
    
    console.log(`[ApiService] batchRenderSlices called with ${viewStates.length} FrontendViewStates`);
    console.log('[ApiService] First ViewState:', JSON.stringify(viewStates[0], null, 2));
    
    // Transform each FrontendViewState to render_loop ViewState format
    const transformedViewStates = viewStates.map((fvs, idx) => {
      // Validate FrontendViewState structure
      if (!fvs.views || !fvs.crosshair || !fvs.layers) {
        throw new Error(`ViewState ${idx}: Missing required fields (views, crosshair, or layers)`);
      }
      
      // Get the single view (MosaicView only uses one axis at a time)
      const viewType = Object.keys(fvs.views)[0];
      const view = fvs.views[viewType];
      
      if (!view || !view.origin_mm || !view.u_mm || !view.v_mm) {
        throw new Error(`ViewState ${idx}: Invalid view structure for ${viewType}`);
      }
      
      // Get requestedView for render parameters
      const requestedView = fvs.requestedView;
      if (!requestedView) {
        throw new Error(`ViewState ${idx}: Missing requestedView`);
      }
      
      // Map colormap names to IDs
      const colormapNameToId = (name: string): number => {
        const colormapMap: Record<string, number> = {
          'gray': 0,
          'hot': 1,
          'cool': 2,
          'jet': 3,
          'viridis': 4,
          'plasma': 5,
          'inferno': 6,
          'magma': 7,
          'turbo': 8,
          'rainbow': 9,
          // Add more as needed
        };
        return colormapMap[name] || 0; // Default to gray
      };
      
      // Transform layers from FrontendViewState format to render_loop format
      const transformedLayers = fvs.layers.map((layer: any, layerIdx: number) => {
        // Validate layer
        if (!layer.volumeId || !layer.intensity || layer.intensity.length !== 2) {
          throw new Error(`ViewState ${idx}, Layer ${layerIdx}: Invalid layer structure`);
        }
        
        // Ensure intensity values are numbers
        const intensityMin = Number(layer.intensity[0]);
        const intensityMax = Number(layer.intensity[1]);
        
        if (isNaN(intensityMin) || isNaN(intensityMax)) {
          throw new Error(`ViewState ${idx}, Layer ${layerIdx}: Invalid intensity values`);
        }
        
        return {
          volume_id: layer.volumeId,  // camelCase to snake_case
          opacity: layer.opacity || 1.0,
          colormap_id: colormapNameToId(layer.colormap || 'gray'),
          blend_mode: layer.blendMode === 'alpha' ? 'Normal' : 'Normal', // Currently only Normal is supported
          intensity_window: [intensityMin, intensityMax], // Array format for JSON serialization
          // For batch_render_slices, we need to send threshold as null for Option<ThresholdConfig>
          // But apply_and_render_view_state_internal expects [f32; 2] array
          // Since batch_render_slices re-serializes and calls apply_and_render_view_state_internal,
          // we need to handle this mismatch temporarily
          threshold: null, // This will be re-serialized correctly by batch_render_slices
          visible: layer.visible !== false
        };
      });
      
      // Build render_loop ViewState structure
      const renderLoopViewState = {
        layout_version: 1,
        camera: {
          world_center: fvs.crosshair.world_mm,
          fov_mm: Math.max(
            Math.abs(requestedView.u_mm[0]) + Math.abs(requestedView.u_mm[1]) + Math.abs(requestedView.u_mm[2]),
            Math.abs(requestedView.v_mm[0]) + Math.abs(requestedView.v_mm[1]) + Math.abs(requestedView.v_mm[2])
          ),
          orientation: requestedView.type.charAt(0).toUpperCase() + requestedView.type.slice(1), // 'axial' -> 'Axial'
          frame_origin: requestedView.origin_mm.length === 3 
            ? [...requestedView.origin_mm, 1.0] 
            : requestedView.origin_mm,
          frame_u_vec: requestedView.u_mm,
          frame_v_vec: requestedView.v_mm
        },
        crosshair_world: fvs.crosshair.world_mm,
        layers: transformedLayers,
        viewport_size: [requestedView.width, requestedView.height],
        show_crosshair: false
      };
      
      console.log(`[ApiService] Transformed ViewState ${idx}:`, JSON.stringify(renderLoopViewState, null, 2));
      
      // Validate the transformed ViewState
      if (!isValidRustViewState(renderLoopViewState)) {
        console.error('[ApiService] Invalid ViewState structure:', renderLoopViewState);
        throw new Error(`ViewState ${idx} does not match Rust structure`);
      }
      
      return renderLoopViewState as RustViewState;
    });
    
    // Serialize with proper JSON format for Rust deserialization
    // Note: We need to ensure tuples are serialized as arrays
    const viewStatesJson = JSON.stringify(transformedViewStates, (key, value) => {
      // Convert intensity_window arrays to ensure proper serialization
      if (key === 'intensity_window' && Array.isArray(value) && value.length === 2) {
        return value; // Keep as array for JSON
      }
      return value;
    });
    
    console.log('[ApiService] Batch render request with', transformedViewStates.length, 'slices');
    console.log('[ApiService] Transformed ViewStates JSON preview:', viewStatesJson.substring(0, 500) + '...');
    
    // Add detailed validation and logging
    try {
      // Test parse to catch issues early
      const testParse = JSON.parse(viewStatesJson);
      console.log('[ApiService] JSON validation passed. Structure:', {
        arrayLength: testParse.length,
        firstItem: testParse[0] ? {
          hasLayoutVersion: 'layout_version' in testParse[0],
          hasCamera: 'camera' in testParse[0],
          hasLayers: 'layers' in testParse[0],
          layersCount: testParse[0].layers?.length,
          firstLayer: testParse[0].layers?.[0] ? {
            hasThreshold: 'threshold' in testParse[0].layers[0],
            thresholdValue: testParse[0].layers[0].threshold,
            thresholdType: typeof testParse[0].layers[0].threshold
          } : null
        } : null
      });
      
      // Log the full JSON for debugging (only in development)
      if (transformedViewStates.length <= 3) {
        console.log('[ApiService] Full ViewStates JSON:', JSON.stringify(testParse, null, 2));
      }
    } catch (e) {
      console.error('[ApiService] Invalid JSON generated:', e);
      console.error('[ApiService] JSON string that failed:', viewStatesJson);
      throw new Error(`Failed to generate valid JSON: ${e.message}`);
    }
    
    // Call the batch render command
    // Note: Tauri converts top-level param names (batchRequest → batch_request)
    // but NOT field names inside objects - those must match Rust struct exactly
    const response = await this.transport.invoke<ArrayBuffer>('batch_render_slices', {
      batchRequest: {
        view_states_json: viewStatesJson,
        width_per_slice: widthPerSlice,
        height_per_slice: heightPerSlice
      }
    });
    
    return response;
  }
  
  /**
   * Apply view state and render a specific view
   * This is the method that useServicesInit expects
   */
  async applyAndRenderViewState(
    viewState: ViewState, 
    viewType: 'axial' | 'sagittal' | 'coronal',
    width?: number,
    height?: number
  ): Promise<ImageBitmap | null> {
    try {
      // Use provided dimensions or default to 512x512
      const renderWidth = width ?? 512;
      const renderHeight = height ?? 512;
      
      // Call the core method with all parameters
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
   * Part of the new architecture to reduce event-based brittleness
   */
  async renderViewState(
    viewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal',
    width = 512,
    height = 512
  ): Promise<ImageBitmap> {
    // Call the core method directly - no event emission
    return this.applyAndRenderViewStateCore(viewState, viewType, width, height);
  }
  
  /**
   * Promise-based batch rendering for MosaicView
   * Returns an array of ImageBitmaps for multiple slice indices
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
      // Clone view state and modify for this specific slice
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
  
  /**
   * Helper to create a view state for a specific slice index
   * Used by batch rendering operations
   */
  private createSliceViewState(
    baseViewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal',
    sliceIndex: number
  ): ViewState {
    // Clone the base view state
    const sliceViewState = JSON.parse(JSON.stringify(baseViewState));
    
    // Calculate slice position based on volume bounds and slice index
    // This logic will be refined based on actual volume metadata
    const axisIndex = viewType === 'axial' ? 2 : viewType === 'sagittal' ? 0 : 1;
    
    // TODO: Get actual bounds from volume metadata
    // For now, use reasonable defaults
    const bounds = {
      min: [-96, -132, -78],
      max: [96, 96, 114]
    };
    
    const range = bounds.max[axisIndex] - bounds.min[axisIndex];
    const totalSlices = Math.ceil(range); // Assuming 1mm spacing
    const slicePosition = bounds.min[axisIndex] + (sliceIndex * range / totalSlices);
    
    // Update crosshair position for this slice
    const newCrosshair = [...sliceViewState.crosshair.world_mm];
    newCrosshair[axisIndex] = slicePosition;
    sliceViewState.crosshair.world_mm = newCrosshair;
    
    return sliceViewState;
  }
  
  /**
   * Enable or disable binary IPC optimization
   * @param enable - true to use binary IPC (fast), false to use JSON (slow)
   */
  setBinaryIPC(enable: boolean) {
    this.useBinaryIPC = enable;
    console.log(`[ApiService] Binary IPC ${enable ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Enable or disable raw RGBA transfer (skips PNG encoding)
   * @param enable - true to use raw RGBA (fastest), false to use PNG
   */
  setRawRGBA(enable: boolean) {
    this.useRawRGBA = enable;
    console.log(`[ApiService] Raw RGBA transfer ${enable ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Enable or disable debug brightening for raw RGBA (diagnostic tool)
   * @param enable - true to artificially brighten raw RGBA data
   */
  setDebugBrighten(enable: boolean) {
    this.debugBrighten = enable;
    console.log(`[ApiService] Debug brightening ${enable ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Enable or disable the new unified render_view API
   * @param enable - true to use new API, false to use legacy apply_and_render methods
   */
  setUseNewRenderAPI(enable: boolean) {
    this.useNewRenderAPI = enable;
    console.log(`[ApiService] New render_view API ${enable ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Create a new isolated render session
   * Part of the new architecture for better render isolation
   */
  createRenderSession(sessionId?: string): RenderSession {
    return createRenderSession(this, sessionId);
  }
}

// Global API service instance
let globalApiService: ApiService | null = null;

/**
 * Get the global API service instance
 */
export function getApiService(): ApiService {
  if (!globalApiService) {
    globalApiService = new ApiService();
  }
  return globalApiService;
}

/**
 * Set the global API service (useful for testing)
 */
export function setApiService(apiService: ApiService) {
  globalApiService = apiService;
}

/**
 * Enable or disable binary IPC optimization globally
 * @param enable - true to use binary IPC (fast), false to use JSON (slow)
 */
export function setBinaryIPC(enable: boolean) {
  const apiService = getApiService();
  apiService.setBinaryIPC(enable);
}

/**
 * Enable or disable raw RGBA transfer globally
 * @param enable - true to use raw RGBA (fastest), false to use PNG
 */
export function setRawRGBA(enable: boolean) {
  const apiService = getApiService();
  apiService.setRawRGBA(enable);
}

/**
 * Enable or disable debug brightening globally
 * @param enable - true to artificially brighten raw RGBA data
 */
export function setDebugBrighten(enable: boolean) {
  const apiService = getApiService();
  apiService.setDebugBrighten(enable);
}

/**
 * Enable or disable the new unified render_view API globally
 * @param enable - true to use new API, false to use legacy apply_and_render methods
 */
export function setUseNewRenderAPI(enable: boolean) {
  const apiService = getApiService();
  apiService.setUseNewRenderAPI(enable);
}

// Export for debugging in console
if (typeof window !== 'undefined') {
  (window as any).setBinaryIPC = setBinaryIPC;
  (window as any).setRawRGBA = setRawRGBA;
  (window as any).setDebugBrighten = setDebugBrighten;
  (window as any).setUseNewRenderAPI = setUseNewRenderAPI;
  (window as any).getApiService = getApiService;
}