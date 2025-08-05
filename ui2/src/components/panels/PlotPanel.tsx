import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { histogramService } from '@/services/HistogramService';
import { HistogramChart } from '@/components/plots/HistogramChart';
import { PanelErrorBoundary } from '../common/PanelErrorBoundary';
import { getEventBus } from '@/events/EventBus';
import type { HistogramData } from '@/types/histogram';

interface PlotPanelProps {
  containerWidth?: number;
  containerHeight?: number;
}

const PlotPanelContent: React.FC<PlotPanelProps> = ({ containerWidth, containerHeight }) => {
  const [histogramData, setHistogramData] = useState<HistogramData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [useLogScale, setUseLogScale] = useState(false);
  
  const selectedLayerId = useLayerStore(state => state.selectedLayerId);
  const selectedLayer = useLayerStore(state => 
    state.layers.find(l => l.id === state.selectedLayerId)
  );
  const viewState = useViewStateStore(state => state.viewState);
  
  // Get layer render properties from ViewState (primary source)
  const layerRender = useMemo(() => {
    if (!selectedLayerId || !viewState.layers) return undefined;
    
    // Find layer in ViewState (primary source)
    const viewStateLayer = viewState.layers.find(l => l.id === selectedLayerId);
    if (viewStateLayer) {
      return {
        intensity: viewStateLayer.intensity,
        threshold: viewStateLayer.threshold,
        colormap: viewStateLayer.colormap,
        opacity: viewStateLayer.opacity,
      };
    }
    
    // During transitions, ViewState might not have the layer yet
    // Return undefined to indicate no render properties available
    return undefined;
  }, [selectedLayerId, viewState.layers]);

  // Simple dimension handling with reasonable defaults
  const chartWidth = containerWidth || 400;
  const chartHeight = containerHeight || 300;
  
  // Debug logging for dimension tracking
  if (!containerWidth || !containerHeight) {
    console.log('[PlotPanel] Using fallback dimensions:', {
      containerWidth,
      containerHeight,
      fallbackWidth: chartWidth,
      fallbackHeight: chartHeight,
      reason: !containerWidth ? 'containerWidth missing' : 'containerHeight missing',
      timestamp: new Date().toISOString()
    });
  }

  // Create loadHistogram as a memoized callback
  const loadHistogram = useCallback(async () => {
    if (!selectedLayerId) {
      setHistogramData(null);
      return;
    }

    console.log('[PlotPanel] Starting histogram load for layer:', selectedLayerId);
    setLoading(true);
    setError(null);
    
    try {
      const data = await histogramService.computeHistogram({
        layerId: selectedLayerId,
        binCount: 256,
        excludeZeros: true  // Default to true for brain imaging data
      });
      
      console.log('[PlotPanel] Histogram data received:', {
        hasData: !!data,
        binCount: data?.bins?.length,
        totalCount: data?.totalCount,
        range: data ? [data.minValue, data.maxValue] : null
      });
      
      setHistogramData(data);
    } catch (err) {
      const error = err as Error;
      // Provide more specific error context
      const enhancedError = new Error(
        `Failed to compute histogram for layer ${selectedLayerId}: ${error.message}`
      );
      enhancedError.cause = error;
      setError(enhancedError);
      
      console.error('[PlotPanel] Histogram computation failed:', {
        layerId: selectedLayerId,
        originalError: error.message,
        containerDimensions: { containerWidth, containerHeight },
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  }, [selectedLayerId]);

  // Load histogram data when selected layer changes
  useEffect(() => {
    if (!selectedLayerId) {
      setHistogramData(null);
      return;
    }

    loadHistogram();
  }, [selectedLayerId, loadHistogram]); // Only reload when layer changes

  // Listen for render change events from LayerPanel (for debugging)
  useEffect(() => {
    if (!selectedLayerId) return;
    
    const handleRenderChange = ({ layerId, renderProps }: { layerId: string; renderProps: any }) => {
      if (layerId === selectedLayerId) {
        console.log('[PlotPanel] Render properties changed for layer:', layerId, renderProps);
        // Don't reload histogram - React will re-render with new props automatically
      }
    };
    
    const eventBus = getEventBus();
    eventBus.on('layer.render.changed', handleRenderChange);
    
    return () => {
      eventBus.off('layer.render.changed', handleRenderChange);
    };
  }, [selectedLayerId]);

  // Handle intensity window changes
  const handleIntensityChange = (window: [number, number]) => {
    if (selectedLayerId && layerRender) {
      // Update ViewState (single source of truth)
      useViewStateStore.getState().setViewState((state) => {
        const layers = [...state.layers];
        const layerIndex = layers.findIndex(l => l.id === selectedLayerId);
        if (layerIndex !== -1) {
          layers[layerIndex] = {
            ...layers[layerIndex],
            intensity: window
          };
        }
        return { ...state, layers };
      });
    }
  };

  // Handle threshold changes
  const handleThresholdChange = (threshold: [number, number]) => {
    if (selectedLayerId && layerRender) {
      // Update ViewState (single source of truth)
      useViewStateStore.getState().setViewState((state) => {
        const layers = [...state.layers];
        const layerIndex = layers.findIndex(l => l.id === selectedLayerId);
        if (layerIndex !== -1) {
          layers[layerIndex] = {
            ...layers[layerIndex],
            threshold
          };
        }
        return { ...state, layers };
      });
    }
  };

  return (
    <div 
      className="flex flex-col h-full overflow-hidden"
      style={{ 
        backgroundColor: 'var(--layer-bg, #1a1a1a)',
        color: 'var(--layer-text, #e5e5e5)',
        borderRadius: '8px',
        fontFamily: 'var(--app-font-sans)'
      }}
    >
      {selectedLayer ? (
        <>
          {/* Chart Container */}
          <div 
            className="flex-1 p-4 overflow-hidden"
            style={{ 
              backgroundColor: 'rgba(0, 0, 0, 0.2)'
            }}
          >
            <HistogramChart
              data={histogramData}
              width={chartWidth} // Width padding already accounted for in calculation
              height={chartHeight}
              intensityWindow={layerRender?.intensity}
              threshold={layerRender?.threshold}
              colormap={layerRender?.colormap}
              showAxes={true}
              showTooltips={true}
              useLogScale={useLogScale}
              onIntensityChange={handleIntensityChange}
              onThresholdChange={handleThresholdChange}
              onLogScaleChange={setUseLogScale}
              loading={loading}
              error={error}
            />
          </div>
        </>
      ) : (
        <div 
          className="flex-1 p-4 overflow-y-auto"
          style={{ 
            backgroundColor: 'rgba(0, 0, 0, 0.2)'
          }}
        >
          <div className="text-center py-8">
            <svg 
              className="w-16 h-16 mx-auto mb-4 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={1.5} 
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--layer-accent, #3b82f6)' }}>
              Plot Panel
            </h3>
            
            <p className="text-sm text-gray-400 mb-4">
              Select a layer to view its histogram
            </p>
            
            <div className="text-xs text-gray-500 space-y-1">
              <p>• Volume intensity distribution</p>
              <p>• Colored by active colormap</p>
              <p>• Interactive tooltips</p>
              <p>• Intensity and threshold indicators</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Export wrapped component with error boundary
export const PlotPanel: React.FC<PlotPanelProps> = (props) => {
  return (
    <PanelErrorBoundary panelName="PlotPanel">
      <PlotPanelContent {...props} />
    </PanelErrorBoundary>
  );
};