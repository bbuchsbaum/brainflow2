/**
 * OptimizedRenderService - Smart rendering that only updates changed views
 * 
 * Tracks changes to ViewState and intelligently determines which views
 * need re-rendering, reducing backend calls by ~66% in typical usage.
 */

import type { ViewState, ViewStateRevisions } from '@/types/viewState';
import type { ViewType } from '@/types/coordinates';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { getRenderCoordinator } from './RenderCoordinator';
import type { RenderRequest } from './RenderCoordinator';
import {
  areCrosshairStatesEqual,
  areViewLayerListsEqual,
  areViewPlanesEqual,
  cloneViewStateRevisions,
  TRACKED_VIEW_TYPES
} from '@/utils/viewStateTracking';

const DEBUG_OPTIMIZED_RENDER =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.localStorage.getItem('brainflow2-debug-optimized-render') === 'true';

const renderOptDebugLog = (...args: unknown[]) => {
  if (DEBUG_OPTIMIZED_RENDER) {
    console.log(...args);
  }
};

interface ViewChangeSet {
  axial: boolean;
  sagittal: boolean;
  coronal: boolean;
}

interface RenderMetrics {
  totalRenders: number;
  skippedRenders: number;
  renderTimes: { [key in ViewType]: number[] };
  lastRenderTimestamp: number;
}

export class OptimizedRenderService {
  private lastViewState: ViewState | null = null;
  private lastRevisions: ViewStateRevisions | null = null;
  private metrics: RenderMetrics = {
    totalRenders: 0,
    skippedRenders: 0,
    renderTimes: {
      axial: [],
      sagittal: [],
      coronal: []
    },
    lastRenderTimestamp: 0
  };
  
  /**
   * Analyze which views changed between two ViewStates
   */
  private detectChangedViews(
    current: ViewState,
    previous: ViewState | null,
    revisions?: ViewStateRevisions
  ): ViewChangeSet {
    // If no previous state, all views need rendering
    if (!previous) {
      return { axial: true, sagittal: true, coronal: true };
    }
    
    const changes: ViewChangeSet = {
      axial: false,
      sagittal: false,
      coronal: false
    };

    if (revisions && this.lastRevisions) {
      if (revisions.layers !== this.lastRevisions.layers || revisions.timepoint !== this.lastRevisions.timepoint) {
        renderOptDebugLog('[OptimizedRenderService] Layer/timepoint revision changed - all views need update');
        return { axial: true, sagittal: true, coronal: true };
      }

      if (revisions.crosshair !== this.lastRevisions.crosshair) {
        renderOptDebugLog('[OptimizedRenderService] Crosshair revision changed - all views need update');
        return { axial: true, sagittal: true, coronal: true };
      }

      TRACKED_VIEW_TYPES.forEach((viewType) => {
        changes[viewType] = revisions.views[viewType] !== this.lastRevisions!.views[viewType];
      });

      return changes;
    }

    // Check if layers changed (affects all views)
    const layersChanged = !areViewLayerListsEqual(current.layers, previous.layers) || current.timepoint !== previous.timepoint;
    if (layersChanged) {
      renderOptDebugLog('[OptimizedRenderService] Layers changed - all views need update');
      return { axial: true, sagittal: true, coronal: true };
    }

    // IMPORTANT: The crosshair appears on ALL views as intersecting lines
    // When ANY coordinate changes, ALL views need to update to show the new crosshair position
    // This is because each view shows crosshair lines representing the intersection
    // of the other two planes with the current view
    if (!areCrosshairStatesEqual(current.crosshair, previous.crosshair)) {
      renderOptDebugLog('[OptimizedRenderService] Crosshair changed - all views need update');
      return { axial: true, sagittal: true, coronal: true };
    }

    // Check for view-specific changes (dimensions, viewport)
    for (const viewType of TRACKED_VIEW_TYPES) {
      const currentView = current.views[viewType];
      const previousView = previous.views[viewType];
      
      if (!currentView && !previousView) continue;
      if (!currentView || !previousView) {
        changes[viewType] = true;
        continue;
      }

      if (!areViewPlanesEqual(currentView, previousView)) {
        changes[viewType] = true;
        renderOptDebugLog(`[OptimizedRenderService] ${viewType} view plane changed`);
      }
    }
    
    return changes;
  }
  
  /**
   * Render only the views that changed
   */
  async renderChangedViews(
    viewState: ViewState,
    tag?: string,
    revisions?: ViewStateRevisions
  ): Promise<void> {
    const startTime = performance.now();
    
    // Skip if no layers
    if (!viewState.layers || viewState.layers.length === 0) {
      console.warn('[OptimizedRenderService] Skipping render - no layers');
      return;
    }
    
    // Detect which views changed
    const changedViews = this.detectChangedViews(viewState, this.lastViewState, revisions);
    const viewsToRender = Object.entries(changedViews)
      .filter(([_, changed]) => changed)
      .map(([viewType]) => viewType as ViewType);
    
    if (viewsToRender.length === 0) {
      renderOptDebugLog('[OptimizedRenderService] No views required rendering after diff');
      this.lastViewState = viewState;
      this.lastRevisions = revisions ? cloneViewStateRevisions(revisions) : null;
      this.metrics.lastRenderTimestamp = performance.now();
      return;
    }
    
    // Track metrics
    const skipped = 3 - viewsToRender.length;
    this.metrics.skippedRenders += skipped;
    this.metrics.totalRenders += viewsToRender.length;
    
    if (skipped > 0) {
      renderOptDebugLog(`[OptimizedRenderService] Optimized: Rendering ${viewsToRender.length}/3 views, skipped ${skipped}`);
      renderOptDebugLog(`[OptimizedRenderService] Views to render:`, viewsToRender);
      renderOptDebugLog(`[OptimizedRenderService] Total savings: ${this.metrics.skippedRenders}/${this.metrics.totalRenders + this.metrics.skippedRenders} (${(this.metrics.skippedRenders / (this.metrics.totalRenders + this.metrics.skippedRenders) * 100).toFixed(1)}%)`);
    }
    
    // Render only changed views
    const renderCoordinator = getRenderCoordinator();
    const { setImage, setRendering, setError } = useRenderStateStore.getState();
    const renderReason = this.determineRenderReason(viewState, this.lastViewState, revisions);
    const startTimes = new Map<ViewType, number>();
    const storeKeyFor = (viewType: ViewType) => tag || viewType;
    
    // Mark all pending views as rendering before dispatching work
    viewsToRender.forEach((viewType) => {
      const key = storeKeyFor(viewType);
      setRendering(key, true);
      startTimes.set(viewType, performance.now());
    });
    
    try {
      if (viewsToRender.length > 1) {
        renderOptDebugLog('[OptimizedRenderService] Batch rendering multiple views via RenderCoordinator');
        const results = await renderCoordinator.requestMultiViewRender({
          viewState,
          viewTypes: viewsToRender,
          reason: renderReason,
          priority: 'normal'
        });
        
        viewsToRender.forEach((viewType) => {
          const imageBitmap = results?.[viewType] ?? null;
          const key = storeKeyFor(viewType);
          const duration = performance.now() - (startTimes.get(viewType) ?? startTime);
          
          setImage(key, imageBitmap);
          setRendering(key, false);
          setError(key, null);
          this.recordRenderTime(viewType, duration);
          
          if (imageBitmap) {
            renderOptDebugLog(`[OptimizedRenderService] ${viewType} rendered via batch in ${duration.toFixed(1)}ms`);
          } else {
            renderOptDebugLog(`[OptimizedRenderService] ${viewType} returned null image via batch`);
          }
        });
      } else {
        const viewType = viewsToRender[0];
        const viewStartTime = startTimes.get(viewType) ?? performance.now();
        const view = viewState.views[viewType];
        const [width, height] = view.dim_px;
        
        const imageBitmap = await renderCoordinator.requestRender({
          viewState,
          viewType,
          width,
          height,
          reason: renderReason,
          priority: 'normal'
        }) as ImageBitmap | null;
        
        const key = storeKeyFor(viewType);
        setImage(key, imageBitmap);
        setRendering(key, false);
        setError(key, null);
        const duration = performance.now() - viewStartTime;
        this.recordRenderTime(viewType, duration);
        
        renderOptDebugLog(`[OptimizedRenderService] ${viewType} rendered in ${duration.toFixed(1)}ms`);
      }
    } catch (error) {
      console.error('[OptimizedRenderService] Batch render failed:', error);
      viewsToRender.forEach((viewType) => {
        const key = storeKeyFor(viewType);
        setError(key, error as Error);
        setRendering(key, false);
      });
    }
    
    // Update state tracking
    this.lastViewState = viewState;
    this.lastRevisions = revisions ? cloneViewStateRevisions(revisions) : null;
    this.metrics.lastRenderTimestamp = performance.now();
    
    const totalTime = performance.now() - startTime;
    renderOptDebugLog(`[OptimizedRenderService] Total render time: ${totalTime.toFixed(1)}ms for ${viewsToRender.length} views`);
  }
  
  /**
   * Determine the reason for rendering based on what changed
   */
  private determineRenderReason(
    current: ViewState,
    previous: ViewState | null,
    revisions?: ViewStateRevisions
  ): RenderRequest['reason'] {
    if (!previous) return 'initial';

    if (revisions && this.lastRevisions) {
      if (revisions.layers !== this.lastRevisions.layers || revisions.timepoint !== this.lastRevisions.timepoint) {
        return 'layer_change';
      }
      if (revisions.crosshair !== this.lastRevisions.crosshair) {
        return 'crosshair';
      }
      if (TRACKED_VIEW_TYPES.some((viewType) => revisions.views[viewType] !== this.lastRevisions!.views[viewType])) {
        return 'view_change';
      }
      return 'unknown';
    }

    if (!areViewLayerListsEqual(current.layers, previous.layers) || current.timepoint !== previous.timepoint) {
      return 'layer_change';
    }

    if (!areCrosshairStatesEqual(current.crosshair, previous.crosshair)) {
      return 'crosshair';
    }

    if (TRACKED_VIEW_TYPES.some((viewType) => !areViewPlanesEqual(current.views[viewType], previous.views[viewType]))) {
      return 'view_change';
    }
    
    return 'unknown';
  }

  private recordRenderTime(viewType: ViewType, duration: number): void {
    this.metrics.renderTimes[viewType].push(duration);
    if (this.metrics.renderTimes[viewType].length > 100) {
      this.metrics.renderTimes[viewType].shift();
    }
  }
  
  /**
   * Get performance metrics
   */
  getMetrics(): RenderMetrics & { averageRenderTimes: { [key in ViewType]: number } } {
    const averageRenderTimes = {
      axial: this.calculateAverage(this.metrics.renderTimes.axial),
      sagittal: this.calculateAverage(this.metrics.renderTimes.sagittal),
      coronal: this.calculateAverage(this.metrics.renderTimes.coronal)
    };
    
    return {
      ...this.metrics,
      averageRenderTimes
    };
  }
  
  private calculateAverage(times: number[]): number {
    if (times.length === 0) return 0;
    return times.reduce((a, b) => a + b, 0) / times.length;
  }
  
  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalRenders: 0,
      skippedRenders: 0,
      renderTimes: {
        axial: [],
        sagittal: [],
        coronal: []
      },
      lastRenderTimestamp: 0
    };
  }
  
  /**
   * Force render all views (bypass optimization)
   */
  async forceRenderAll(viewState: ViewState): Promise<void> {
    // Temporarily clear last state to force all views to render
    this.lastViewState = null;
    this.lastRevisions = null;
    
    await this.renderChangedViews(viewState);
    
    // Restore last state (it was updated in renderChangedViews)
    // No need to restore as renderChangedViews updates it
  }
}

// Singleton instance
let optimizedRenderService: OptimizedRenderService | null = null;

export function getOptimizedRenderService(): OptimizedRenderService {
  if (!optimizedRenderService) {
    optimizedRenderService = new OptimizedRenderService();
  }
  return optimizedRenderService;
}
