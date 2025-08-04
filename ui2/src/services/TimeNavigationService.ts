/**
 * TimeNavigationService
 * Manages navigation through time for 4D volumes
 */

import type { ViewStateStore } from '@/stores/viewStateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { getEventBus } from '@/events/EventBus';
import type { LayerInfo } from '@/stores/layerStore';

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
    const layers = useLayerStore.getState().layers;
    const viewState = useViewStateStore.getState().viewState;
    
    // Find first 4D volume
    const layer4D = layers.find(layer => layer.volumeType === 'TimeSeries4D');
    if (!layer4D || !layer4D.timeSeriesInfo) {
      return null;
    }

    const currentTimepoint = viewState.timepoint || 0;
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
    const layers = useLayerStore.getState().layers;
    return layers.some(layer => layer.volumeType === 'TimeSeries4D');
  }

  /**
   * Navigate to a specific timepoint
   */
  setTimepoint(timepoint: number): void {
    const timeInfo = this.getTimeInfo();
    if (!timeInfo) return;

    // Clamp to valid range
    const clampedTimepoint = Math.max(0, Math.min(timepoint, timeInfo.totalTimepoints - 1));
    
    console.log(`[TimeNavigationService] Setting timepoint to ${clampedTimepoint}`);
    
    // Update ViewState
    useViewStateStore.getState().setViewState(state => {
      state.timepoint = clampedTimepoint;
    });

    // Emit event for UI updates
    this.eventBus.emit('time.changed', {
      timepoint: clampedTimepoint,
      timeInfo
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