import React, { useCallback, useState, useMemo } from 'react';
import { useLayers, useSelectedLayerId, useSelectedLayer, layerSelectors, useLayer } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getLayerService } from '@/services/LayerService';
import { LayerTable } from '../ui/LayerTable';
import { MetadataDrawer } from '../ui/MetadataDrawer';
import { useMetadataShortcut } from '@/hooks/useMetadataShortcut';
import { useLayerPanelServices } from '@/hooks/useLayerPanelServices';
import { useFileLoadingStatus } from '@/hooks/useFileLoadingStatus';
import { LayerControlsPanel } from './LayerControlsPanel';
import { LayerPropertiesManager } from './LayerPropertiesManager';
import { LayerEmptyState } from './LayerEmptyState';
import { LayerStatusBar } from './LayerStatusBar';
import { PanelErrorBoundary } from '../common/PanelErrorBoundary';
import { getEventBus } from '@/events/EventBus';
import type { LayerRender, Layer } from '@/types/layers';
import './LayerPanel.css';

const VolumeLayerPanelContent: React.FC = () => {
  console.log('[VolumeLayerPanel] VolumeLayerPanelContent component mounting');
  
  // State for metadata drawer
  const [metadataLayerId, setMetadataLayerId] = useState<string | null>(null);
  const [isMetadataPinned, setIsMetadataPinned] = useState(false);
  
  // Use volume layers from layer store
  const layers = useLayers();
  const selectedLayerId = useSelectedLayerId();
  const selectedLayer = useSelectedLayer();
  const layerMetadata = useLayer(layerSelectors.layerMetadata);
  const selectLayer = useLayer(state => state.selectLayer);
  const selectedMetadata = useLayer(state => 
    selectedLayerId ? layerSelectors.getLayerMetadata(state, selectedLayerId) : undefined
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
    interpolation: (viewStateLayer.interpolation || 'linear') as 'nearest' | 'linear'
  } : undefined;

  const toggleVisibility = useCallback((layerId: string) => {
    try {
      const viewStateLayer = viewStateLayers.find(l => l.id === layerId);
      if (serviceInitialized) {
        const currentOpacity = viewStateLayer?.opacity ?? 1.0;
        const isCurrentlyVisible = currentOpacity > 0;
        getLayerService().toggleVisibility(layerId, !isCurrentlyVisible);
      }
    } catch (error) {
      console.error('[LayerPanel] Error in toggleVisibility:', error);
    }
  }, [viewStateLayers, serviceInitialized]);

  const handleRenderUpdate = useCallback((updates: Partial<LayerRender>) => {
    if (!selectedLayerId) return;

    const sanitized: Partial<LayerRender> = {};

    if (updates.intensity) {
      const [minIntensity, maxIntensity] = updates.intensity;
      sanitized.intensity = [minIntensity, maxIntensity];
    }

    if (updates.threshold) {
      let [minThresh, maxThresh] = updates.threshold;
      if (minThresh > maxThresh) {
        [minThresh, maxThresh] = [maxThresh, minThresh];
      }
      sanitized.threshold = [minThresh, maxThresh];
    }

    if (updates.colormap) {
      sanitized.colormap = updates.colormap;
    }

    if (updates.opacity !== undefined) {
      sanitized.opacity = updates.opacity;
    }

    if (updates.interpolation) {
      sanitized.interpolation = updates.interpolation;
    }

    let didChange = false;

    useViewStateStore.getState().setViewState((state) => {
      const layer = state.layers.find((l) => l.id === selectedLayerId);
      if (!layer) return;

      if (sanitized.intensity) {
        const [nextMin, nextMax] = sanitized.intensity;
        const current = layer.intensity;
        if (!current || current[0] !== nextMin || current[1] !== nextMax) {
          layer.intensity = [nextMin, nextMax];
          didChange = true;
        }
      }

      if (sanitized.threshold) {
        const [nextLow, nextHigh] = sanitized.threshold;
        const current = layer.threshold;
        if (!current || current[0] !== nextLow || current[1] !== nextHigh) {
          layer.threshold = [nextLow, nextHigh];
          didChange = true;
        }
      }

      if (sanitized.colormap && layer.colormap !== sanitized.colormap) {
        layer.colormap = sanitized.colormap;
        didChange = true;
      }

      if (sanitized.opacity !== undefined && !Object.is(layer.opacity, sanitized.opacity)) {
        layer.opacity = sanitized.opacity;
        didChange = true;
      }

      if (sanitized.interpolation && layer.interpolation !== sanitized.interpolation) {
        layer.interpolation = sanitized.interpolation;
        didChange = true;
      }
    });

    if (!didChange) {
      return;
    }

    // Emit event for render property changes (use sanitized copy)
    getEventBus().emit('layer.render.changed', {
      layerId: selectedLayerId,
      renderProps: sanitized,
    });

    // Debug: log current ViewState layer ordering + opacities
    const viewState = useViewStateStore.getState().viewState;
    console.log('[VolumeLayerPanel] ViewState layers after render update:', {
      layers: viewState.layers.map(l => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        volumeId: l.volumeId,
        order: l.order
      }))
    });
  }, [selectedLayerId]);
  
  return (
    <div className="flex flex-col h-full overflow-hidden bg-card text-card-foreground rounded-md shadow-sm border border-border font-sans">
      {/* Main content area */}
      <div 
        className="flex-1 p-4 space-y-4 overflow-y-auto min-h-0 bg-muted/20"
      >
        {/* Status messages */}
        <LayerStatusBar
          error={initializationError}
          isInitializing={!serviceInitialized}
          fileLoadingStatus={fileLoadingStatus}
        />
        
        {/* Layer selector table - Volume layers only */}
        <LayerTable
          layers={layers}
          selectedLayerId={selectedLayerId}
          onSelect={selectLayer}
          onToggleVisibility={toggleVisibility}
          onShowMetadata={setMetadataLayerId}
          getLayerVisibility={(layerId) => {
            const viewStateLayer = viewStateLayers.find(l => l.id === layerId);
            return viewStateLayer ? viewStateLayer.opacity > 0 : true;
          }}
        />

        {/* Layer controls - Now using LayerPropertiesManager dispatcher */}
        <LayerPropertiesManager
          selectedLayer={selectedLayer || false}
          selectedRender={selectedRender}
          selectedMetadata={selectedMetadata}
          onRenderUpdate={handleRenderUpdate}
        />
        
        {/* Show help text when no layer is selected */}
        {!selectedLayer && layers.length > 0 && (
          <div className="text-center py-4">
            <p className="text-[13px] text-muted-foreground">
              Select a layer to edit properties
            </p>
          </div>
        )}
        
        {/* Empty state - No volume layers */}
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
export const VolumeLayerPanel: React.FC = () => {
  return (
    <PanelErrorBoundary panelName="VolumeLayerPanel">
      <VolumeLayerPanelContent />
    </PanelErrorBoundary>
  );
};
