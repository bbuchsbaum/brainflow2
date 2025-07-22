<!--
  LayerPanel Component
  Unified layer selection and controls in a compact, vertical layout
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getContainer } from '$lib/di/Container';
  import { useLayerStore, layers as layersStore, activeLayerId as activeLayerIdStore } from '$lib/stores/layerStore';
  import { sanitizeFileName } from '$lib/utils/sanitize';
  import { debounce } from '$lib/utils/debounce';
  import { ChevronDown, ChevronRight, Eye, EyeOff, Trash2 } from 'lucide-svelte';
  import type { EventBus } from '$lib/events/EventBus';
  import type { LayerService } from '$lib/services/LayerService';
  import type { LayerEntry } from '$lib/stores/layerStore';
  
  // Dependencies
  let eventBus: EventBus;
  let layerService: LayerService;
  
  // Store subscription
  const layerStore = useLayerStore;
  
  // State
  let layers = $state<LayerEntry[]>([]);
  let selectedLayerId = $state<string | null>(null);
  let selectedLayer = $derived(layers.find(l => getLayerId(l) === selectedLayerId));
  let unsubscribeFns: Array<() => void> = [];
  
  // UI state
  let layersExpanded = $state(true);
  let controlsExpanded = $state(true);
  
  // Control values for active layer
  let opacity = $state(100);
  let colormap = $state('grayscale');
  let windowMin = $state(0);
  let windowMax = $state(255);
  let thresholdMin = $state(0);
  let thresholdMax = $state(255);
  
  // Available colormaps
  const colormaps = [
    { value: 'grayscale', label: 'Grayscale' },
    { value: 'hot', label: 'Hot' },
    { value: 'cool', label: 'Cool' },
    { value: 'rainbow', label: 'Rainbow' },
    { value: 'viridis', label: 'Viridis' }
  ];
  
  onMount(async () => {
    const container = getContainer();
    [eventBus, layerService] = await container.resolveAll('eventBus', 'layerService');
    
    // Get initial state
    layers = useLayerStore.getState().layers;
    selectedLayerId = useLayerStore.getState().activeLayerId;
    updateControlsFromLayer();
    
    // Subscribe to store changes
    const unsubscribeLayers = layersStore.subscribe((newLayers) => {
      layers = newLayers;
      updateControlsFromLayer();
    });
    
    const unsubscribeSelected = activeLayerIdStore.subscribe((newId) => {
      selectedLayerId = newId;
      updateControlsFromLayer();
    });
    
    unsubscribeFns = [unsubscribeLayers, unsubscribeSelected];
  });
  
  // Cleanup subscriptions on destroy
  onDestroy(() => {
    unsubscribeFns.forEach(fn => fn());
  });
  
  // Update controls when selected layer changes
  function updateControlsFromLayer() {
    if (selectedLayer?.gpu) {
      opacity = (selectedLayer.gpu.opacity ?? 1) * 100;
      colormap = selectedLayer.gpu.colormap ?? 'grayscale';
      
      const range = selectedLayer.gpu.data_range;
      if (range) {
        windowMin = range.window_min ?? range.min;
        windowMax = range.window_max ?? range.max;
        thresholdMin = range.threshold_min ?? range.min;
        thresholdMax = range.threshold_max ?? range.max;
      }
    }
  }
  
  // Helper to get layer ID
  function getLayerId(entry: LayerEntry): string {
    if ('Volume' in entry.spec) {
      return entry.spec.Volume.id;
    }
    return '';
  }
  
  // Helper to get layer name
  function getLayerName(entry: LayerEntry): string {
    if ('Volume' in entry.spec) {
      const path = entry.spec.Volume.source_resource_id;
      return sanitizeFileName(path.split('/').pop() || path);
    }
    return 'Unknown Layer';
  }
  
  // Layer actions
  async function toggleVisibility(layer: LayerEntry) {
    const layerId = getLayerId(layer);
    const isVisible = layer.gpu?.visible ?? true;
    await layerService?.updateLayerVisibility(layerId, !isVisible);
  }
  
  async function removeLayer(layer: LayerEntry) {
    const layerId = getLayerId(layer);
    await layerService?.removeLayer(layerId);
  }
  
  function selectLayer(layer: LayerEntry) {
    useLayerStore.setActiveLayer(getLayerId(layer));
  }
  
  // Debounced control updates
  const updateOpacity = debounce(async (value: number) => {
    if (selectedLayerId && layerService) {
      await layerService.updateLayerOpacity(selectedLayerId, value / 100);
    }
  }, 100);
  
  const updateColormap = async (value: string) => {
    if (selectedLayerId && layerService) {
      await layerService.updateLayerColormap(selectedLayerId, value);
    }
  };
  
  const updateWindow = debounce(async () => {
    if (selectedLayerId && layerService) {
      await layerService.updateLayerWindow(selectedLayerId, windowMin, windowMax);
    }
  }, 100);
  
  const updateThreshold = debounce(async () => {
    if (selectedLayerId && layerService) {
      await layerService.updateLayerThreshold(selectedLayerId, thresholdMin, thresholdMax);
    }
  }, 100);
</script>

<div class="layer-panel">
  <!-- Layers Section -->
  <div class="section">
    <button
      class="section-header"
      onclick={() => layersExpanded = !layersExpanded}
      aria-expanded={layersExpanded}
    >
      {#if layersExpanded}
        <ChevronDown size={16} />
      {:else}
        <ChevronRight size={16} />
      {/if}
      <span>Layers ({layers.length})</span>
    </button>
    
    {#if layersExpanded}
      <div class="layer-list">
        {#each layers as layer (getLayerId(layer))}
          {@const layerId = getLayerId(layer)}
          {@const isVisible = layer.gpu?.visible ?? true}
          {@const isSelected = selectedLayerId === layerId}
          
          <div
            class="layer-item"
            class:selected={isSelected}
            class:loading={layer.isLoadingGpu}
            class:error={!!layer.error}
          >
            <input
              type="checkbox"
              checked={isVisible}
              onclick={(e) => {
                e.stopPropagation();
                toggleVisibility(layer);
              }}
              class="layer-checkbox"
              aria-label="Toggle visibility"
            />
            
            <button
              class="layer-name"
              onclick={() => selectLayer(layer)}
              title={getLayerName(layer)}
            >
              {getLayerName(layer)}
            </button>
            
            <div class="layer-actions">
              <button
                class="icon-btn"
                onclick={(e) => {
                  e.stopPropagation();
                  toggleVisibility(layer);
                }}
                title={isVisible ? 'Hide' : 'Show'}
              >
                {#if isVisible}
                  <Eye size={14} />
                {:else}
                  <EyeOff size={14} />
                {/if}
              </button>
              
              <button
                class="icon-btn danger"
                onclick={(e) => {
                  e.stopPropagation();
                  removeLayer(layer);
                }}
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </div>
            
            {#if layer.isLoadingGpu}
              <div class="loading-indicator" />
            {/if}
          </div>
        {/each}
        
        {#if layers.length === 0}
          <div class="empty-state">
            No layers loaded
          </div>
        {/if}
      </div>
    {/if}
  </div>
  
  <!-- Controls Section -->
  {#if selectedLayer}
    <div class="section">
      <button
        class="section-header"
        onclick={() => controlsExpanded = !controlsExpanded}
        aria-expanded={controlsExpanded}
      >
        {#if controlsExpanded}
          <ChevronDown size={16} />
        {:else}
          <ChevronRight size={16} />
        {/if}
        <span>Controls ({getLayerName(selectedLayer)})</span>
      </button>
      
      {#if controlsExpanded}
        <div class="controls">
          <!-- Opacity -->
          <div class="control-group">
            <label for="opacity">Opacity</label>
            <div class="slider-container">
              <input
                id="opacity"
                type="range"
                bind:value={opacity}
                min={0}
                max={100}
                step={1}
                oninput={() => updateOpacity(opacity)}
                class="slider"
              />
              <span class="value">{opacity}%</span>
            </div>
          </div>
          
          <!-- Colormap -->
          <div class="control-group">
            <label for="colormap">Colormap</label>
            <select
              id="colormap"
              bind:value={colormap}
              onchange={() => updateColormap(colormap)}
              class="select"
            >
              {#each colormaps as cm}
                <option value={cm.value}>{cm.label}</option>
              {/each}
            </select>
          </div>
          
          <!-- Window/Level -->
          <div class="control-group">
            <label>Window</label>
            <div class="range-inputs">
              <input
                type="number"
                bind:value={windowMin}
                oninput={updateWindow}
                class="number-input"
              />
              <span class="range-separator">–</span>
              <input
                type="number"
                bind:value={windowMax}
                oninput={updateWindow}
                class="number-input"
              />
            </div>
          </div>
          
          <!-- Threshold -->
          <div class="control-group">
            <label>Threshold</label>
            <div class="range-inputs">
              <input
                type="number"
                bind:value={thresholdMin}
                oninput={updateThreshold}
                class="number-input"
              />
              <span class="range-separator">–</span>
              <input
                type="number"
                bind:value={thresholdMax}
                oninput={updateThreshold}
                class="number-input"
              />
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .layer-panel {
    height: 100%;
    overflow-y: auto;
    background: var(--panel-bg, #f5f5f5);
    border-left: 1px solid var(--border-color, #ddd);
  }
  
  .section {
    border-bottom: 1px solid var(--border-color, #ddd);
  }
  
  .section-header {
    width: 100%;
    padding: 0.75rem 1rem;
    background: none;
    border: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-weight: 600;
    text-align: left;
    font-size: 0.875rem;
  }
  
  .section-header:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.05));
  }
  
  .layer-list {
    padding: 0.5rem;
  }
  
  .layer-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    position: relative;
    min-height: 32px;
  }
  
  .layer-item:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.05));
  }
  
  .layer-item.selected {
    background: var(--selected-bg, rgba(0, 100, 255, 0.1));
    outline: 1px solid var(--selected-border, rgba(0, 100, 255, 0.3));
  }
  
  .layer-checkbox {
    width: 14px;
    height: 14px;
    cursor: pointer;
  }
  
  .layer-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.8125rem;
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    color: inherit;
  }
  
  .layer-actions {
    display: flex;
    gap: 0.125rem;
    opacity: 0;
    transition: opacity 0.2s;
  }
  
  .layer-item:hover .layer-actions {
    opacity: 1;
  }
  
  .icon-btn {
    background: none;
    border: none;
    padding: 0.25rem;
    cursor: pointer;
    border-radius: 3px;
    color: var(--text-secondary, #666);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .icon-btn:hover {
    background: var(--hover-bg, rgba(0, 0, 0, 0.1));
    color: var(--text-primary, #000);
  }
  
  .icon-btn.danger:hover {
    background: rgba(220, 38, 38, 0.1);
    color: #dc2626;
  }
  
  .loading-indicator {
    position: absolute;
    right: 0.5rem;
    width: 14px;
    height: 14px;
    border: 2px solid var(--border-color, #ddd);
    border-top-color: var(--primary-color, #0066cc);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  .empty-state {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--text-secondary, #666);
    font-size: 0.8125rem;
  }
  
  .controls {
    padding: 0.75rem 1rem;
  }
  
  .control-group {
    margin-bottom: 0.875rem;
  }
  
  .control-group:last-child {
    margin-bottom: 0;
  }
  
  .control-group label {
    display: block;
    margin-bottom: 0.375rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-secondary, #666);
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }
  
  .slider-container {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  
  .slider {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--slider-bg, #ddd);
    border-radius: 2px;
    outline: none;
  }
  
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: var(--primary-color, #0066cc);
    cursor: pointer;
    border-radius: 50%;
  }
  
  .slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: var(--primary-color, #0066cc);
    cursor: pointer;
    border-radius: 50%;
    border: none;
  }
  
  .value {
    font-size: 0.75rem;
    color: var(--text-secondary, #666);
    min-width: 35px;
    text-align: right;
  }
  
  .select {
    width: 100%;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    font-size: 0.8125rem;
    background: white;
    color: inherit;
  }
  
  .range-inputs {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .number-input {
    width: 72px;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    font-size: 0.75rem;
    text-align: center;
  }
  
  .range-separator {
    font-size: 0.8125rem;
    color: var(--text-secondary, #666);
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* Compact mode for smaller screens */
  @media (max-height: 600px) {
    .section-header {
      padding: 0.5rem 0.75rem;
    }
    
    .layer-item {
      padding: 0.25rem 0.5rem;
      min-height: 28px;
    }
    
    .control-group {
      margin-bottom: 0.625rem;
    }
  }
</style>