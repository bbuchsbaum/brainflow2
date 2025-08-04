/**
 * Performance monitoring hook for development
 * Tracks render times, update frequencies, and memory usage
 */

import { useRef, useEffect } from 'react';

export interface PerformanceMetrics {
  renderTime: number;
  updateFrequency: number;
  memoryUsage: number;
  wheelEventRate: number;
  reRenderCount: number;
  backendCallRate: number;
}

interface UsePerformanceMonitorOptions {
  enabled?: boolean;
  alertThresholds?: {
    renderTime?: number; // ms
    memoryUsage?: number; // MB
    reRenderRate?: number; // renders per second
  };
}

export function usePerformanceMonitor(
  componentName: string,
  options: UsePerformanceMonitorOptions = {}
) {
  const {
    enabled = process.env.NODE_ENV === 'development',
    alertThresholds = {
      renderTime: 16, // 60fps target
      memoryUsage: 500, // 500MB
      reRenderRate: 60, // Max 60 renders/sec
    },
  } = options;

  const metricsRef = useRef<PerformanceMetrics>({
    renderTime: 0,
    updateFrequency: 0,
    memoryUsage: 0,
    wheelEventRate: 0,
    reRenderCount: 0,
    backendCallRate: 0,
  });

  const renderCount = useRef(0);
  const lastRenderTime = useRef(performance.now());
  const renderTimes = useRef<number[]>([]);

  // Track renders
  useEffect(() => {
    if (!enabled) return;

    renderCount.current++;
    const now = performance.now();
    const timeSinceLastRender = now - lastRenderTime.current;

    metricsRef.current.renderTime = timeSinceLastRender;
    metricsRef.current.reRenderCount = renderCount.current;
    lastRenderTime.current = now;

    // Track render frequency
    renderTimes.current.push(now);
    // Keep only last 60 renders
    if (renderTimes.current.length > 60) {
      renderTimes.current.shift();
    }

    // Calculate render frequency
    if (renderTimes.current.length > 1) {
      const duration = renderTimes.current[renderTimes.current.length - 1] - renderTimes.current[0];
      metricsRef.current.updateFrequency = (renderTimes.current.length - 1) / (duration / 1000);
    }

    // Alert on performance issues
    if (timeSinceLastRender > alertThresholds.renderTime!) {
      console.warn(
        `⚠️ Slow render in ${componentName}: ${timeSinceLastRender.toFixed(1)}ms`
      );
    }

    if (metricsRef.current.updateFrequency > alertThresholds.reRenderRate!) {
      console.warn(
        `⚠️ High re-render rate in ${componentName}: ${metricsRef.current.updateFrequency.toFixed(1)} renders/sec`
      );
    }
  });

  // Memory monitoring
  useEffect(() => {
    if (!enabled || !('memory' in performance)) return;

    const measureMemory = () => {
      const memory = (performance as any).memory;
      metricsRef.current.memoryUsage = memory.usedJSHeapSize;

      // Alert on memory growth
      const memoryMB = memory.usedJSHeapSize / 1024 / 1024;
      if (memoryMB > alertThresholds.memoryUsage!) {
        console.warn(
          `⚠️ High memory usage in ${componentName}: ${memoryMB.toFixed(1)}MB`
        );
      }
    };

    measureMemory();
    const interval = setInterval(measureMemory, 5000);
    return () => clearInterval(interval);
  }, [componentName, enabled, alertThresholds.memoryUsage]);

  // Public API
  const recordWheelEvent = () => {
    if (!enabled) return;
    metricsRef.current.wheelEventRate++;
  };

  const recordBackendCall = () => {
    if (!enabled) return;
    metricsRef.current.backendCallRate++;
  };

  const getMetrics = (): PerformanceMetrics => {
    return { ...metricsRef.current };
  };

  const resetMetrics = () => {
    renderCount.current = 0;
    renderTimes.current = [];
    metricsRef.current = {
      renderTime: 0,
      updateFrequency: 0,
      memoryUsage: 0,
      wheelEventRate: 0,
      reRenderCount: 0,
      backendCallRate: 0,
    };
  };

  // Log summary on unmount in development
  useEffect(() => {
    if (!enabled) return;

    return () => {
      console.log(`📊 Performance summary for ${componentName}:`, {
        totalRenders: renderCount.current,
        avgRenderFrequency: metricsRef.current.updateFrequency.toFixed(1) + ' renders/sec',
        peakMemoryMB: (metricsRef.current.memoryUsage / 1024 / 1024).toFixed(1) + 'MB',
      });
    };
  }, [componentName, enabled]);

  return {
    metrics: metricsRef.current,
    getMetrics,
    resetMetrics,
    recordWheelEvent,
    recordBackendCall,
  };
}