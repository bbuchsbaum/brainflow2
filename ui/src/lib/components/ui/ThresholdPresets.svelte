<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { Calculator } from 'lucide-svelte';
  
  interface Props {
    onSelect: (low: number, high: number) => void;
    dataMin?: number;
    dataMax?: number;
  }
  
  let {
    onSelect,
    dataMin = -5,
    dataMax = 5
  }: Props = $props();
  
  const dispatch = createEventDispatcher<{
    select: { low: number; high: number };
  }>();
  
  // Common statistical thresholds
  const presets = [
    { label: 't > 2.0', value: 2.0, description: 'p < 0.05 (one-tailed)' },
    { label: 't > 2.58', value: 2.58, description: 'p < 0.01 (one-tailed)' },
    { label: 't > 3.29', value: 3.29, description: 'p < 0.001 (one-tailed)' },
    { label: 'z > 1.96', value: 1.96, description: 'p < 0.05 (normal dist)' },
    { label: 'Custom Range', value: null, description: 'Set custom threshold range' },
  ];
  
  let showAbsolute = $state(true);
  let selectedPreset = $state<number | null>(null);
  
  function applyPreset(threshold: number | null) {
    selectedPreset = threshold;
    
    if (threshold === null) {
      // Custom range - don't change current values
      return;
    }
    
    if (showAbsolute) {
      // For absolute values, we want to hide values between -threshold and +threshold
      // This shows both strong positive and negative activations
      const normalizedNegThresh = normalizeValue(-threshold);
      const normalizedPosThresh = normalizeValue(threshold);
      
      // Current shader only supports showing values within a range
      // So we can either show:
      // 1. Positive values above threshold (most common for activation maps)
      // 2. Negative values below -threshold
      // Let's default to positive for now
      onSelect(normalizedPosThresh, 1);
      
      // TODO: Add a toggle for positive/negative/both
    } else {
      // Show values greater than threshold (one-tailed)
      const normalizedThreshold = normalizeValue(threshold);
      onSelect(normalizedThreshold, 1);
    }
    
    dispatch('select', { 
      low: showAbsolute ? normalizeValue(threshold) : normalizeValue(threshold), 
      high: 1 
    });
  }
  
  function normalizeValue(value: number): number {
    // Normalize value from data range to [0, 1]
    return (value - dataMin) / (dataMax - dataMin);
  }
  
  function clearPreset() {
    selectedPreset = null;
    onSelect(0, 1); // Show all values
    dispatch('select', { low: 0, high: 1 });
  }
</script>

<div class="threshold-presets">
  <div class="preset-header">
    <Calculator size={16} />
    <span class="preset-title">Statistical Thresholds</span>
  </div>
  
  <div class="preset-options">
    <label class="checkbox-label">
      <input
        type="checkbox"
        bind:checked={showAbsolute}
        class="checkbox"
      />
      <span>Show absolute values</span>
    </label>
  </div>
  
  <div class="preset-buttons">
    {#each presets as preset}
      <button
        class="preset-btn"
        class:active={selectedPreset === preset.value}
        onclick={() => applyPreset(preset.value)}
        title={preset.description}
      >
        {preset.label}
      </button>
    {/each}
  </div>
  
  {#if selectedPreset !== null}
    <button
      class="clear-btn"
      onclick={clearPreset}
    >
      Clear threshold
    </button>
  {/if}
  
  <div class="preset-note">
    <p class="text-xs text-muted-foreground">
      {#if showAbsolute}
        Showing positive values above threshold. For negative activations, 
        uncheck "Show absolute values" and use negative threshold.
      {:else}
        Showing all values above the selected threshold.
      {/if}
    </p>
  </div>
</div>

<style>
  .threshold-presets {
    margin-top: 1.5rem;
    padding: 0.75rem;
    background: var(--muted);
    border-radius: 0.375rem;
    border: 1px solid var(--border);
  }
  
  .preset-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    color: var(--foreground);
  }
  
  .preset-title {
    font-size: 0.875rem;
    font-weight: 500;
  }
  
  .preset-options {
    margin-bottom: 0.75rem;
  }
  
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    cursor: pointer;
  }
  
  .checkbox {
    width: 1rem;
    height: 1rem;
    cursor: pointer;
  }
  
  .preset-buttons {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  
  .preset-btn {
    padding: 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.2s;
    color: var(--foreground);
  }
  
  .preset-btn:hover {
    background: var(--muted);
    border-color: var(--primary);
  }
  
  .preset-btn.active {
    background: var(--primary);
    color: var(--primary-foreground);
    border-color: var(--primary);
  }
  
  .clear-btn {
    width: 100%;
    padding: 0.5rem;
    font-size: 0.875rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.2s;
    color: var(--muted-foreground);
    margin-bottom: 0.75rem;
  }
  
  .clear-btn:hover {
    background: var(--muted);
    color: var(--foreground);
  }
  
  .preset-note {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }
</style>