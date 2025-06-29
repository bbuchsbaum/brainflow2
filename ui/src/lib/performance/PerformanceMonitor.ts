/**
 * Performance Monitoring System
 * Tracks metrics and provides optimization insights
 */
import { getEventBus } from '$lib/events/EventBus';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface PerformanceThreshold {
  metric: string;
  warning: number;
  critical: number;
  unit: string;
}

export class PerformanceMonitor {
  private metrics = new Map<string, PerformanceMetric[]>();
  private thresholds = new Map<string, PerformanceThreshold>();
  private observers = new Map<string, PerformanceObserver>();
  private eventBus = getEventBus();
  
  // Default thresholds
  private readonly defaultThresholds: PerformanceThreshold[] = [
    { metric: 'fps', warning: 30, critical: 15, unit: 'fps' },
    { metric: 'frame_time', warning: 33, critical: 66, unit: 'ms' },
    { metric: 'gpu_memory', warning: 80, critical: 95, unit: '%' },
    { metric: 'render_time', warning: 16, critical: 33, unit: 'ms' },
    { metric: 'js_heap', warning: 80, critical: 95, unit: '%' }
  ];
  
  constructor() {
    this.setupDefaultThresholds();
    this.setupObservers();
  }
  
  /**
   * Record a performance metric
   */
  record(name: string, value: number, unit: string, tags?: Record<string, string>): void {
    const metric: PerformanceMetric = {
      name,
      value,
      unit,
      timestamp: performance.now(),
      tags
    };
    
    // Store metric
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    
    const metrics = this.metrics.get(name)!;
    metrics.push(metric);
    
    // Keep only last 1000 metrics per type
    if (metrics.length > 1000) {
      metrics.shift();
    }
    
    // Check thresholds
    this.checkThreshold(metric);
    
    // Emit event
    this.eventBus.emit('performance.metric.recorded', metric);
  }
  
  /**
   * Start a performance measurement
   */
  startMeasure(name: string): () => void {
    const start = performance.now();
    
    return () => {
      const duration = performance.now() - start;
      this.record(name, duration, 'ms');
    };
  }
  
  /**
   * Measure async operation
   */
  async measureAsync<T>(
    name: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    
    try {
      const result = await operation();
      const duration = performance.now() - start;
      this.record(name, duration, 'ms', { status: 'success' });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.record(name, duration, 'ms', { status: 'error' });
      throw error;
    }
  }
  
  /**
   * Get metrics for a specific name
   */
  getMetrics(name: string, limit?: number): PerformanceMetric[] {
    const metrics = this.metrics.get(name) || [];
    return limit ? metrics.slice(-limit) : metrics;
  }
  
  /**
   * Get statistics for a metric
   */
  getStats(name: string, windowMs = 60000): {
    avg: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
    count: number;
  } | null {
    const metrics = this.getMetrics(name);
    const cutoff = performance.now() - windowMs;
    const recent = metrics.filter(m => m.timestamp > cutoff);
    
    if (recent.length === 0) return null;
    
    const values = recent.map(m => m.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    
    const percentile = (p: number) => {
      const index = Math.ceil((p / 100) * values.length) - 1;
      return values[Math.max(0, index)];
    };
    
    return {
      avg: sum / values.length,
      min: values[0],
      max: values[values.length - 1],
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
      count: values.length
    };
  }
  
  /**
   * Monitor FPS
   */
  startFpsMonitoring(): () => void {
    let frameCount = 0;
    let lastTime = performance.now();
    let rafId: number;
    
    const measure = () => {
      frameCount++;
      const now = performance.now();
      const elapsed = now - lastTime;
      
      if (elapsed >= 1000) {
        const fps = (frameCount * 1000) / elapsed;
        this.record('fps', fps, 'fps');
        frameCount = 0;
        lastTime = now;
      }
      
      rafId = requestAnimationFrame(measure);
    };
    
    measure();
    
    return () => cancelAnimationFrame(rafId);
  }
  
  /**
   * Monitor memory usage
   */
  startMemoryMonitoring(intervalMs = 5000): () => void {
    if (!('memory' in performance)) {
      console.warn('Performance.memory not available');
      return () => {};
    }
    
    const measure = () => {
      const memory = (performance as any).memory;
      const usedPercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
      
      this.record('js_heap', usedPercent, '%');
      this.record('js_heap_size', memory.usedJSHeapSize, 'bytes');
    };
    
    const intervalId = setInterval(measure, intervalMs);
    measure(); // Initial measurement
    
    return () => clearInterval(intervalId);
  }
  
  /**
   * Setup Performance Observers
   */
  private setupObservers(): void {
    // Long tasks observer
    if ('PerformanceObserver' in window) {
      try {
        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.record('long_task', entry.duration, 'ms', {
              name: entry.name,
              startTime: entry.startTime.toString()
            });
          }
        });
        
        longTaskObserver.observe({ entryTypes: ['longtask'] });
        this.observers.set('longtask', longTaskObserver);
      } catch (e) {
        console.warn('Long task observer not supported');
      }
    }
  }
  
  /**
   * Setup default thresholds
   */
  private setupDefaultThresholds(): void {
    for (const threshold of this.defaultThresholds) {
      this.thresholds.set(threshold.metric, threshold);
    }
  }
  
  /**
   * Set custom threshold
   */
  setThreshold(threshold: PerformanceThreshold): void {
    this.thresholds.set(threshold.metric, threshold);
  }
  
  /**
   * Check if metric exceeds threshold
   */
  private checkThreshold(metric: PerformanceMetric): void {
    const threshold = this.thresholds.get(metric.name);
    if (!threshold) return;
    
    let level: 'ok' | 'warning' | 'critical' = 'ok';
    
    if (threshold.metric === 'fps') {
      // For FPS, lower is worse
      if (metric.value <= threshold.critical) level = 'critical';
      else if (metric.value <= threshold.warning) level = 'warning';
    } else {
      // For most metrics, higher is worse
      if (metric.value >= threshold.critical) level = 'critical';
      else if (metric.value >= threshold.warning) level = 'warning';
    }
    
    if (level !== 'ok') {
      this.eventBus.emit('performance.threshold.exceeded', {
        metric,
        threshold,
        level
      });
    }
  }
  
  /**
   * Generate performance report
   */
  generateReport(): {
    summary: Record<string, any>;
    issues: Array<{
      metric: string;
      level: 'warning' | 'critical';
      message: string;
    }>;
  } {
    const summary: Record<string, any> = {};
    const issues: Array<any> = [];
    
    // Analyze each metric
    for (const [name, threshold] of this.thresholds) {
      const stats = this.getStats(name);
      if (!stats) continue;
      
      summary[name] = stats;
      
      // Check for issues
      if (name === 'fps' && stats.avg <= threshold.warning) {
        issues.push({
          metric: name,
          level: stats.avg <= threshold.critical ? 'critical' : 'warning',
          message: `Low FPS detected: ${stats.avg.toFixed(1)} fps (target: >${threshold.warning})`
        });
      } else if (name !== 'fps' && stats.avg >= threshold.warning) {
        issues.push({
          metric: name,
          level: stats.avg >= threshold.critical ? 'critical' : 'warning',
          message: `High ${name} detected: ${stats.avg.toFixed(1)}${threshold.unit} (target: <${threshold.warning})`
        });
      }
    }
    
    return { summary, issues };
  }
  
  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }
  
  /**
   * Cleanup
   */
  dispose(): void {
    for (const observer of this.observers.values()) {
      observer.disconnect();
    }
    this.observers.clear();
    this.clear();
  }
}

// Singleton instance
let monitor: PerformanceMonitor | null = null;

export function getPerformanceMonitor(): PerformanceMonitor {
  if (!monitor) {
    monitor = new PerformanceMonitor();
  }
  return monitor;
}

// Helper hooks
export function usePerformanceMetric(name: string) {
  const monitor = getPerformanceMonitor();
  
  return {
    record: (value: number, unit: string, tags?: Record<string, string>) =>
      monitor.record(name, value, unit, tags),
    measure: () => monitor.startMeasure(name),
    getStats: (windowMs?: number) => monitor.getStats(name, windowMs)
  };
}