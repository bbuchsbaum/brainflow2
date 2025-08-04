/**
 * Performance Dashboard Component
 * Real-time performance monitoring overlay for development
 * Toggle with Ctrl+Shift+P
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getPerformanceMonitoringService } from '@/services/PerformanceMonitoringService';
import type { PerformanceReport } from '@/services/PerformanceMonitoringService';

const DEBUG_PERFORMANCE = process.env.NODE_ENV === 'development';

export function PerformanceDashboard() {
  const [metrics, setMetrics] = useState<PerformanceReport | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);

  useEffect(() => {
    if (!DEBUG_PERFORMANCE) return;

    const updateMetrics = () => {
      const report = getPerformanceMonitoringService().getReport();
      setMetrics(report);
    };

    updateMetrics();
    const interval = setInterval(updateMetrics, 1000);
    return () => clearInterval(interval);
  }, []);

  // Toggle visibility with Ctrl+Shift+P
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key === 'P') {
        setIsVisible(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!DEBUG_PERFORMANCE || !isVisible || !metrics) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'good': return 'text-green-400';
      case 'warning': return 'text-yellow-400';
      case 'poor': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getSeverityColor = (severity: string) => {
    return severity === 'critical' ? 'text-red-500' : 'text-yellow-500';
  };

  return createPortal(
    <div className="fixed top-4 right-4 bg-black bg-opacity-90 text-white p-4 rounded-lg z-50 max-w-md font-mono text-xs">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-sm">Performance Monitor</h3>
        <button 
          onClick={() => setIsVisible(false)} 
          className="text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </div>
      
      <div className="space-y-2">
        {/* Status Summary */}
        <div className={`font-semibold ${getStatusColor(metrics.summary.status)}`}>
          Status: {metrics.summary.status.toUpperCase()}
        </div>
        
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>Components: {metrics.summary.totalComponents}</div>
          <div>Active Alerts: {metrics.summary.totalAlerts}</div>
          <div>Avg Render: {metrics.summary.avgRenderTime.toFixed(1)}ms</div>
          <div>FPS: {metrics.summary.avgRenderTime > 0 ? (1000 / metrics.summary.avgRenderTime).toFixed(0) : '60'}</div>
        </div>

        {/* Recent Alerts */}
        {metrics.alerts.length > 0 && (
          <div className="mt-3">
            <div className="font-semibold text-red-400 mb-1">Recent Alerts:</div>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {metrics.alerts.slice(-3).map((alert, i) => (
                <div key={i} className={`text-xs ${getSeverityColor(alert.severity)}`}>
                  <span className="font-semibold">{alert.component}:</span> {alert.issue}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Component Metrics */}
        <div className="mt-3">
          <div className="font-semibold mb-1">Component Metrics:</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {Object.entries(metrics.metrics).slice(0, 5).map(([component, data]) => (
              <div 
                key={component} 
                className={`text-xs cursor-pointer hover:bg-gray-800 p-1 rounded ${
                  selectedComponent === component ? 'bg-gray-800' : ''
                }`}
                onClick={() => setSelectedComponent(
                  selectedComponent === component ? null : component
                )}
              >
                <div className="font-semibold">{component}:</div>
                {selectedComponent === component ? (
                  <div className="ml-2 space-y-0.5 text-gray-300">
                    <div>Render: {data.renderTime.toFixed(1)}ms</div>
                    <div>Frequency: {data.updateFrequency.toFixed(1)}/s</div>
                    <div>Re-renders: {data.reRenderCount}</div>
                    <div>Memory: {(data.memoryUsage / 1024 / 1024).toFixed(1)}MB</div>
                    {data.wheelEventRate > 0 && (
                      <div>Wheel: {data.wheelEventRate}/s</div>
                    )}
                    {data.backendCallRate > 0 && (
                      <div>Backend: {data.backendCallRate}/s</div>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-400">
                    {data.renderTime.toFixed(1)}ms | {data.updateFrequency.toFixed(1)}/s
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Memory Usage */}
        {typeof performance !== 'undefined' && 'memory' in performance && (
          <div className="mt-3 text-xs">
            <div className="font-semibold">Memory Usage:</div>
            <div className="text-gray-300">
              {((performance as any).memory.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / 
              {((performance as any).memory.jsHeapSizeLimit / 1024 / 1024).toFixed(0)}MB
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="mt-3 pt-2 border-t border-gray-700 flex gap-2">
          <button
            onClick={() => getPerformanceMonitoringService().clearAlerts()}
            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Clear Alerts
          </button>
          <button
            onClick={() => getPerformanceMonitoringService().resetMetrics()}
            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Reset All
          </button>
        </div>

        <div className="text-xs text-gray-500 mt-2">
          Press Ctrl+Shift+P to toggle
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Hook to integrate performance monitoring into components
 */
export function usePerformanceDashboard() {
  const [isDashboardVisible, setIsDashboardVisible] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key === 'P') {
        setIsDashboardVisible(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { isDashboardVisible };
}