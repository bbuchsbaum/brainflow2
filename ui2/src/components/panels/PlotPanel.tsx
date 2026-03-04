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
    /* Bauhaus empty state - quiet structural void */
    <div className="h-full w-full flex flex-col items-center justify-center bg-muted/5 select-none">
      {/* Faint grid pattern implying chart axis */}
      <div
        className="w-16 h-16 mb-4 opacity-10"
        style={{
          backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '6px 6px'
        }}
      />

      <span className="text-[9px] uppercase tracking-[0.2em] font-bold text-muted-foreground/40">
        No Signal Input
      </span>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-card text-card-foreground shadow-sm border border-border" style={{ borderRadius: '1px' }}>
      {/* Header - Instrument Control style */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'hsl(var(--border))', backgroundColor: 'hsl(var(--muted) / 0.2)' }}
      >
        <div className="flex items-center gap-2">
          {/* Status indicator */}
          <div
            className="w-1.5 h-1.5"
            style={{
              backgroundColor: selectedLayer ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.3)',
              borderRadius: '1px'
            }}
          />
          <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground">
            {selectedLayer ? selectedLayer.name : 'Histogram'}
          </span>
        </div>

        {/* Only show refresh button when layer is selected */}
        {selectedLayer && (
          <button
            type="button"
            onClick={loadHistogram}
            className="px-2 py-0.5 text-[9px] uppercase tracking-wider font-mono border transition-colors"
            style={{
              borderColor: 'hsl(var(--border))',
              color: 'hsl(var(--muted-foreground))',
              backgroundColor: 'transparent',
              borderRadius: '1px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'hsl(var(--muted) / 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Refresh
          </button>
        )}
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
