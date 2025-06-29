import React, { useState, useEffect, useRef } from 'react';
import { coreApi } from '../lib/api';
import type { VolumeHandleInfo, VolumeLayerGpuInfo } from '@brainflow/api';

export function TestRender() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [loadedVolume, setLoadedVolume] = useState<VolumeHandleInfo | null>(null);
  const [gpuInfo, setGpuInfo] = useState<VolumeLayerGpuInfo | null>(null);
  const [renderImage, setRenderImage] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerId = useRef(`layer-${Date.now()}`);

  // Initialize render loop on mount
  useEffect(() => {
    const initializeGpu = async () => {
      try {
        console.log('Initializing render loop...');
        await coreApi.init_render_loop();
        
        // Create offscreen render target
        await coreApi.create_offscreen_render_target(512, 512);
        
        setIsInitialized(true);
        console.log('Render loop initialized successfully');
      } catch (err) {
        console.error('Failed to initialize render loop:', err);
        setError(`Failed to initialize GPU: ${err}`);
      }
    };

    initializeGpu();

    // Cleanup on unmount
    return () => {
      if (gpuInfo) {
        coreApi.release_view_resources(layerId.current).catch(console.error);
      }
    };
  }, []);

  const loadTestFile = async () => {
    try {
      setError(null);
      // Load a test NIFTI file
      const testPath = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz';
      console.log('Loading file:', testPath);
      
      const volumeInfo = await coreApi.load_file(testPath);
      console.log('Volume loaded:', volumeInfo);
      setLoadedVolume(volumeInfo);

      // Request GPU resources for this volume
      const layerSpec = {
        Volume: {
          id: layerId.current,
          source_resource_id: volumeInfo.id,
          colormap: 'viridis',
          slice_axis: 'Axial' as const,
          slice_index: { Middle: null }
        }
      };

      console.log('Requesting GPU resources with spec:', layerSpec);
      const gpuResources = await coreApi.request_layer_gpu_resources(layerSpec);
      console.log('GPU resources allocated:', gpuResources);
      setGpuInfo(gpuResources);

      // Set up initial rendering parameters
      await setupRenderingParams();
      
    } catch (err) {
      console.error('Failed to load test file:', err);
      setError(`Failed to load file: ${err}`);
    }
  };

  const setupRenderingParams = async () => {
    try {
      // Set up a basic orthographic view for the slice
      const viewProj = [
        2/512, 0, 0, 0,
        0, 2/512, 0, 0,
        0, 0, 1, 0,
        -1, -1, 0, 1
      ];

      // Identity transform for world_to_voxel
      const worldToVoxel = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];

      // Center crosshair
      const crosshairVoxel = [128, 128, 64, 1];
      
      // View plane normal (Z-axis for axial)
      const viewPlaneNormal = [0, 0, 1, 0];
      const viewPlaneDistance = 64;

      await coreApi.update_frame_ubo(
        viewProj,
        worldToVoxel,
        crosshairVoxel,
        viewPlaneNormal,
        viewPlaneDistance
      );

      // Set view plane to axial
      await coreApi.set_view_plane(2);

      // Set crosshair position
      await coreApi.set_crosshair([128, 128, 64]);

    } catch (err) {
      console.error('Failed to setup render params:', err);
      setError(`Failed to setup render params: ${err}`);
    }
  };

  const renderFrame = async () => {
    if (!isInitialized || !gpuInfo) {
      console.log('Cannot render: not initialized or no GPU resources');
      return;
    }

    try {
      setIsRendering(true);
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
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const imageData = new ImageData(new Uint8ClampedArray(bytes.buffer), 512, 512);
            ctx.putImageData(imageData, 0, 0);
            
            // Convert canvas to PNG data URL for display
            const pngDataUrl = canvas.toDataURL('image/png');
            setRenderImage(pngDataUrl);
          }
        }
      }
      
    } catch (err) {
      console.error('Failed to render frame:', err);
      setError(`Failed to render: ${err}`);
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold">GPU Rendering Test</h2>
      
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">GPU Initialized:</span>
          <span className={`text-sm font-bold ${isInitialized ? 'text-green-600' : 'text-red-600'}`}>
            {isInitialized ? 'Yes' : 'No'}
          </span>
        </div>
        
        {loadedVolume && (
          <div className="text-sm">
            <div>Volume: {loadedVolume.name}</div>
            <div>Dimensions: {loadedVolume.dims.join(' × ')}</div>
            <div>Data type: {loadedVolume.dtype}</div>
          </div>
        )}
        
        {gpuInfo && (
          <div className="text-sm">
            <div>GPU Layer: {gpuInfo.layer_id}</div>
            <div>Atlas Index: {gpuInfo.atlas_layer_index}</div>
            <div>Texture Format: {gpuInfo.tex_format}</div>
            <div>Slice: {gpuInfo.slice_info.axis_name} {gpuInfo.slice_info.index}</div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={loadTestFile}
          disabled={!isInitialized || !!loadedVolume}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
        >
          Load Test NIFTI
        </button>
        
        <button
          onClick={renderFrame}
          disabled={!gpuInfo || isRendering}
          className="px-4 py-2 bg-green-500 text-white rounded disabled:bg-gray-300"
        >
          {isRendering ? 'Rendering...' : 'Render Frame'}
        </button>
      </div>

      {error && (
        <div className="p-2 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {/* Hidden canvas for RGBA to PNG conversion */}
        <canvas 
          ref={canvasRef}
          width={512}
          height={512}
          style={{ display: 'none' }}
        />
        
        {/* Display rendered image */}
        {renderImage && (
          <div>
            <h3 className="text-lg font-semibold mb-2">Rendered Output:</h3>
            <img 
              src={renderImage} 
              alt="Rendered slice"
              className="border border-gray-300"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}