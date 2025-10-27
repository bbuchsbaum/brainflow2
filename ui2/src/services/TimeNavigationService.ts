/**
 * TimeNavigationService
 * Manages navigation through time for 4D volumes
 */

import type { ViewStateStore } from '@/stores/viewStateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { getEventBus } from '@/events/EventBus';
import type { LayerInfo } from '@/stores/layerStore';
import { getApiService } from '@/services/apiService';

export interface TimeInfo {
  currentTimepoint: number;
  totalTimepoints: number;
  tr: number | null; // Repetition time in seconds
  currentTime: number; // Current time in seconds
  totalTime: number; // Total acquisition time in seconds
}

export interface TimeNavigationMode {
  mode: 'time' | 'slice';
}

class TimeNavigationService {
  private static instance: TimeNavigationService;
  private mode: TimeNavigationMode['mode'] = 'slice'; // Default to slice mode
  private eventBus = getEventBus();

  private collectTimeSeriesLayers(): LayerInfo[] {
    const storeHook = useLayerStore as unknown as {
      (): unknown;
      getState?: () => { layers?: unknown };
    };

    let candidateLayers: unknown;
    if (typeof storeHook.getState === 'function') {
      candidateLayers = storeHook.getState().layers;
    } else if (process.env.NODE_ENV === 'test' && typeof storeHook === 'function') {
      candidateLayers = storeHook();
    }

    const layersArray: LayerInfo[] = Array.isArray(candidateLayers)
      ? candidateLayers as LayerInfo[]
      : Array.isArray((candidateLayers as any)?.layers)
        ? (candidateLayers as { layers: LayerInfo[] }).layers
        : [];

    return layersArray.filter(
      layer =>
        layer.volumeType === 'TimeSeries4D' &&
        layer.timeSeriesInfo &&
        layer.timeSeriesInfo.num_timepoints > 0
    );
  }

  private persistTimepoint(volumeIds: string[], timepoint: number): void {
    if (volumeIds.length === 0) {
      return;
    }

    const api = getApiService();
    void Promise.allSettled(
      volumeIds.map(volumeId => api.setVolumeTimepoint(volumeId, timepoint))
    ).then(results => {
      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (failures.length > 0) {
        const error = failures[0].reason;
        console.error(
          '[TimeNavigationService] Failed to persist timepoint',
          error
        );
        this.eventBus.emit('ui.notification', {
          type: 'error',
          message:
            'Failed to update timepoint on backend. Visual state may be out of sync.'
        });
      }
    });
  }

  private constructor() {
    console.log('[TimeNavigationService] Initialized');
  }

  static getInstance(): TimeNavigationService {
    if (!TimeNavigationService.instance) {
      TimeNavigationService.instance = new TimeNavigationService();
    }
    return TimeNavigationService.instance;
  }

  /**
   * Get time information for the current 4D volume
   */
  getTimeInfo(): TimeInfo | null {
    const layers = this.collectTimeSeriesLayers();
    const layer4D = layers[0];
    if (!layer4D || !layer4D.timeSeriesInfo) {
      return null;
    }

    const viewState = useViewStateStore.getState().viewState;
    const currentTimepoint =
      viewState.timepoint ??
      layer4D.currentTimepoint ??
      0;
    const totalTimepoints = layer4D.timeSeriesInfo.num_timepoints;
    const tr = layer4D.timeSeriesInfo.tr || 1.0; // Default to 1s if not specified
    
    return {
      currentTimepoint,
      totalTimepoints,
      tr,
      currentTime: currentTimepoint * tr,
      totalTime: totalTimepoints * tr
    };
  }

  /**
   * Check if we have a 4D volume loaded
   */
  has4DVolume(): boolean {
    return this.collectTimeSeriesLayers().length > 0;
  }

  /**
   * Navigate to a specific timepoint
   */
  setTimepoint(timepoint: number): void {
    const layers = this.collectTimeSeriesLayers();
    if (layers.length === 0) {
      return;
    }

    const totalTimepoints =
      layers[0].timeSeriesInfo?.num_timepoints ?? 0;
    if (totalTimepoints === 0) {
      return;
    }

    const clampedTimepoint = Math.max(
      0,
      Math.min(timepoint, totalTimepoints - 1)
    );

    console.log(
      `[TimeNavigationService] Setting timepoint to ${clampedTimepoint}`
    );

    // Update view state
    useViewStateStore.getState().setViewState(state => {
      state.timepoint = clampedTimepoint;
    });

    // Update layer metadata
    const layerStoreApi = (useLayerStore as unknown as { getState?: () => { updateLayer?: (id: string, updates: Partial<LayerInfo>) => void } }).getState?.();
    const updateLayer = layerStoreApi?.updateLayer;
    if (typeof updateLayer === 'function') {
      layers.forEach(layer => {
        updateLayer(layer.id, { currentTimepoint: clampedTimepoint });
      });
    }

    // Persist to backend (fire and forget)
    const volumeIds = Array.from(
      new Set(
        layers
          .map(layer => layer.volumeId)
          .filter((id): id is string => Boolean(id))
      )
    );
    this.persistTimepoint(volumeIds, clampedTimepoint);

    // Emit UI event with refreshed info
    const updatedInfo = this.getTimeInfo();
    this.eventBus.emit('time.changed', {
      timepoint: clampedTimepoint,
      timeInfo: updatedInfo ?? {
        currentTimepoint: clampedTimepoint,
        totalTimepoints,
        tr: layers[0].timeSeriesInfo?.tr ?? 1.0,
        currentTime: clampedTimepoint * (layers[0].timeSeriesInfo?.tr ?? 1.0),
        totalTime: totalTimepoints * (layers[0].timeSeriesInfo?.tr ?? 1.0)
      }
    });
  }

  /**
   * Navigate by delta timepoints
   */
  navigateByDelta(delta: number): void {
    const timeInfo = this.getTimeInfo();
    if (!timeInfo) return;

    const newTimepoint = timeInfo.currentTimepoint + delta;
    this.setTimepoint(newTimepoint);
  }

  /**
   * Navigate to next timepoint
   */
  nextTimepoint(): void {
    this.navigateByDelta(1);
  }

  /**
   * Navigate to previous timepoint
   */
  previousTimepoint(): void {
    this.navigateByDelta(-1);
  }

  /**
   * Jump forward/backward by larger steps
   */
  jumpTimepoints(steps: number): void {
    this.navigateByDelta(steps);
  }

  /**
   * Get current navigation mode (time vs slice)
   */
  getMode(): TimeNavigationMode['mode'] {
    return this.mode;
  }

  /**
   * Toggle between time and slice navigation modes
   */
  toggleMode(): void {
    this.mode = this.mode === 'time' ? 'slice' : 'time';
    console.log(`[TimeNavigationService] Navigation mode changed to: ${this.mode}`);
    
    // Emit event for UI feedback
    this.eventBus.emit('navigation.modeChanged', { mode: this.mode });
  }

  /**
   * Set navigation mode explicitly
   */
  setMode(mode: TimeNavigationMode['mode']): void {
    if (this.mode !== mode) {
      this.mode = mode;
      console.log(`[TimeNavigationService] Navigation mode set to: ${this.mode}`);
      this.eventBus.emit('navigation.modeChanged', { mode: this.mode });
    }
  }

  /**
   * Format time for display
   */
  formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${minutes}:${secs.padStart(4, '0')}`;
  }

  /**
   * Format timepoint display (e.g., "t = 87 / 240")
   */
  formatTimepointDisplay(): string | null {
    const timeInfo = this.getTimeInfo();
    if (!timeInfo) return null;

    return `t = ${timeInfo.currentTimepoint} / ${timeInfo.totalTimepoints}`;
  }

  /**
   * Format status bar display (e.g., "TR 37 | 1:14.8 s")
   */
  formatStatusDisplay(): string | null {
    const timeInfo = this.getTimeInfo();
    if (!timeInfo) return null;

    const timeStr = this.formatTime(timeInfo.currentTime);
    return `TR ${timeInfo.currentTimepoint} | ${timeStr}`;
  }
}

// Export singleton instance getter
export function getTimeNavigationService(): TimeNavigationService {
  return TimeNavigationService.getInstance();
}

// Export convenience hook for React components
export function useTimeNavigationService(): TimeNavigationService {
  return TimeNavigationService.getInstance();
}
