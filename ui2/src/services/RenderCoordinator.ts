/**
 * RenderCoordinator - Central orchestrator for all render operations
 * 
 * Provides a unified render pathway that eliminates race conditions and
 * state synchronization issues between resize and crosshair triggers.
 */

import { useRenderStore } from '@/stores/renderStore';
import { getApiService } from '@/services/apiService';
import type { ViewState } from '@/types/viewState';
import type { ViewType } from '@/types/coordinates';

export interface RenderRequest {
  viewState: ViewState;
  viewType?: ViewType;
  width: number;
  height: number;
  reason: 'resize' | 'crosshair' | 'layer_change' | 'initial';
  priority: 'normal' | 'high';
  sliceOverride?: {
    axis: 'x' | 'y' | 'z';
    position: number;  // in world coordinates (mm)
  };
}

interface QueuedJob extends RenderRequest {
  id: string;
  timestamp: number;
  resolve: (result: ImageBitmap | null) => void;
  reject: (error: Error) => void;
}

/**
 * Central coordinator for all render operations
 */
export class RenderCoordinator {
  private queue: QueuedJob[] = [];
  private processing = false;
  private jobIdCounter = 0;
  private abortController = new AbortController();
  
  // Debouncing for resize operations
  private resizeDebounceMap = new Map<string, NodeJS.Timeout>();
  
  constructor() {
    console.log('[RenderCoordinator] Initialized');
  }
  
  /**
   * Request a render operation - the unified entry point
   */
  async requestRender(request: RenderRequest): Promise<ImageBitmap | null> {
    return new Promise((resolve, reject) => {
      const job: QueuedJob = {
        ...request,
        id: `job_${++this.jobIdCounter}`,
        timestamp: performance.now(),
        resolve,
        reject
      };
      
      console.log(`[RenderCoordinator] Queuing job ${job.id}: ${job.reason} ${job.width}x${job.height}`);
      
      // Handle debouncing for resize operations
      if (job.reason === 'resize') {
        this.enqueueWithDebounce(job);
      } else {
        this.enqueueImmediate(job);
      }
      
      this.processQueue();
    });
  }
  
  // Removed updateDimensions method - backend now handles per-view render targets
  
  // Removed isReady and getCurrentDimensions methods - no longer managing global render targets
  
  /**
   * Cleanup and abort pending operations
   */
  dispose(): void {
    console.log('[RenderCoordinator] Disposing...');
    this.abortController.abort();
    this.clearAllDebounces();
    this.queue.forEach(job => job.reject(new Error('RenderCoordinator disposed')));
    this.queue = [];
  }
  
  // Private methods
  
  private enqueueWithDebounce(job: QueuedJob): void {
    const debounceKey = `${job.width}x${job.height}`;
    
    // Clear existing debounce for this dimension
    const existingTimeout = this.resizeDebounceMap.get(debounceKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Set new debounced enqueue
    const timeout = setTimeout(() => {
      this.resizeDebounceMap.delete(debounceKey);
      this.enqueueImmediate(job);
      this.processQueue();
    }, 200); // 200ms debounce for resize operations (unified timing)
    
    this.resizeDebounceMap.set(debounceKey, timeout);
  }
  
  private enqueueImmediate(job: QueuedJob): void {
    // Implement collapse strategy: remove older jobs of same type
    if (job.reason === 'resize') {
      // For resize, keep only the latest dimensions
      this.queue = this.queue.filter(existingJob => 
        existingJob.reason !== 'resize' || 
        (existingJob.width !== job.width || existingJob.height !== job.height)
      );
    }
    
    this.queue.push(job);
    useRenderStore.getState()._setRenderState({ queuedJobs: this.queue.length });
  }
  
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    
    this.processing = true;
    useRenderStore.getState()._setRenderState({ isRendering: true });
    
    try {
      while (this.queue.length > 0) {
        // Take the next job (FIFO, but collapse strategy may have removed others)
        const job = this.queue.shift()!;
        useRenderStore.getState()._setRenderState({ queuedJobs: this.queue.length });
        
        console.log(`[RenderCoordinator] Processing job ${job.id}: ${job.reason} ${job.width}x${job.height}`);
        
        try {
          const result = await this.executeRenderJob(job);
          job.resolve(result);
        } catch (error) {
          console.error(`[RenderCoordinator] Job ${job.id} failed:`, error);
          job.reject(error as Error);
        }
      }
    } finally {
      this.processing = false;
      useRenderStore.getState()._setRenderState({ 
        isRendering: false,
        queuedJobs: this.queue.length 
      });
    }
  }
  
  /**
   * Validate view parameters to detect corrupted vectors before backend processing
   */
  private validateViewParameters(viewState: ViewState, viewType?: ViewType): boolean {
    // If viewType is specified, validate only that view; otherwise validate all views
    const viewsToValidate = viewType ? [viewType] : ['axial', 'sagittal', 'coronal'] as ViewType[];
    
    for (const type of viewsToValidate) {
      const view = viewState.views[type];
      if (!view) continue;
      
      const { u_mm, v_mm, dim_px } = view;
      
      // Validate vector lengths
      if (u_mm.length !== 3 || v_mm.length !== 3) {
        console.error(`[RenderCoordinator] Invalid view vector dimensions for ${type}:`, { u_mm, v_mm });
        return false;
      }
      
      // Check for NaN or infinite values
      const allValues = [...u_mm, ...v_mm, ...dim_px];
      if (allValues.some(val => !Number.isFinite(val))) {
        console.error(`[RenderCoordinator] Non-finite values in view parameters for ${type}:`, view);
        return false;
      }
      
      // Check for zero-length vectors (would cause division by zero)
      const u_length = Math.sqrt(u_mm[0]**2 + u_mm[1]**2 + u_mm[2]**2);
      const v_length = Math.sqrt(v_mm[0]**2 + v_mm[1]**2 + v_mm[2]**2);
      if (u_length < 1e-10 || v_length < 1e-10) {
        console.error(`[RenderCoordinator] Zero-length displacement vectors for ${type}:`, { u_length, v_length });
        return false;
      }
      
      // Check for invalid dimensions
      if (dim_px[0] <= 0 || dim_px[1] <= 0) {
        console.error(`[RenderCoordinator] Invalid dimensions for ${type}:`, dim_px);
        return false;
      }
    }
    
    return true;
  }

  /**
   * Create detailed error context for render failures
   */
  private createRenderErrorContext(job: QueuedJob, error: any) {
    return {
      jobId: job.id,
      reason: job.reason,
      timestamp: job.timestamp,
      dimensions: {
        requested: { width: job.width, height: job.height },
        viewType: job.viewType
      },
      viewState: {
        layers: job.viewState.layers.map(l => ({
          id: l.id,
          volumeId: l.volumeId,
          visible: l.visible,
          opacity: l.opacity
        })),
        crosshair: {
          position: job.viewState.crosshair.world_mm,
          visible: job.viewState.crosshair.visible
        },
        viewGeometry: job.viewType ? {
          dim_px: job.viewState.views[job.viewType]?.dim_px,
          origin_mm: job.viewState.views[job.viewType]?.origin_mm,
          u_mm_length: job.viewState.views[job.viewType]?.u_mm ? 
            Math.sqrt(job.viewState.views[job.viewType].u_mm.reduce((sum, val) => sum + val**2, 0)) : 0,
          v_mm_length: job.viewState.views[job.viewType]?.v_mm ? 
            Math.sqrt(job.viewState.views[job.viewType].v_mm.reduce((sum, val) => sum + val**2, 0)) : 0
        } : null
      },
      sliceOverride: job.sliceOverride,
      error: {
        message: error.toString(),
        name: error.name,
        stack: error.stack
      }
    };
  }

  private async executeRenderJob(job: QueuedJob): Promise<ImageBitmap | null> {
    const startTime = performance.now();
    
    try {
      // Validate view parameters before rendering
      if (!this.validateViewParameters(job.viewState, job.viewType)) {
        console.error(`[RenderCoordinator] Rejecting render job ${job.id} due to invalid view parameters`);
        throw new Error('Invalid view parameters detected - corrupted vectors or dimensions');
      }
      
      // Step 1: Execute the render (backend will create per-view render target)
      const apiService = getApiService();
      const result = await apiService.applyAndRenderViewStateCore(
        job.viewState,
        job.viewType,
        job.width,
        job.height,
        job.sliceOverride
      );
      
      // Step 3: Update success state
      useRenderStore.getState()._setLastRender(performance.now(), {
        width: job.width,
        height: job.height
      });
      
      const duration = performance.now() - startTime;
      console.log(`[RenderCoordinator] Job ${job.id} completed in ${duration.toFixed(1)}ms`);
      
      return result;
    } catch (error) {
      // Create detailed error context for debugging
      const errorContext = this.createRenderErrorContext(job, error);
      console.error(`[RenderCoordinator] Job ${job.id} failed with detailed context:`, errorContext);
      
      useRenderStore.getState()._setRenderState({ renderError: error as Error });
      throw error;
    }
  }
  
  // Removed ensureRenderTarget method - backend now creates per-view render targets
  
  private clearAllDebounces(): void {
    this.resizeDebounceMap.forEach(timeout => clearTimeout(timeout));
    this.resizeDebounceMap.clear();
  }
}

// Global instance
let globalCoordinator: RenderCoordinator | null = null;

/**
 * Get the global RenderCoordinator instance
 */
export function getRenderCoordinator(): RenderCoordinator {
  if (!globalCoordinator) {
    globalCoordinator = new RenderCoordinator();
  }
  return globalCoordinator;
}

/**
 * Set the global coordinator (useful for testing)
 */
export function setRenderCoordinator(coordinator: RenderCoordinator): void {
  if (globalCoordinator) {
    globalCoordinator.dispose();
  }
  globalCoordinator = coordinator;
}