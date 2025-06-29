<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { coreApi } from '../lib/api';
  import type { VolumeHandleInfo, VolumeLayerGpuInfo } from '@brainflow/api';

  let isInitialized = false;
  let loadedVolume: VolumeHandleInfo | null = null;
  let gpuInfo: VolumeLayerGpuInfo | null = null;
  let renderImage: string | null = null;
  let isRendering = false;
  let error: string | null = null;
  let canvas: HTMLCanvasElement;
  const layerId = `layer-${Date.now()}`;

  onMount(async () => {
    try {
      console.log('Initializing render loop...');
      await coreApi.init_render_loop();
      
      // Create offscreen render target
      await coreApi.create_offscreen_render_target(512, 512);
      
      isInitialized = true;
      console.log('Render loop initialized successfully');
    } catch (err) {
      console.error('Failed to initialize render loop:', err);
      error = `Failed to initialize GPU: ${err}`;
    }
  });

  onDestroy(async () => {
    if (gpuInfo) {
      try {
        await coreApi.release_view_resources(layerId);
      } catch (err) {
        console.error('Failed to release resources:', err);
      }
    }
  });

  async function loadTestFile() {
    try {
      error = null;
      // Load a test NIFTI file
      const testPath = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz';
      console.log('Loading file:', testPath);
      
      const volumeInfo = await coreApi.load_file(testPath);
      console.log('Volume loaded:', volumeInfo);
      loadedVolume = volumeInfo;

      // Request GPU resources for this volume
      const layerSpec = {
        Volume: {
          id: layerId,
          source_resource_id: volumeInfo.id,
          colormap: 'viridis',
          slice_axis: 'Axial' as const,
          slice_index: { Middle: null }
        }
      };

      console.log('Requesting GPU resources with spec:', layerSpec);
      const gpuResources = await coreApi.request_layer_gpu_resources(layerSpec);
      console.log('GPU resources allocated:', gpuResources);
      gpuInfo = gpuResources;

      // Add layer to render state
      await addLayerToRenderState(gpuResources);

      // Set up initial rendering parameters
      await setupRenderingParams();
      
    } catch (err) {
      console.error('Failed to load test file:', err);
      error = `Failed to load file: ${err}`;
    }
  }

  async function addLayerToRenderState(gpuResources: VolumeLayerGpuInfo) {
    try {
      // Add the layer to the render state with the atlas index and texture coordinates
      const textureCoords = [
        gpuResources.texture_coords.u_min,
        gpuResources.texture_coords.v_min,
        gpuResources.texture_coords.u_max,
        gpuResources.texture_coords.v_max
      ];
      
      const layerIndex = await coreApi.add_render_layer(
        gpuResources.atlas_layer_index,
        1.0, // Full opacity
        textureCoords
      );
      
      console.log('Added layer to render state at index:', layerIndex);
      
      // Patch the layer to use the correct intensity window for the test data
      // The test volume has values from 1 to 1000
      console.log('Patching layer intensity window for test data (1-1000)...');
      await coreApi.patch_layer(layerId, {
        intensity_min: 1.0,
        intensity_max: 1000.0
      });
      console.log('Layer intensity window updated');
    } catch (err) {
      console.error('Failed to add layer to render state:', err);
      error = `Failed to add layer: ${err}`;
    }
  }

  async function setupRenderingParams() {
    try {
      if (!loadedVolume || !gpuInfo) {
        console.error('Cannot setup rendering params without loaded volume');
        return;
      }

      // Calculate volume center based on actual dimensions
      const dims = loadedVolume.dims;
      const centerVoxel = [
        (dims[0] - 1) / 2,
        (dims[1] - 1) / 2,
        (dims[2] - 1) / 2
      ];
      
      console.log('Volume dimensions:', dims);
      console.log('Center in voxel coordinates:', centerVoxel);
      
      // Transform voxel center to world coordinates using voxel_to_world matrix
      // The matrix is stored column-major in a flat array
      const voxelToWorld = gpuInfo.voxel_to_world;
      if (!voxelToWorld || voxelToWorld.length !== 16) {
        console.error('Invalid or missing voxel_to_world matrix');
        return;
      }
      
      // Perform matrix multiplication: world = voxel_to_world * voxel_homogeneous
      const voxelHomogeneous = [...centerVoxel, 1.0];
      const worldX = voxelToWorld[0] * voxelHomogeneous[0] + voxelToWorld[4] * voxelHomogeneous[1] + 
                     voxelToWorld[8] * voxelHomogeneous[2] + voxelToWorld[12] * voxelHomogeneous[3];
      const worldY = voxelToWorld[1] * voxelHomogeneous[0] + voxelToWorld[5] * voxelHomogeneous[1] + 
                     voxelToWorld[9] * voxelHomogeneous[2] + voxelToWorld[13] * voxelHomogeneous[3];
      const worldZ = voxelToWorld[2] * voxelHomogeneous[0] + voxelToWorld[6] * voxelHomogeneous[1] + 
                     voxelToWorld[10] * voxelHomogeneous[2] + voxelToWorld[14] * voxelHomogeneous[3];
      const worldW = voxelToWorld[3] * voxelHomogeneous[0] + voxelToWorld[7] * voxelHomogeneous[1] + 
                     voxelToWorld[11] * voxelHomogeneous[2] + voxelToWorld[15] * voxelHomogeneous[3];
      
      // Normalize by W if needed
      const centerWorld = worldW !== 0 ? [worldX/worldW, worldY/worldW, worldZ/worldW] : [worldX, worldY, worldZ];
      
      console.log('Center in world coordinates:', centerWorld);
      console.log('Voxel_to_world matrix:', voxelToWorld);
      
      // Set crosshair using world coordinates
      await coreApi.set_crosshair(centerWorld);

      // Calculate appropriate view size based on volume dimensions
      // For identity transform, voxel size = world size
      const viewWidth = Math.max(dims[0], dims[1]) * 1.2; // Add 20% padding
      const viewHeight = Math.max(dims[1], dims[2]) * 1.2;
      
      console.log('Setting up view with size:', viewWidth, 'x', viewHeight, 'mm');
      
      // Update frame for synchronized view
      // For axial view (plane_id = 0)
      await coreApi.update_frame_for_synchronized_view(
        viewWidth,    // view width in mm
        viewHeight,   // view height in mm
        centerWorld,  // crosshair position in world coordinates
        0             // plane_id: 0=axial, 1=coronal, 2=sagittal
      );

      // Set view plane to axial
      await coreApi.set_view_plane(0);

    } catch (err) {
      console.error('Failed to setup render params:', err);
      error = `Failed to setup render params: ${err}`;
    }
  }

  async function renderFrame() {
    if (!isInitialized || !gpuInfo) {
      console.log('Cannot render: not initialized or no GPU resources');
      return;
    }

    try {
      isRendering = true;
      console.log('Rendering frame...');
      
      // Render to offscreen buffer and get image
      const imageDataUrl = await coreApi.render_to_image();
      console.log('Got image data, length:', imageDataUrl.length);
      
      // Parse the data URL
      if (imageDataUrl.startsWith('data:image/raw-rgba;base64,')) {
        // Convert raw RGBA to canvas
        const base64Data = imageDataUrl.substring('data:image/raw-rgba;base64,'.length);
        const binaryData = atob(base64Data);
        const bytes = new Uint8Array(binaryData.length);
        for (let i = 0; i < binaryData.length; i++) {
          bytes[i] = binaryData.charCodeAt(i);
        }

        // Draw to canvas
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const imageData = new ImageData(new Uint8ClampedArray(bytes.buffer), 512, 512);
            ctx.putImageData(imageData, 0, 0);
            
            // Convert canvas to PNG data URL for display
            renderImage = canvas.toDataURL('image/png');
          }
        }
      }
      
    } catch (err) {
      console.error('Failed to render frame:', err);
      error = `Failed to render: ${err}`;
    } finally {
      isRendering = false;
    }
  }
</script>

<div class="p-4 space-y-4">
  <h2 class="text-xl font-bold">GPU Rendering Test</h2>
  
  <div class="space-y-2">
    <div class="flex items-center gap-2">
      <span class="text-sm">GPU Initialized:</span>
      <span class="text-sm font-bold {isInitialized ? 'text-green-600' : 'text-red-600'}">
        {isInitialized ? 'Yes' : 'No'}
      </span>
    </div>
    
    {#if loadedVolume}
      <div class="text-sm">
        <div>Volume: {loadedVolume.name}</div>
        <div>Dimensions: {loadedVolume.dims.join(' × ')}</div>
        <div>Data type: {loadedVolume.dtype}</div>
      </div>
    {/if}
    
    {#if gpuInfo}
      <div class="text-sm">
        <div>GPU Layer: {gpuInfo.layer_id}</div>
        <div>Atlas Index: {gpuInfo.atlas_layer_index}</div>
        <div>Texture Format: {gpuInfo.tex_format}</div>
        <div>Slice: {gpuInfo.slice_info.axis_name} {gpuInfo.slice_info.index}</div>
      </div>
    {/if}
  </div>

  <div class="flex gap-2">
    <button
      on:click={loadTestFile}
      disabled={!isInitialized || !!loadedVolume}
      class="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
    >
      Load Test NIFTI
    </button>
    
    <button
      on:click={renderFrame}
      disabled={!gpuInfo || isRendering}
      class="px-4 py-2 bg-green-500 text-white rounded disabled:bg-gray-300"
    >
      {isRendering ? 'Rendering...' : 'Render Frame'}
    </button>
  </div>

  {#if error}
    <div class="p-2 bg-red-100 text-red-700 rounded">
      {error}
    </div>
  {/if}

  <div class="space-y-2">
    <!-- Hidden canvas for RGBA to PNG conversion -->
    <canvas 
      bind:this={canvas}
      width={512}
      height={512}
      style="display: none"
    />
    
    <!-- Display rendered image -->
    {#if renderImage}
      <div>
        <h3 class="text-lg font-semibold mb-2">Rendered Output:</h3>
        <img 
          src={renderImage} 
          alt="Rendered slice"
          class="border border-gray-300"
          style="image-rendering: pixelated"
        />
      </div>
    {/if}
  </div>
</div>