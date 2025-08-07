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

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { MosaicCell } from './MosaicCell';
import { MosaicCellErrorBoundary } from './MosaicCellErrorBoundary';
import { getMosaicRenderService } from '@/services/MosaicRenderService';
import { calculateInitialPage, calculateVolumeCenter, getAxisIndex } from '@/utils/mosaicUtils';
import { getApiService } from '@/services/apiService';
import { MosaicToolbar } from '@/components/ui/MosaicToolbar';
import type { ViewState } from '@/types/viewState';
import type { WorldCoordinates } from '@/types/coordinates';
import './MosaicView.css';

interface MosaicViewPromiseProps {
  workspaceId?: string; // Optional workspace ID for generating unique cell tags
}

/**
 * Main MosaicView component using event-based architecture with MosaicRenderService
 */
export function MosaicViewPromise({ 
  workspaceId = 'mosaic-default'
}: MosaicViewPromiseProps) {
  console.log('[MosaicViewPromise] Component rendering/mounting');
  
  const viewState = useViewStateStore(state => state.viewState);
  const setCrosshair = useViewStateStore(state => state.setCrosshair);
  const [currentPage, setCurrentPage] = useState(0);
  const [sliceAxis, setSliceAxis] = useState<'axial' | 'sagittal' | 'coronal'>('axial');
  const [gridSize, setGridSize] = useState({ rows: 4, cols: 4 });
  const [totalSlices, setTotalSlices] = useState(0); // Start with 0, will be set when metadata loads
  const [cellSize, setCellSize] = useState({ width: 128, height: 128 }); // Start with minimum size
  const [currentSlice, setCurrentSlice] = useState(0);
  const [hasInitialized, setHasInitialized] = useState(false);
  
  const gridRef = useRef<HTMLDivElement>(null);
  const mosaicRenderService = getMosaicRenderService();
  const apiService = getApiService();
  
  // Log component lifecycle
  useEffect(() => {
    console.log('[MosaicViewPromise] Component mounted');
    return () => console.log('[MosaicViewPromise] Component unmounting');
  }, []);
  
  // Get visible layers
  const visibleLayers = useMemo(() => 
    viewState.layers.filter(layer => layer.visible && layer.opacity > 0),
    [viewState.layers]
  );
  
  // Get primary volume for metadata
  const primaryVolumeId = visibleLayers[0]?.volumeId;
  
  // Fetch slice metadata and calculate initial page based on crosshair
  useEffect(() => {
    if (!primaryVolumeId) return;
    
    const fetchMetadataAndSetInitialPage = async () => {
      try {
        // Get slice metadata
        const meta = await apiService.querySliceAxisMeta(primaryVolumeId, sliceAxis);
        if (!meta || meta.sliceCount <= 0) {
          console.warn('[MosaicViewPromise] Invalid slice metadata received');
          return;
        }
        
        console.log('[MosaicViewPromise] Setting totalSlices to:', meta.sliceCount);
        setTotalSlices(meta.sliceCount);
        
        // Get volume bounds for coordinate calculations
        const volumeBounds = await apiService.getVolumeBounds(primaryVolumeId);
        if (!volumeBounds) {
          console.warn('[MosaicViewPromise] Could not get volume bounds');
          return;
        }
        
        // Get current crosshair position
        const viewState = useViewStateStore.getState().viewState;
        let crosshairPosition = viewState.crosshair.world_mm;
        
        // If crosshair is at origin [0,0,0], use volume center
        if (crosshairPosition[0] === 0 && 
            crosshairPosition[1] === 0 && 
            crosshairPosition[2] === 0) {
          crosshairPosition = calculateVolumeCenter(volumeBounds);
        }
        
        // Calculate initial page based on crosshair position
        const initialPage = calculateInitialPage(
          crosshairPosition,
          volumeBounds,
          sliceAxis,
          meta.sliceCount,
          gridSize.rows,
          gridSize.cols
        );
        
        // Ensure page is within valid range
        const maxPage = Math.ceil(meta.sliceCount / (gridSize.rows * gridSize.cols)) - 1;
        const validPage = Math.max(0, Math.min(initialPage, maxPage));
        
        setCurrentPage(validPage);
        
      } catch (error) {
        console.error('[MosaicViewPromise] Error fetching metadata or calculating initial page:', error);
      }
    };
    
    fetchMetadataAndSetInitialPage();
  }, [primaryVolumeId, sliceAxis, gridSize.rows, gridSize.cols, apiService]);
  
  // Calculate cell dimensions based on container size
  useEffect(() => {
    if (!gridRef.current) return;

    const updateCellDimensions = () => {
      if (!gridRef.current) return;
      
      const { rows, cols } = gridSize;
      const containerRect = gridRef.current.getBoundingClientRect();
      
      // Skip if container has no dimensions yet
      if (containerRect.width === 0 || containerRect.height === 0) {
        console.log('[MosaicViewPromise] Container has no dimensions yet, waiting...');
        return;
      }
      
      // Account for gaps and padding
      const gap = 4;
      const padding = 16;
      const availableWidth = containerRect.width - padding - (gap * (cols - 1));
      const availableHeight = containerRect.height - padding - (gap * (rows - 1));
      
      // Calculate optimal cell size (maintain square aspect)
      const cellWidth = Math.floor(availableWidth / cols);
      const cellHeight = Math.floor(availableHeight / rows);
      const cellSizeValue = Math.min(cellWidth, cellHeight, 512); // Cap at 512px
      
      // Ensure minimum size
      const finalSize = Math.max(cellSizeValue, 128);
      
      console.log('[MosaicViewPromise] Calculating cell dimensions:', {
        containerSize: { width: containerRect.width, height: containerRect.height },
        gridSize: { rows, cols },
        availableSpace: { width: availableWidth, height: availableHeight },
        calculatedCellSize: { width: cellWidth, height: cellHeight },
        finalSize
      });
      
      setCellSize({ width: finalSize, height: finalSize });
      setHasInitialized(true);
    };

    // Try to calculate dimensions immediately
    updateCellDimensions();
    
    // If not initialized yet, try again after a frame
    if (!hasInitialized) {
      requestAnimationFrame(() => {
        updateCellDimensions();
      });
    }
    
    // Use ResizeObserver to detect container size changes
    const resizeObserver = new ResizeObserver(updateCellDimensions);
    resizeObserver.observe(gridRef.current);
    
    // Also listen to window resize as backup
    window.addEventListener('resize', updateCellDimensions);
    
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateCellDimensions);
    };
  }, [gridSize, hasInitialized]);
  
  // Calculate slice indices for current page
  const sliceIndices = useMemo(() => {
    const slicesPerPage = gridSize.rows * gridSize.cols;
    const startIdx = currentPage * slicesPerPage;
    
    console.log('[MosaicViewPromise] DEBUG - Calculating slice indices:', {
      currentPage,
      gridSize,
      totalSlices,
      slicesPerPage,
      startIdx,
      endIdx: startIdx + slicesPerPage - 1
    });
    
    const indices: number[] = [];
    for (let i = 0; i < slicesPerPage; i++) {
      const idx = startIdx + i;
      if (idx < totalSlices) {
        indices.push(idx);
      }
    }
    
    console.log('[MosaicViewPromise] DEBUG - Calculated indices:', indices);
    
    return indices;
  }, [currentPage, gridSize, totalSlices]);
  
  // Generate unique cell IDs
  const cellIds = useMemo(() => 
    sliceIndices.map(idx => `mosaic-${workspaceId}-${sliceAxis}-${idx}`),
    [sliceIndices, workspaceId, sliceAxis]
  );
  
  // Trigger renders when slice indices or layer parameters change
  useEffect(() => {
    console.log('[MosaicViewPromise] DEBUG - Render trigger effect:', {
      sliceIndicesLength: sliceIndices.length,
      visibleLayersLength: visibleLayers.length,
      sliceAxis,
      cellSize,
      viewStateKeys: Object.keys(viewState),
      hasLayers: !!viewState.layers,
      layerCount: viewState.layers?.length
    });
    
    if (sliceIndices.length === 0 || visibleLayers.length === 0) {
      console.log('[MosaicViewPromise] DEBUG - Skipping render: no slices or layers');
      return;
    }
    
    const renderRequests = sliceIndices.map((sliceIndex, i) => ({
      sliceIndex,
      axis: sliceAxis,
      cellId: cellIds[i],
      width: cellSize.width,
      height: cellSize.height
    }));
    
    console.log('[MosaicViewPromise] DEBUG - Sending render requests:', renderRequests);
    
    mosaicRenderService.renderMosaicGrid(renderRequests);
    
    // Cleanup: cancel renders when component unmounts or indices change
    return () => {
      mosaicRenderService.cancelRenders(cellIds);
    };
  }, [
    sliceIndices, 
    sliceAxis, 
    cellIds, 
    cellSize.width,
    cellSize.height,
    visibleLayers.length,
    // Use JSON.stringify to detect deep changes in layer properties
    JSON.stringify(visibleLayers.map(l => ({
      id: l.id,
      intensity: l.intensity,
      threshold: l.threshold,
      colormap: l.colormap,
      opacity: l.opacity
    })))
  ]);
  
  // Handle page navigation
  const totalPages = totalSlices 
    ? Math.ceil(totalSlices / (gridSize.rows * gridSize.cols))
    : 0;
  
  const goToPreviousPage = () => {
    setCurrentPage(prev => Math.max(0, prev - 1));
  };
  
  const goToNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages - 1, prev + 1));
  };
  
  // Handle slice change from slider
  const handleSliceChange = (newSlice: number) => {
    setCurrentSlice(newSlice);
    // Calculate which page this slice is on
    const slicesPerPage = gridSize.rows * gridSize.cols;
    const newPage = Math.floor(newSlice / slicesPerPage);
    setCurrentPage(newPage);
  };
  
  // Update current slice when page changes (only if out of range)
  useEffect(() => {
    const slicesPerPage = gridSize.rows * gridSize.cols;
    const firstSliceOnPage = currentPage * slicesPerPage;
    const lastSliceOnPage = Math.min(firstSliceOnPage + slicesPerPage - 1, totalSlices - 1);
    
    // Only reset slice if it's outside the current page's range
    if (currentSlice < firstSliceOnPage || currentSlice > lastSliceOnPage) {
      console.log('[MosaicViewPromise] Resetting slice to first on page:', firstSliceOnPage);
      setCurrentSlice(firstSliceOnPage);
    }
  }, [currentPage, gridSize, totalSlices, currentSlice]);
  
  if (!primaryVolumeId || totalSlices === 0) {
    console.log('[MosaicViewPromise] No volume to display:', { primaryVolumeId, totalSlices });
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        No volume loaded
      </div>
    );
  }
  
  // Log what we're about to render
  console.log('[MosaicViewPromise] Rendering mosaic grid:', {
    sliceCount: sliceIndices.length,
    gridSize: `${gridSize.rows}x${gridSize.cols}`,
    cellSize: `${cellSize.width}x${cellSize.height}`,
    axis: sliceAxis,
    currentPage,
    totalPages
  });
  
  return (
    <div className="mosaic-container">
      {/* Sticky toolbar */}
      <MosaicToolbar
        axis={sliceAxis}
        onAxisChange={setSliceAxis}
        grid={`${gridSize.rows}x${gridSize.cols}`}
        onGridChange={(value) => {
          const [rows, cols] = value.split('x').map(Number);
          setGridSize({ rows, cols });
        }}
        page={currentPage}
        pageCount={totalPages}
        canPrev={currentPage > 0}
        canNext={currentPage < totalPages - 1}
        onPrev={goToPreviousPage}
        onNext={goToNextPage}
        currentSlice={currentSlice}
        totalSlices={totalSlices}
        onSliceChange={handleSliceChange}
      />
      
      <div 
        ref={gridRef}
        className="mosaic-grid flex-1 p-2 overflow-auto"
        style={{
          display: 'grid',
          gridTemplateRows: `repeat(${gridSize.rows}, minmax(0, 1fr))`,
          gridTemplateColumns: `repeat(${gridSize.cols}, minmax(0, 1fr))`,
          gap: '4px'
        }}
      >
        {sliceIndices.map((sliceIndex, i) => (
          <div key={cellIds[i]} className="mosaic-cell">
            <MosaicCellErrorBoundary cellId={cellIds[i]} sliceIndex={sliceIndex}>
              <MosaicCell
                width={cellSize.width}
                height={cellSize.height}
                tag={cellIds[i]}
                sliceIndex={sliceIndex}
                axis={sliceAxis}
                onCrosshairClick={setCrosshair}
              />
            </MosaicCellErrorBoundary>
          </div>
        ))}
      </div>
    </div>
  );
}