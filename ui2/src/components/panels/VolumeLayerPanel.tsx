import React, { useCallback, useState, useMemo } from 'react';
import { useLayers, useSelectedLayerId, useSelectedLayer, layerSelectors, useLayer, useLayerStore } from '@/stores/layerStore';
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

// Stable selectors — defined outside the component to avoid new references each render
const selectLayerSelector = (state: any) => state.selectLayer;

const VolumeLayerPanelContent: React.FC = () => {
  // State for metadata drawer
  const [metadataLayerId, setMetadataLayerId] = useState<string | null>(null);
  const [isMetadataPinned, setIsMetadataPinned] = useState(false);
  
  // Use volume layers from layer store
  const layers = useLayers();
  const selectedLayerId = useSelectedLayerId();
  const selectedLayer = useSelectedLayer();
  // Stable selector for selectLayer action (avoid inline arrow on every render)
  const selectLayer = useLayerStore(selectLayerSelector);
  // Metadata for the selected layer — selector stabilized via useMemo to avoid
  // re-subscription on every render (immer produces new Map refs per mutation)
  const metadataSelector = useMemo(
    () => selectedLayerId
      ? (state: any) => layerSelectors.getLayerMetadata(state, selectedLayerId)
      : () => undefined,
    [selectedLayerId]
  );
  const selectedMetadata = useLayer(metadataSelector);
  
  // Service initialization hook
  const { isInitialized: serviceInitialized, error: initializationError } = useLayerPanelServices();
  
  // File loading status hook
  const fileLoadingStatus = useFileLoadingStatus();
  
  // Get layer render properties from ViewState (source of truth)
  const viewStateLayers = useViewStateStore(state => state.viewState.layers);
  const viewStateLayer = viewStateLayers.find(l => l.id === selectedLayerId);
  
  // Keyboard shortcut for metadata
  useMetadataShortcut({ onShowMetadata: setMetadataLayerId });
  
  // Convert ViewState layer to render properties format (memoized to prevent
  // child re-renders when viewStateLayer reference is stable)
  const selectedRender = useMemo(() => viewStateLayer ? {
    opacity: viewStateLayer.opacity,
    intensity: viewStateLayer.intensity,
    threshold: viewStateLayer.threshold,
    colormap: viewStateLayer.colormap,
    colormapId: (viewStateLayer as any).colormapId,
    interpolation: (viewStateLayer.interpolation || 'linear') as 'nearest' | 'linear',
    atlasConfig: (viewStateLayer as any).atlasConfig,
    atlasPaletteKind: (viewStateLayer as any).atlasPaletteKind,
    atlasPaletteSeed: (viewStateLayer as any).atlasPaletteSeed,
    atlasMaxLabel: (viewStateLayer as any).atlasMaxLabel,
  } : undefined, [viewStateLayer]);

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

  const handleReorder = useCallback((newLayers: Layer[]) => {
    const layerIds = newLayers.map((layer) => layer.id);
    if (!serviceInitialized) {
      console.warn('[VolumeLayerPanel] Ignoring reorder before LayerService initialization');
      return;
    }
    void getLayerService().reorderLayers(layerIds).catch((error) => {
      console.error('[VolumeLayerPanel] Failed to reorder layers:', error);
    });
  }, [serviceInitialized]);

  const handleOpacityChange = useCallback((layerId: string, opacity: number) => {
    useViewStateStore.getState().setViewState((state) => {
      const layer = state.layers.find(l => l.id === layerId);
      if (layer) {
        layer.opacity = opacity;
        layer.visible = opacity > 0;
      }
    });
    getEventBus().emit('layer.render.changed', {
      layerId,
      renderProps: { opacity },
    });
  }, []);

  const getLayerVisibility = useCallback((layerId: string) => {
    const vsl = viewStateLayers.find(l => l.id === layerId);
    return vsl ? vsl.opacity > 0 : true;
  }, [viewStateLayers]);

  const handleRemoveLayer = useCallback((layerId: string) => {
    if (!serviceInitialized) {
      console.warn('[VolumeLayerPanel] Ignoring remove before LayerService initialization');
      return;
    }

    const layer = layers.find((item) => item.id === layerId);
    const confirmed = window.confirm(`Remove layer "${layer?.name ?? layerId}"?`);
    if (!confirmed) {
      return;
    }

    void getLayerService().removeLayer(layerId).catch((error) => {
      console.error('[VolumeLayerPanel] Failed to remove layer:', error);
    });
  }, [layers, serviceInitialized]);

  const getLayerOpacity = useCallback((layerId: string) => {
    const vsl = viewStateLayers.find(l => l.id === layerId);
    return vsl?.opacity ?? 1.0;
  }, [viewStateLayers]);

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

    if ((updates as any).colormapId !== undefined) {
      sanitized.colormapId = (updates as any).colormapId;
    }
    if ((updates as any).atlasConfig) {
      sanitized.atlasConfig = (updates as any).atlasConfig;
    }
    if ((updates as any).atlasPaletteKind) {
      sanitized.atlasPaletteKind = (updates as any).atlasPaletteKind;
    }
    if ((updates as any).atlasPaletteSeed !== undefined) {
      sanitized.atlasPaletteSeed = (updates as any).atlasPaletteSeed;
    }
    if ((updates as any).atlasMaxLabel !== undefined) {
      sanitized.atlasMaxLabel = (updates as any).atlasMaxLabel;
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
        // Switching to a named colormap disables any categorical palette colormapId.
        (layer as any).colormapId = undefined;
        (layer as any).atlasConfig = undefined;
        (layer as any).atlasPaletteKind = undefined;
        (layer as any).atlasPaletteSeed = undefined;
        (layer as any).atlasMaxLabel = undefined;
        didChange = true;
      }

      if ((sanitized as any).colormapId !== undefined && (layer as any).colormapId !== (sanitized as any).colormapId) {
        (layer as any).colormapId = (sanitized as any).colormapId;
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

      if ((sanitized as any).atlasConfig && (layer as any).atlasConfig !== (sanitized as any).atlasConfig) {
        (layer as any).atlasConfig = (sanitized as any).atlasConfig;
        didChange = true;
      }
      if ((sanitized as any).atlasPaletteKind && (layer as any).atlasPaletteKind !== (sanitized as any).atlasPaletteKind) {
        (layer as any).atlasPaletteKind = (sanitized as any).atlasPaletteKind;
        didChange = true;
      }
      if ((sanitized as any).atlasPaletteSeed !== undefined && (layer as any).atlasPaletteSeed !== (sanitized as any).atlasPaletteSeed) {
        (layer as any).atlasPaletteSeed = (sanitized as any).atlasPaletteSeed;
        didChange = true;
      }
      if ((sanitized as any).atlasMaxLabel !== undefined && (layer as any).atlasMaxLabel !== (sanitized as any).atlasMaxLabel) {
        (layer as any).atlasMaxLabel = (sanitized as any).atlasMaxLabel;
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
    <div className="flex flex-col h-full overflow-hidden bg-card text-card-foreground shadow-sm border border-border font-sans" style={{ borderRadius: '1px' }}>
      {/* Main content area */}
      <div
        className="flex-1 p-3 space-y-3 overflow-y-auto min-h-0"
        style={{ backgroundColor: 'hsl(var(--muted) / 0.1)' }}
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
          onRemove={handleRemoveLayer}
          onShowMetadata={setMetadataLayerId}
          onReorder={handleReorder}
          onOpacityChange={handleOpacityChange}
          getLayerVisibility={getLayerVisibility}
          getLayerOpacity={getLayerOpacity}
        />

        {/* Layer controls - Now using LayerPropertiesManager dispatcher */}
        {/* Only show when we have layers (empty state handled by LayerPropertiesManager) */}
        {layers.length > 0 && (
          <LayerPropertiesManager
            selectedLayer={selectedLayer || false}
            selectedRender={selectedRender}
            selectedMetadata={selectedMetadata}
            onRenderUpdate={handleRenderUpdate}
          />
        )}

        {/* Show help text when no layer is selected */}
        {!selectedLayer && layers.length > 0 && (
          <div className="text-center py-4">
            <p className="text-[13px] text-muted-foreground">
              Select a layer to edit properties
            </p>
          </div>
        )}

        {/* Empty state - No volume layers - fills remaining space */}
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
