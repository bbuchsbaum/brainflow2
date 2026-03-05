/**
 * RenderSession
 * 
 * Encapsulates a rendering session with isolated state and lifecycle management.
 * This abstraction prevents cross-contamination between different rendering contexts
 * and provides a clean promise-based API.
 * 
 * Benefits:
 * - Session isolation: Each session has a unique ID
 * - Automatic cleanup: Resources are released on dispose
 * - Error boundaries: Errors are contained within sessions
 * - Performance tracking: Built-in timing and metadata
 * - No event filtering needed: Direct promise returns
 */

import type { ViewState } from '@/types/viewState';
import type { ApiService } from './apiService';
import { nanoid } from 'nanoid';

const DEBUG_RENDER_SESSION =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.localStorage.getItem('brainflow2-debug-render-session') === 'true';

const renderSessionDebugLog = (...args: unknown[]) => {
  if (DEBUG_RENDER_SESSION) {
    console.log(...args);
  }
};

export interface RenderSessionMetadata {
  sessionId: string;
  createdAt: number;
  renderCount: number;
  totalRenderTime: number;
  errors: Error[];
  disposed: boolean;
}

export interface RenderResult {
  bitmap: ImageBitmap;
  renderTime: number;
  dimensions: [number, number];
}

export class RenderSession {
  private sessionId: string;
  private apiService: ApiService;
  private metadata: RenderSessionMetadata;
  private disposed = false;
  private activeRenders = new Set<Promise<any>>();
  
  constructor(apiService: ApiService, sessionId?: string) {
    this.sessionId = sessionId || nanoid();
    this.apiService = apiService;
    this.metadata = {
      sessionId: this.sessionId,
      createdAt: Date.now(),
      renderCount: 0,
      totalRenderTime: 0,
      errors: [],
      disposed: false
    };
    
    renderSessionDebugLog(`[RenderSession ${this.sessionId}] Created`);
  }
  
  /**
   * Get session ID
   */
  getId(): string {
    return this.sessionId;
  }
  
  /**
   * Get session metadata
   */
  getMetadata(): Readonly<RenderSessionMetadata> {
    return { ...this.metadata };
  }
  
  /**
   * Render a single view state
   */
  async render(
    viewState: ViewState,
    viewType: 'axial' | 'sagittal' | 'coronal',
    width = 512,
    height = 512
  ): Promise<RenderResult> {
    if (this.disposed) {
      throw new Error(`RenderSession ${this.sessionId} has been disposed`);
    }
    
    const startTime = performance.now();
    let renderPromise: Promise<ImageBitmap> | null = null;
    
    try {
      // Create render promise
      renderPromise = this.apiService.renderViewState(
        viewState,
        viewType,
        width,
        height
      );
      
      // Track active render
      this.activeRenders.add(renderPromise);
      
      // Execute render
      const bitmap = await renderPromise;
      
      // Update metadata
      const renderTime = performance.now() - startTime;
      this.metadata.renderCount++;
      this.metadata.totalRenderTime += renderTime;
      
      renderSessionDebugLog(`[RenderSession ${this.sessionId}] Rendered ${viewType} in ${renderTime.toFixed(1)}ms`);
      
      return {
        bitmap,
        renderTime,
        dimensions: [width, height]
      };
      
    } catch (error) {
      // Record error in metadata
      this.metadata.errors.push(error as Error);
      console.error(`[RenderSession ${this.sessionId}] Render error:`, error);
      throw error;
    } finally {
      // Remove from active renders
      if (renderPromise) {
        this.activeRenders.delete(renderPromise);
      }
    }
  }
  
  /**
   * Render multiple views in batch
   */
  async renderBatch(
    requests: Array<{
      viewState: ViewState;
      viewType: 'axial' | 'sagittal' | 'coronal';
      width?: number;
      height?: number;
    }>
  ): Promise<RenderResult[]> {
    if (this.disposed) {
      throw new Error(`RenderSession ${this.sessionId} has been disposed`);
    }
    
    renderSessionDebugLog(`[RenderSession ${this.sessionId}] Starting batch render of ${requests.length} views`);

    if (requests.length > 1) {
      const firstViewState = requests[0].viewState;
      const sharedState = requests.every(req => req.viewState === firstViewState);

      if (sharedState && typeof this.apiService.renderViewStateMulti === 'function') {
        const startTime = performance.now();
        try {
          const viewTypes = requests.map(req => req.viewType);
          const bitmaps = await this.apiService.renderViewStateMulti(firstViewState, viewTypes);
          const totalTime = performance.now() - startTime;

          if (viewTypes.some(viewType => !bitmaps[viewType])) {
            throw new Error('renderViewStateMulti returned missing bitmap');
          }

          return requests.map((req) => {
            const bitmap = bitmaps[req.viewType]!;
            const dimensions: [number, number] = [
              req.width ?? firstViewState.views[req.viewType]?.dim_px?.[0] ?? 512,
              req.height ?? firstViewState.views[req.viewType]?.dim_px?.[1] ?? 512
            ];

            return {
              bitmap,
              renderTime: totalTime,
              dimensions
            };
          });
        } catch (error) {
          console.warn(`[RenderSession ${this.sessionId}] Multi-view render failed, falling back to per-view renders`, error);
        }
      }
    }
    
    // Render all requests in parallel
    const renderPromises = requests.map(req =>
      this.render(
        req.viewState,
        req.viewType,
        req.width || 512,
        req.height || 512
      )
    );
    
    return Promise.all(renderPromises);
  }
  
  /**
   * Cancel all active renders
   */
  async cancelActiveRenders(): Promise<void> {
    if (this.activeRenders.size === 0) return;
    
    renderSessionDebugLog(`[RenderSession ${this.sessionId}] Cancelling ${this.activeRenders.size} active renders`);
    
    // Note: We can't actually cancel the backend renders,
    // but we can stop waiting for them
    this.activeRenders.clear();
  }
  
  /**
   * Dispose the session and cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    
    renderSessionDebugLog(`[RenderSession ${this.sessionId}] Disposing session`, {
      renderCount: this.metadata.renderCount,
      avgRenderTime: this.metadata.renderCount > 0 
        ? (this.metadata.totalRenderTime / this.metadata.renderCount).toFixed(1)
        : 0,
      errors: this.metadata.errors.length
    });
    
    // Cancel any active renders
    await this.cancelActiveRenders();
    
    // Mark as disposed
    this.disposed = true;
    this.metadata.disposed = true;
  }
  
  /**
   * Check if session is disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}

/**
 * Factory function to create a new render session
 */
export function createRenderSession(
  apiService: ApiService,
  sessionId?: string
): RenderSession {
  return new RenderSession(apiService, sessionId);
}
