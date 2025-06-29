import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLayerStore } from './layerStore';
import type { LayerSpec, VolumeLayerGpuInfo } from '@brainflow/api';
import { coreApi } from '$lib/api';

// Mock the coreApi
vi.mock('$lib/api', () => ({
  coreApi: {
    request_layer_gpu_resources: vi.fn(),
  },
}));

describe('layerStore', () => {
  // Store the original state to reset between tests
  let unsubscribe: () => void;

  beforeEach(() => {
    // Reset the store to initial state
    useLayerStore.setState({ layers: [] });
    vi.clearAllMocks();
    
    // Prevent console logs during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (unsubscribe) {
      unsubscribe();
    }
  });

  describe('addLayer', () => {
    it('adds a new layer to the store', () => {
      const layerSpec: LayerSpec = {
        Volume: {
          id: 'volume-1',
          volume_id: 'vol-123',
          opacity: 1.0,
          colormap: 'grayscale',
          intensity_min: 0,
          intensity_max: 255,
        },
      };

      useLayerStore.getState().addLayer(layerSpec);

      const state = useLayerStore.getState();
      expect(state.layers).toHaveLength(1);
      expect(state.layers[0].spec).toEqual(layerSpec);
      expect(state.layers[0].isLoadingGpu).toBe(false);
      expect(state.layers[0].gpu).toBeUndefined();
      expect(state.layers[0].error).toBeUndefined();
    });

    it('adds multiple layers', () => {
      const layer1: LayerSpec = {
        Volume: {
          id: 'volume-1',
          volume_id: 'vol-123',
          opacity: 1.0,
          colormap: 'grayscale',
          intensity_min: 0,
          intensity_max: 255,
        },
      };

      const layer2: LayerSpec = {
        Volume: {
          id: 'volume-2',
          volume_id: 'vol-456',
          opacity: 0.5,
          colormap: 'hot',
          intensity_min: 0,
          intensity_max: 1000,
        },
      };

      useLayerStore.getState().addLayer(layer1);
      useLayerStore.getState().addLayer(layer2);

      const state = useLayerStore.getState();
      expect(state.layers).toHaveLength(2);
      expect(state.layers[0].spec).toEqual(layer1);
      expect(state.layers[1].spec).toEqual(layer2);
    });
  });

  describe('requestGpuResources', () => {
    it('successfully requests GPU resources', async () => {
      const layerSpec: LayerSpec = {
        Volume: {
          id: 'volume-1',
          volume_id: 'vol-123',
          opacity: 1.0,
          colormap: 'grayscale',
          intensity_min: 0,
          intensity_max: 255,
        },
      };

      const mockGpuInfo: VolumeLayerGpuInfo = {
        layer_id: 'volume-1',
        world_to_voxel: new Array(16).fill(0),
        dim: [91, 109, 91],
        pad_slices: 1,
        tex_format: { R32Float: {} },
        atlas_layer_index: 0,
        slice_info: {
          axis: 2,
          index: 45,
          axis_name: 'Axial',
          dimensions: [91, 109],
        },
        texture_coords: {
          u_min: 0,
          v_min: 0,
          u_max: 1,
          v_max: 1,
        },
        voxel_to_world: new Array(16).fill(0),
        origin: [0, 0, 0],
        spacing: [2, 2, 2],
        data_range: { min: 0, max: 255 },
        source_volume_id: 'vol-123',
        allocated_at: Date.now(),
      };

      vi.mocked(coreApi.request_layer_gpu_resources).mockResolvedValue(mockGpuInfo);

      useLayerStore.getState().addLayer(layerSpec);
      
      // Check loading state is set
      const promise = useLayerStore.getState().requestGpuResources('volume-1');
      
      let state = useLayerStore.getState();
      expect(state.layers[0].isLoadingGpu).toBe(true);

      await promise;

      // Check final state
      state = useLayerStore.getState();
      expect(state.layers[0].gpu).toEqual(mockGpuInfo);
      expect(state.layers[0].isLoadingGpu).toBe(false);
      expect(state.layers[0].error).toBeUndefined();
      expect(coreApi.request_layer_gpu_resources).toHaveBeenCalledWith(layerSpec);
    });

    it('handles GPU resource request failure', async () => {
      const layerSpec: LayerSpec = {
        Volume: {
          id: 'volume-1',
          volume_id: 'vol-123',
          opacity: 1.0,
          colormap: 'grayscale',
          intensity_min: 0,
          intensity_max: 255,
        },
      };

      const mockError = new Error('GPU out of memory');
      vi.mocked(coreApi.request_layer_gpu_resources).mockRejectedValue(mockError);

      useLayerStore.getState().addLayer(layerSpec);
      await useLayerStore.getState().requestGpuResources('volume-1');

      const state = useLayerStore.getState();
      expect(state.layers[0].gpu).toBeUndefined();
      expect(state.layers[0].isLoadingGpu).toBe(false);
      expect(state.layers[0].error).toEqual(mockError);
    });

    it('prevents duplicate GPU requests', async () => {
      const layerSpec: LayerSpec = {
        Volume: {
          id: 'volume-1',
          volume_id: 'vol-123',
          opacity: 1.0,
          colormap: 'grayscale',
          intensity_min: 0,
          intensity_max: 255,
        },
      };

      // Mock a slow API call
      vi.mocked(coreApi.request_layer_gpu_resources).mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      useLayerStore.getState().addLayer(layerSpec);
      
      // Start two requests simultaneously
      const promise1 = useLayerStore.getState().requestGpuResources('volume-1');
      const promise2 = useLayerStore.getState().requestGpuResources('volume-1');

      await Promise.all([promise1, promise2]);

      // Should only call API once
      expect(coreApi.request_layer_gpu_resources).toHaveBeenCalledTimes(1);
    });

    it('ignores request for non-existent layer', async () => {
      await useLayerStore.getState().requestGpuResources('non-existent');
      expect(coreApi.request_layer_gpu_resources).not.toHaveBeenCalled();
    });
  });

  describe('removeLayer', () => {
    it('removes a layer from the store', () => {
      const layer1: LayerSpec = {
        Volume: {
          id: 'volume-1',
          volume_id: 'vol-123',
          opacity: 1.0,
          colormap: 'grayscale',
          intensity_min: 0,
          intensity_max: 255,
        },
      };

      const layer2: LayerSpec = {
        Volume: {
          id: 'volume-2',
          volume_id: 'vol-456',
          opacity: 0.5,
          colormap: 'hot',
          intensity_min: 0,
          intensity_max: 1000,
        },
      };

      useLayerStore.getState().addLayer(layer1);
      useLayerStore.getState().addLayer(layer2);
      
      expect(useLayerStore.getState().layers).toHaveLength(2);

      useLayerStore.getState().removeLayer('volume-1');

      const state = useLayerStore.getState();
      expect(state.layers).toHaveLength(1);
      expect(state.layers[0].spec).toEqual(layer2);
    });

    it('handles removing non-existent layer gracefully', () => {
      const layer: LayerSpec = {
        Volume: {
          id: 'volume-1',
          volume_id: 'vol-123',
          opacity: 1.0,
          colormap: 'grayscale',
          intensity_min: 0,
          intensity_max: 255,
        },
      };

      useLayerStore.getState().addLayer(layer);
      useLayerStore.getState().removeLayer('non-existent');

      expect(useLayerStore.getState().layers).toHaveLength(1);
    });
  });

  describe('setLayerError', () => {
    it('sets error on a specific layer', () => {
      const layerSpec: LayerSpec = {
        Volume: {
          id: 'volume-1',
          volume_id: 'vol-123',
          opacity: 1.0,
          colormap: 'grayscale',
          intensity_min: 0,
          intensity_max: 255,
        },
      };

      const error = new Error('Test error');

      useLayerStore.getState().addLayer(layerSpec);
      useLayerStore.getState().setLayerError('volume-1', error);

      const state = useLayerStore.getState();
      expect(state.layers[0].error).toEqual(error);
      expect(state.layers[0].isLoadingGpu).toBe(false);
    });
  });

  describe('store subscription', () => {
    it('notifies subscribers when layers change', () => {
      const callback = vi.fn();
      unsubscribe = useLayerStore.subscribe(callback);

      const layerSpec: LayerSpec = {
        Volume: {
          id: 'volume-1',
          volume_id: 'vol-123',
          opacity: 1.0,
          colormap: 'grayscale',
          intensity_min: 0,
          intensity_max: 255,
        },
      };

      useLayerStore.getState().addLayer(layerSpec);

      expect(callback).toHaveBeenCalled();
    });
  });
});