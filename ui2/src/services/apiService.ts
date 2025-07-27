/**
 * API Service - High-level interface to backend commands
 * Uses the transport layer and provides typed methods
 */

import type { BackendTransport } from './transport';
import { getTransport } from './transport';
import type { ViewState } from '@/types/viewState';
import type { WorldCoordinates, ViewPlane } from '@/types/coordinates';
import type { VolumeBounds } from '@brainflow/api';
import { useRenderStore } from '@/stores/renderStore';

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
  
  // Note: Render target state is now managed by RenderCoordinator
  
  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
    console.log(`[ApiService] Initialized with RGBA mode: ${this.useRawRGBA ? 'ENABLED' : 'DISABLED'}`);
  }
  
  /**
   * Apply view state and render - the core operation
   * Currently the backend only handles crosshair in apply_and_render_view_state,
   * so we need to handle layers separately for now.
   */
  async applyAndRenderViewStateCore(viewState: ViewState, viewType?: 'axial' | 'sagittal' | 'coronal', width = 512, height = 512): Promise<ImageBitmap> {
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
    
    const declarativeViewState = {
      views: viewState.views,
      crosshair: viewState.crosshair,
      layers: visibleLayers.map(layer => ({
        id: layer.id,  // Add the id field expected by backend
        volumeId: layer.volumeId,  // Use camelCase to match backend expectation
        colormap: layer.colormap,
        blendMode: layer.blendMode || 'alpha',
        opacity: layer.opacity,
        intensity: layer.intensity,
        threshold: layer.threshold,
        visible: true  // Always true since we pre-filtered for visible layers
      }))
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
    if (viewType && viewState.views[viewType]) {
      const view = viewState.views[viewType];
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
    if (viewType && viewState.views[viewType]) {
      const view = viewState.views[viewType];
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
    
    if (this.useRawRGBA) {
      // Use the raw RGBA command that avoids PNG encoding
      console.log(`🚀 [ApiService] RAW RGBA PATH - Calling apply_and_render_view_state_raw`);
      console.log(`🚀 [ApiService] This avoids PNG encoding entirely!`);
      try {
        const rawResult = await this.transport.invoke<Uint8Array>(
          'apply_and_render_view_state_raw',
          { viewStateJson: JSON.stringify(declarativeViewState) }
        );
        console.log(`🚀 [ApiService ${performance.now() - startTime}ms] SUCCESS: Raw RGBA returned after ${(performance.now() - backendCallTime).toFixed(0)}ms`);
        console.log(`🚀 [ApiService] Raw result type: ${Object.prototype.toString.call(rawResult)}`);
        console.log(`🚀 [ApiService] Is Uint8Array: ${rawResult instanceof Uint8Array}`);
        console.log(`🚀 [ApiService] Raw result:`, rawResult);
        
        // Convert to Uint8Array if needed
        if (rawResult instanceof Uint8Array) {
          imageData = rawResult;
        } else if (rawResult instanceof ArrayBuffer) {
          // Convert ArrayBuffer to Uint8Array
          console.log(`🚀 [ApiService] Converting ArrayBuffer to Uint8Array`);
          imageData = new Uint8Array(rawResult);
        } else if (rawResult && typeof rawResult === 'object' && 'data' in rawResult) {
          // Check if it's wrapped in an object
          console.log(`🚀 [ApiService] Result appears to be wrapped, extracting data property`);
          imageData = new Uint8Array(rawResult.data);
        } else if (Array.isArray(rawResult)) {
          // Convert array to Uint8Array
          console.log(`🚀 [ApiService] Converting array to Uint8Array`);
          imageData = new Uint8Array(rawResult);
        } else {
          console.error(`❌ [ApiService] Unexpected result type:`, typeof rawResult);
          throw new Error(`Raw RGBA returned unexpected type: ${typeof rawResult}`);
        }
        
        console.log(`🚀 [ApiService] Final data size: ${imageData?.length || 'undefined'} bytes`);
        
        // When using raw RGBA path, we should always get raw RGBA format
        // The backend is supposed to return raw RGBA when this command is used
        isRawRGBAFormat = true;
        console.log(`🚀 [ApiService] Set isRawRGBAFormat = true`);
        console.log(`🚀 [ApiService] Using raw RGBA format (as requested)`);
        
        // Optionally check if we accidentally got PNG
        if (imageData.length > 8 && imageData[0] === 0x89 && imageData[1] === 0x50) {
          console.warn(`⚠️ [ApiService] WARNING: Data appears to be PNG despite raw RGBA request!`);
          console.warn(`⚠️ [ApiService] Backend might not be honoring the raw RGBA flag`);
        }
      } catch (error) {
        console.error(`❌ [ApiService] RAW RGBA FAILED! Error:`, error);
        console.error(`❌ [ApiService] Falling back to binary PNG path...`);
        // Fall back to binary PNG path
        imageData = await this.transport.invoke<Uint8Array>(
          'apply_and_render_view_state_binary',
          { viewStateJson: JSON.stringify(declarativeViewState) }
        );
      }
    } else if (this.useBinaryIPC) {
      // Use the new binary-optimized command that returns Uint8Array directly
      console.log(`🚀 [ApiService] BINARY IPC ENABLED - Calling apply_and_render_view_state_binary`);
      console.log(`🚀 [ApiService] This should avoid JSON serialization of PNG data`);
      try {
        imageData = await this.transport.invoke<Uint8Array>(
          'apply_and_render_view_state_binary',
          { viewStateJson: JSON.stringify(declarativeViewState) }
        );
        console.log(`🚀 [ApiService ${performance.now() - startTime}ms] SUCCESS: Binary IPC returned Uint8Array directly after ${(performance.now() - backendCallTime).toFixed(0)}ms`);
        console.log(`🚀 [ApiService] Data type check:`, Object.prototype.toString.call(imageData));
      } catch (error) {
        console.error(`❌ [ApiService] BINARY IPC FAILED! Error:`, error);
        console.error(`❌ [ApiService] Falling back to slow JSON path...`);
        // Fall back to the slow JSON path
        const jsonData = await this.transport.invoke<number[]>(
          'apply_and_render_view_state',
          { viewStateJson: JSON.stringify(declarativeViewState) }
        );
        imageData = new Uint8Array(jsonData);
        console.log(`📊 [ApiService ${performance.now() - startTime}ms] FALLBACK: Used JSON path, returned number[] after ${(performance.now() - backendCallTime).toFixed(0)}ms`);
      }
    } else {
      // Use the original slow JSON path
      console.log(`📊 [ApiService] JSON PATH SELECTED (binary IPC disabled by user)`);
      console.log(`📊 [ApiService] WARNING: This will serialize PNG as JSON array - SLOW!`);
      const jsonData = await this.transport.invoke<number[]>(
        'apply_and_render_view_state',
        { viewStateJson: JSON.stringify(declarativeViewState) }
      );
      imageData = new Uint8Array(jsonData);
      console.log(`📊 [ApiService ${performance.now() - startTime}ms] JSON PATH: Returned number[] after ${(performance.now() - backendCallTime).toFixed(0)}ms`);
      console.log(`📊 [ApiService] Had to convert number[] to Uint8Array - extra overhead!`);
    }
    
    // Check if we got valid data
    if (!imageData || imageData.length === 0) {
      console.error('❌ Backend returned empty image data!');
      console.error('❌ This means the backend render failed completely');
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
    
    // imageData is already a Uint8Array from either path
    const byteArray = imageData;
    
    // Check if this is raw RGBA data or PNG
    let bitmap: ImageBitmap;
    
    // Debug: Log the first few bytes to understand the format
    if (byteArray && byteArray.length > 0) {
      console.log(`🔍 First 8 bytes (hex): ${Array.from(byteArray.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      console.log(`🔍 First 8 bytes (decimal): ${Array.from(byteArray.slice(0, 8)).join(', ')}`);
    } else {
      console.error(`🔍 ERROR: byteArray is undefined or empty!`);
    }
    console.log(`🔍 isRawRGBAFormat flag: ${isRawRGBAFormat}`);
    console.log(`🔍 useRawRGBA setting: ${this.useRawRGBA}`);
    console.log(`🔍 Total data length: ${byteArray?.length || 'undefined'} bytes`);
    
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
    
    // Otherwise, it's PNG data
    // Check PNG signature (89 50 4E 47 0D 0A 1A 0A)
    const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const first8Bytes = Array.from(byteArray.slice(0, 8));
    const isPNG = pngSignature.every((byte, i) => byte === first8Bytes[i]);
    
    if (!isPNG) {
      console.error('Data is not a valid PNG file!');
      console.log('Expected PNG signature:', pngSignature.map(b => b.toString(16).padStart(2, '0')).join(' '));
      console.log('Actual first 8 bytes:', first8Bytes.map(b => b.toString(16).padStart(2, '0')).join(' '));
      console.log('First 32 bytes:', Array.from(byteArray.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    } else {
      // Check if this is a valid PNG with actual content
      // IHDR chunk should be at bytes 12-29
      const width = (byteArray[16] << 24) | (byteArray[17] << 16) | (byteArray[18] << 8) | byteArray[19];
      const height = (byteArray[20] << 24) | (byteArray[21] << 16) | (byteArray[22] << 8) | byteArray[23];
      console.log(`PNG dimensions from header: ${width}x${height}`);
    }
    
    // Decode image off main thread - use the Uint8Array to prevent string coercion
    const blob = new Blob([byteArray], { type: 'image/png' });
    
    try {
      return await createImageBitmap(blob);
    } catch (error) {
      console.error('Failed to decode PNG data:', error);
      console.log('Image data type:', Object.prototype.toString.call(imageData));
      console.log('Image data length:', imageData.length);
      console.log('Blob size:', blob.size);
      console.log('First 64 bytes as numbers:', Array.from(byteArray.slice(0, 64)));
      console.log('First 64 bytes as hex:', Array.from(byteArray.slice(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      
      // Return a 1x1 transparent image as fallback
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1);
      }
      return createImageBitmap(canvas);
    }
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
      console.warn(`[ApiService] ⚠️ DIMENSION MISMATCH: Backend returned different dimensions than requested!`);
      console.warn(`  Requested: ${dimensions[0]}x${dimensions[1]}`);
      console.warn(`  Backend returned: ${result.width_px}x${result.height_px}`);
      console.warn(`  This could cause centering/sizing issues!`);
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

// Export for debugging in console
if (typeof window !== 'undefined') {
  (window as any).setBinaryIPC = setBinaryIPC;
  (window as any).setRawRGBA = setRawRGBA;
  (window as any).setDebugBrighten = setDebugBrighten;
}