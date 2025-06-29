<script lang="ts">
  import { onMount } from 'svelte';
  import { SliceViewer, OrthogonalViewer } from '$lib/components';
  import { getGpuRenderer, initializeGpuRenderer } from '$lib/gpu';
  import type { VolumeMeta, Vec3 } from '$lib/geometry/types';
  
  // Demo volume metadata
  const volumeMeta: VolumeMeta = {
    dims: { x: 256, y: 256, z: 128 },
    spacing: { x: 1.0, y: 1.0, z: 2.0 },
    origin: { x: -128, y: -128, z: -128 }
  };
  
  let initialized = false;
  let error: Error | null = null;
  let crosshairPos: Vec3 | null = null;
  let currentSlice = 64;
  let showSingleView = true;
  
  onMount(async () => {
    try {
      await initializeGpuRenderer();
      initialized = true;
    } catch (e) {
      error = e as Error;
      console.error('Failed to initialize GPU renderer:', e);
    }
  });
  
  function handleCrosshairChange(event: CustomEvent<{ position: Vec3 }>) {
    crosshairPos = event.detail.position;
  }
</script>

<div class="demo-container">
  <h1>SliceViewer Demo</h1>
  
  {#if error}
    <div class="error">
      Error initializing GPU renderer: {error.message}
    </div>
  {:else if !initialized}
    <div class="loading">Initializing GPU renderer...</div>
  {:else}
    <div class="controls">
      <label>
        <input type="checkbox" bind:checked={showSingleView} />
        Show single view (vs orthogonal)
      </label>
      
      {#if crosshairPos}
        <div class="info">
          Crosshair: ({crosshairPos.x.toFixed(1)}, {crosshairPos.y.toFixed(1)}, {crosshairPos.z.toFixed(1)}) mm
        </div>
      {/if}
    </div>
    
    {#if showSingleView}
      <div class="single-view">
        <h2>Single Axial View</h2>
        <p>Controls:</p>
        <ul>
          <li>Left drag: Pan</li>
          <li>Scroll: Change slice</li>
          <li>Ctrl+Scroll: Zoom</li>
          <li>Double-click: Set crosshair</li>
          <li>Slider: Navigate through slices</li>
        </ul>
        
        <SliceViewer
          {volumeMeta}
          plane="axial"
          sliceIndex={currentSlice}
          layers={[]}
          showCrosshair={true}
          onCrosshairChange={(pos) => crosshairPos = pos}
          onSliceChange={(index) => currentSlice = index}
          width={512}
          height={512}
        />
        
        <div class="info">
          Current slice: {currentSlice}
        </div>
      </div>
    {:else}
      <div class="orthogonal-view">
        <h2>Orthogonal Views</h2>
        <p>All three anatomical planes synchronized with crosshair</p>
        
        <OrthogonalViewer
          {volumeMeta}
          layers={[]}
          layout="horizontal"
          viewSize={300}
          showCrosshair={true}
          showLabels={true}
          on:crosshairChange={handleCrosshairChange}
        />
      </div>
    {/if}
  {/if}
</div>

<style>
  .demo-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  
  h1 {
    color: #333;
    margin-bottom: 20px;
  }
  
  h2 {
    color: #555;
    margin: 20px 0 10px;
  }
  
  .error {
    background: #fee;
    color: #c00;
    padding: 10px;
    border-radius: 4px;
    margin: 20px 0;
  }
  
  .loading {
    color: #666;
    font-style: italic;
  }
  
  .controls {
    background: #f5f5f5;
    padding: 15px;
    border-radius: 4px;
    margin-bottom: 20px;
  }
  
  .controls label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  
  .info {
    margin-top: 10px;
    font-family: monospace;
    color: #666;
  }
  
  .single-view, .orthogonal-view {
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 20px;
  }
  
  .single-view ul {
    margin: 10px 0 20px 20px;
    color: #666;
    font-size: 14px;
  }
  
  .single-view :global(.slice-viewer) {
    margin: 0 auto;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
  
  .orthogonal-view :global(.orthogonal-viewer) {
    justify-content: center;
  }
</style>