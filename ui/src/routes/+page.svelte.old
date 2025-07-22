<script lang="ts">
  import { onMount } from 'svelte';

  // For Tauri v2, need to use direct imports
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import ViewerWithStatusBar from '../lib/components/ViewerWithStatusBar.svelte';
  import type { VolumeMeta } from '../lib/geometry/types';
  import { coreApi } from '../lib/api';
  import { useLayerStore } from '../lib/stores/layerStore';
  
  let greeting = '';
  let name = '';
  let volumes: any[] = [];
  let isLoading = false;
  let currentVolume: any = null;
  let volumeMeta: VolumeMeta | null = null;
  let viewMode: 'single' | 'orthogonal' = 'single';
  
  async function greet() {
    try {
      greeting = await invoke('greet', { name });
    } catch (error) {
      console.error('Error greeting:', error);
    }
  }
  
  async function listVolumes() {
    try {
      volumes = await invoke('list_volumes');
    } catch (error) {
      console.error('Error listing volumes:', error);
    }
  }
  
  async function selectAndLoadFile() {
    isLoading = true;
    try {
      // Open file dialog
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Neuroimaging Files', extensions: ['nii', 'gz', 'gii'] }]
      });
      
      if (selected) {
        const filePath = selected as string;
        
        // Check if file can be loaded
        const canLoad = await invoke('can_load_file', { filePath });
        
        if (canLoad) {
          // Load the volume using the API bridge
          const volumeInfo = await coreApi.load_file(filePath);
          console.log('Loaded volume:', volumeInfo);
          
          // Set up volume metadata for SliceViewer
          currentVolume = volumeInfo;
          volumeMeta = {
            dims: { x: volumeInfo.dims[0], y: volumeInfo.dims[1], z: volumeInfo.dims[2] },
            spacing: { x: 1.0, y: 1.0, z: 1.0 }, // Default spacing, would need from volume metadata
            origin: { x: 0, y: 0, z: 0 } // Default origin, would need from volume metadata
          };
          
          // Request GPU resources and set up layer
          const layerSpec = {
            Volume: {
              id: `layer-${Date.now()}`,
              source_resource_id: volumeInfo.id,
              colormap: 'viridis',
              slice_axis: 'Axial' as const,
              slice_index: { Middle: null }
            }
          };
          
          const gpuResources = await coreApi.request_layer_gpu_resources(layerSpec);
          console.log('GPU resources allocated:', gpuResources);
          
          // Add layer to the layer store
          const layerStore = useLayerStore.getState();
          layerStore.addLayer({
            spec: layerSpec,
            gpu: gpuResources,
            visible: true,
            opacity: 1.0
          });
          
          // Refresh volumes list
          await listVolumes();
        } else {
          alert('This file format is not supported.');
        }
      }
    } catch (error) {
      console.error('Error loading file:', error);
      alert(`Error loading file: ${error}`);
    } finally {
      isLoading = false;
    }
  }
  
  onMount(async () => {
    try {
      // Initialize the render loop
      await coreApi.init_render_loop();
      
      // Create offscreen render target
      await coreApi.create_offscreen_render_target(512, 512);
      
      console.log('GPU rendering initialized');
    } catch (error) {
      console.error('Failed to initialize GPU rendering:', error);
    }
  });
</script>

<main>
  <h1>Brainflow Neuroimaging</h1>
  
  <div class="card">
    <div class="input-group">
      <input id="greet-input" placeholder="Enter your name..." bind:value={name} />
      <button on:click={greet}>Greet</button>
    </div>
    {#if greeting}
      <p>{greeting}</p>
    {/if}
  </div>
  
  <div class="card">
    <h2>Neuroimaging Files</h2>
    <button on:click={selectAndLoadFile} disabled={isLoading}>
      {isLoading ? 'Loading...' : 'Load Neuroimaging File'}
    </button>
    
    <div class="volumes-list">
      <h3>Loaded Volumes</h3>
      {#if volumes.length === 0}
        <p>No volumes loaded. Select a file to load.</p>
      {:else}
        <ul>
          {#each volumes as volume}
            <li>
              <strong>{volume.name}</strong>
              <div class="volume-details">
                Dimensions: {volume.dimensions.join(' × ')}
                <br>
                Voxel Size: {volume.voxel_size.join(' × ')} mm
                <br>
                Data Type: {volume.data_type}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
  
  <div class="card full-height">
    <div class="viewer-header">
      <h2>Volume Viewer</h2>
      {#if volumeMeta}
        <div class="view-mode-toggle">
          <button 
            class="mode-button" 
            class:active={viewMode === 'single'}
            on:click={() => viewMode = 'single'}
          >
            Single View
          </button>
          <button 
            class="mode-button" 
            class:active={viewMode === 'orthogonal'}
            on:click={() => viewMode = 'orthogonal'}
          >
            Orthogonal View
          </button>
        </div>
      {/if}
    </div>
    <div class="viewer-wrapper">
      {#if volumeMeta}
        <ViewerWithStatusBar
          {volumeMeta}
          layers={useLayerStore.getState().layers.map(l => l.spec)}
          {viewMode}
          width={800}
          height={600}
        />
      {:else}
        <div class="empty-viewer">
          <p>No volume loaded</p>
          <p>Click "Load Neuroimaging File" above to get started</p>
        </div>
      {/if}
    </div>
  </div>
</main>

<style>
  main {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
      Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    text-align: center;
    padding: 1em;
    max-width: 800px;
    margin: 0 auto;
  }

  h1 {
    color: #3b82f6;
    font-size: 2em;
    margin-bottom: 1em;
  }
  
  .card {
    background-color: #f9fafb;
    border-radius: 8px;
    padding: 1.5em;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    margin-bottom: 2em;
  }
  
  .input-group {
    display: flex;
    margin-bottom: 1em;
  }
  
  input {
    padding: 0.5em;
    border: 1px solid #d1d5db;
    border-radius: 4px 0 0 4px;
    flex-grow: 1;
  }
  
  button {
    background-color: #3b82f6;
    color: white;
    border: none;
    padding: 0.5em 1em;
    border-radius: 0 4px 4px 0;
    cursor: pointer;
    transition: background-color 0.3s;
  }
  
  button:hover {
    background-color: #2563eb;
  }
  
  button:disabled {
    background-color: #9ca3af;
    cursor: not-allowed;
  }
  
  button:not(.input-group button) {
    border-radius: 4px;
    margin-bottom: 1em;
  }
  
  .volumes-list {
    text-align: left;
  }
  
  ul {
    list-style-type: none;
    padding: 0;
  }
  
  li {
    background-color: white;
    padding: 1em;
    margin-bottom: 0.5em;
    border-radius: 4px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  
  .volume-details {
    margin-top: 0.5em;
    font-size: 0.9em;
    color: #4b5563;
  }
  
  .viewer-container {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: 1em;
  }
  
  .card.full-height {
    height: 80vh;
    display: flex;
    flex-direction: column;
  }
  
  .viewer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1em;
  }
  
  .view-mode-toggle {
    display: flex;
    gap: 8px;
  }
  
  .mode-button {
    padding: 0.5em 1em;
    border-radius: 4px;
    background-color: #e5e7eb;
    color: #4b5563;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .mode-button:hover {
    background-color: #d1d5db;
  }
  
  .mode-button.active {
    background-color: #3b82f6;
    color: white;
  }
  
  .viewer-wrapper {
    flex: 1;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .empty-viewer {
    text-align: center;
    color: #6b7280;
  }
  
  .empty-viewer p {
    margin: 0.5em 0;
  }
  
  .empty-viewer p:first-child {
    font-size: 1.2em;
    font-weight: 500;
  }
</style>
