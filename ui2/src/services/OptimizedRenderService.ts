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
import { effectiveRenderRatio, hidpiViewState, tagBitmapRatio } from '@/utils/renderPixelRatio';
import { hasVisibleSliceCanvas } from './ViewZoomService';
import {
  areCrosshairStatesEqual,
  areViewLayerListsEqual,
  areViewPlanesEqual,
  cloneViewStateRevisions,
  TRACKED_VIEW_TYPES
} from '@/utils/viewStateTracking';
import {
  applyRenderLayerScope,
  getRenderLayerScopeRevision,
  hasRenderLayerScope,
} from './render/RenderLayerScope';

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
  /** Render-layer scope revision the last render used. */
  private lastScopeRevision = getRenderLayerScopeRevision();
  // The ratio each view was last drawn at (HiDPI). A view below the
  // effective ratio (an interaction ended, a sharper display) is redrawn,
  // but only if it is on screen. A drop to 1× never forces a redraw: views
  // re-render at 1× only when they change anyway.
  private renderedRatio = new Map<ViewType, number>();
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
    workspaceViewState: ViewState,
    tag?: string,
    revisions?: ViewStateRevisions
  ): Promise<void> {
    const startTime = performance.now();

    // A view that borrows the orthogonal views (the Set studio Deck) draws
    // only its own layers, never the workspace scene.
    const scoped = hasRenderLayerScope();
    const viewState = applyRenderLayerScope(workspaceViewState);
    const scopeRevision = getRenderLayerScopeRevision();
    const scopeChanged = scopeRevision !== this.lastScopeRevision;

    // Skip if no layers
    if (!viewState.layers || viewState.layers.length === 0) {
      if (scoped || scopeChanged) {
        // Nothing of the scope is loaded yet (or the scope just ended over an
        // empty workspace): show an empty view, not the image last drawn.
        const { setImage, setRendering } = useRenderStateStore.getState();
        TRACKED_VIEW_TYPES.forEach((viewType) => {
          const key = tag || viewType;
          setImage(key, null);
          setRendering(key, false);
        });
        this.lastScopeRevision = scopeRevision;
        this.lastViewState = null;
        this.lastRevisions = null;
        return;
      }
      console.warn('[OptimizedRenderService] Skipping render - no layers');
      return;
    }

    // Detect which views changed
    const ratio = effectiveRenderRatio();
    const changedViews = scopeChanged
      ? { axial: true, sagittal: true, coronal: true }
      : this.detectChangedViews(viewState, this.lastViewState, revisions);
    for (const viewType of TRACKED_VIEW_TYPES) {
      const drawnAt = this.renderedRatio.get(viewType);
      if (drawnAt !== undefined && drawnAt < ratio && hasVisibleSliceCanvas(viewType)) {
        changedViews[viewType] = true;
      }
    }
    this.lastScopeRevision = scopeRevision;
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
        // At the effective device-pixel ratio: the same planes on a finer
        // grid (utils/renderPixelRatio); the view state keeps CSS pixels.
        const results = await renderCoordinator.requestMultiViewRender({
          viewState: hidpiViewState(viewState, viewsToRender, ratio),
          viewTypes: viewsToRender,
          reason: renderReason,
          priority: 'normal'
        });
        
        viewsToRender.forEach((viewType) => {
          const imageBitmap = tagBitmapRatio(results?.[viewType] ?? null, ratio);
          const key = storeKeyFor(viewType);
          const duration = performance.now() - (startTimes.get(viewType) ?? startTime);
          
          setImage(key, imageBitmap);
          setRendering(key, false);
          setError(key, null);
          this.renderedRatio.set(viewType, ratio);
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
        const renderState = hidpiViewState(viewState, [viewType], ratio);
        const [width, height] = renderState.views[viewType].dim_px;
        
        const imageBitmap = tagBitmapRatio(
          (await renderCoordinator.requestRender({
            viewState: renderState,
            viewType,
            width,
            height,
            reason: renderReason,
            priority: 'normal'
          })) as ImageBitmap | null,
          ratio,
        );
        
        const key = storeKeyFor(viewType);
        setImage(key, imageBitmap);
        setRendering(key, false);
        setError(key, null);
        this.renderedRatio.set(viewType, ratio);
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
