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
import { RenderCell } from './RenderCell';
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
  const viewState = useViewStateStore(state => state.viewState);
  const [currentPage, setCurrentPage] = useState(0);
  const [sliceAxis, setSliceAxis] = useState<'axial' | 'sagittal' | 'coronal'>('axial');
  const [gridSize, setGridSize] = useState({ rows: 4, cols: 4 });
  const [totalSlices, setTotalSlices] = useState(100);
  const [cellSize, setCellSize] = useState({ width: 256, height: 256 });
  
  const gridRef = useRef<HTMLDivElement>(null);
  const mosaicRenderService = getMosaicRenderService();
  const apiService = getApiService();
  
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
  
  // Auto-resize cells based on container size
  useEffect(() => {
    if (!gridRef.current) return;

    const updateCellDimensions = () => {
      if (!gridRef.current) return;
      
      const { rows, cols } = gridSize;
      const containerRect = gridRef.current.getBoundingClientRect();
      
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
      
      setCellSize({ width: finalSize, height: finalSize });
    };

    updateCellDimensions();
    
    // Use ResizeObserver to detect container size changes
    const resizeObserver = new ResizeObserver(updateCellDimensions);
    resizeObserver.observe(gridRef.current);
    
    // Also listen to window resize as backup
    window.addEventListener('resize', updateCellDimensions);
    
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateCellDimensions);
    };
  }, [gridSize]);
  
  // Calculate slice indices for current page
  const sliceIndices = useMemo(() => {
    const slicesPerPage = gridSize.rows * gridSize.cols;
    const startIdx = currentPage * slicesPerPage;
    
    const indices: number[] = [];
    for (let i = 0; i < slicesPerPage; i++) {
      const idx = startIdx + i;
      if (idx < totalSlices) {
        indices.push(idx);
      }
    }
    
    return indices;
  }, [currentPage, gridSize, totalSlices]);
  
  // Generate unique cell IDs
  const cellIds = useMemo(() => 
    sliceIndices.map(idx => `mosaic-${workspaceId}-${sliceAxis}-${idx}`),
    [sliceIndices, workspaceId, sliceAxis]
  );
  
  // Trigger renders when slice indices or layer parameters change
  useEffect(() => {
    if (sliceIndices.length === 0 || visibleLayers.length === 0) return;
    
    const renderRequests = sliceIndices.map((sliceIndex, i) => ({
      sliceIndex,
      axis: sliceAxis,
      cellId: cellIds[i],
      width: cellSize.width,
      height: cellSize.height
    }));
    
    mosaicRenderService.renderMosaicGrid(renderRequests);
    
    // Cleanup: cancel renders when component unmounts or indices change
    return () => {
      mosaicRenderService.cancelRenders(cellIds);
    };
  }, [sliceIndices, sliceAxis, cellIds, cellSize, mosaicRenderService, 
      // Add dependencies for layer parameters to trigger re-renders
      visibleLayers.length,
      // Include layer properties that should trigger updates
      ...visibleLayers.map(layer => [
        layer.intensity?.[0], 
        layer.intensity?.[1],
        layer.threshold?.enabled,
        layer.threshold?.min,
        layer.threshold?.max,
        layer.opacity,
        layer.colormap
      ]).flat()
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
  
  if (!primaryVolumeId || totalSlices === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        No volume loaded
      </div>
    );
  }
  
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
            <RenderCell
              width={cellSize.width}
              height={cellSize.height}
              tag={cellIds[i]}
              showLabel={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}