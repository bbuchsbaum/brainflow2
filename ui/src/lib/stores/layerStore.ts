import { createStore } from '$lib/zustand-vanilla';
import type { LayerSpec, VolumeLayerGpuInfo } from '@brainflow/api';
import { coreApi } from '$lib/api'; // Assumes api client exists at this path
import { crosshairSlice } from '$lib/stores/crosshairSlice';
// import { newRequestSpan } from '$lib/log'; // TODO: Import logging when available

// Helper function to get the ID from a LayerSpec
function getLayerId(spec: LayerSpec): string {
  if ('Volume' in spec) {
    return spec.Volume.id;
  }
  // Add other layer types as needed
  throw new Error('Unsupported layer type');
}


export interface LayerEntry {
  spec: LayerSpec;
  gpu?: VolumeLayerGpuInfo; // Optional: Only present if GPU resources are ready
  error?: Error | unknown; // Optional: Store error if GPU request failed
  isLoadingGpu?: boolean; // Optional: Track loading state
}

interface LayerState {
  layers: LayerEntry[];
  selectedLayerId: string | null;
  addLayer: (spec: LayerSpec) => void; // Simplified initial add
  requestGpuResources: (layerId: string) => Promise<void>; // Explicit GPU request
  setGpuInfo: (layerId: string, gpuInfo: VolumeLayerGpuInfo) => void;
  setLayerError: (layerId: string, error: Error | unknown) => void;
  removeLayer: (layerId: string) => void;
  selectLayer: (layerId: string | null) => void;
  // Add other actions: updateLayerSpec, reorderLayers, etc.
}

export const useLayerStore = createStore<LayerState>((set, get) => ({
  layers: [],
  selectedLayerId: null,

  addLayer: (spec) => {
    console.log('[layerStore] Adding layer spec:', spec);
    const newEntry: LayerEntry = { spec, isLoadingGpu: false };
    set((state) => ({ layers: [...state.layers, newEntry] }));
    // Optionally trigger GPU request immediately after adding
    // For Volume layers, we can access the id via spec.Volume.id
    if ('Volume' in spec) {
      // get().requestGpuResources(spec.Volume.id);
    }
  },

  requestGpuResources: async (layerId: string) => {
    console.log(`[layerStore] requestGpuResources called for layer ${layerId}`);
    console.log(`[layerStore] Current layers:`, get().layers.map(l => ({
      id: getLayerId(l.spec),
      hasGpu: !!l.gpu,
      isLoading: l.isLoadingGpu
    })));
    
    const layerEntry = get().layers.find(l => getLayerId(l.spec) === layerId);
    if (!layerEntry || layerEntry.isLoadingGpu || layerEntry.gpu) {
      if (!layerEntry) console.warn(`[layerStore] requestGpuResources: Layer ${layerId} not found.`);
      if (layerEntry?.isLoadingGpu) console.warn(`[layerStore] requestGpuResources: Layer ${layerId} already loading.`);
      if (layerEntry?.gpu) console.warn(`[layerStore] requestGpuResources: Layer ${layerId} already has GPU resources.`);
      return; // Avoid duplicate requests or requests for non-existent layers
    }

    console.log(`[layerStore] Requesting GPU resources for layer ${layerId}...`);
    // Set loading state
    set(state => ({
      layers: state.layers.map(l => 
        getLayerId(l.spec) === layerId ? { ...l, isLoadingGpu: true, error: undefined } : l
      )
    }));

    // TODO: Integrate tracing span when logger is available
    // const span = newRequestSpan('ui.request_layer_gpu'); 

    try {
      // Pass only the spec to the backend
      const gpuInfo = await coreApi.request_layer_gpu_resources(layerEntry.spec);
      console.log(`[layerStore] GPU resources received for ${layerId}:`, gpuInfo);
      get().setGpuInfo(layerId, gpuInfo); // Update store via dedicated action
    } catch (err: unknown) {
      console.error(`[layerStore] Failed to get GPU resources for ${layerId}:`, err);
      // Store the error
      const error = err instanceof Error ? err : new Error('Unknown error during GPU resource request');
      get().setLayerError(layerId, error);
    } finally {
      // Clear loading state regardless of success/failure
      set(state => ({
        layers: state.layers.map(l => 
          getLayerId(l.spec) === layerId ? { ...l, isLoadingGpu: false } : l
        )
      }));
      // TODO: span.end();
    }
  },

  setGpuInfo: (layerId, gpuInfo) => {
    set(state => ({
      layers: state.layers.map(l => 
        getLayerId(l.spec) === layerId ? { ...l, gpu: gpuInfo, isLoadingGpu: false, error: undefined } : l
      )
    }));
    
    // Initialize crosshair to volume center if this is the first volume loaded
    if (gpuInfo && 'center_world' in gpuInfo) {
      // Use the pre-calculated center_world from the backend
      const centerWorld: [number, number, number] = gpuInfo.center_world;
      
      console.log(`[layerStore] Initializing crosshair to volume center: [${centerWorld[0]}, ${centerWorld[1]}, ${centerWorld[2]}]`);
      console.log(`[layerStore] Volume dimensions: [${gpuInfo.dim[0]}, ${gpuInfo.dim[1]}, ${gpuInfo.dim[2]}]`);
      
      // Check if crosshair was already set
      const currentCrosshair = crosshairSlice.getState().crosshairWorldCoord;
      if (currentCrosshair) {
        console.log(`[layerStore] WARNING: Crosshair already set to: [${currentCrosshair[0]}, ${currentCrosshair[1]}, ${currentCrosshair[2]}]`);
      }
      
      crosshairSlice.getState().setCrosshairWorldCoord(centerWorld);
    }
  },

  setLayerError: (layerId, error) => {
    set(state => ({
      layers: state.layers.map(l => 
        getLayerId(l.spec) === layerId ? { ...l, error, isLoadingGpu: false } : l
      )
    }));
  },

  removeLayer: (layerId) => {
     console.log(`[layerStore] Removing layer ${layerId}`);
     set(state => ({ 
       layers: state.layers.filter(l => getLayerId(l.spec) !== layerId),
       // Clear selection if removed layer was selected
       selectedLayerId: state.selectedLayerId === layerId ? null : state.selectedLayerId
     }));
     // TODO: Add coreApi.release_view_resources(layerId) call here?
  },
  
  selectLayer: (layerId) => {
    set({ selectedLayerId: layerId });
    console.log(`[layerStore] Selected layer: ${layerId}`);
  },
}));

// Optional: Subscribe for debugging
useLayerStore.subscribe((newState, prevState) => {
    if (newState.layers.length !== prevState.layers.length) {
        console.log('[layerStore] Layer list changed:', newState.layers.map(l => getLayerId(l.spec)));
    }
    // Add more checks if needed, e.g., GPU status changes
}); 