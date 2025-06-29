<!--
  VolumeLoader Component Example
  Shows how to use the new service layer architecture
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { getService } from '$lib/di/Container';
  import type { VolumeService } from '$lib/services/VolumeService';
  import type { NotificationService } from '$lib/services/NotificationService';
  import type { LayerService } from '$lib/services/LayerService';
  import { useVolumeStore } from '$lib/stores/volumeStore.clean';
  import { useLayerStore } from '$lib/stores/layerStoreClean';
  
  // Services
  let volumeService: VolumeService | null = null;
  let notificationService: NotificationService | null = null;
  let layerService: LayerService | null = null;
  
  // State from stores
  const volumes = $derived(useVolumeStore.getState().volumes);
  const layers = $derived(useLayerStore.getState().layers);
  const isLoading = $state(false);
  
  // File input
  let fileInput: HTMLInputElement;
  
  onMount(async () => {
    // Get services from DI container
    [volumeService, notificationService, layerService] = await Promise.all([
      getService<VolumeService>('volumeService'),
      getService<NotificationService>('notificationService'),
      getService<LayerService>('layerService')
    ]);
  });
  
  async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !volumeService || !layerService) return;
    
    isLoading = true;
    
    try {
      // Show progress notification
      const progress = notificationService?.progress('Loading volume', {
        message: file.name,
        indeterminate: true
      });
      
      // Load the volume
      const volumeHandle = await volumeService.loadVolume(file.path || file.name, file.name);
      
      // Create a layer for the volume
      if ('Volume' in volumeHandle) {
        const layerSpec = {
          type: 'Volume' as const,
          Volume: {
            id: `layer-${volumeHandle.Volume.id}`,
            source_resource_id: volumeHandle.Volume.id,
            colormap: 'grayscale' as const,
            slice_axis: null,
            slice_index: null
          }
        };
        
        // Add layer and request GPU resources
        await layerService.addLayer(layerSpec);
        await layerService.requestGpuResources(layerSpec);
      }
      
      // Complete progress
      progress?.complete('Volume loaded successfully');
      
    } catch (error) {
      notificationService?.error('Failed to load volume', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      isLoading = false;
      // Reset file input
      input.value = '';
    }
  }
  
  async function unloadVolume(volumeId: string) {
    if (!volumeService) return;
    
    try {
      await volumeService.unloadVolume(volumeId);
      notificationService?.success('Volume unloaded');
    } catch (error) {
      notificationService?.error('Failed to unload volume', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  // Subscribe to store changes
  $effect(() => {
    const unsubscribe = useVolumeStore.subscribe(
      (state) => state.volumes,
      (newVolumes) => {
        console.log('Volumes updated:', newVolumes.size);
      }
    );
    
    return unsubscribe;
  });
</script>

<div class="volume-loader">
  <div class="header">
    <h3>Volume Loader</h3>
    <button 
      class="load-button"
      onclick={() => fileInput?.click()}
      disabled={isLoading}
    >
      {isLoading ? 'Loading...' : 'Load Volume'}
    </button>
    
    <input
      bind:this={fileInput}
      type="file"
      accept=".nii,.nii.gz,.nifti"
      onchange={handleFileSelect}
      style="display: none"
    />
  </div>
  
  <div class="volume-list">
    {#if volumes.size === 0}
      <p class="empty-state">No volumes loaded</p>
    {:else}
      {#each Array.from(volumes.values()) as volume}
        <div class="volume-item">
          <div class="volume-info">
            <div class="volume-name">{volume.name}</div>
            <div class="volume-details">
              {volume.dimensions[0]} × {volume.dimensions[1]} × {volume.dimensions[2]}
              • {volume.dataType}
            </div>
          </div>
          
          <button
            class="unload-button"
            onclick={() => unloadVolume(volume.id)}
            title="Unload volume"
          >
            ✕
          </button>
        </div>
      {/each}
    {/if}
  </div>
  
  <div class="stats">
    <span>Volumes: {volumes.size}</span>
    <span>Layers: {layers.length}</span>
  </div>
</div>

<style>
  .volume-loader {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-surface-100);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-bottom: 1px solid var(--color-surface-300);
  }
  
  .header h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  
  .load-button {
    padding: 0.5rem 1rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  
  .load-button:hover:not(:disabled) {
    background: var(--color-primary-dark);
  }
  
  .load-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .volume-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
  }
  
  .empty-state {
    text-align: center;
    color: var(--color-text-tertiary);
    padding: 2rem;
    font-size: 0.875rem;
  }
  
  .volume-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem;
    background: var(--color-surface-200);
    border-radius: 0.375rem;
    margin-bottom: 0.5rem;
    transition: all 0.15s;
  }
  
  .volume-item:hover {
    background: var(--color-surface-300);
  }
  
  .volume-info {
    flex: 1;
    min-width: 0;
  }
  
  .volume-name {
    font-weight: 500;
    color: var(--color-text-primary);
    margin-bottom: 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .volume-details {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }
  
  .unload-button {
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    border-radius: 0.25rem;
    transition: all 0.15s;
  }
  
  .unload-button:hover {
    background: var(--color-surface-400);
    color: var(--color-error);
  }
  
  .stats {
    display: flex;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--color-surface-300);
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    background: var(--color-surface-200);
  }
</style>