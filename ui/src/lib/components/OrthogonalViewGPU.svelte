<script lang="ts">
  /**
   * OrthogonalViewGPU - Three synchronized orthogonal views using GPU rendering
   */
  import { createEventDispatcher } from 'svelte';
  import SliceViewerGPU from './SliceViewerGPU.svelte';
  import type { VolumeMeta, Vec3, ViewFrameExplicit } from '../geometry/types';
  
  // Props
  export let volumeMeta: VolumeMeta;
  export let crosshairWorld: Vec3 = { x: 0, y: 0, z: 0 };
  export let showCrosshair = true;
  export let layers: Array<{
    volumeId: string;
    colormapId: number;
    opacity: number;
    window: { level: number; width: number };
  }> = [];
  
  const dispatch = createEventDispatcher<{
    crosshairChanged: Vec3;
    frameChanged: { plane: string; frame: ViewFrameExplicit };
  }>();
  
  // Calculate initial crosshair at volume center
  $: if (!crosshairWorld && volumeMeta) {
    crosshairWorld = {
      x: volumeMeta.origin.x + (volumeMeta.dims.x * volumeMeta.spacing.x) / 2,
      y: volumeMeta.origin.y + (volumeMeta.dims.y * volumeMeta.spacing.y) / 2,
      z: volumeMeta.origin.z + (volumeMeta.dims.z * volumeMeta.spacing.z) / 2
    };
  }
  
  // Handle click in any view - update crosshair
  function handleViewClick(plane: string, event: CustomEvent<{ world: Vec3 }>) {
    crosshairWorld = event.detail.world;
    dispatch('crosshairChanged', crosshairWorld);
  }
  
  // Handle frame changes
  function handleFrameChange(plane: string, event: CustomEvent<ViewFrameExplicit>) {
    dispatch('frameChanged', { plane, frame: event.detail });
  }
</script>

<div class="orthogonal-view-gpu">
  <div class="view-container axial">
    <div class="view-label">Axial</div>
    <SliceViewerGPU
      {volumeMeta}
      plane="axial"
      sliceMm={crosshairWorld.z}
      {crosshairWorld}
      {showCrosshair}
      {layers}
      on:click={(e) => handleViewClick('axial', e)}
      on:frame={(e) => handleFrameChange('axial', e)}
    />
  </div>
  
  <div class="view-container coronal">
    <div class="view-label">Coronal</div>
    <SliceViewerGPU
      {volumeMeta}
      plane="coronal"
      sliceMm={crosshairWorld.y}
      {crosshairWorld}
      {showCrosshair}
      {layers}
      on:click={(e) => handleViewClick('coronal', e)}
      on:frame={(e) => handleFrameChange('coronal', e)}
    />
  </div>
  
  <div class="view-container sagittal">
    <div class="view-label">Sagittal</div>
    <SliceViewerGPU
      {volumeMeta}
      plane="sagittal"
      sliceMm={crosshairWorld.x}
      {crosshairWorld}
      {showCrosshair}
      {layers}
      on:click={(e) => handleViewClick('sagittal', e)}
      on:frame={(e) => handleFrameChange('sagittal', e)}
    />
  </div>
  
  <div class="info-panel">
    <div class="crosshair-info">
      <strong>Crosshair:</strong>
      <div>X: {crosshairWorld.x.toFixed(1)} mm</div>
      <div>Y: {crosshairWorld.y.toFixed(1)} mm</div>
      <div>Z: {crosshairWorld.z.toFixed(1)} mm</div>
    </div>
    
    <div class="layer-info">
      <strong>Layers:</strong>
      {#each layers as layer, i}
        <div class="layer-item">
          Layer {i + 1}: {(layer.opacity * 100).toFixed(0)}% opacity
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .orthogonal-view-gpu {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 2px;
    width: 100%;
    height: 100%;
    background: #333;
  }
  
  .view-container {
    position: relative;
    background: #000;
    overflow: hidden;
  }
  
  .view-label {
    position: absolute;
    top: 5px;
    left: 5px;
    color: white;
    background: rgba(0, 0, 0, 0.7);
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 12px;
    font-weight: bold;
    z-index: 10;
    pointer-events: none;
  }
  
  .info-panel {
    background: #222;
    color: white;
    padding: 10px;
    font-size: 12px;
    overflow-y: auto;
  }
  
  .crosshair-info,
  .layer-info {
    margin-bottom: 15px;
  }
  
  .crosshair-info strong,
  .layer-info strong {
    display: block;
    margin-bottom: 5px;
    color: #0af;
  }
  
  .crosshair-info div {
    font-family: monospace;
    margin-left: 10px;
  }
  
  .layer-item {
    margin-left: 10px;
    padding: 2px 0;
  }
</style>