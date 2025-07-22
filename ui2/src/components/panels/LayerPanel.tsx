import React, { useCallback, useEffect } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getLayerService } from '@/services/LayerService';
import { getStoreSyncService } from '@/services/StoreSyncService';
import { LayerDropdown } from '../ui/LayerDropdown';
import { ProSlider } from '../ui/ProSlider';
import { SingleSlider } from '../ui/SingleSlider';
import { EnhancedColormapSelector } from './EnhancedColormapSelector';
import type { LayerRender } from '@/types/layers';
import './LayerPanel.css';

export const LayerPanel: React.FC = () => {
  const layers = useLayerStore(state => state.layers);
  const selectedLayerId = useLayerStore(state => state.selectedLayerId);
  const layerMetadata = useLayerStore(state => state.layerMetadata);
  const selectLayer = useLayerStore(state => state.selectLayer);
  
  // Get layer render properties from ViewState (source of truth)
  const viewStateLayers = useViewStateStore(state => state.viewState.layers);
  const viewStateLayer = viewStateLayers.find(l => l.id === selectedLayerId);
  
  // Debug: Log when ViewState layer changes
  useEffect(() => {
    if (viewStateLayer) {
      // console.log(`[LayerPanel] ViewState layer ${selectedLayerId} updated:`, {
      //   intensity: viewStateLayer.intensity,
      //   threshold: viewStateLayer.threshold,
      //   colormap: viewStateLayer.colormap,
      //   opacity: viewStateLayer.opacity
      // });
    }
  }, [viewStateLayer, selectedLayerId]);
  
  const layerService = getLayerService();
  const selectedLayer = layers.find(l => l.id === selectedLayerId);
  const selectedMetadata = selectedLayerId ? layerMetadata.get(selectedLayerId) : undefined;
  
  // Convert ViewState layer to render properties format
  const selectedRender = viewStateLayer ? {
    opacity: viewStateLayer.opacity,
    intensity: viewStateLayer.intensity,
    threshold: viewStateLayer.threshold,
    colormap: viewStateLayer.colormap,
    interpolation: 'linear' as const
  } : undefined;
  
  // Debug logging - commented out to prevent console spam
  // console.log('[LayerPanel] Render debug:', {
  //   layersCount: layers.length,
  //   selectedLayerId,
  //   selectedLayer: selectedLayer ? { id: selectedLayer.id, name: selectedLayer.name } : null,
  //   selectedRender,
  //   selectedMetadata: selectedMetadata ? { dataRange: selectedMetadata.dataRange } : null
  // });


  function toggleVisibility(layerId: string) {
    const layer = layers.find(l => l.id === layerId);
    if (layer && layerService) {
      layerService.updateLayer(layerId, { visible: !layer.visible });
    }
  }

  const handleRenderUpdate = useCallback((updates: Partial<LayerRender>) => {
    if (selectedLayerId) {
      // console.log(`[LayerPanel] handleRenderUpdate for layer ${selectedLayerId}:`, updates);
      
      // Mark layer as dirty to prevent StoreSyncService from overwriting user changes
      getStoreSyncService().markLayerDirty(selectedLayerId);
      
      // Get current ViewState layer for threshold validation
      const currentViewLayer = useViewStateStore.getState().viewState.layers.find(l => l.id === selectedLayerId);
      
      // Validate threshold values to ensure they stay within intensity window
      if (updates.threshold && currentViewLayer) {
        const [minThresh, maxThresh] = updates.threshold;
        const [minIntensity, maxIntensity] = currentViewLayer.intensity;
        
        // Auto-swap if crossed
        if (minThresh > maxThresh) {
          updates.threshold = [maxThresh, minThresh];
        }
        
        // Clamp to intensity range
        updates.threshold = [
          Math.max(minIntensity, Math.min(maxIntensity, updates.threshold[0])),
          Math.max(minIntensity, Math.min(maxIntensity, updates.threshold[1]))
        ];
      }
      
      // Update ViewState (primary source of truth)
      useViewStateStore.getState().setViewState((state) => {
        const layers = [...state.layers];
        const layerIndex = layers.findIndex(l => l.id === selectedLayerId);
        if (layerIndex !== -1) {
          // Update only the properties that changed
          if (updates.intensity) {
            layers[layerIndex].intensity = updates.intensity;
          }
          if (updates.threshold) {
            layers[layerIndex].threshold = updates.threshold;
          }
          if (updates.colormap) {
            layers[layerIndex].colormap = updates.colormap;
          }
          if (updates.opacity !== undefined) {
            layers[layerIndex].opacity = updates.opacity;
          }
          
          // console.log(`[LayerPanel] Updated ViewState layer ${selectedLayerId} with:`, updates);
        }
        return { ...state, layers };
      });
      
      // CRITICAL FIX: Also update layerStore so StoreSyncService has correct values
      // This prevents the snap-back issue where StoreSyncService reads stale 20-80% defaults
      useLayerStore.getState().updateLayerRender(selectedLayerId, updates);
      // console.log(`[LayerPanel] Also updated layerStore render for ${selectedLayerId} to prevent snap-back`);
      
      // ViewState changes will be automatically sent to backend via coalescing
    }
  }, [selectedLayerId]);

  return (
    <div 
      className="flex flex-col h-full overflow-hidden"
      style={{ 
        backgroundColor: 'var(--layer-bg)',
        color: 'var(--layer-text)',
        borderRadius: '8px',
        fontFamily: 'var(--app-font-sans)'
      }}
    >
      {/* Main content area */}
      <div 
        className="flex-1 p-3 space-y-4 overflow-y-auto min-h-0"
        style={{ 
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          paddingRight: '28px',
          paddingLeft: '20px',
          paddingTop: '16px'
        }}
      >
        {/* Debug info */}
        <div style={{ color: 'white', fontSize: '10px', marginBottom: '10px' }}>
          Debug: {layers.length} layers, selected: {selectedLayerId || 'none'}
        </div>
        
        {/* Layer selector dropdown */}
        <LayerDropdown
          layers={layers}
          selectedLayerId={selectedLayerId}
          onSelect={selectLayer}
          onToggleVisibility={toggleVisibility}
        />

        {/* Layer controls - only show if a layer is selected */}
        {selectedLayer && selectedRender ? (
          <>
            {/* Intensity Window */}
            <ProSlider
              label="Intensity Window"
              min={selectedMetadata?.dataRange?.min ?? 0}
              max={selectedMetadata?.dataRange?.max ?? 10000}
              value={selectedRender.intensity}
              onChange={(value) => handleRenderUpdate({ intensity: value })}
              precision={0}
            />

            {/* Threshold */}
            <ProSlider
              label="Threshold"
              min={selectedRender.intensity[0]}
              max={selectedRender.intensity[1]}
              value={selectedRender.threshold}
              onChange={(value) => handleRenderUpdate({ threshold: value })}
              precision={0}
            />

            {/* Colormap */}
            <EnhancedColormapSelector
              value={selectedRender.colormap}
              onChange={(colormap) => handleRenderUpdate({ colormap })}
            />

            {/* Opacity */}
            <SingleSlider
              label="Opacity"
              min={0}
              max={1}
              value={selectedRender.opacity}
              onChange={(opacity) => handleRenderUpdate({ opacity })}
              showPercentage={true}
              className="mb-0"
            />
          </>
        ) : (
          /* Empty state - only show if no layer is selected */
          layers.length > 0 && (
            <div className="text-center py-8">
              <p className="text-[13px]" style={{ color: '#94a3b8' }}>
                Select a layer to edit properties
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
};