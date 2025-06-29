<script lang="ts">
  import StatusBar from './StatusBar.svelte';
  import SliceViewer from './SliceViewerGPU.svelte';
  import OrthogonalViewer from './OrthogonalViewGPU.svelte';
  import type { VolumeMeta, Vec3, Plane } from '../geometry/types';
  import type { LayerSpec } from '@brainflow/api';
  import { crosshairSlice } from '../stores/crosshairSlice';
  
  // Props
  export let volumeMeta: VolumeMeta;
  export let layers: LayerSpec[] = [];
  export let viewMode: 'single' | 'orthogonal' = 'single';
  export let plane: Plane = 'axial';
  export let width = 512;
  export let height = 512;
  
  let statusBar: StatusBar;
  
  // Handle mouse world coordinate updates
  function handleMouseWorldCoord(coords: [number, number, number] | null) {
    if (statusBar) {
      statusBar.setMouseWorldCoord(coords);
    }
  }
  
  // Handle crosshair changes
  function handleCrosshairChange(pos: Vec3) {
    // Update the global crosshair store
    crosshairSlice.getState().setCrosshairWorldCoord([pos.x, pos.y, pos.z]);
  }
</script>

<div class="viewer-with-status">
  <div class="viewer-container">
    {#if viewMode === 'single'}
      <SliceViewer
        {volumeMeta}
        {layers}
        {plane}
        {width}
        {height}
        showSlider={true}
        showCrosshair={true}
        onCrosshairChange={handleCrosshairChange}
        onMouseWorldCoord={handleMouseWorldCoord}
      />
    {:else}
      <OrthogonalViewer
        {volumeMeta}
        {layers}
        viewSize={Math.min(width, height) / 2}
        showCrosshair={true}
        showSliders={true}
        showLabels={true}
        onMouseWorldCoord={handleMouseWorldCoord}
      />
    {/if}
  </div>
  
  <StatusBar bind:this={statusBar} />
</div>

<style>
  .viewer-with-status {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  
  .viewer-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1a1a1a;
    overflow: auto;
  }
</style>