<script lang="ts">
  import { BarChart3 } from 'lucide-svelte';
  
  interface Props {
    thresholdLow: number;
    thresholdHigh: number;
    dataMin: number;
    dataMax: number;
    showHistogram?: boolean;
  }
  
  let {
    thresholdLow,
    thresholdHigh,
    dataMin,
    dataMax,
    showHistogram = false
  }: Props = $props();
  
  // Calculate what percentage of the range is visible
  let visiblePercent = $derived(() => {
    const totalRange = dataMax - dataMin;
    const visibleRange = thresholdHigh - thresholdLow;
    return Math.max(0, Math.min(100, (visibleRange / totalRange) * 100));
  });
  
  // Convert normalized threshold back to data values
  let dataThreshLow = $derived(dataMin + thresholdLow * (dataMax - dataMin));
  let dataThreshHigh = $derived(dataMin + thresholdHigh * (dataMax - dataMin));
</script>

<div class="threshold-info">
  <div class="info-header">
    <BarChart3 size={14} />
    <span class="info-title">Threshold Range</span>
  </div>
  
  <div class="info-content">
    <div class="range-display">
      <span class="range-value">{dataThreshLow.toFixed(2)}</span>
      <span class="range-separator">to</span>
      <span class="range-value">{dataThreshHigh.toFixed(2)}</span>
    </div>
    
    <div class="visibility-bar">
      <div 
        class="visibility-fill"
        style="width: {visiblePercent()}%"
      ></div>
    </div>
    
    <p class="visibility-text">
      Showing {visiblePercent().toFixed(0)}% of value range
    </p>
  </div>
  
  {#if showHistogram}
    <div class="histogram-placeholder">
      <p class="text-xs text-muted-foreground">
        Histogram visualization coming soon
      </p>
    </div>
  {/if}
</div>

<style>
  .threshold-info {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: var(--muted);
    border-radius: 0.375rem;
    border: 1px solid var(--border);
  }
  
  .info-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    color: var(--muted-foreground);
  }
  
  .info-title {
    font-size: 0.75rem;
    font-weight: 500;
  }
  
  .info-content {
    space-y: 0.5rem;
  }
  
  .range-display {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  
  .range-value {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--foreground);
  }
  
  .range-separator {
    color: var(--muted-foreground);
    font-size: 0.875rem;
  }
  
  .visibility-bar {
    width: 100%;
    height: 0.25rem;
    background: var(--border);
    border-radius: 0.125rem;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }
  
  .visibility-fill {
    height: 100%;
    background: var(--primary);
    transition: width 0.2s ease;
  }
  
  .visibility-text {
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  
  .histogram-placeholder {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: var(--background);
    border-radius: 0.25rem;
    text-align: center;
  }
</style>