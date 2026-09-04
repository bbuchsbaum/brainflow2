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

import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { MosaicCell } from './MosaicCell';
import { MosaicCellErrorBoundary } from './MosaicCellErrorBoundary';
import { createMosaicRenderService } from '@/services/MosaicRenderService';
import { calculateInitialPage } from '@/utils/mosaicUtils';
import { getApiService } from '@/services/apiService';
import { MosaicToolbar } from '@/components/ui/MosaicToolbar';
import { RenderErrorBoundary } from '@/components/ui/RenderErrorBoundary';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { readFileDragData } from '@/utils/layerDrag';
import { resolveDropOpenIntent } from '@/types/loadIntent';
import './MosaicView.css';

interface MosaicViewPromiseProps {
  workspaceId?: string; // Optional workspace ID for generating unique cell tags
}

/**
 * Main MosaicView component using event-based architecture with MosaicRenderService
 */
function MosaicViewPromiseRaw({ 
  workspaceId = 'mosaic-default'
}: MosaicViewPromiseProps) {
  console.log('[MosaicViewPromise] Component rendering/mounting');
  
  const layers = useViewStateStore(state => state.getWorkspaceViewState(workspaceId).layers);
  const layerRevision = useViewStateStore(
    state => state.getWorkspaceViewStateRevisions(workspaceId).layers
  );
  const timepointRevision = useViewStateStore(
    state => state.getWorkspaceViewStateRevisions(workspaceId).timepoint
  );
  const setCrosshair = useViewStateStore(state => state.setCrosshair);
  const [currentPage, setCurrentPage] = useState(0);
  const [sliceAxis, setSliceAxis] = useState<'axial' | 'sagittal' | 'coronal'>('axial');
  const [gridSize, setGridSize] = useState({ rows: 4, cols: 4 });
  const [sliceMetadata, setSliceMetadata] = useState<{ volumeId: string; axis: string; count: number } | null>(null);
  const [cellSize, setCellSize] = useState({ width: 128, height: 128 }); // Start with minimum size
  const [currentSlice, setCurrentSlice] = useState(0);
  const [hasInitialized, setHasInitialized] = useState(false);
  
  const gridRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mosaicRenderService = useMemo(() => createMosaicRenderService(workspaceId), [workspaceId]);
  useEffect(() => () => mosaicRenderService.destroy(), [mosaicRenderService]);
  const apiService = getApiService();
  const [isDragging, setIsDragging] = useState(false);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const { clientX: x, clientY: y } = e;
      if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
        setIsDragging(false);
      }
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const fileLoadingService = getFileLoadingService();
    const intent = resolveDropOpenIntent(e);

    // Native OS files
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.nii') || lower.endsWith('.nii.gz') || lower.endsWith('.gii')) {
        await fileLoadingService.loadDroppedFile(file, intent);
      }
    }
    if (files.length > 0) return;

    // Internal file browser drag
    const draggedFile = readFileDragData(e.dataTransfer);
    if (draggedFile?.path) {
      await fileLoadingService.loadFile(draggedFile.path, 'drag-drop', intent);
    }
  }, []);
  
  // Log component lifecycle
  useEffect(() => {
    console.log('[MosaicViewPromise] Component mounted');
    return () => console.log('[MosaicViewPromise] Component unmounting');
  }, []);
  
  // Get visible layers
  const visibleLayers = useMemo(() => 
    layers.filter(layer => layer.visible && layer.opacity > 0),
    [layers]
  );
  
  // Get primary volume for metadata
  const primaryVolumeId = visibleLayers[0]?.volumeId;
  const totalSlices = sliceMetadata?.volumeId === primaryVolumeId && sliceMetadata?.axis === sliceAxis ? sliceMetadata.count : 0;
  
  // Fetch slice metadata and calculate initial page based on crosshair
  useEffect(() => {
    if (!primaryVolumeId) return;
    
    let cancelled = false;
    const fetchMetadataAndSetInitialPage = async () => {
      try {
        // Get slice metadata
        const meta = await apiService.querySliceAxisMeta(primaryVolumeId, sliceAxis);
        if (cancelled) return;
        if (!meta || meta.sliceCount <= 0) {
          console.warn('[MosaicViewPromise] Invalid slice metadata received');
          return;
        }
        
        console.log('[MosaicViewPromise] Setting totalSlices to:', meta.sliceCount);

        
        // Get volume bounds for coordinate calculations
        const volumeBounds = await apiService.getVolumeBounds(primaryVolumeId);
        if (cancelled) return;
        if (!volumeBounds) {
          console.warn('[MosaicViewPromise] Could not get volume bounds');
          return;
        }
        
        // Get current crosshair position
        const crosshairPosition = useViewStateStore.getState().getWorkspaceViewState(workspaceId).crosshair.world_mm;

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
        
        setSliceMetadata(previous => previous?.volumeId === primaryVolumeId &&
          previous.axis === sliceAxis && previous.count === meta.sliceCount
          ? previous : { volumeId: primaryVolumeId, axis: sliceAxis, count: meta.sliceCount });
        setCurrentPage(validPage);
        
      } catch (error) {
        console.error('[MosaicViewPromise] Error fetching metadata or calculating initial page:', error);
      }
    };
    
    void fetchMetadataAndSetInitialPage();
    return () => { cancelled = true; };
  }, [primaryVolumeId, sliceAxis, gridSize.rows, gridSize.cols, apiService, workspaceId]);
  
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
  
  // Generate cell IDs for each mosaic cell
  // These are used as tags for MosaicCell and for the render service
  const cellIds = useMemo(() => {
    return sliceIndices.map(idx => 
      `mosaic-${workspaceId}-${sliceAxis}-${idx}`
    );
  }, [sliceIndices, workspaceId, sliceAxis]);
  
  // Trigger renders when slice indices or layer parameters change
  useEffect(() => {
    console.log('[MosaicViewPromise] DEBUG - Render trigger effect:', {
      sliceIndicesLength: sliceIndices.length,
      visibleLayersLength: visibleLayers.length,
      sliceAxis,
      cellSize,
      layerCount: layers.length,
      layerRevision,
      timepointRevision
    });
    
    if (sliceIndices.length === 0 || visibleLayers.length === 0) {
      console.log('[MosaicViewPromise] DEBUG - Skipping render: no slices or layers');
      return;
    }
    
    const renderRequests = sliceIndices.map((sliceIndex, i) => ({
      sliceIndex,
      axis: sliceAxis,
      cellId: cellIds[i],  // Tag for this cell
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
    layerRevision,
    timepointRevision
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

  const handleCrosshairClick = useCallback((worldCoord: [number, number, number]) => {
    void setCrosshair(worldCoord, true);
  }, [setCrosshair]);
  
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
      <div
        className="flex items-center justify-center h-full text-gray-500 relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging ? (
          <div className="bg-white rounded-lg px-6 py-4 shadow-2xl">
            <div className="text-blue-600 font-semibold text-lg">Drop to load volume</div>
            <div className="text-gray-500 text-sm mt-1">Supported: .nii, .nii.gz, .gii</div>
          </div>
        ) : (
          'No volume loaded — drag a file here'
        )}
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
    <div
      ref={containerRef}
      className="mosaic-container relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-500 bg-opacity-10 pointer-events-none flex items-center justify-center z-50">
          <div className="bg-white rounded-lg px-6 py-4 shadow-2xl">
            <div className="text-blue-600 font-semibold text-lg">Drop to add layer</div>
            <div className="text-gray-500 text-sm mt-1">Supported: .nii, .nii.gz, .gii</div>
          </div>
        </div>
      )}
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
                    workspaceId={workspaceId}
                    renderService={mosaicRenderService}
                width={cellSize.width}
                height={cellSize.height}
                tag={cellIds[i]}  // Pass tag for this cell
                sliceIndex={sliceIndex}
                axis={sliceAxis}
                onCrosshairClick={handleCrosshairClick}
              />
            </MosaicCellErrorBoundary>
          </div>
        ))}
      </div>
    </div>
  );
}

const MosaicViewPromiseMemo = memo(MosaicViewPromiseRaw);

// Export the wrapped version with error boundary
export const MosaicViewPromise = memo(function MosaicViewPromise(props: MosaicViewPromiseProps) {
  return (
    <RenderErrorBoundary viewId={`mosaic-${props.workspaceId || 'default'}`}>
      <MosaicViewPromiseMemo {...props} />
    </RenderErrorBoundary>
  );
});
