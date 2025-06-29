<!--
  LayerControls Component - Migrated to new architecture
  Provides layer appearance, window/level, and blend mode controls
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getService } from '$lib/di/Container';
  import { getEventBus } from '$lib/events/EventBus';
  import type { LayerService } from '$lib/services/LayerService';
  import type { NotificationService } from '$lib/services/NotificationService';
  import type { EventBus } from '$lib/events/EventBus';
  import { layerStoreClean } from '$lib/stores/layerStore.clean';
  import { Palette, SlidersHorizontal, Blend } from 'lucide-svelte';
  import type { LayerPatch, LayerSpec } from '@brainflow/api';
  
  interface VolumeLayerSpec {
    id: string;
    source_resource_id: string;
    colormap?: string;
    opacity?: number;
    window?: { center: number; width: number };
    threshold?: { low: number; high: number };
    blendMode?: 'over' | 'add' | 'max' | 'min';
    slice_axis?: string | null;
    slice_index?: number | null;
  }
  import DualRangeSlider from '$lib/components/ui/DualRangeSlider.svelte';
  import ThresholdPresets from '$lib/components/ui/ThresholdPresets.svelte';
  import ThresholdInfo from '$lib/components/ui/ThresholdInfo.svelte';
  import { debounce } from '$lib/utils/debounce';
  
  // Props
  let {
    class: className = ''
  }: {
    class?: string;
  } = $props();
  
  // Services
  let layerService: LayerService | null = null;
  let notificationService: NotificationService | null = null;
  let eventBus: EventBus = getEventBus();
  
  // Store state
  let storeState = $state(layerStoreClean.getState());
  
  // Local state
  let activeTab = $state<'appearance' | 'window' | 'blend'>('appearance');
  let isUpdating = $state(false);
  
  // Derived state
  let selectedLayer = $derived(() => {
    const layerId = storeState.activeLayerId;
    if (!layerId) return null;
    
    const layer = storeState.layers.get(layerId);
    if (!layer || !('Volume' in layer.spec)) return null;
    
    return layer;
  });
  
  let volumeSpec = $derived(() => {
    const layer = selectedLayer();
    if (!layer || !('Volume' in layer.spec)) return null;
    return layer.spec.Volume as VolumeLayerSpec;
  });
  
  // Layer properties - synced with actual layer data
  let opacity = $state(1.0);
  let colormap = $state('grayscale');
  let windowCenter = $state(0);
  let windowWidth = $state(100);
  let thresholdLow = $state(0);
  let thresholdHigh = $state(1);
  let blendMode = $state<'over' | 'add' | 'max' | 'min'>('over');
  
  // Data range for the current layer
  let dataMin = $state(0);
  let dataMax = $state(1);
  
  // Sync layer properties when selection changes
  $effect(() => {
    const spec = volumeSpec();
    if (!spec) return;
    
    // Update from layer spec
    opacity = spec.opacity ?? 1.0;
    colormap = spec.colormap ?? 'grayscale';
    windowCenter = spec.window?.center ?? 0;
    windowWidth = spec.window?.width ?? 100;
    thresholdLow = spec.threshold?.low ?? 0;
    thresholdHigh = spec.threshold?.high ?? 1;
    blendMode = spec.blendMode ?? 'over';
    
    // Get data range from layer info if available
    const layer = selectedLayer();
    if (layer?.info?.dataRange) {
      dataMin = layer.info.dataRange.min;
      dataMax = layer.info.dataRange.max;
    }
  });
  
  // Available colormaps
  const colormaps = [
    { value: 'grayscale', label: 'Grayscale' },
    { value: 'viridis', label: 'Viridis' },
    { value: 'hot', label: 'Hot' },
    { value: 'cool', label: 'Cool' },
    { value: 'plasma', label: 'Plasma' },
    { value: 'inferno', label: 'Inferno' },
    { value: 'turbo', label: 'Turbo' },
    { value: 'rainbow', label: 'Rainbow' },
  ];
  
  // Blend modes
  const blendModes = [
    { value: 'over', label: 'Normal (Alpha)' },
    { value: 'add', label: 'Additive' },
    { value: 'max', label: 'Maximum' },
    { value: 'min', label: 'Minimum' },
  ];
  
  // Update layer through service
  async function updateLayer(updates: Partial<VolumeLayerSpec>) {
    const layer = selectedLayer();
    if (!layer || !layerService) return;
    
    isUpdating = true;
    
    try {
      console.log('[LayerControls] Updating layer:', updates);
      await layerService.updateLayer(layer.id, updates);
      
      // Emit specific events based on what changed
      if ('opacity' in updates) {
        eventBus.emit('layercontrols.opacity.changed', { 
          layerId: layer.id, 
          opacity: updates.opacity! 
        });
      }
      if ('colormap' in updates) {
        eventBus.emit('layercontrols.colormap.changed', { 
          layerId: layer.id, 
          colormap: updates.colormap! 
        });
      }
      if ('window' in updates) {
        eventBus.emit('layercontrols.window.changed', { 
          layerId: layer.id, 
          window: updates.window! 
        });
      }
      if ('threshold' in updates) {
        eventBus.emit('layercontrols.threshold.changed', { 
          layerId: layer.id, 
          threshold: updates.threshold! 
        });
      }
      if ('blendMode' in updates) {
        eventBus.emit('layercontrols.blendmode.changed', { 
          layerId: layer.id, 
          blendMode: updates.blendMode! 
        });
      }
    } catch (error) {
      console.error('[LayerControls] Failed to update layer:', error);
      notificationService?.error('Failed to update layer settings');
    } finally {
      isUpdating = false;
    }
  }
  
  // Debounced version for continuous updates
  const debouncedUpdateLayer = debounce(updateLayer, 300);
  
  function updateOpacity(value: number) {
    opacity = value;
    debouncedUpdateLayer({ opacity: value });
  }
  
  function updateColormap(value: string) {
    colormap = value;
    updateLayer({ colormap: value });
  }
  
  function updateWindow(center: number, width: number) {
    windowCenter = center;
    windowWidth = width;
    debouncedUpdateLayer({ 
      window: { center, width }
    });
  }
  
  function updateThreshold(low: number, high: number) {
    thresholdLow = low;
    thresholdHigh = high;
    debouncedUpdateLayer({ 
      threshold: { low, high }
    });
  }
  
  function updateBlendMode(value: typeof blendMode) {
    blendMode = value;
    updateLayer({ blendMode: value });
  }
  
  // Handle preset selections
  function applyThresholdPreset(preset: { low: number; high: number }) {
    updateThreshold(preset.low, preset.high);
    eventBus.emit('layercontrols.preset.applied', { 
      layerId: selectedLayer()?.id, 
      preset 
    });
  }
  
  // Subscribe to events
  let eventUnsubscribes: Array<() => void> = [];
  
  function subscribeToEvents() {
    // Listen for external layer updates
    eventUnsubscribes.push(
      eventBus.on('layer.updated', ({ layerId }) => {
        const layer = selectedLayer();
        if (layer && layer.id === layerId) {
          // Re-sync properties when layer is updated externally
          const spec = volumeSpec();
          if (spec) {
            opacity = spec.opacity ?? opacity;
            colormap = spec.colormap ?? colormap;
            windowCenter = spec.window?.center ?? windowCenter;
            windowWidth = spec.window?.width ?? windowWidth;
            thresholdLow = spec.threshold?.low ?? thresholdLow;
            thresholdHigh = spec.threshold?.high ?? thresholdHigh;
            blendMode = spec.blendMode ?? blendMode;
          }
        }
      })
    );
    
    // Listen for data range updates
    eventUnsubscribes.push(
      eventBus.on('layer.datarange.updated', ({ layerId, dataRange }) => {
        const layer = selectedLayer();
        if (layer && layer.id === layerId) {
          dataMin = dataRange.min;
          dataMax = dataRange.max;
        }
      })
    );
    
    // Listen for preset requests
    eventUnsubscribes.push(
      eventBus.on('layercontrols.preset.request', ({ presetName }) => {
        const layer = selectedLayer();
        if (!layer) return;
        
        // Apply preset based on name
        switch (presetName) {
          case 'brain-ct':
            updateWindow(40, 80);
            break;
          case 'brain-mri':
            updateWindow(500, 1000);
            break;
          case 'lung-ct':
            updateWindow(-500, 1500);
            break;
          default:
            console.warn('[LayerControls] Unknown preset:', presetName);
        }
      })
    );
  }
  
  // Lifecycle
  onMount(async () => {
    try {
      // Get services
      [layerService, notificationService] = await Promise.all([
        getService<LayerService>('layerService'),
        getService<NotificationService>('notificationService')
      ]);
      
      // Subscribe to store
      const unsubscribeStore = layerStoreClean.subscribe((state) => {
        storeState = state;
      });
      
      // Subscribe to events
      subscribeToEvents();
      
      // Emit ready event
      eventBus.emit('layercontrols.ready');
      
      // Cleanup
      return () => {
        unsubscribeStore();
        eventUnsubscribes.forEach(fn => fn());
      };
    } catch (error) {
      console.error('[LayerControls] Failed to initialize:', error);
      notificationService?.error('Failed to initialize layer controls');
    }
  });
</script>

<div class="layer-controls {className}" role="region" aria-label="Layer controls">
  {#if !selectedLayer()}
    <div class="empty-state">
      <p class="text-sm text-muted-foreground">Select a layer to edit</p>
    </div>
  {:else}
    <!-- Tab Bar -->
    <div class="tabs">
      <button
        class="tab"
        class:active={activeTab === 'appearance'}
        onclick={() => activeTab = 'appearance'}
      >
        <Palette size={16} />
        <span>Appearance</span>
      </button>
      <button
        class="tab"
        class:active={activeTab === 'window'}
        onclick={() => activeTab = 'window'}
      >
        <SlidersHorizontal size={16} />
        <span>Window/Level</span>
      </button>
      <button
        class="tab"
        class:active={activeTab === 'blend'}
        onclick={() => activeTab = 'blend'}
      >
        <Blend size={16} />
        <span>Blend</span>
      </button>
    </div>
    
    <!-- Tab Content -->
    <div class="tab-content">
      {#if activeTab === 'appearance'}
        <div class="control-group">
          <label class="control-label">
            <span>Opacity</span>
            <span class="value">{(opacity * 100).toFixed(0)}%</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={opacity}
            oninput={(e) => updateOpacity(parseFloat(e.currentTarget.value))}
            disabled={isUpdating}
            class="slider"
          />
        </div>
        
        <div class="control-group">
          <label class="control-label">Colormap</label>
          <select
            value={colormap}
            onchange={(e) => updateColormap(e.currentTarget.value)}
            disabled={isUpdating}
            class="select"
          >
            {#each colormaps as cm}
              <option value={cm.value}>{cm.label}</option>
            {/each}
          </select>
        </div>
      {/if}
      
      {#if activeTab === 'window'}
        <div class="control-group">
          <label class="control-label">Window Center</label>
          <input
            type="number"
            value={windowCenter}
            oninput={(e) => updateWindow(parseFloat(e.currentTarget.value), windowWidth)}
            disabled={isUpdating}
            class="input"
          />
        </div>
        
        <div class="control-group">
          <label class="control-label">Window Width</label>
          <input
            type="number"
            value={windowWidth}
            min="1"
            oninput={(e) => updateWindow(windowCenter, parseFloat(e.currentTarget.value))}
            disabled={isUpdating}
            class="input"
          />
        </div>
        
        <div class="control-group">
          <DualRangeSlider
            label="Threshold"
            min={0}
            max={1}
            step={0.01}
            bind:valueLow={thresholdLow}
            bind:valueHigh={thresholdHigh}
            on:input={(e) => updateThreshold(e.detail.low, e.detail.high)}
            disabled={isUpdating}
          />
        </div>
        
        <ThresholdInfo
          thresholdLow={thresholdLow}
          thresholdHigh={thresholdHigh}
          dataMin={dataMin}
          dataMax={dataMax}
        />
        
        <ThresholdPresets
          onSelect={(preset) => applyThresholdPreset(preset)}
          dataMin={dataMin}
          dataMax={dataMax}
        />
      {/if}
      
      {#if activeTab === 'blend'}
        <div class="control-group">
          <label class="control-label">Blend Mode</label>
          <select
            value={blendMode}
            onchange={(e) => updateBlendMode(e.currentTarget.value as typeof blendMode)}
            disabled={isUpdating}
            class="select"
          >
            {#each blendModes as mode}
              <option value={mode.value}>{mode.label}</option>
            {/each}
          </select>
        </div>
        
        <div class="info-box">
          <p class="text-xs">
            <strong>Normal:</strong> Standard transparency blending<br/>
            <strong>Additive:</strong> Adds layer values together<br/>
            <strong>Maximum:</strong> Shows highest value at each pixel<br/>
            <strong>Minimum:</strong> Shows lowest value at each pixel
          </p>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .layer-controls {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--background);
    color: var(--foreground);
  }
  
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    padding: 2rem;
  }
  
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    background: var(--muted);
  }
  
  .tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    color: var(--muted-foreground);
    font-size: 0.875rem;
    transition: all 0.2s;
  }
  
  .tab:hover {
    color: var(--foreground);
    background: var(--muted);
  }
  
  .tab.active {
    color: var(--foreground);
    border-bottom-color: var(--primary);
  }
  
  .tab-content {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }
  
  .control-group {
    margin-bottom: 1.5rem;
  }
  
  .control-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
  }
  
  .value {
    font-weight: normal;
    color: var(--muted-foreground);
    font-size: 0.75rem;
  }
  
  .slider {
    width: 100%;
    height: 0.375rem;
    border-radius: 0.1875rem;
    background: var(--muted);
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }
  
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    background: var(--primary);
    cursor: pointer;
  }
  
  .slider::-moz-range-thumb {
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    background: var(--primary);
    cursor: pointer;
    border: none;
  }
  
  .select,
  .input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--background);
    color: var(--foreground);
    font-size: 0.875rem;
  }
  
  .select:focus,
  .input:focus {
    outline: none;
    border-color: var(--primary);
  }
  
  .select:disabled,
  .input:disabled,
  .slider:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  
  .info-box {
    padding: 0.75rem;
    background: var(--muted);
    border-radius: 0.375rem;
    border: 1px solid var(--border);
  }
  
  /* Custom scrollbar */
  .tab-content::-webkit-scrollbar {
    width: 0.5rem;
  }
  
  .tab-content::-webkit-scrollbar-track {
    background: var(--muted);
  }
  
  .tab-content::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 0.25rem;
  }
  
  .tab-content::-webkit-scrollbar-thumb:hover {
    background: var(--muted-foreground);
  }
  
  /* Loading state */
  .layer-controls.is-updating {
    pointer-events: none;
  }
  
  .layer-controls.is-updating::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.1);
    z-index: 10;
  }
</style>