/**
 * Performance Monitoring Service
 * Centralized service for tracking performance metrics across the application
 */

import type { PerformanceMetrics } from '@/hooks/usePerformanceMonitor';

export interface PerformanceAlert {
  component: string;
  issue: string;
  timestamp: number;
  severity: 'warning' | 'critical';
}

export interface PerformanceReport {
  metrics: Record<string, PerformanceMetrics>;
  alerts: PerformanceAlert[];
  summary: {
    totalComponents: number;
    totalAlerts: number;
    avgRenderTime: number;
    status: 'good' | 'warning' | 'poor';
  };
}

class PerformanceMonitoringService {
  private static instance: PerformanceMonitoringService;
  private metrics = new Map<string, PerformanceMetrics>();
  private alerts: PerformanceAlert[] = [];
  private enabled = process.env.NODE_ENV === 'development';

  private thresholds = {
    renderTime: 16, // 60fps
    wheelEventRate: 10, // events/sec
    memoryUsage: 500 * 1024 * 1024, // 500MB
    reRenderCount: 100, // per minute
    backendCallRate: 60, // calls/sec
  };

  private constructor() {
    if (this.enabled) {
      console.log('🚀 Performance Monitoring Service initialized');
      this.startPeriodicReporting();
    }
  }

  static getInstance(): PerformanceMonitoringService {
    if (!PerformanceMonitoringService.instance) {
      PerformanceMonitoringService.instance = new PerformanceMonitoringService();
    }
    return PerformanceMonitoringService.instance;
  }

  recordMetric(component: string, metric: keyof PerformanceMetrics, value: number) {
    if (!this.enabled) return;

    if (!this.metrics.has(component)) {
      this.metrics.set(component, {
        renderTime: 0,
        updateFrequency: 0,
        memoryUsage: 0,
        wheelEventRate: 0,
        reRenderCount: 0,
        backendCallRate: 0,
      });
    }

    const componentMetrics = this.metrics.get(component)!;
    componentMetrics[metric] = value;

    // Check for performance issues
    this.checkPerformanceThresholds(component, metric, value);
  }

  updateMetrics(component: string, metrics: Partial<PerformanceMetrics>) {
    if (!this.enabled) return;

    const currentMetrics = this.metrics.get(component) || {
      renderTime: 0,
      updateFrequency: 0,
      memoryUsage: 0,
      wheelEventRate: 0,
      reRenderCount: 0,
      backendCallRate: 0,
    };

    this.metrics.set(component, { ...currentMetrics, ...metrics });

    // Check all updated metrics
    Object.entries(metrics).forEach(([metric, value]) => {
      if (value !== undefined) {
        this.checkPerformanceThresholds(
          component,
          metric as keyof PerformanceMetrics,
          value
        );
      }
    });
  }

  private checkPerformanceThresholds(
    component: string,
    metric: keyof PerformanceMetrics,
    value: number
  ) {
    const threshold = this.thresholds[metric];
    if (!threshold) return;

    const severity = value > threshold * 1.5 ? 'critical' : 'warning';

    if (value > threshold) {
      const issue = `${metric} exceeded threshold: ${value.toFixed(1)} > ${threshold}`;
      
      this.alerts.push({
        component,
        issue,
        timestamp: Date.now(),
        severity,
      });

      // Keep only recent alerts (last 5 minutes)
      this.alerts = this.alerts.filter(
        alert => Date.now() - alert.timestamp < 300000
      );

      // Log critical issues immediately
      if (severity === 'critical') {
        console.error(`🚨 Critical performance issue in ${component}: ${issue}`);
      }
    }
  }

  getReport(): PerformanceReport {
    const metricsArray = Array.from(this.metrics.entries());
    const totalComponents = metricsArray.length;
    const totalAlerts = this.alerts.length;
    
    // Calculate average render time
    const avgRenderTime = totalComponents > 0
      ? metricsArray.reduce((sum, [_, m]) => sum + m.renderTime, 0) / totalComponents
      : 0;

    const status = 
      totalAlerts === 0 ? 'good' :
      totalAlerts < 5 ? 'warning' : 'poor';

    return {
      metrics: Object.fromEntries(this.metrics),
      alerts: this.alerts,
      summary: {
        totalComponents,
        totalAlerts,
        avgRenderTime,
        status,
      },
    };
  }

  clearAlerts() {
    this.alerts = [];
  }

  resetMetrics() {
    this.metrics.clear();
    this.alerts = [];
  }

  private startPeriodicReporting() {
    // Report summary every 30 seconds in development
    setInterval(() => {
      const report = this.getReport();
      if (report.summary.totalComponents > 0) {
        console.log('📊 Performance Report:', {
          status: report.summary.status,
          components: report.summary.totalComponents,
          alerts: report.summary.totalAlerts,
          avgRenderTime: `${report.summary.avgRenderTime.toFixed(1)}ms`,
        });

        // Log any critical alerts
        const criticalAlerts = report.alerts.filter(a => a.severity === 'critical');
        if (criticalAlerts.length > 0) {
          console.warn('⚠️ Critical performance issues:', criticalAlerts);
        }
      }
    }, 30000);
  }

  // Utility method for conditional logging
  static log(message: string, ...args: any[]) {
    if (process.env.NODE_ENV === 'development' && 
        process.env.REACT_APP_DEBUG_PERFORMANCE === 'true') {
      console.log(`⚡ ${message}`, ...args);
    }
  }

  // Performance measurement utility
  static async measureAsync<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    if (process.env.NODE_ENV !== 'development') {
      return fn();
    }

    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      
      if (duration > 50) {
        console.warn(`⚠️ Slow operation "${operation}": ${duration.toFixed(1)}ms`);
      } else {
        this.log(`${operation}: ${duration.toFixed(1)}ms`);
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      console.error(`❌ Failed operation "${operation}" after ${duration.toFixed(1)}ms:`, error);
      throw error;
    }
  }

  static measure<T>(operation: string, fn: () => T): T {
    if (process.env.NODE_ENV !== 'development') {
      return fn();
    }

    const start = performance.now();
    try {
      const result = fn();
      const duration = performance.now() - start;
      
      if (duration > 16) {
        console.warn(`⚠️ Slow sync operation "${operation}": ${duration.toFixed(1)}ms`);
      } else {
        this.log(`${operation}: ${duration.toFixed(1)}ms`);
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      console.error(`❌ Failed operation "${operation}" after ${duration.toFixed(1)}ms:`, error);
      throw error;
    }
  }
}

// Export singleton instance getter
export function getPerformanceMonitoringService(): PerformanceMonitoringService {
  return PerformanceMonitoringService.getInstance();
}

// Export static utilities
export const { log: perfLog, measure, measureAsync } = PerformanceMonitoringService;