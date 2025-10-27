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
import type { RenderSession } from './RenderSession';

export interface RenderRequest {
  viewState: ViewState;
  viewType?: ViewType;
  viewTypes?: ViewType[];
  width?: number;
  height?: number;
  reason: 'resize' | 'crosshair' | 'layer_change' | 'initial' | 'view_change' | 'unknown';
  priority: 'normal' | 'high';
  sliceOverride?: {
    axis: 'x' | 'y' | 'z';
    position: number;  // in world coordinates (mm)
  };
}

type RenderJobResult = ImageBitmap | null | Record<ViewType, ImageBitmap | null>;

interface QueuedJob extends RenderRequest {
  id: string;
  timestamp: number;
  resolve: (result: RenderJobResult) => void;
  reject: (error: Error) => void;
}

/**
 * Central coordinator for all render operations
 */
export class RenderCoordinator {
  private static multiViewBatchEnabled = false;

  static setMultiViewBatchEnabled(enabled: boolean): void {
    RenderCoordinator.multiViewBatchEnabled = enabled;
    console.log(`[RenderCoordinator] Multi-view batch mode ${enabled ? 'ENABLED' : 'disabled'}`);
  }

  static isMultiViewBatchEnabled(): boolean {
    return RenderCoordinator.multiViewBatchEnabled;
  }

  private queue: QueuedJob[] = [];
  private processing = false;
  private jobIdCounter = 0;
  private abortController = new AbortController();
  
  // Debouncing for resize operations
  private resizeDebounceMap = new Map<string, NodeJS.Timeout>();
  
  // RenderSession for promise-based rendering
  private renderSession: RenderSession | null = null;
  
  constructor() {
    console.log('[RenderCoordinator] Initialized');
    // Create a persistent render session for the coordinator
    const apiService = getApiService();
    this.renderSession = apiService.createRenderSession('render-coordinator');
  }

  /**
   * Request a render operation - the unified entry point
   */
  async requestRender(request: RenderRequest): Promise<RenderJobResult> {
    return new Promise<RenderJobResult>((resolve, reject) => {
      const job: QueuedJob = {
        ...request,
        id: `job_${++this.jobIdCounter}`,
        timestamp: performance.now(),
        resolve,
        reject
      };
      
      const logDims = job.viewTypes && job.viewTypes.length > 1
        ? job.viewTypes.map((vt) => {
            const view = job.viewState.views[vt];
            return `${vt}:${view?.dim_px?.[0] ?? '??'}x${view?.dim_px?.[1] ?? '??'}`;
          }).join(', ')
        : `${job.width ?? '??'}x${job.height ?? '??'}`;
      console.log(`[RenderCoordinator] Queuing job ${job.id}: ${job.reason} ${logDims}`);
      
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
    
    // Dispose the render session
    if (this.renderSession) {
      this.renderSession.dispose();
      this.renderSession = null;
    }
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
        
        const jobDims = job.viewTypes && job.viewTypes.length > 1
          ? job.viewTypes.map((vt) => {
              const view = job.viewState.views[vt];
              return `${vt}:${view?.dim_px?.[0] ?? '??'}x${view?.dim_px?.[1] ?? '??'}`;
            }).join(', ')
          : `${job.width ?? '??'}x${job.height ?? '??'}`;
        console.log(`[RenderCoordinator] Processing job ${job.id}: ${job.reason} ${jobDims}`);
        
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

  private async executeRenderJob(job: QueuedJob): Promise<RenderJobResult> {
    if (job.viewTypes && job.viewTypes.length > 0) {
      const multiJob = job as QueuedJob & { viewTypes: ViewType[] };
      if (RenderCoordinator.isMultiViewBatchEnabled()) {
        return this.executeMultiViewBatch(multiJob);
      }
      return this.executeSequentialMultiView(multiJob);
    }

    if (!job.viewType) {
      throw new Error('Render job missing viewType information');
    }

    return this.executeSingleViewJob(job as QueuedJob & { viewType: ViewType; width: number; height: number });
  }

  private async executeSingleViewJob(job: QueuedJob & { viewType: ViewType; width: number; height: number }): Promise<ImageBitmap | null> {
    const startTime = performance.now();

    try {
      if (!this.validateViewParameters(job.viewState, job.viewType)) {
        console.error(`[RenderCoordinator] Rejecting render job ${job.id} due to invalid view parameters`);
        throw new Error('Invalid view parameters detected - corrupted vectors or dimensions');
      }

      let result: ImageBitmap | null;

      if (this.renderSession) {
        const renderResult = await this.renderSession.render(
          job.viewState,
          job.viewType,
          job.width,
          job.height
        );
        result = renderResult.bitmap;
        console.log(`[RenderCoordinator] Job ${job.id} (${job.viewType}) completed via RenderSession in ${renderResult.renderTime.toFixed(1)}ms`);
      } else {
        const apiService = getApiService();
        result = await apiService.applyAndRenderViewStateCore(
          job.viewState,
          job.viewType,
          job.width,
          job.height,
          job.sliceOverride
        );
      }

      useRenderStore.getState()._setLastRender(performance.now(), {
        width: job.width,
        height: job.height
      });

      const duration = performance.now() - startTime;
      console.log(`[RenderCoordinator] Job ${job.id} (${job.viewType}) completed in ${duration.toFixed(1)}ms`);

      return result;
    } catch (error) {
      const errorContext = this.createRenderErrorContext(job, error);
      console.error(`[RenderCoordinator] Job ${job.id} (${job.viewType}) failed with detailed context:`, errorContext);

      useRenderStore.getState()._setRenderState({ renderError: error as Error });
      throw error;
    }
  }

  async requestMultiViewRender(params: {
    viewState: ViewState;
    viewTypes: ViewType[];
    reason: RenderRequest['reason'];
    priority?: RenderRequest['priority'];
  }): Promise<Record<ViewType, ImageBitmap | null>> {
    const { viewState, viewTypes, reason, priority = 'normal' } = params;
    const firstView = viewState.views[viewTypes[0]];
    const baseWidth = firstView?.dim_px?.[0] ?? 0;
    const baseHeight = firstView?.dim_px?.[1] ?? 0;
    const mode = RenderCoordinator.isMultiViewBatchEnabled() ? 'batch' : 'sequential';
    console.log(`[RenderCoordinator] requestMultiViewRender using ${mode} mode for views: ${viewTypes.join(', ')}`);

    return this.requestRender({
      viewState,
      viewTypes,
      reason,
      priority,
      width: baseWidth,
      height: baseHeight
    }) as Promise<Record<ViewType, ImageBitmap | null>>;
  }
  
  // Removed ensureRenderTarget method - backend now creates per-view render targets
  
  private clearAllDebounces(): void {
    this.resizeDebounceMap.forEach(timeout => clearTimeout(timeout));
    this.resizeDebounceMap.clear();
  }

  private async executeSequentialMultiView(job: QueuedJob & { viewTypes: ViewType[] }): Promise<Record<ViewType, ImageBitmap | null>> {
    const results: Partial<Record<ViewType, ImageBitmap | null>> = {};

    for (const viewType of job.viewTypes) {
      const view = job.viewState.views[viewType];
      if (!view) {
        results[viewType] = null;
        continue;
      }

      const width = view.dim_px?.[0] ?? job.width ?? 0;
      const height = view.dim_px?.[1] ?? job.height ?? 0;
      const subJob = {
        ...job,
        viewType,
        viewTypes: undefined,
        width,
        height
      } as QueuedJob & { viewType: ViewType; width: number; height: number };

      results[viewType] = await this.executeSingleViewJob(subJob);
    }

    return results as Record<ViewType, ImageBitmap | null>;
  }

  private async executeMultiViewBatch(job: QueuedJob & { viewTypes: ViewType[] }): Promise<Record<ViewType, ImageBitmap | null>> {
    if (!this.renderSession) {
      console.warn('[RenderCoordinator] No render session available for multi-view batch; falling back to sequential path');
      return this.executeSequentialMultiView(job);
    }

    try {
      const requests = job.viewTypes.map((viewType) => {
        const view = job.viewState.views[viewType];
        const width = view?.dim_px?.[0] ?? job.width ?? 0;
        const height = view?.dim_px?.[1] ?? job.height ?? 0;
        return {
          viewState: job.viewState,
          viewType,
          width,
          height
        };
      });

      const batchResults = await this.renderSession.renderBatch(requests);
      const results: Partial<Record<ViewType, ImageBitmap | null>> = {};

      batchResults.forEach((result, index) => {
        const viewType = job.viewTypes[index];
        results[viewType] = result?.bitmap ?? null;
      });

      // Fill any missing entries with null to keep contract stable
      job.viewTypes.forEach((viewType) => {
        if (!(viewType in results)) {
          results[viewType] = null;
        }
      });

      return results as Record<ViewType, ImageBitmap | null>;
    } catch (error) {
      console.error('[RenderCoordinator] Multi-view batch render failed, reverting to sequential fallback:', error);
      return this.executeSequentialMultiView(job);
    }
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

export function setMultiViewBatchEnabled(enabled: boolean): void {
  RenderCoordinator.setMultiViewBatchEnabled(enabled);
}

export function isMultiViewBatchEnabled(): boolean {
  return RenderCoordinator.isMultiViewBatchEnabled();
}
