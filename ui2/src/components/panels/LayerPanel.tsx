import React, { useCallback, useEffect, useState } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getLayerService } from '@/services/LayerService';
import { getStoreSyncService } from '@/services/StoreSyncService';
import { LayerTable } from '../ui/LayerTable';
import { ProSlider } from '../ui/ProSlider';
import { SingleSlider } from '../ui/SingleSlider';
import { EnhancedColormapSelector } from './EnhancedColormapSelector';
import { MetadataDrawer } from '../ui/MetadataDrawer';
import { useMetadataShortcut } from '@/hooks/useMetadataShortcut';
import type { LayerRender } from '@/types/layers';
import './LayerPanel.css';

export const LayerPanel: React.FC = () => {
  // All hooks must be called before any conditional returns
  const [serviceInitialized, setServiceInitialized] = useState(false);
  const [metadataLayerId, setMetadataLayerId] = useState<string | null>(null);
  const [isMetadataPinned, setIsMetadataPinned] = useState(false);
  const [syncRetries, setSyncRetries] = useState(0);
  
  // Store subscriptions
  const layers = useLayerStore(state => state.layers);
  const selectedLayerId = useLayerStore(state => state.selectedLayerId);
  const layerMetadata = useLayerStore(state => state.layerMetadata);
  const selectLayer = useLayerStore(state => state.selectLayer);
  
  // Get layer render properties from ViewState (source of truth)
  const viewStateLayers = useViewStateStore(state => state.viewState.layers);
  const viewStateLayer = viewStateLayers.find(l => l.id === selectedLayerId);
  
  // Keyboard shortcut for metadata
  useMetadataShortcut({ onShowMetadata: setMetadataLayerId });
  
  // Check if LayerService is initialized
  useEffect(() => {
    const checkService = () => {
      try {
        getLayerService();
        setServiceInitialized(true);
      } catch (error) {
        // Service not ready yet, try again
        setTimeout(checkService, 100);
      }
    };
    checkService();
  }, []);
  
  // Get selected layer and metadata
  const selectedLayer = layers.find(l => l.id === selectedLayerId);
  const selectedMetadata = selectedLayerId ? layerMetadata.get(selectedLayerId) : undefined;
  const layerStore = useLayerStore.getState();
  const selectedLayerRender = selectedLayerId ? layerStore.getLayerRender(selectedLayerId) : undefined;
  
  // Convert ViewState layer to render properties format with fallback
  const selectedRender = viewStateLayer ? {
    opacity: viewStateLayer.opacity,
    intensity: viewStateLayer.intensity,
    threshold: viewStateLayer.threshold,
    colormap: viewStateLayer.colormap,
    interpolation: 'linear' as const
  } : selectedLayerRender ? {
    // Fallback to layerStore render properties when ViewState is not yet synchronized
    opacity: selectedLayerRender.opacity,
    intensity: selectedLayerRender.intensity || [0, 100],
    threshold: selectedLayerRender.threshold || [0, 0],
    colormap: selectedLayerRender.colormap || 'gray',
    interpolation: selectedLayerRender.interpolation || 'linear' as const
  } : undefined;
  
  // Sync verification with retry logic
  useEffect(() => {
    if (selectedLayerId && !viewStateLayer && syncRetries < 3) {
      const timer = setTimeout(() => {
        const storeSyncService = getStoreSyncService();
        // Force a manual sync by re-reading the layer store and updating ViewState
        const layer = layers.find(l => l.id === selectedLayerId);
        if (layer) {
          // Emit a layer.added event to trigger sync
          storeSyncService.getEventBus().emit('layer.added', { layer });
        }
        setSyncRetries(prev => prev + 1);
      }, 100 * (syncRetries + 1)); // Exponential backoff: 100ms, 200ms, 300ms
      
      return () => clearTimeout(timer);
    } else if (selectedLayerId && viewStateLayer && syncRetries > 0) {
      // Reset retries on successful sync
      setSyncRetries(0);
    }
  }, [selectedLayerId, viewStateLayer, syncRetries, layers]);

  const toggleVisibility = useCallback((layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (layer && serviceInitialized) {
      getLayerService().updateLayer(layerId, { visible: !layer.visible });
    }
  }, [layers, serviceInitialized]);

  const handleRenderUpdate = useCallback((updates: Partial<LayerRender>) => {
    if (selectedLayerId) {
      // Mark layer as dirty to prevent StoreSyncService from overwriting user changes
      getStoreSyncService().markLayerDirty(selectedLayerId);
      
      // Validate threshold values - just ensure min <= max
      if (updates.threshold) {
        const [minThresh, maxThresh] = updates.threshold;
        
        // Auto-swap if crossed
        if (minThresh > maxThresh) {
          updates.threshold = [maxThresh, minThresh];
        }
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
        }
        return { ...state, layers };
      });
      
      // CRITICAL FIX: Also update layerStore so StoreSyncService has correct values
      // This prevents the snap-back issue where StoreSyncService reads stale 20-80% defaults
      useLayerStore.getState().updateLayerRender(selectedLayerId, updates);
      
      // ViewState changes will be automatically sent to backend via coalescing
    }
  }, [selectedLayerId]);

  // Check if service is initialized - this must happen after all hooks
  if (!serviceInitialized) {
    return (
      <div className="flex flex-col h-full items-center justify-center" 
           style={{ backgroundColor: 'var(--layer-bg)', color: 'var(--layer-text)' }}>
        <div className="text-center">
          <div className="mb-4">
            <svg className="animate-spin h-8 w-8 mx-auto" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <p className="text-sm text-gray-400">Initializing layer service...</p>
        </div>
      </div>
    );
  }

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
        
        {/* Layer selector table */}
        <LayerTable
          layers={layers}
          selectedLayerId={selectedLayerId}
          onSelect={selectLayer}
          onToggleVisibility={toggleVisibility}
          onShowMetadata={setMetadataLayerId}
        />

        {/* Layer controls - always visible */}
        <div className={`${!selectedLayer || !selectedRender ? 'opacity-50 pointer-events-none' : ''}`}>
          
          {/* Intensity Window */}
          <ProSlider
            label="Intensity Window"
            min={selectedMetadata?.dataRange?.min ?? 0}
            max={selectedMetadata?.dataRange?.max ?? 10000}
            value={selectedRender?.intensity || [0, 10000]}
            onChange={(value) => selectedLayer && handleRenderUpdate({ intensity: value })}
            precision={0}
          />

          {/* Threshold */}
          <ProSlider
            label="Threshold"
            min={selectedMetadata?.dataRange?.min ?? 0}
            max={selectedMetadata?.dataRange?.max ?? 10000}
            value={selectedRender?.threshold || [0, 0]}
            onChange={(value) => selectedLayer && handleRenderUpdate({ threshold: value })}
            precision={0}
          />

          {/* Colormap */}
          <EnhancedColormapSelector
            value={selectedRender?.colormap || 'gray'}
            onChange={(colormap) => selectedLayer && handleRenderUpdate({ colormap })}
          />

          {/* Opacity */}
          <SingleSlider
            label="Opacity"
            min={0}
            max={1}
            value={selectedRender?.opacity || 1}
            onChange={(opacity) => selectedLayer && handleRenderUpdate({ opacity })}
            showPercentage={true}
            className="mb-0"
          />
        </div>
        
        {/* Show help text when no layer is selected */}
        {!selectedLayer && layers.length > 0 && (
          <div className="text-center py-4">
            <p className="text-[13px]" style={{ color: '#94a3b8' }}>
              Select a layer to edit properties
            </p>
          </div>
        )}
      </div>
      
      {/* Metadata Drawer */}
      <MetadataDrawer
        layerId={metadataLayerId || selectedLayerId || ''}
        isOpen={!!metadataLayerId}
        onOpenChange={(open) => {
          if (!open && !isMetadataPinned) {
            setMetadataLayerId(null);
          }
        }}
        isPinned={isMetadataPinned}
        onPinToggle={() => setIsMetadataPinned(!isMetadataPinned)}
      />
    </div>
  );
};