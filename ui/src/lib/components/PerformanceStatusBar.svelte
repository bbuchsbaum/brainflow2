<!--
  PerformanceStatusBar Component
  Simplified status bar focused on performance metrics
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { getContainer } from '$lib/di/Container';
  import { getPerformanceMonitor } from '$lib/performance/PerformanceMonitor';
  import type { EventBus } from '$lib/events/EventBus';
  import type { GpuResourceManager } from '$lib/gpu/GpuResourceManager';
  
  // Dependencies
  let eventBus: EventBus | null = null;
  let gpuManager: GpuResourceManager | null = null;
  const perfMonitor = getPerformanceMonitor();
  
  // State
  let status = $state('Ready');
  let gpuMemory = $state(0);
  let fps = $state(60);
  let isLoading = $state(false);
  
  // Performance monitoring
  let stopFpsMonitoring: (() => void) | null = null;
  let updateInterval: number | null = null;
  
  onMount(async () => {
    try {
      const container = getContainer();
      [eventBus, gpuManager] = await container.resolveAll('eventBus', 'gpuResourceManager');
    } catch (e) {
      console.warn('Some services not available:', e);
    }
    
    // Start FPS monitoring
    stopFpsMonitoring = perfMonitor.startFpsMonitoring();
    
    // Update metrics every second
    updateInterval = window.setInterval(updateMetrics, 1000);
    
    // Subscribe to events if available
    const unsubscribes: Array<() => void> = [];
    
    if (eventBus) {
      unsubscribes.push(
        eventBus.on('volume.loading', () => {
          status = 'Loading volume...';
          isLoading = true;
        }),
        eventBus.on('volume.loaded', () => {
          status = 'Ready';
          isLoading = false;
        }),
        eventBus.on('layer.gpu.request.start', () => {
          status = 'Uploading to GPU...';
          isLoading = true;
        }),
        eventBus.on('layer.gpu.request.success', () => {
          status = 'Ready';
          isLoading = false;
        }),
        eventBus.on('error.boundary.caught', (data) => {
          status = `Error: ${data.error.message}`;
          isLoading = false;
        })
      );
    }
    
    // Initial update
    updateMetrics();
    
    return () => {
      unsubscribes.forEach(fn => fn());
      if (stopFpsMonitoring) stopFpsMonitoring();
      if (updateInterval) clearInterval(updateInterval);
    };
  });
  
  async function updateMetrics() {
    // Get FPS
    const fpsStats = perfMonitor.getStats('fps', 5000);
    if (fpsStats) {
      fps = Math.round(fpsStats.avg);
    }
    
    // Get GPU memory if available
    if (gpuManager) {
      try {
        const gpuStats = await gpuManager.getStats();
        gpuMemory = Math.round(gpuStats.totalMemory / 1024 / 1024); // Convert to MB
      } catch (e) {
        // GPU stats not available
      }
    }
  }
  
  // Format memory display
  function formatMemory(mb: number): string {
    if (mb === 0) return '—';
    if (mb < 1024) return `${mb}MB`;
    return `${(mb / 1024).toFixed(1)}GB`;
  }
  
  // Get FPS color
  function getFpsColor(fps: number): string {
    if (fps >= 50) return '#10b981';
    if (fps >= 30) return '#f59e0b';
    return '#ef4444';
  }
</script>

<div class="perf-status-bar">
  <div class="status-item">
    <span class="label">Status:</span>
    <span class="value" class:loading={isLoading}>
      {status}
    </span>
  </div>
  
  <div class="separator" />
  
  <div class="status-item">
    <span class="label">GPU:</span>
    <span class="value">
      {formatMemory(gpuMemory)}
    </span>
  </div>
  
  <div class="separator" />
  
  <div class="status-item">
    <span class="label">FPS:</span>
    <span 
      class="value fps"
      style:color={getFpsColor(fps)}
    >
      {fps}
    </span>
  </div>
</div>

<style>
  .perf-status-bar {
    display: flex;
    align-items: center;
    height: 24px;
    padding: 0 0.75rem;
    background: var(--status-bg, #f8f8f8);
    border-top: 1px solid var(--border-color, #e5e5e5);
    font-size: 0.6875rem;
    font-family: system-ui, -apple-system, sans-serif;
  }
  
  .status-item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  
  .label {
    font-weight: 500;
    color: var(--text-secondary, #666);
  }
  
  .value {
    color: var(--text-primary, #333);
  }
  
  .value.loading {
    animation: pulse 1.5s ease-in-out infinite;
  }
  
  .separator {
    width: 1px;
    height: 14px;
    background: var(--border-color, #e5e5e5);
    margin: 0 0.75rem;
  }
  
  .fps {
    font-family: 'SF Mono', Monaco, monospace;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
</style>