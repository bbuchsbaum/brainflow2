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

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { MosaicCell } from './MosaicCell';
import { MosaicCellErrorBoundary } from './MosaicCellErrorBoundary';
import { createMosaicRenderService } from '@/services/MosaicRenderService';
import { unionNonzeroBbox } from '@/services/mosaic/brainBounds';
import { formatWorldMm } from '@/utils/valueFormat';
import {
  MOSAIC_COLORBAR_COLUMN_PX,
  MOSAIC_LABEL_STRIP_PX,
  MOSAIC_TILE_GAP_PX,
  autoMosaicGrid,
  fitMosaicGrid,
  sliceIndexRange,
  slicePositionAtIndex,
} from '@/services/mosaic/sliceGeometry';
import { MosaicTileLabel, MosaicColorbar } from './MosaicFrame';
import { chooseColorbarLayerId } from './viewportFrame';
import { getApiService } from '@/services/apiService';
import { useActiveLayer } from '@/utils/activeLayer';
import { useLayerStore } from '@/stores/layerStore';
import { shortLayerLabel } from './viewportFrame/frameFormat';
import { registerMosaicExportSource } from '@/services/export/compositeCapture';
import { useActiveRenderable } from '@/hooks/useActiveRenderable';
import { useMirrorsView } from '@/stores/viewDisplaySettingsStore';
import { setMosaicAxis } from '@/utils/mosaicAxis';
import { useCanvasPixelRatio } from '@/hooks/useCanvasPixelRatio';
import { MosaicToolbar } from '@/components/ui/MosaicToolbar';
import { EmptyPane } from '@/components/ui/bf';
import { openFileDialog, openFileShortcut } from '@/services/fileActions';
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
  // Radiological convention: the tiles are mirrored; one badge per mosaic.
  const mirrored = useMirrorsView(sliceAxis);
  // ↑/↓ step this mosaic's axis while its tab is in front.
  useEffect(() => setMosaicAxis(workspaceId, sliceAxis), [workspaceId, sliceAxis]);
  const [gridSize, setGridSize] = useState({ rows: 4, cols: 4 });
  const [colorbarColumnPx, setColorbarColumnPx] = useState(MOSAIC_COLORBAR_COLUMN_PX);
  const gridSizeRef = useRef(gridSize);
  // "auto" (the default) sizes the grid to the pane; "RxC" is a manual pick.
  const [gridChoice, setGridChoice] = useState<string>('auto');
  const [sliceMetadata, setSliceMetadata] = useState<MosaicSliceRange | null>(null);
  const [cellSize, setCellSize] = useState({ width: 128, height: 128 }); // Start with minimum size
  // In-plane aspect (width / height) of the cropped brain: tiles take this
  // shape so the brain fills them instead of floating in a landscape cell.
  const [brainAspect, setBrainAspect] = useState<number | null>(null);
  // Share of the pane the tiles cover (the harness reports it).
  const [mosaicFill, setMosaicFill] = useState(0);
  const [currentSlice, setCurrentSlice] = useState(0);
  const [hasInitialized, setHasInitialized] = useState(false);
  // The layout inputs the current cellSize was fitted for. Tiles are only
  // requested for a fitted layout: a grid requested at the provisional size
  // (128 px, 4×4) is cancelled a frame later, and each throwaway grid is one
  // more chance for a cancel/supersede race to strand a tile.
  const [fittedKey, setFittedKey] = useState<string | null>(null);
  
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
  // The frame header names the layer the colorbar describes (the stat map
  // over a T1), else the active layer: header, colorbar and export agree.
  const activeHeaderLayer = useActiveLayer(layers);
  const layerInfos = useLayerStore((s) => s.layers);
  const headerLayerId = useMemo(
    () => chooseColorbarLayerId(layerInfos, layers, activeHeaderLayer?.id ?? null) ?? activeHeaderLayer?.id ?? null,
    [layerInfos, layers, activeHeaderLayer?.id],
  );
  const headerLayerName = useLayerStore((s) => {
    const info = headerLayerId ? s.layers.find((l) => l.id === headerLayerId) : undefined;
    return info ? shortLayerLabel(info.name) : null;
  });
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
        const grid = gridSizeRef.current;
        const validPage = Math.floor((crossIndex - first) / (grid.rows * grid.cols));

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
  }, [primaryVolumeId, visibleVolumeKey, sliceAxis, apiService, workspaceId]);

  // A grid change (Auto re-fits on resize) keeps the crosshair's slice on
  // screen: recompute the page at once (no refetch of the slicing).
  useEffect(() => {
    gridSizeRef.current = gridSize;
    if (!range) return;
    const d = AXIS_DIMENSION[sliceAxis];
    const step = range.count > 1 ? (range.max - range.min) / (range.count - 1) : 1;
    const crossAt = useViewStateStore.getState().getWorkspaceViewState(workspaceId).crosshair.world_mm[d];
    const crossIndex = Math.min(range.last, Math.max(range.first, Math.round((crossAt - range.min) / step)));
    const page = Math.floor((crossIndex - range.first) / (gridSize.rows * gridSize.cols));
    setCurrentPage((prev) => (prev === page ? prev : page));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridSize.rows, gridSize.cols]);
  
  const layoutKey = (rows: number, cols: number) =>
    `${gridChoice}|${rows}x${cols}|${brainAspect ?? ''}|${totalSlices}|${colorbarColumnPx}`;

  // Calculate cell dimensions based on container size. A layout effect: the
  // first grid commit is measured before it paints or requests any tile.
  useLayoutEffect(() => {
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
      
      // The area tiles may use: minus padding and the colorbar column.
      const padding = 16;
      // The column is the colorbar's measured extent (caption and footer
      // included), so the bar is never pushed past the pane edge.
      const availableWidth = containerRect.width - padding - colorbarColumnPx - MOSAIC_TILE_GAP_PX;
      const availableHeight = containerRect.height - padding;
      const aspect = brainAspect && Number.isFinite(brainAspect) ? brainAspect : 1;
      // Auto: the grid with the largest tiles for this pane and the brain's
      // aspect; manual: the chosen grid. Tiles follow the brain's aspect,
      // with a label strip under each image and a gap between tiles.
      const fit =
        gridChoice === 'auto'
          ? autoMosaicGrid(availableWidth, availableHeight, aspect, totalSlices)
          : fitMosaicGrid(availableWidth, availableHeight, rows, cols, aspect);
      if (gridChoice === 'auto' && (fit.rows !== rows || fit.cols !== cols)) {
        setGridSize({ rows: fit.rows, cols: fit.cols });
      }
      const cellWidth = fit.tileWidth;
      const cellHeight = fit.tileHeight;
      const finalSize = {
        width: Math.max(48, fit.tileWidth),
        height: Math.max(48, fit.tileHeight),
      };
      setMosaicFill(fit.fill);

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
      setFittedKey(layoutKey(fit.rows, fit.cols));
      setHasInitialized(true);
    };

    // Try to calculate dimensions immediately
    updateCellDimensions();

    // Measure again on the next frame: the host pane (GoldenLayout, the
    // bottom dock's reserve) can settle its size after this commit.
    const frame = requestAnimationFrame(() => {
      updateCellDimensions();
    });
    
    // Use ResizeObserver to detect container size changes
    const resizeObserver = new ResizeObserver(updateCellDimensions);
    resizeObserver.observe(gridRef.current);
    
    // Also listen to window resize as backup
    window.addEventListener('resize', updateCellDimensions);
    
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateCellDimensions);
    };
    // The grid element mounts with the first non-empty slicing (totalSlices).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridSize, gridChoice, hasInitialized, brainAspect, totalSlices, colorbarColumnPx]);
  const layoutFitted = fittedKey === layoutKey(gridSize.rows, gridSize.cols);
  
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
  
  // A move to a display of another ratio re-renders the tiles (HiDPI).
  const pixelRatio = useCanvasPixelRatio();
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
    if (!layoutFitted) {
      // Wait for the grid to be fitted to the pane (no provisional-size tiles).
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
    timepointRevision,
    layoutFitted,
    pixelRatio,
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
  
  const markMosaicActive = useActiveRenderable(`mosaic:${workspaceId}`);

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
    // Empty (or slicing not known yet): the toolbar stays, so the grid
    // control works and the ghost grid shows its effect (P3.11).
    return (
      <div className="mosaic-container relative">
        <MosaicToolbar
          axis={sliceAxis}
          onAxisChange={setSliceAxis}
          grid={gridChoice === 'auto' ? 'auto' : `${gridSize.rows}x${gridSize.cols}`}
          onGridChange={(value) => {
            setGridChoice(value);
            if (value === 'auto') return;
            const [rows, cols] = value.split('x').map(Number);
            setGridSize({ rows, cols });
          }}
          page={0}
          pageCount={0}
          canPrev={false}
          canNext={false}
          onPrev={goToPreviousPage}
          onNext={goToNextPage}
          currentSlice={0}
          totalSlices={0}
          onSliceChange={() => undefined}
        />
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center bg-bf-bg-canvas text-bf-sm text-muted-foreground"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
        {isDragging ? (
          <div className="rounded-sm border border-border bg-popover px-6 py-4 shadow-2xl">
            <div className="text-primary font-semibold text-bf-lg">Drop to load volume</div>
            <div className="text-muted-foreground text-bf-sm mt-1">Supported: .nii, .nii.gz, .gii</div>
          </div>
        ) : primaryVolumeId ? null : (
          // P3.11: the one empty state, over a ghost of the selected grid so
          // the rows × cols control's effect is visible.
          <EmptyPane
            title="Load a volume to tile its slices"
            hint="Double-click a file in Files, or drop one here."
            primary={{ label: 'Open file…', onClick: () => void openFileDialog(), shortcut: openFileShortcut() }}
            messageGround="canvas"
            backdrop={
              <div
                className="grid h-full w-full gap-px p-2 opacity-20"
                style={{
                  gridTemplateRows: `repeat(${gridSize.rows}, minmax(0, 1fr))`,
                  gridTemplateColumns: `repeat(${gridSize.cols}, minmax(0, 1fr))`,
                }}
                data-testid="mosaic-ghost-grid"
              >
                {Array.from({ length: gridSize.rows * gridSize.cols }, (_, i) => (
                  <div key={i} className="border border-bf-border-strong bg-bf-bg-canvas" />
                ))}
              </div>
            }
          />
        )}
        </div>
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
        grid={gridChoice === 'auto' ? 'auto' : `${gridSize.rows}x${gridSize.cols}`}
        autoGridLabel={`Auto (${gridSize.rows}×${gridSize.cols})`}
        onGridChange={(value) => {
          setGridChoice(value);
          if (value === 'auto') return;
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
      
      {/* One frame header for the pane (P3.10): plane, layer, page range, in its own row above the tiles (never over them). */}
      {range && sliceIndices.length > 0 ? (
        <div
          className="flex h-5 shrink-0 select-none items-center gap-2 whitespace-nowrap px-2 text-bf-xs text-bf-text-secondary"
          data-testid="mosaic-frame-header"
        >
          {/* "Axial · zmap_synthetic · z 24.5–54.5 mm" */}
          <span>{sliceAxis.charAt(0).toUpperCase() + sliceAxis.slice(1)}</span>
          {headerLayerName ? (
            <>
              <span aria-hidden className="text-bf-text-muted">·</span>
              <span className="max-w-[28ch] truncate text-bf-text-muted">{headerLayerName}</span>
            </>
          ) : null}
          <span aria-hidden className="text-bf-text-muted">·</span>
          <span className="font-mono tabular-nums">
            {AXIS_LETTER[sliceAxis]} {formatWorldMm(slicePositionAtIndex(range, sliceIndices[0]))}–
            {formatWorldMm(slicePositionAtIndex(range, sliceIndices[sliceIndices.length - 1]))} mm
          </span>
          {mirrored ? (
            <span
              className="ml-auto font-mono text-bf-text-muted"
              data-testid="radiological-badge"
              title="Radiological convention: the patient's right is on the left"
            >
              R | L
            </span>
          ) : null}
        </div>
      ) : null}
      {/* The measured area; the brain-shaped grid and its colorbar sit
          together in its centre (the bar beside the tiles, top-aligned). */}
      <div
        ref={gridRef}
        className="mosaic-grid relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto p-2"
        // A click on the tiles makes the mosaic the focused view, so Export
        // View exports it (QA features 2026-10-31 §3).
        onPointerDownCapture={markMosaicActive}
      >
        <div className="flex">
        <div
          style={{
            display: 'grid',
            gridTemplateRows: `repeat(${gridSize.rows}, ${cellSize.height + MOSAIC_LABEL_STRIP_PX}px)`,
            gridTemplateColumns: `repeat(${gridSize.cols}, ${cellSize.width}px)`,
            gap: `${MOSAIC_TILE_GAP_PX}px`
          }}
          data-fill={mosaicFill.toFixed(3)}
          data-testid="mosaic-tile-grid"
        >
          {sliceIndices.map((sliceIndex, i) => {
            const position = range ? slicePositionAtIndex(range, sliceIndex) : null;
            const step = range && range.count > 1 ? (range.max - range.min) / (range.count - 1) : 1;
            const atCrosshair =
              position !== null &&
              Math.abs(crosshairWorld[AXIS_DIMENSION[sliceAxis]] - position) < step / 2;
            return (
              <div
                key={cellIds[i]}
                className="mosaic-cell"
                // A strip under the image holds the position label.
                style={{ paddingBottom: MOSAIC_LABEL_STRIP_PX }}
              >
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
                <MosaicTileLabel axis={sliceAxis} position={position} atCrosshair={atCrosshair} inStrip />
              </div>
            );
          })}
        </div>
        {/* One colorbar for the whole grid, outside the tiles (P3.7). */}
        <MosaicColorbar
          workspaceId={workspaceId}
          columnPx={colorbarColumnPx}
          onColumnPx={setColorbarColumnPx}
        />
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
