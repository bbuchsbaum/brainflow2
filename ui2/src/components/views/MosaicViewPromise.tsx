/**
 * MosaicViewPromise Component
 * 
 * A refactored version of MosaicView that uses promise-based rendering
 * instead of event-based rendering. This eliminates the brittleness
 * from event filtering and provides cleaner isolation.
 * 
 * Key improvements:
 * - Each cell has its own RenderSession for complete isolation
 * - No event filtering needed - direct promise returns
 * - Cleaner error handling per cell
 * - Built-in performance tracking
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useRenderSession } from '@/hooks/useRenderSession';
import { calculateInitialPage, worldPositionToSliceIndex, getAxisIndex } from '@/utils/mosaicUtils';
import { getApiService } from '@/services/apiService';
import type { ViewState } from '@/types/viewState';
import type { WorldCoordinates } from '@/types/coordinates';
import './MosaicView.css';

interface MosaicCellPromiseProps {
  viewState: ViewState;
  viewType: 'axial' | 'sagittal' | 'coronal';
  sliceIndex: number;
  slicePosition: number;
  showLabel?: boolean;
}

/**
 * Individual cell component using promise-based rendering
 */
function MosaicCellPromise({ 
  viewState, 
  viewType, 
  sliceIndex, 
  slicePosition,
  showLabel = false 
}: MosaicCellPromiseProps) {
  const cellRef = useRef<HTMLDivElement>(null);
  
  // Use promise-based rendering with unique session per cell
  const {
    canvasRef,
    isLoading,
    error,
    renderToCanvas
  } = useRenderSession({
    sessionId: `mosaic-${viewType}-${sliceIndex}`,
    onRenderError: (error) => {
      console.error(`[MosaicCell ${viewType}:${sliceIndex}] Render error:`, error);
    }
  });
  
  // Track if initial render has happened
  const hasRendered = useRef(false);
  const renderToCanvasRef = useRef(renderToCanvas);
  
  // Update the ref when renderToCanvas changes
  useEffect(() => {
    renderToCanvasRef.current = renderToCanvas;
  }, [renderToCanvas]);
  
  // Handle canvas sizing
  useEffect(() => {
    if (!canvasRef.current || !cellRef.current) return;
    
    const updateCanvasSize = () => {
      const rect = cellRef.current!.getBoundingClientRect();
      canvasRef.current!.width = Math.floor(rect.width);
      canvasRef.current!.height = Math.floor(rect.height);
    };
    
    updateCanvasSize();
    
    // Observe size changes
    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(cellRef.current);
    
    return () => observer.disconnect();
  }, []);
  
  
  // Render the slice using ref to avoid dependency loops
  const renderSlice = useCallback(async () => {
    if (!canvasRef.current) return;
    
    // Create a modified view state with the slice position
    const sliceViewState = { ...viewState };
    const axisIndex = viewType === 'axial' ? 2 : viewType === 'sagittal' ? 0 : 1;
    const newCrosshair = [...viewState.crosshair.world_mm];
    newCrosshair[axisIndex] = slicePosition;
    sliceViewState.crosshair = {
      ...viewState.crosshair,
      world_mm: newCrosshair
    };
    
    try {
      await renderToCanvasRef.current(sliceViewState, viewType);
      hasRendered.current = true;
    } catch (error) {
      console.error(`[MosaicCell] Failed to render slice ${sliceIndex}:`, error);
    }
  }, [viewState, viewType, slicePosition, sliceIndex]); // Stable dependencies
  
  // Trigger render when viewState or slice position changes
  useEffect(() => {
    renderSlice();
  }, [viewState, slicePosition]); // Don't include renderSlice to avoid loops
  
  return (
    <div ref={cellRef} className="mosaic-cell">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
      />
      
      {showLabel && (
        <div className="absolute top-1 left-1 text-xs text-white/70 bg-black/50 px-1 rounded">
          {viewType[0].toUpperCase()}{sliceIndex}
        </div>
      )}
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="text-white/50 text-xs">...</div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/20">
          <div className="text-red-400 text-xs">Error</div>
        </div>
      )}
    </div>
  );
}

interface MosaicViewPromiseProps {
  viewType: 'axial' | 'sagittal' | 'coronal';
  gridSize?: { rows: number; cols: number };
}

/**
 * Main MosaicView component using promise-based architecture
 */
export function MosaicViewPromise({ 
  viewType, 
  gridSize = { rows: 4, cols: 4 } 
}: MosaicViewPromiseProps) {
  const viewState = useViewStateStore(state => state.viewState);
  const [currentPage, setCurrentPage] = useState(0);
  const [sliceMetadata, setSliceMetadata] = useState<{
    sliceCount: number;
    sliceSpacing: number;
    axisLength: number;
  } | null>(null);
  
  // Get the first visible layer's volume ID
  const volumeId = useMemo(() => {
    const firstVisibleLayer = viewState.layers.find(layer => 
      layer.visible && layer.opacity > 0
    );
    return firstVisibleLayer?.volumeId;
  }, [viewState.layers]);
  
  // Fetch slice metadata
  useEffect(() => {
    if (!volumeId) return;
    
    const fetchMetadata = async () => {
      try {
        const apiService = getApiService();
        const metadata = await apiService.querySliceAxisMeta(volumeId, viewType);
        setSliceMetadata(metadata);
        
        // Calculate initial page based on crosshair
        const axisIndex = viewType === 'axial' ? 2 : viewType === 'sagittal' ? 0 : 1;
        const currentPosition = viewState.crosshair.world_mm[axisIndex];
        // Calculate bounds from metadata
        const bounds = {
          min: [-metadata.axisLength / 2, -metadata.axisLength / 2, -metadata.axisLength / 2],
          max: [metadata.axisLength / 2, metadata.axisLength / 2, metadata.axisLength / 2]
        };
        bounds.min[axisIndex] = -metadata.axisLength / 2;
        bounds.max[axisIndex] = metadata.axisLength / 2;
        
        const initialPage = calculateInitialPage(
          viewState.crosshair.world_mm,
          bounds,
          viewType,
          metadata.sliceCount,
          gridSize.rows,
          gridSize.cols
        );
        setCurrentPage(initialPage);
      } catch (error) {
        console.error('[MosaicViewPromise] Failed to fetch slice metadata:', error);
      }
    };
    
    fetchMetadata();
  }, [volumeId, viewType]);
  
  // Calculate slice indices for current page
  const sliceData = useMemo(() => {
    if (!sliceMetadata) return [];
    
    const slicesPerPage = gridSize.rows * gridSize.cols;
    const startIndex = currentPage * slicesPerPage;
    const endIndex = Math.min(startIndex + slicesPerPage, sliceMetadata.sliceCount);
    
    const slices = [];
    const axisIndex = getAxisIndex(viewType);
    
    // Calculate slice positions based on the volume bounds
    const axisMin = -sliceMetadata.axisLength / 2;
    const axisMax = sliceMetadata.axisLength / 2;
    const sliceSpacing = sliceMetadata.sliceSpacing;
    
    for (let i = startIndex; i < endIndex; i++) {
      // Calculate world position for this slice
      const normalizedPosition = i / (sliceMetadata.sliceCount - 1);
      const worldPosition = axisMin + normalizedPosition * (axisMax - axisMin);
      
      slices.push({
        index: i,
        position: worldPosition
      });
    }
    
    return slices;
  }, [currentPage, gridSize, sliceMetadata, viewType]);
  
  // Handle page navigation
  const totalPages = sliceMetadata 
    ? Math.ceil(sliceMetadata.sliceCount / (gridSize.rows * gridSize.cols))
    : 0;
  
  const goToPreviousPage = () => {
    setCurrentPage(prev => Math.max(0, prev - 1));
  };
  
  const goToNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages - 1, prev + 1));
  };
  
  if (!volumeId || !sliceMetadata) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        No volume loaded
      </div>
    );
  }
  
  return (
    <div className="mosaic-container">
      <div className="mosaic-header">
        <h3 className="text-sm font-medium">
          {viewType.charAt(0).toUpperCase() + viewType.slice(1)} Mosaic
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousPage}
            disabled={currentPage === 0}
            className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded"
          >
            Previous
          </button>
          <span className="text-sm">
            Page {currentPage + 1} of {totalPages}
          </span>
          <button
            onClick={goToNextPage}
            disabled={currentPage === totalPages - 1}
            className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded"
          >
            Next
          </button>
        </div>
      </div>
      
      <div 
        className="mosaic-grid"
        style={{
          gridTemplateRows: `repeat(${gridSize.rows}, 1fr)`,
          gridTemplateColumns: `repeat(${gridSize.cols}, 1fr)`
        }}
      >
        {sliceData.map((slice, index) => (
          <MosaicCellPromise
            key={`${viewType}-${currentPage}-${index}`}
            viewState={viewState}
            viewType={viewType}
            sliceIndex={slice.index}
            slicePosition={slice.position}
            showLabel={false}
          />
        ))}
      </div>
    </div>
  );
}