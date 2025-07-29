/**
 * MosaicViewSimple Component
 * 
 * A simplified MosaicView that uses the event-driven rendering architecture.
 * This component demonstrates how to reuse the existing rendering pipeline
 * instead of implementing custom batch rendering.
 * 
 * Key improvements:
 * - Uses RenderCell components for each grid cell
 * - Leverages MosaicRenderService for coordinated rendering
 * - Works with the existing ViewState → Backend pipeline
 * - No manual buffer parsing or ViewState transformation
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Grid3x3 } from 'lucide-react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getMosaicRenderService } from '@/services/MosaicRenderService';
import { getApiService } from '@/services/apiService';
import { RenderCell } from './RenderCell';
import { calculateInitialPage, calculateVolumeCenter } from '@/utils/mosaicUtils';
import './MosaicView.css';

interface MosaicViewSimpleProps {
  workspaceId: string;
}

export function MosaicViewSimple({ workspaceId }: MosaicViewSimpleProps) {
  // State management
  const [sliceAxis, setSliceAxis] = useState<'axial' | 'sagittal' | 'coronal'>('axial');
  const [currentPage, setCurrentPage] = useState(0);
  const [gridSize, setGridSize] = useState({ rows: 2, cols: 2 }); // Start with 2x2 for testing
  const [totalSlices, setTotalSlices] = useState(100); // Default
  const [cellSize, setCellSize] = useState({ width: 256, height: 256 });
  
  const gridRef = useRef<HTMLDivElement>(null);
  const mosaicRenderService = getMosaicRenderService();
  const apiService = getApiService();
  
  // Get layers from ViewStateStore
  const viewState = useViewStateStore(state => state.viewState);
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
          console.warn('[MosaicViewSimple] Invalid slice metadata received');
          return;
        }
        
        setTotalSlices(meta.sliceCount);
        
        // Get volume bounds for coordinate calculations
        const volumeBounds = await apiService.getVolumeBounds(primaryVolumeId);
        if (!volumeBounds) {
          console.warn('[MosaicViewSimple] Could not get volume bounds');
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
        console.error('[MosaicViewSimple] Error fetching metadata or calculating initial page:', error);
      }
    };
    
    fetchMetadataAndSetInitialPage();
  }, [primaryVolumeId, sliceAxis, gridSize.rows, gridSize.cols, apiService]);
  
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
  
  // Navigation handlers
  const handlePrevPage = useCallback(() => {
    setCurrentPage(prev => Math.max(0, prev - 1));
  }, []);
  
  const handleNextPage = useCallback(() => {
    const slicesPerPage = gridSize.rows * gridSize.cols;
    const maxPage = Math.ceil(totalSlices / slicesPerPage) - 1;
    setCurrentPage(prev => Math.min(maxPage, prev + 1));
  }, [gridSize, totalSlices]);
  
  // Calculate navigation state
  const isPrevDisabled = currentPage === 0;
  const isNextDisabled = useMemo(() => {
    const slicesPerPage = gridSize.rows * gridSize.cols;
    const maxPage = Math.ceil(totalSlices / slicesPerPage) - 1;
    return currentPage >= maxPage;
  }, [currentPage, gridSize, totalSlices]);
  
  const totalPages = Math.ceil(totalSlices / (gridSize.rows * gridSize.cols)) || 1;
  
  return (
    <div className="mosaic-view h-full flex flex-col bg-gray-900">
      {/* Header controls */}
      <div className="mosaic-header flex items-center justify-between p-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Grid3x3 className="w-5 h-5 text-gray-400" />
            <span className="text-sm font-medium text-gray-300">
              Mosaic View (Event-Driven)
            </span>
          </div>
          
          {/* Axis selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Axis:</label>
            <select
              className="h-7 px-2 text-sm bg-gray-700 text-gray-300 border border-gray-600 rounded"
              value={sliceAxis}
              onChange={(e) => {
                setSliceAxis(e.target.value as any);
                // Page will be recalculated in useEffect based on crosshair position
              }}
            >
              <option value="axial">Axial</option>
              <option value="sagittal">Sagittal</option>
              <option value="coronal">Coronal</option>
            </select>
          </div>
          
          {/* Grid size selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Grid:</label>
            <select
              className="h-7 px-2 text-sm bg-gray-700 text-gray-300 border border-gray-600 rounded"
              value={`${gridSize.rows}x${gridSize.cols}`}
              onChange={(e) => {
                const [rows, cols] = e.target.value.split('x').map(Number);
                setGridSize({ rows, cols });
                // Page will be recalculated in useEffect based on crosshair position
              }}
            >
              <option value="2x2">2×2</option>
              <option value="3x3">3×3</option>
              <option value="4x4">4×4</option>
              <option value="5x5">5×5</option>
            </select>
          </div>
        </div>
        
        {/* Navigation controls */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handlePrevPage}
            disabled={isPrevDisabled}
            className="h-7"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          
          <span className="text-sm text-gray-400 min-w-[100px] text-center">
            Page {currentPage + 1} / {totalPages}
          </span>
          
          <Button
            size="sm"
            variant="ghost"
            onClick={handleNextPage}
            disabled={isNextDisabled}
            className="h-7"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Grid container */}
      <div 
        ref={gridRef}
        className="mosaic-grid flex-1 p-2 overflow-auto"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${gridSize.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridSize.rows}, minmax(0, 1fr))`,
          gap: '4px',
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
      
      {/* No layers indicator */}
      {visibleLayers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50">
          <div className="text-gray-400 text-center">
            <div className="text-4xl mb-2">🧠</div>
            <div className="text-sm">No volumes loaded</div>
          </div>
        </div>
      )}
    </div>
  );
}