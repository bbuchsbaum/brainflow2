/**
 * Performance test utilities and helpers
 */

import { performance } from 'perf_hooks';

export interface PerformanceMetrics {
  renderTime: number;
  updateFrequency: number;
  memoryUsage: number;
  wheelEventRate: number;
  reRenderCount: number;
  backendCallRate: number;
}

export interface PerformanceReport {
  metrics: Record<string, PerformanceMetrics>;
  alerts: Array<{ component: string; issue: string; timestamp: number }>;
  summary: {
    totalComponents: number;
    totalAlerts: number;
    avgRenderTime: number;
    status: 'good' | 'warning' | 'poor';
  };
}

/**
 * Measure execution time of a function
 */
export async function measureTime<T>(
  operation: string,
  fn: () => T | Promise<T>
): Promise<{ result: T; time: number }> {
  const start = performance.now();
  const result = await fn();
  const time = performance.now() - start;
  return { result, time };
}

/**
 * Create a mock time navigation with performance tracking
 */
export function createMockTimeNavigation() {
  const calls = {
    jumpTimepoints: [] as number[],
    setTimepoint: [] as number[],
    has4DVolume: 0,
    getTimeInfo: 0,
  };

  return {
    jumpTimepoints: vi.fn((delta: number) => {
      calls.jumpTimepoints.push(performance.now());
    }),
    setTimepoint: vi.fn((timepoint: number) => {
      calls.setTimepoint.push(performance.now());
    }),
    has4DVolume: vi.fn(() => {
      calls.has4DVolume++;
      return true;
    }),
    getTimeInfo: vi.fn(() => {
      calls.getTimeInfo++;
      return {
        currentTimepoint: 0,
        totalTimepoints: 100,
        tr: 2.0,
        currentTime: 0,
        totalTime: 200,
      };
    }),
    formatTimepointDisplay: vi.fn(() => 't = 0 / 100'),
    formatStatusDisplay: vi.fn(() => 'TR 0 | 0:00.0'),
    nextTimepoint: vi.fn(),
    previousTimepoint: vi.fn(),
    getCalls: () => calls,
  };
}

/**
 * Create mock layers for testing
 */
export function createMockLayers(count: number, with4D = true) {
  const layers = [];
  
  // Add a 4D layer if requested
  if (with4D) {
    layers.push({
      id: 'layer-4d',
      volumeType: 'TimeSeries4D',
      timeSeriesInfo: {
        num_timepoints: 100,
        tr: 2.0,
        temporal_unit: 's',
        acquisition_time: null,
      },
      visible: true,
      opacity: 1.0,
    });
  }

  // Add 3D layers
  for (let i = 0; i < count - (with4D ? 1 : 0); i++) {
    layers.push({
      id: `layer-${i}`,
      volumeType: 'Volume3D',
      visible: true,
      opacity: 1.0,
    });
  }

  return layers;
}

/**
 * Simulate rapid wheel events
 */
export function simulateRapidWheelEvents(
  count: number,
  handler: (event: any) => void
) {
  const events = [];
  for (let i = 0; i < count; i++) {
    const event = {
      deltaY: i % 2 === 0 ? 1 : -1,
      preventDefault: vi.fn(),
      shiftKey: false,
    };
    events.push(event);
    handler(event);
  }
  return events;
}

/**
 * Monitor render frequency
 */
export class RenderFrequencyMonitor {
  private renderTimes: number[] = [];
  private startTime: number;

  constructor() {
    this.startTime = performance.now();
  }

  recordRender() {
    this.renderTimes.push(performance.now() - this.startTime);
  }

  getFrequency(): number {
    if (this.renderTimes.length < 2) return 0;
    
    const duration = this.renderTimes[this.renderTimes.length - 1] - this.renderTimes[0];
    return (this.renderTimes.length - 1) / (duration / 1000); // renders per second
  }

  getRenderCount(): number {
    return this.renderTimes.length;
  }

  getAverageInterval(): number {
    if (this.renderTimes.length < 2) return 0;
    
    let totalInterval = 0;
    for (let i = 1; i < this.renderTimes.length; i++) {
      totalInterval += this.renderTimes[i] - this.renderTimes[i - 1];
    }
    return totalInterval / (this.renderTimes.length - 1);
  }
}

/**
 * Memory usage tracker
 */
export class MemoryTracker {
  private measurements: Array<{ time: number; usage: number }> = [];

  measure() {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      this.measurements.push({
        time: performance.now(),
        usage: memory.usedJSHeapSize,
      });
    }
  }

  getGrowthRate(): number {
    if (this.measurements.length < 2) return 0;
    
    const first = this.measurements[0];
    const last = this.measurements[this.measurements.length - 1];
    const duration = (last.time - first.time) / 1000; // seconds
    const growth = last.usage - first.usage;
    
    return growth / duration; // bytes per second
  }

  getPeakUsage(): number {
    return Math.max(...this.measurements.map(m => m.usage));
  }
}