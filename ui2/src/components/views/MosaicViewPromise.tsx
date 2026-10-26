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
import { unionNonzeroBbox } from '@/services/mosaic/brainBounds';
import { formatWorldMm } from '@/utils/valueFormat';
import {
  MOSAIC_COLORBAR_COLUMN_PX,
  sliceIndexRange,
  slicePositionAtIndex,
} from '@/services/mosaic/sliceGeometry';
import { MosaicTileLabel, MosaicColorbar } from './MosaicFrame';
import { getApiService } from '@/services/apiService';
import { registerMosaicExportSource } from '@/services/export/compositeCapture';
import { MosaicToolbar } from '@/components/ui/MosaicToolbar';
import { Notice } from '@/components/ui/bf';
import { RenderErrorBoundary } from '@/components/ui/RenderErrorBoundary';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { readFileDragData } from '@/utils/layerDrag';
import { resolveDropOpenIntent } from '@/types/loadIntent';
import './MosaicView.css';

const AXIS_DIMENSION = { sagittal: 0, coronal: 1, axial: 2 } as const;
const AXIS_LETTER = { sagittal: 'x', coronal: 'y', axial: 'z' } as const;
/** World axes spanning each plane's tile (u across, v down). */
const IN_PLANE_AXES = { axial: [0, 1], coronal: [0, 2], sagittal: [1, 2] } as const;

/** Reference slicing for one axis, cropped to the brain's slices [first, last]. */
interface MosaicSliceRange {
  volumeId: string;
  axis: string;
  count: number;
  first: number;
  last: number;
  /** World positions of slice 0 and slice count-1 (voxel centres). */
  min: number;
  max: number;
}

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
  const crosshairWorld = useViewStateStore(
    state => state.getWorkspaceViewState(workspaceId).crosshair.world_mm
  );
  const [currentPage, setCurrentPage] = useState(0);
  const [sliceAxis, setSliceAxis] = useState<'axial' | 'sagittal' | 'coronal'>('axial');
  const [gridSize, setGridSize] = useState({ rows: 4, cols: 4 });
  const [sliceMetadata, setSliceMetadata] = useState<MosaicSliceRange | null>(null);
  const [cellSize, setCellSize] = useState({ width: 128, height: 128 }); // Start with minimum size
  // In-plane aspect (width / height) of the cropped brain: tiles take this
  // shape so the brain fills them instead of floating in a landscape cell.
  const [brainAspect, setBrainAspect] = useState<number | null>(null);
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
  
  // Reference volume for slice sampling: the bottom volume layer, visible or
  // not (the voxel-snapping / ijk rule, utils/voxelSnap.ts).
  const primaryVolumeId = layers.find(layer => layer.volumeId)?.volumeId;
  const visibleVolumeKey = visibleLayers.map(layer => layer.volumeId).filter(Boolean).join('|');
  const range =
    sliceMetadata?.volumeId === primaryVolumeId && sliceMetadata?.axis === sliceAxis ? sliceMetadata : null;
  // Paging runs over the brain's slices only (P3.7 crop); indices stay the
  // reference volume's own, so positions and spacing are unchanged.
  const firstSlice = range?.first ?? 0;
  const totalSlices = range ? range.last - range.first + 1 : 0;
  
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
        
        // Crop the slice range to the union of the visible layers' non-zero
        // voxels (a statistic outside the anatomy is not cut silently).
        const brain = await unionNonzeroBbox(
          visibleVolumeKey ? visibleVolumeKey.split('|') : [primaryVolumeId],
        );
        if (cancelled) return;
        const d = AXIS_DIMENSION[sliceAxis];
        const sampling = { min: volumeBounds.min[d], max: volumeBounds.max[d], count: meta.sliceCount };
        const { first, last } = brain
          ? sliceIndexRange(sampling, brain.worldMinMm[d], brain.worldMaxMm[d])
          : { first: 0, last: meta.sliceCount - 1 };
        const [ua, va] = IN_PLANE_AXES[sliceAxis];
        const box = brain ?? { worldMinMm: volumeBounds.min, worldMaxMm: volumeBounds.max };
        const extentU = Math.abs(box.worldMaxMm[ua] - box.worldMinMm[ua]);
        const extentV = Math.abs(box.worldMaxMm[va] - box.worldMinMm[va]);
        const aspect = extentU > 0 && extentV > 0 ? extentU / extentV : null;
        setBrainAspect((prev) => (prev !== null && aspect !== null && Math.abs(prev - aspect) < 1e-3 ? prev : aspect));

        // Initial page: the one holding the crosshair's slice.
        const crosshairPosition = useViewStateStore.getState().getWorkspaceViewState(workspaceId).crosshair.world_mm;
        const step = meta.sliceCount > 1 ? (sampling.max - sampling.min) / (meta.sliceCount - 1) : 1;
        const crossIndex = Math.min(
          last,
          Math.max(first, Math.round((crosshairPosition[d] - sampling.min) / step)),
        );
        const validPage = Math.floor((crossIndex - first) / (gridSize.rows * gridSize.cols));

        const next: MosaicSliceRange = {
          volumeId: primaryVolumeId,
          axis: sliceAxis,
          count: meta.sliceCount,
          first,
          last,
          min: sampling.min,
          max: sampling.max,
        };
        setSliceMetadata(previous =>
          previous &&
          (Object.keys(next) as Array<keyof MosaicSliceRange>).every((k) => previous[k] === next[k])
            ? previous
            : next,
        );
        setCurrentPage(validPage);
        
      } catch (error) {
        console.error('[MosaicViewPromise] Error fetching metadata or calculating initial page:', error);
      }
    };
    
    void fetchMetadataAndSetInitialPage();
    return () => { cancelled = true; };
  }, [primaryVolumeId, visibleVolumeKey, sliceAxis, gridSize.rows, gridSize.cols, apiService, workspaceId]);
  
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
      const gap = 1; // hairline between tiles (MosaicView.css)
      const padding = 16;
      // The shared colorbar column sits beside the grid.
      const availableWidth = containerRect.width - padding - MOSAIC_COLORBAR_COLUMN_PX - (gap * (cols - 1));
      const availableHeight = containerRect.height - padding - (gap * (rows - 1));
      
      // Tiles take the cropped brain's shape (square until it is known),
      // as large as the grid allows, capped at 512 px on the long side.
      const cellWidth = Math.floor(availableWidth / cols);
      const cellHeight = Math.floor(availableHeight / rows);
      const aspect = brainAspect && Number.isFinite(brainAspect) ? brainAspect : 1;
      let tileHeight = Math.min(cellHeight, cellWidth / aspect);
      let tileWidth = tileHeight * aspect;
      const longSide = Math.max(tileWidth, tileHeight);
      if (longSide > 512) {
        tileWidth *= 512 / longSide;
        tileHeight *= 512 / longSide;
      }
      const finalSize = {
        width: Math.max(64, Math.floor(tileWidth)),
        height: Math.max(64, Math.floor(tileHeight)),
      };
      
      console.log('[MosaicViewPromise] Calculating cell dimensions:', {
        containerSize: { width: containerRect.width, height: containerRect.height },
        gridSize: { rows, cols },
        availableSpace: { width: availableWidth, height: availableHeight },
        calculatedCellSize: { width: cellWidth, height: cellHeight },
        finalSize
      });
      
      setCellSize((prev) =>
        prev.width === finalSize.width && prev.height === finalSize.height ? prev : finalSize,
      );
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
  }, [gridSize, hasInitialized, brainAspect]);
  
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
        indices.push(firstSlice + idx);
      }
    }
    
    console.log('[MosaicViewPromise] DEBUG - Calculated indices:', indices);
    
    return indices;
  }, [currentPage, gridSize, totalSlices, firstSlice]);
  
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
  
  // The slider has one meaning: the crosshair's slice (0-based within the
  // cropped range). Moving it moves the crosshair along the mosaic axis, and
  // the page follows to the tile holding it.
  const axisDim = AXIS_DIMENSION[sliceAxis];
  const sliceStep = range && range.count > 1 ? (range.max - range.min) / (range.count - 1) : 1;
  const crosshairRel = range
    ? Math.min(
        Math.max(0, Math.round((crosshairWorld[axisDim] - range.min) / sliceStep) - firstSlice),
        Math.max(0, totalSlices - 1),
      )
    : 0;
  const handleSliceChange = (rel: number) => {
    if (!range) return;
    const position = slicePositionAtIndex(range, firstSlice + rel);
    const current = useViewStateStore.getState().getWorkspaceViewState(workspaceId).crosshair.world_mm;
    const next: [number, number, number] = [current[0], current[1], current[2]];
    next[axisDim] = position;
    void setCrosshair(next, true, false, workspaceId);
    setCurrentSlice(rel);
    setCurrentPage(Math.floor(rel / (gridSize.rows * gridSize.cols)));
  };

  const handleCrosshairClick = useCallback((worldCoord: [number, number, number]) => {
    void setCrosshair(worldCoord, true, false, workspaceId);
  }, [setCrosshair, workspaceId]);
  
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
  
  // Export (P3.8): the visible tiles in grid order, read when the dialog composes.
  const exportTilesRef = useRef<() => ReturnType<Parameters<typeof registerMosaicExportSource>[1]>>(() => null);
  exportTilesRef.current = () => {
    if (!primaryVolumeId || !range) return null;
    const step = range.count > 1 ? (range.max - range.min) / (range.count - 1) : 1;
    return {
      workspaceId,
      axis: sliceAxis,
      cols: gridSize.cols,
      sampling: { min: range.min, step, first: range.first, last: range.last },
      tiles: sliceIndices.map((sliceIndex, i) => {
        const position = slicePositionAtIndex(range, sliceIndex);
        return {
          plane: mosaicRenderService.getViewPlaneForTag(cellIds[i]),
          positionMm: position,
          label: `${AXIS_LETTER[sliceAxis]} ${formatWorldMm(position)}`,
          atCrosshair: Math.abs(crosshairWorld[AXIS_DIMENSION[sliceAxis]] - position) < step / 2,
        };
      }),
    };
  };
  useEffect(
    () => registerMosaicExportSource(workspaceId, () => exportTilesRef.current()),
    [workspaceId],
  );

  if (!primaryVolumeId || totalSlices === 0) {
    console.log('[MosaicViewPromise] No volume to display:', { primaryVolumeId, totalSlices });
    return (
      <div
        className="flex items-center justify-center h-full text-bf-sm text-muted-foreground relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging ? (
          <div className="rounded-sm border border-border bg-popover px-6 py-4 shadow-2xl">
            <div className="text-primary font-semibold text-bf-lg">Drop to load volume</div>
            <div className="text-muted-foreground text-bf-sm mt-1">Supported: .nii, .nii.gz, .gii</div>
          </div>
        ) : (
          <Notice role={undefined}>No volume loaded. Drag a file here.</Notice>
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
        <div className="absolute inset-0 bg-primary/10 pointer-events-none flex items-center justify-center z-50">
          <div className="rounded-sm border border-border bg-popover px-6 py-4 shadow-2xl">
            <div className="text-primary font-semibold text-bf-lg">Drop to add layer</div>
            <div className="text-muted-foreground text-bf-sm mt-1">Supported: .nii, .nii.gz, .gii</div>
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
        currentSlice={crosshairRel}
        totalSlices={totalSlices}
        pageRange={
          range && sliceIndices.length > 0
            ? `${AXIS_LETTER[sliceAxis]} ${formatWorldMm(slicePositionAtIndex(range, sliceIndices[0]))}–${formatWorldMm(
                slicePositionAtIndex(range, sliceIndices[sliceIndices.length - 1]),
              )}`
            : undefined
        }
        onSliceChange={handleSliceChange}
        sliceLabel={(rel) =>
          range
            ? `${AXIS_LETTER[sliceAxis]} ${formatWorldMm(slicePositionAtIndex(range, firstSlice + rel))}`
            : String(rel)
        }
      />
      
      {/* The measured area; the brain-shaped grid and its colorbar sit
          together in its centre (the bar beside the tiles, top-aligned). */}
      <div
        ref={gridRef}
        className="mosaic-grid flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto p-2"
      >
        <div className="flex">
        <div
          style={{
            display: 'grid',
            gridTemplateRows: `repeat(${gridSize.rows}, ${cellSize.height}px)`,
            gridTemplateColumns: `repeat(${gridSize.cols}, ${cellSize.width}px)`,
            gap: '1px'
          }}
        >
          {sliceIndices.map((sliceIndex, i) => {
            const position = range ? slicePositionAtIndex(range, sliceIndex) : null;
            const step = range && range.count > 1 ? (range.max - range.min) / (range.count - 1) : 1;
            const atCrosshair =
              position !== null &&
              Math.abs(crosshairWorld[AXIS_DIMENSION[sliceAxis]] - position) < step / 2;
            return (
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
                <MosaicTileLabel axis={sliceAxis} position={position} atCrosshair={atCrosshair} />
              </div>
            );
          })}
        </div>
        {/* One colorbar for the whole grid, outside the tiles (P3.7). */}
        <MosaicColorbar workspaceId={workspaceId} />
        </div>
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
