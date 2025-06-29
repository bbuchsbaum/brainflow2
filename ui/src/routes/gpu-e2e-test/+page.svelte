<script lang="ts">
  /**
   * End-to-end test: NIfTI → GPU → PNG
   */
  import { onMount } from 'svelte';
  import { coreApi } from '$lib/api';
  import { GpuRenderManager } from '$lib/gpu/renderManager';
  import type { VolumeHandleInfo, VolumeLayerGpuInfo } from '$lib/api';
  
  let status = 'Initializing...';
  let logs: string[] = [];
  let imageUrl: string | null = null;
  let renderTime = 0;
  
  const log = (msg: string) => {
    console.log(msg);
    logs = [...logs, `${new Date().toISOString()}: ${msg}`];
  };
  
  async function runTest() {
    try {
      // Step 1: Initialize GPU render loop
      log('Initializing GPU render loop...');
      await coreApi.init_render_loop();
      
      // Step 2: Load a test NIfTI file
      const testFile = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz';
      log(`Loading NIfTI file: ${testFile}`);
      
      const volumeInfo = await coreApi.load_file(testFile);
      log(`Loaded volume: ${volumeInfo.id}, dims: ${volumeInfo.dims.join('x')}, type: ${volumeInfo.dtype}`);
      
      // Step 3: Request GPU resources for the volume
      log('Uploading volume to GPU...');
      const gpuInfo = await coreApi.request_layer_gpu_resources({
        Volume: {
          volume_id: volumeInfo.id,
          colormap: 'gray',
          opacity: 1.0
        }
      }, 'test-layer-1');
      
      const volGpuInfo = gpuInfo as VolumeLayerGpuInfo;
      log(`GPU upload complete: atlas layer ${volGpuInfo.atlas_layer_index}, texture format: ${volGpuInfo.tex_format}`);
      log(`Volume center: [${volGpuInfo.center_world.map(v => v.toFixed(1)).join(', ')}]`);
      
      // Step 4: Create render manager and render a frame
      log('Creating GPU render manager...');
      const renderManager = new GpuRenderManager();
      await renderManager.initialize();
      
      // Create a simple frame for axial view at center
      const frame = {
        origin: { 
          x: volGpuInfo.center_world[0] - 50, 
          y: volGpuInfo.center_world[1] - 50, 
          z: volGpuInfo.center_world[2] 
        },
        u_dir: { x: 1, y: 0, z: 0 },
        v_dir: { x: 0, y: 1, z: 0 },
        pixels_per_mm: 2,
        viewport_px: { x: 256, y: 256 },
        version: 1
      };
      
      log('Rendering frame...');
      const startTime = performance.now();
      
      const result = await renderManager.render({
        frame,
        layers: [{
          volumeId: volumeInfo.id,
          colormapId: 0, // gray
          opacity: 1.0,
          window: { 
            level: (volGpuInfo.data_range.min + volGpuInfo.data_range.max) / 2,
            width: volGpuInfo.data_range.max - volGpuInfo.data_range.min
          },
          blendMode: 'over'
        }],
        showCrosshair: true,
        crosshairWorld: volGpuInfo.center_world as [number, number, number]
      });
      
      renderTime = performance.now() - startTime;
      log(`Render complete in ${renderTime.toFixed(1)}ms`);
      
      // Step 5: Display the PNG
      const blob = new Blob([result.imageData], { type: 'image/png' });
      imageUrl = URL.createObjectURL(blob);
      log(`PNG created, size: ${result.imageData.length} bytes`);
      
      status = '✅ Success! End-to-end pipeline working!';
      
      // Step 6: Clean up
      setTimeout(async () => {
        log('Cleaning up GPU resources...');
        await coreApi.release_view_resources('test-layer-1');
        await renderManager.dispose();
        log('Cleanup complete');
      }, 5000);
      
    } catch (error) {
      status = `❌ Error: ${error}`;
      log(`ERROR: ${error}`);
      console.error(error);
    }
  }
  
  onMount(() => {
    runTest();
    
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  });
</script>

<div class="test-container">
  <h1>GPU End-to-End Test</h1>
  <h2>NIfTI → GPU → PNG Pipeline</h2>
  
  <div class="status {status.startsWith('✅') ? 'success' : status.startsWith('❌') ? 'error' : ''}">
    {status}
  </div>
  
  {#if imageUrl}
    <div class="result">
      <h3>Rendered Image ({renderTime.toFixed(1)}ms):</h3>
      <img src={imageUrl} alt="Rendered slice" />
    </div>
  {/if}
  
  <div class="logs">
    <h3>Log:</h3>
    <pre>{logs.join('\n')}</pre>
  </div>
</div>

<style>
  .test-container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    font-family: monospace;
  }
  
  h1 {
    color: #0af;
    margin-bottom: 10px;
  }
  
  h2 {
    color: #888;
    font-size: 16px;
    margin-bottom: 20px;
  }
  
  .status {
    padding: 15px;
    border-radius: 5px;
    background: #333;
    color: white;
    margin-bottom: 20px;
    font-weight: bold;
  }
  
  .status.success {
    background: #0a0;
  }
  
  .status.error {
    background: #f00;
  }
  
  .result {
    margin: 20px 0;
    text-align: center;
  }
  
  .result img {
    border: 2px solid #0af;
    max-width: 100%;
    image-rendering: pixelated;
  }
  
  .logs {
    background: #222;
    padding: 15px;
    border-radius: 5px;
    margin-top: 20px;
  }
  
  .logs h3 {
    color: #0af;
    margin-bottom: 10px;
  }
  
  .logs pre {
    color: #0f0;
    font-size: 12px;
    overflow-x: auto;
    white-space: pre-wrap;
  }
</style>