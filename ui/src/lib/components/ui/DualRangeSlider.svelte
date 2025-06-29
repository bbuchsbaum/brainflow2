<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  interface Props {
    min?: number;
    max?: number;
    step?: number;
    valueLow?: number;
    valueHigh?: number;
    disabled?: boolean;
    label?: string;
    formatValue?: (value: number) => string;
  }
  
  let {
    min = 0,
    max = 1,
    step = 0.01,
    valueLow = $bindable(0.2),
    valueHigh = $bindable(0.8),
    disabled = false,
    label = '',
    formatValue = (v: number) => v.toFixed(2)
  }: Props = $props();
  
  const dispatch = createEventDispatcher<{
    change: { low: number; high: number };
    input: { low: number; high: number };
  }>();
  
  // Track which thumb is being dragged
  let draggingThumb: 'low' | 'high' | null = $state(null);
  
  // Calculate thumb positions as percentages
  let lowPercent = $derived(((valueLow - min) / (max - min)) * 100);
  let highPercent = $derived(((valueHigh - min) / (max - min)) * 100);
  
  // Handle low thumb input
  function handleLowInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const newValue = parseFloat(target.value);
    
    // Ensure low doesn't exceed high
    valueLow = Math.min(newValue, valueHigh);
    
    dispatch('input', { low: valueLow, high: valueHigh });
  }
  
  // Handle high thumb input
  function handleHighInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const newValue = parseFloat(target.value);
    
    // Ensure high doesn't go below low
    valueHigh = Math.max(newValue, valueLow);
    
    dispatch('input', { low: valueLow, high: valueHigh });
  }
  
  // Handle change events (when user releases the thumb)
  function handleChange() {
    dispatch('change', { low: valueLow, high: valueHigh });
  }
  
  // Track which thumb is being dragged for z-index management
  function startDrag(thumb: 'low' | 'high') {
    draggingThumb = thumb;
  }
  
  function endDrag() {
    draggingThumb = null;
  }
</script>

<div class="dual-range-slider" class:disabled>
  {#if label}
    <label class="slider-label">
      <span>{label}</span>
      <span class="values">
        {formatValue(valueLow)} - {formatValue(valueHigh)}
      </span>
    </label>
  {/if}
  
  <div class="slider-container">
    <!-- Track background -->
    <div class="track"></div>
    
    <!-- Active range track -->
    <div 
      class="track-active"
      style="left: {lowPercent}%; right: {100 - highPercent}%"
    ></div>
    
    <!-- Low value input -->
    <input
      type="range"
      class="thumb thumb-low"
      class:dragging={draggingThumb === 'low'}
      {min}
      {max}
      {step}
      value={valueLow}
      {disabled}
      oninput={handleLowInput}
      onchange={handleChange}
      onmousedown={() => startDrag('low')}
      onmouseup={endDrag}
      ontouchstart={() => startDrag('low')}
      ontouchend={endDrag}
    />
    
    <!-- High value input -->
    <input
      type="range"
      class="thumb thumb-high"
      class:dragging={draggingThumb === 'high'}
      {min}
      {max}
      {step}
      value={valueHigh}
      {disabled}
      oninput={handleHighInput}
      onchange={handleChange}
      onmousedown={() => startDrag('high')}
      onmouseup={endDrag}
      ontouchstart={() => startDrag('high')}
      ontouchend={endDrag}
    />
  </div>
</div>

<style>
  .dual-range-slider {
    width: 100%;
  }
  
  .dual-range-slider.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  
  .slider-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
  }
  
  .values {
    font-weight: normal;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
  
  .slider-container {
    position: relative;
    height: 1.5rem;
    margin: 0.5rem 0;
  }
  
  .track {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 0.375rem;
    transform: translateY(-50%);
    background: var(--muted);
    border-radius: 0.1875rem;
  }
  
  .track-active {
    position: absolute;
    top: 50%;
    height: 0.375rem;
    transform: translateY(-50%);
    background: var(--primary);
    opacity: 0.3;
    border-radius: 0.1875rem;
    transition: left 0.1s ease, right 0.1s ease;
  }
  
  .thumb {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 100%;
    height: 1.5rem;
    background: transparent;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
    pointer-events: none;
    cursor: pointer;
  }
  
  .thumb::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    background: var(--primary);
    cursor: pointer;
    pointer-events: auto;
    position: relative;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }
  
  .thumb::-moz-range-thumb {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    background: var(--primary);
    cursor: pointer;
    pointer-events: auto;
    border: none;
    position: relative;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }
  
  .thumb:hover::-webkit-slider-thumb {
    transform: scale(1.1);
    box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.2);
  }
  
  .thumb:hover::-moz-range-thumb {
    transform: scale(1.1);
    box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.2);
  }
  
  .thumb.dragging::-webkit-slider-thumb {
    transform: scale(1.2);
    box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.3);
  }
  
  .thumb.dragging::-moz-range-thumb {
    transform: scale(1.2);
    box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.3);
  }
  
  /* Z-index management to ensure the dragging thumb is on top */
  .thumb-low {
    z-index: 1;
  }
  
  .thumb-high {
    z-index: 2;
  }
  
  .thumb-low.dragging {
    z-index: 3;
  }
  
  /* Fix for overlapping thumbs */
  .thumb::-webkit-slider-runnable-track {
    width: 100%;
    height: 100%;
    background: transparent;
  }
  
  .thumb::-moz-range-track {
    width: 100%;
    height: 100%;
    background: transparent;
    border: none;
  }
</style>