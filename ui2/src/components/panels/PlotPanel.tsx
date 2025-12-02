import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
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
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0
  });

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

  // Account for p-4 padding (1rem = 16px on each side = 32px total)
  const CONTAINER_PADDING = 32;

  // Track actual chart container size via ResizeObserver so the histogram
  // responds to GoldenLayout panel resizes even when no explicit dimensions
  // are passed in props (side panels).
  useEffect(() => {
    const element = chartContainerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(0, rect.width);
      const height = Math.max(0, rect.height);
      setMeasuredSize(prev => {
        if (prev.width === width && prev.height === height) {
          return prev;
        }
        return { width, height };
      });
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateSize();
      });
      observer.observe(element);
      return () => observer.disconnect();
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }
  }, []);

  // Simple dimension handling with reasonable defaults
  // Prefer measured DOM size, then GoldenLayout props, then fallbacks.
  const effectiveWidth = (measuredSize.width || containerWidth || 400);
  const effectiveHeight = (measuredSize.height || containerHeight || 300);

  // Subtract padding and ensure minimum dimensions for chart rendering
  const chartWidth = Math.max(effectiveWidth - CONTAINER_PADDING, 100);
  const chartHeight = Math.max(effectiveHeight - CONTAINER_PADDING, 80);

  // Debug logging for dimension tracking
  if (!containerWidth || !containerHeight) {
    console.log('[PlotPanel] Using fallback dimensions:', {
      containerWidth,
      containerHeight,
      measuredSize,
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

  const histogramPanel = selectedLayer ? (
    <div
      ref={chartContainerRef}
      className="h-full p-4 overflow-hidden bg-transparent"
    >
      <HistogramChart
        data={histogramData}
        width={chartWidth}
        height={chartHeight}
        intensityWindow={layerRender?.intensity}
        threshold={layerRender?.threshold}
        colormap={layerRender?.colormap}
        showAxes
        showTooltips
        useLogScale={useLogScale}
        onIntensityChange={handleIntensityChange}
        onThresholdChange={handleThresholdChange}
        onLogScaleChange={setUseLogScale}
        loading={loading}
        error={error}
      />
    </div>
  ) : (
    <div className="flex-1 p-4 overflow-y-auto bg-transparent">
      <div className="text-center py-8 space-y-2">
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
        <h3 className="text-lg font-semibold mb-2 text-primary">
          Plot Panel
        </h3>
        <p className="text-sm text-muted-foreground mb-2">Select a layer to view its histogram</p>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>• Volume intensity distribution</p>
          <p>• Colored by active colormap</p>
          <p>• Interactive tooltips</p>
          <p>• Intensity and threshold indicators</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-card text-card-foreground rounded-md shadow-sm border border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="space-y-1">
          <div className="label-text">Current Layer</div>
          <div className="font-semibold text-foreground">
            {selectedLayer?.name || 'No Layer Selected'}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tracking-wide uppercase text-[10px]">Histogram</span>
          <button
            type="button"
            onClick={loadHistogram}
            disabled={!selectedLayerId}
            className="px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {histogramPanel}
      </div>
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
