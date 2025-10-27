/**
 * useTimeNavigation Hook
 * Centralizes time navigation logic and provides a clean React interface
 * Eliminates service-store coupling and provides single source of truth
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useViewStateStore } from '../stores/viewStateStore';
import { useLayerStore } from '../stores/layerStore';
import { getTimeNavigationService } from '@/services/TimeNavigationService';

export interface TimeInfo {
  currentTimepoint: number;
  totalTimepoints: number;
  tr: number | null; // Repetition time in seconds
  currentTime: number; // Current time in seconds
  totalTime: number; // Total acquisition time in seconds
}

export interface TimeNavigationActions {
  setTimepoint: (timepoint: number) => void;
  nextTimepoint: () => void;
  previousTimepoint: () => void;
  jumpTimepoints: (delta: number) => void;
  has4DVolume: () => boolean;
  getTimeInfo: () => TimeInfo | null;
  formatTimepointDisplay: () => string | null;
  formatStatusDisplay: () => string | null;
}

export function useTimeNavigation(): TimeNavigationActions {
  // Subscribe to relevant store slices
  const viewState = useViewStateStore(state => state.viewState);
  const layers = useLayerStore(state => state.layers);
  const timeNavService = useMemo(() => getTimeNavigationService(), []);

  // Performance monitoring for development
  const performanceRef = useRef({
    computationTime: 0,
    lastMeasurement: 0
  });

  // Cache expensive layer filtering with useMemo to avoid re-computation
  const cached4DLayer = useMemo(() => {
    const start = performance.now();
    const result = layers.find(layer => 
      layer.volumeType === 'TimeSeries4D' && 
      layer.timeSeriesInfo && 
      layer.timeSeriesInfo.num_timepoints > 1
    );
    const computeTime = performance.now() - start;
    
    // Only log in development and if computation took significant time
    if (process.env.NODE_ENV === 'development' && computeTime > 1) {
      console.debug(`[useTimeNavigation] Layer filtering took ${computeTime.toFixed(2)}ms`);
    }
    
    return result;
  }, [layers]); // Only recalculate when layers actually change

  // Check if we have a 4D volume loaded (now using cached value)
  const has4DVolume = useCallback(() => {
    return cached4DLayer !== undefined;
  }, [cached4DLayer]);

  // Cache the time series information separately from the timepoint-dependent calculations
  const timeSeriesInfo = useMemo(() => {
    if (!cached4DLayer?.timeSeriesInfo) {
      return null;
    }
    return {
      num_timepoints: cached4DLayer.timeSeriesInfo.num_timepoints,
      tr: cached4DLayer.timeSeriesInfo.tr ?? 1.0 // Default to 1s if not specified
    };
  }, [cached4DLayer]);

  // Get time information for the current 4D volume (separated layer-dependent and timepoint-dependent logic)
  const getTimeInfo = useCallback((): TimeInfo | null => {
    if (!timeSeriesInfo) {
      return null;
    }

    const currentTimepoint = viewState.timepoint ?? 0;
    const { num_timepoints, tr } = timeSeriesInfo;

    return {
      currentTimepoint,
      totalTimepoints: num_timepoints,
      tr,
      currentTime: currentTimepoint * tr,
      totalTime: num_timepoints * tr
    };
  }, [timeSeriesInfo, viewState.timepoint]); // Separate dependencies for better performance

  // Navigate to a specific timepoint
  const setTimepoint = useCallback((timepoint: number) => {
    timeNavService.setTimepoint(timepoint);
  }, [timeNavService]);

  // Navigate to next timepoint
  const nextTimepoint = useCallback(() => {
    timeNavService.nextTimepoint();
  }, [timeNavService]);

  // Navigate to previous timepoint
  const previousTimepoint = useCallback(() => {
    timeNavService.previousTimepoint();
  }, [timeNavService]);

  // Jump forward/backward by delta timepoints
  const jumpTimepoints = useCallback((delta: number) => {
    timeNavService.jumpTimepoints(delta);
  }, [timeNavService]);

  // Format time for display
  const formatTime = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${minutes}:${secs.padStart(4, '0')}`;
  }, []);

  // Format timepoint display (e.g., "t = 87 / 240")
  const formatTimepointDisplay = useCallback((): string | null => {
    const timeInfo = getTimeInfo();
    if (!timeInfo) return null;

    return `t = ${timeInfo.currentTimepoint} / ${timeInfo.totalTimepoints}`;
  }, [getTimeInfo]);

  // Format status bar display (e.g., "TR 37 | 1:14.8 s")
  const formatStatusDisplay = useCallback((): string | null => {
    const timeInfo = getTimeInfo();
    if (!timeInfo) return null;

    const timeStr = formatTime(timeInfo.currentTime);
    return `TR ${timeInfo.currentTimepoint} | ${timeStr}`;
  }, [getTimeInfo, formatTime]);

  // Track overall hook performance in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const start = performance.now();
      performanceRef.current = {
        computationTime: performance.now() - start,
        lastMeasurement: Date.now()
      };
    }
  }, [cached4DLayer, viewState.timepoint]);

  return {
    setTimepoint,
    nextTimepoint,
    previousTimepoint,
    jumpTimepoints,
    has4DVolume,
    getTimeInfo,
    formatTimepointDisplay,
    formatStatusDisplay
  };
}
