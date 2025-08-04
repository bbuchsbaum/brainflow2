import React, { useCallback, useState } from 'react';
import { useLayers, useSelectedLayerId, useSelectedLayer, layerSelectors, useLayer } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getLayerService } from '@/services/LayerService';
import { getStoreSyncService } from '@/services/StoreSyncService';
import { LayerTable } from '../ui/LayerTable';
import { MetadataDrawer } from '../ui/MetadataDrawer';
import { useMetadataShortcut } from '@/hooks/useMetadataShortcut';
import { useLayerPanelServices } from '@/hooks/useLayerPanelServices';
import { useFileLoadingStatus } from '@/hooks/useFileLoadingStatus';
import { LayerControlsPanel } from './LayerControlsPanel';
import { LayerEmptyState } from './LayerEmptyState';
import { LayerStatusBar } from './LayerStatusBar';
import { PanelErrorBoundary } from '../common/PanelErrorBoundary';
import { getEventBus } from '@/events/EventBus';
import type { LayerRender } from '@/types/layers';
import './LayerPanel.css';

const LayerPanelContent: React.FC = () => {
  console.log('[LayerPanel] LayerPanelContent component mounting');
  
  // State for metadata drawer
  const [metadataLayerId, setMetadataLayerId] = useState<string | null>(null);
  const [isMetadataPinned, setIsMetadataPinned] = useState(false);
  
  // Use typed selectors
  const layers = useLayers();
  const selectedLayerId = useSelectedLayerId();
  const selectedLayer = useSelectedLayer();
  const layerMetadata = useLayer(layerSelectors.layerMetadata);
  const selectLayer = useLayer(state => state.selectLayer);
  const selectedMetadata = useLayer(state => 
    selectedLayerId ? layerSelectors.getLayerMetadata(state, selectedLayerId) : undefined
  );
  const selectedLayerRender = useLayer(state => 
    selectedLayerId ? layerSelectors.getLayerRender(state, selectedLayerId) : undefined
  );
  
  // Service initialization hook
  const { isInitialized: serviceInitialized, error: initializationError } = useLayerPanelServices();
  
  // File loading status hook
  const fileLoadingStatus = useFileLoadingStatus();
  
  // Get layer render properties from ViewState (source of truth)
  const viewStateLayers = useViewStateStore(state => state.viewState.layers);
  const viewStateLayer = viewStateLayers.find(l => l.id === selectedLayerId);
  
  // Keyboard shortcut for metadata
  useMetadataShortcut({ onShowMetadata: setMetadataLayerId });
  
  // Convert ViewState layer to render properties format
  const selectedRender = viewStateLayer ? {
    opacity: viewStateLayer.opacity,
    intensity: viewStateLayer.intensity,
    threshold: viewStateLayer.threshold,
    colormap: viewStateLayer.colormap,
    interpolation: 'linear' as const
  } : selectedLayerRender ? {
    // Fallback to layerStore render properties
    opacity: selectedLayerRender.opacity,
    intensity: selectedLayerRender.intensity || [0, 100],
    threshold: selectedLayerRender.threshold || [0, 0],
    colormap: selectedLayerRender.colormap || 'gray',
    interpolation: selectedLayerRender.interpolation || 'linear' as const
  } : undefined;

  const toggleVisibility = useCallback((layerId: string) => {
    try {
      const layer = layers.find(l => l.id === layerId);
      const viewStateLayer = viewStateLayers.find(l => l.id === layerId);
      if (layer && serviceInitialized) {
        // SINGLE SOURCE OF TRUTH: Use opacity to determine visibility
        const currentOpacity = viewStateLayer?.opacity ?? 1.0;
        const isCurrentlyVisible = currentOpacity > 0;
        getLayerService().toggleVisibility(layerId, !isCurrentlyVisible);
      }
    } catch (error) {
      console.error('[LayerPanel] Error in toggleVisibility:', error);
    }
  }, [layers, viewStateLayers, serviceInitialized]);

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
      useLayer(state => state.updateLayerRender)(selectedLayerId, updates);
      
      // Emit event for render property changes
      getEventBus().emit('layer.render.changed', { 
        layerId: selectedLayerId, 
        renderProps: updates 
      });
      
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
        {/* Status messages */}
        <LayerStatusBar
          error={initializationError}
          isInitializing={!serviceInitialized}
          fileLoadingStatus={fileLoadingStatus}
        />
        
        {/* Layer selector table */}
        <LayerTable
          layers={layers}
          selectedLayerId={selectedLayerId}
          onSelect={selectLayer}
          onToggleVisibility={toggleVisibility}
          onShowMetadata={setMetadataLayerId}
          getLayerVisibility={(layerId) => {
            // SINGLE SOURCE OF TRUTH: Derive visibility from opacity
            const viewStateLayer = viewStateLayers.find(l => l.id === layerId);
            return viewStateLayer ? viewStateLayer.opacity > 0 : true;
          }}
        />

        {/* Layer controls */}
        <LayerControlsPanel
          selectedLayer={!!selectedLayer}
          selectedRender={selectedRender}
          selectedMetadata={selectedMetadata}
          onRenderUpdate={handleRenderUpdate}
        />
        
        {/* Show help text when no layer is selected */}
        {!selectedLayer && layers.length > 0 && (
          <div className="text-center py-4">
            <p className="text-[13px]" style={{ color: '#94a3b8' }}>
              Select a layer to edit properties
            </p>
          </div>
        )}
        
        {/* Empty state */}
        {layers.length === 0 && <LayerEmptyState />}
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

// Export the wrapped component with error boundary
export const LayerPanel: React.FC = () => {
  return (
    <PanelErrorBoundary panelName="LayerPanel">
      <LayerPanelContent />
    </PanelErrorBoundary>
  );
};