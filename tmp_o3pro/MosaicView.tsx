/**
 * MosaicView Component
 * 
 * Displays multiple brain slices in a grid layout (e.g., 3x3) with batch rendering.
 * This component is COMPLETELY ISOLATED from FlexibleOrthogonalView and ViewStateStore.
 * 
 * Key features:
 * - Local state management (no global store dependencies)
 * - Batch rendering via backend API
 * - Navigation controls (prev/next page)
 * - Configurable grid size
 * - Performance optimized with single IPC call
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Grid3x3 } from 'lucide-react';
import { getApiService } from '@/services/apiService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { drawScaledImage } from '@/utils/canvasUtils';
import { calculateInitialPage, calculateVolumeCenter } from '@/utils/mosaicUtils';
import './MosaicView.css';

// Local types for MosaicView
interface MosaicViewState {
  sliceAxis: 'axial' | 'sagittal' | 'coronal';
  currentPage: number;
  gridSize: { rows: number; cols: number };
  sliceIndices: number[];
  totalSlices: number;
  sliceSpacing: number;
}

interface MosaicCellProps {
  sliceIndex: number;
  width: number;
  height: number;
  imageData: Uint8Array | null;
  axis: 'axial' | 'sagittal' | 'coronal';
  // Add actual render dimensions from backend
  renderWidth?: number;
  renderHeight?: number;
}

const MosaicCell: React.FC<MosaicCellProps> = ({ sliceIndex, width, height, imageData, axis, renderWidth, renderHeight }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Log the dimensions being passed
  console.log(`[MosaicCell ${sliceIndex}] Dimensions:`, {
    propWidth: width,
    propHeight: height,
    renderWidth,
    renderHeight
  });

  useEffect(() => {
    if (!canvasRef.current || !imageData) return;

    const drawImage = async () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!canvas || !ctx) return;

      try {
        // IMPORTANT: The canvas element dimensions should match the display size (width/height props)
        // The image data dimensions come from the backend (renderWidth/renderHeight)
        const imageWidth = renderWidth || width;
        const imageHeight = renderHeight || height;
        
        console.log(`[MosaicCell ${sliceIndex}] Creating ImageData:`, {
          canvasSize: `${width}x${height}`,
          imageSize: `${imageWidth}x${imageHeight}`,
          bufferSize: imageData.length,
          expectedBytes: imageWidth * imageHeight * 4,
          canvasElement: canvas,
          canvasPixelDimensions: `${canvas.width}x${canvas.height}`,
          canvasDisplayDimensions: `${canvas.offsetWidth}x${canvas.offsetHeight}`
        });
        
        // Validate buffer size
        const expectedBytes = imageWidth * imageHeight * 4;
        if (imageData.length !== expectedBytes) {
          console.error(`[MosaicCell ${sliceIndex}] Buffer size mismatch:`, {
            actual: imageData.length,
            expected: expectedBytes,
            dimensions: `${imageWidth}x${imageHeight}`
          });
          return;
        }
        
        // Create ImageData from raw RGBA using actual backend dimensions
        const imageDataObj = new ImageData(new Uint8ClampedArray(imageData), imageWidth, imageHeight);
        
        // Convert to ImageBitmap (same as SliceView/apiService.ts)
        // Backend should handle Y-flip consistently between single and batch render
        const imageBitmap = await createImageBitmap(imageDataObj);
        
        // Debug canvas and container dimensions
        console.log(`[MosaicCell ${sliceIndex}] Canvas and container info:`, {
          canvas: {
            width: canvas.width,
            height: canvas.height,
            offsetWidth: canvas.offsetWidth,
            offsetHeight: canvas.offsetHeight,
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight
          },
          parent: {
            offsetWidth: canvas.parentElement?.offsetWidth,
            offsetHeight: canvas.parentElement?.offsetHeight
          },
          image: {
            width: imageBitmap.width,
            height: imageBitmap.height
          }
        });
        
        // Check canvas state before drawing
        const canvasBounds = canvas.getBoundingClientRect();
        console.log(`[MosaicCell ${sliceIndex}] Pre-draw state:`, {
          canvasBufferSize: `${canvas.width}x${canvas.height}`,
          canvasDisplaySize: `${canvasBounds.width}x${canvasBounds.height}`,
          canvasStyle: {
            width: canvas.style.width,
            height: canvas.style.height
          },
          parentSize: {
            offsetWidth: canvas.parentElement?.offsetWidth,
            offsetHeight: canvas.parentElement?.offsetHeight,
            clientWidth: canvas.parentElement?.clientWidth,
            clientHeight: canvas.parentElement?.clientHeight
          }
        });
        
        // Use the shared canvas utility to draw the image with proper scaling
        // This ensures consistent rendering between SliceView and MosaicView
        const placement = drawScaledImage(ctx, imageBitmap, canvas.width, canvas.height);
        
        console.log(`[MosaicCell ${sliceIndex}] Image placement:`, placement);
        
        // Verify what was actually drawn
        const pixelData = ctx.getImageData(0, 0, 1, 1).data;
        const cornerPixel = `rgba(${pixelData[0]}, ${pixelData[1]}, ${pixelData[2]}, ${pixelData[3]/255})`;
        console.log(`[MosaicCell ${sliceIndex}] Top-left corner pixel:`, cornerPixel);
        
      } catch (error) {
        console.error(`[MosaicCell] Failed to render slice ${sliceIndex}:`, error);
      }
    };

    drawImage();
  }, [imageData, width, height, sliceIndex, renderWidth, renderHeight]);

  return (
    <div className="mosaic-cell relative border border-gray-700 bg-black">
      <canvas 
        ref={canvasRef} 
        width={width} 
        height={height}
        className="block"
      />
      <div className="absolute bottom-1 left-1 text-xs text-white bg-black/50 px-1 rounded">
        {axis[0].toUpperCase()}{sliceIndex}
      </div>
    </div>
  );
};

interface MosaicViewProps {
  workspaceId: string;
}

export function MosaicView({ workspaceId }: MosaicViewProps) {
  // Local state - completely independent of global stores
  const [viewState, setViewState] = useState<MosaicViewState>({
    sliceAxis: 'axial',
    currentPage: 0,
    gridSize: { rows: 3, cols: 3 },
    sliceIndices: [],
    totalSlices: 0,
    sliceSpacing: 1,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [renderedImages, setRenderedImages] = useState<Map<number, Uint8Array>>(new Map());
  const [cellDimensions, setCellDimensions] = useState({ width: 256, height: 256 });
  const [renderDimensions, setRenderDimensions] = useState<{ width: number; height: number } | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const apiService = getApiService();

  // Get layers from ViewStateStore - same as SliceView
  const globalViewState = useViewStateStore(state => state.viewState);
  const viewLayers = globalViewState.layers;
  console.log('[MosaicView] ViewState layers:', viewLayers.length, viewLayers);
  
  const visibleLayers = useMemo(() => {
    const visible = viewLayers.filter(layer => layer.visible && layer.opacity > 0);
    console.log('[MosaicView] Visible layers:', visible.length, visible);
    return visible;
  }, [viewLayers]);

  // Get the first visible layer's volume info for metadata queries
  const primaryVolumeId = visibleLayers[0]?.volumeId;
  console.log('[MosaicView] Primary volumeId:', primaryVolumeId);
  
  // For slice metadata, we still need to query the backend
  // This is just for getting slice count and spacing, not for rendering

  // Auto-resize cells based on container size
  useEffect(() => {
    if (!gridRef.current) return;

    const updateCellDimensions = () => {
      const { rows, cols } = viewState.gridSize;
      const containerRect = gridRef.current!.getBoundingClientRect();
      
      // Account for gaps and padding
      const gap = 4;
      const padding = 16;
      const availableWidth = containerRect.width - padding - (gap * (cols - 1));
      const availableHeight = containerRect.height - padding - (gap * (rows - 1));
      
      // Calculate optimal cell size (maintain square aspect)
      const cellWidth = Math.floor(availableWidth / cols);
      const cellHeight = Math.floor(availableHeight / rows);
      const cellSize = Math.min(cellWidth, cellHeight, 512); // Cap at 512px
      
      // Ensure minimum size
      const finalSize = Math.max(cellSize, 128);
      
      setCellDimensions({ width: finalSize, height: finalSize });
    };

    updateCellDimensions();
    
    // Re-calculate on window resize
    window.addEventListener('resize', updateCellDimensions);
    return () => window.removeEventListener('resize', updateCellDimensions);
  }, [viewState.gridSize]);

  // Fetch slice metadata when volume or axis changes
  useEffect(() => {
    if (!primaryVolumeId) {
      console.log('[MosaicView] No primary volume, skipping metadata fetch');
      return;
    }

    const fetchMetadataAndSetInitialPage = async () => {
      try {
        console.log('[MosaicView] Starting metadata fetch for volume:', primaryVolumeId, 'axis:', viewState.sliceAxis);
        
        const meta = await apiService.querySliceAxisMeta(
          primaryVolumeId,
          viewState.sliceAxis
        );

        console.log('[MosaicView] Received metadata:', meta);
        
        if (!meta || meta.sliceCount === 0) {
          console.warn('[MosaicView] Invalid metadata received');
          // Default fallback
          setViewState(prev => ({
            ...prev,
            totalSlices: 100,
            sliceSpacing: 1,
            currentPage: 0
          }));
          return;
        }
        
        // Get volume bounds for coordinate calculations
        const volumeBounds = await apiService.getVolumeBounds(primaryVolumeId);
        if (!volumeBounds) {
          console.warn('[MosaicView] Could not get volume bounds');
          setViewState(prev => ({
            ...prev,
            totalSlices: meta.sliceCount,
            sliceSpacing: meta.sliceSpacing,
            currentPage: 0 // Fallback to 0 if bounds not available
          }));
          return;
        }
        
        // Get current crosshair position
        const globalViewState = useViewStateStore.getState().viewState;
        let crosshairPosition = globalViewState.crosshair.world_mm;
        
        // If crosshair is at origin, use volume center
        if (crosshairPosition[0] === 0 && 
            crosshairPosition[1] === 0 && 
            crosshairPosition[2] === 0) {
          crosshairPosition = calculateVolumeCenter(volumeBounds);
        }
        
        // Calculate initial page
        const initialPage = calculateInitialPage(
          crosshairPosition,
          volumeBounds,
          viewState.sliceAxis,
          meta.sliceCount,
          viewState.gridSize.rows,
          viewState.gridSize.cols
        );
        
        // Ensure page is within valid range
        const maxPage = Math.ceil(meta.sliceCount / (viewState.gridSize.rows * viewState.gridSize.cols)) - 1;
        const validPage = Math.max(0, Math.min(initialPage, maxPage));
        
        console.log(`[MosaicView] Setting initial page to ${validPage} for ${viewState.sliceAxis} axis`);
        
        setViewState(prev => ({
          ...prev,
          totalSlices: meta.sliceCount,
          sliceSpacing: meta.sliceSpacing,
          currentPage: validPage
        }));
      } catch (error) {
        console.error('[MosaicView] Failed to fetch metadata or calculate initial page:', error);
        console.error('[MosaicView] Error details:', {
          error: error,
          message: (error as any)?.message || String(error),
          stack: (error as any)?.stack
        });
        
        // Default fallback on error
        setViewState(prev => ({
          ...prev,
          totalSlices: 100,
          sliceSpacing: 1,
          currentPage: 0
        }));
      }
    };

    fetchMetadataAndSetInitialPage();
  }, [primaryVolumeId, viewState.sliceAxis, viewState.gridSize.rows, viewState.gridSize.cols, apiService]);

  // Calculate slice indices for current page
  useEffect(() => {
    const { rows, cols } = viewState.gridSize;
    const slicesPerPage = rows * cols;
    const startIdx = viewState.currentPage * slicesPerPage;
    
    console.log('[MosaicView] Calculating indices - totalSlices:', viewState.totalSlices, 'currentPage:', viewState.currentPage);
    
    const indices: number[] = [];
    for (let i = 0; i < slicesPerPage; i++) {
      const idx = startIdx + i;
      if (idx < viewState.totalSlices) {
        indices.push(idx);
      }
    }
    
    console.log('[MosaicView] Calculated slice indices:', indices);
    setViewState(prev => ({ ...prev, sliceIndices: indices }));
  }, [viewState.currentPage, viewState.gridSize, viewState.totalSlices]);

  // Build view states for batch rendering - using FrontendViewState format
  const buildViewStates = useCallback(() => {
    if (viewState.sliceIndices.length === 0 || visibleLayers.length === 0) return [];

    // Use the requested dimensions for now
    // TODO: The backend might render at a different size (e.g., 220x220)
    // which would cause a mismatch in the view plane calculation
    const { width, height } = cellDimensions;
    console.log('[MosaicView] Building view states with dimensions:', { width, height });
    const viewStates = [];

    for (const sliceIndex of viewState.sliceIndices) {
      // For now, use a simple calculation for world position
      // In a real implementation, we'd need volume metadata
      const worldPos = calculateSliceWorldPositionSimple(
        sliceIndex,
        viewState.sliceAxis,
        viewState.sliceSpacing
      );

      // Calculate view plane vectors based on axis
      const viewPlane = calculateViewPlaneSimple(
        viewState.sliceAxis,
        worldPos,
        width,
        height
      );

      // Build layer configs using ViewLayers directly - they already have proper intensity values!
      const layerConfigs = visibleLayers.map(layer => {
        console.log('[MosaicView] Using ViewLayer:', layer.id, {
          intensity: layer.intensity,
          colormap: layer.colormap,
          opacity: layer.opacity
        });
        
        // ViewLayers already have all the correct values
        return {
          id: layer.id,
          volumeId: layer.volumeId,
          visible: layer.visible,
          opacity: layer.opacity,
          colormap: layer.colormap,
          intensity: layer.intensity,  // Already a proper [min, max] array!
          threshold: layer.threshold,
          blendMode: layer.blendMode || 'alpha'
        };
      });

      // Skip this view state if no valid layers
      if (layerConfigs.length === 0) {
        console.warn(`[MosaicView] Skipping slice ${sliceIndex}: No valid layers`);
        continue;
      }

      // Build FrontendViewState structure
      const frontendViewState = {
        views: {
          // Only populate the single axis we're rendering
          [viewState.sliceAxis]: viewPlane
        },
        crosshair: {
          world_mm: worldPos,
          visible: false
        },
        layers: layerConfigs,
        // Add requestedView for explicit render parameters
        requestedView: {
          type: viewState.sliceAxis,
          origin_mm: [...viewPlane.origin_mm, 1.0],
          u_mm: [
            viewPlane.u_mm[0],
            viewPlane.u_mm[1],
            viewPlane.u_mm[2],
            0.0
          ],
          v_mm: [
            viewPlane.v_mm[0],
            viewPlane.v_mm[1],
            viewPlane.v_mm[2],
            0.0
          ],
          width: width,
          height: height
        }
      };
      
      // Validate the complete viewState before adding
      console.log(`[MosaicView] FrontendViewState for slice ${sliceIndex}:`, JSON.stringify(frontendViewState, null, 2));
      
      viewStates.push(frontendViewState);
    }

    return viewStates;
  }, [viewState.sliceIndices, viewState.sliceAxis, cellDimensions, visibleLayers, viewState.sliceSpacing]);

  // Debug helper for ViewStates
  const debugViewStates = useCallback((viewStates: any[]) => {
    console.group('[MosaicView] FrontendViewStates Debug');
    viewStates.forEach((vs, idx) => {
      const viewType = viewState.sliceAxis;
      const view = vs.views?.[viewType];
      console.log(`ViewState ${idx}:`, {
        hasView: !!view,
        viewValid: view && view.origin_mm && view.u_mm && view.v_mm && view.dim_px,
        layerCount: vs.layers?.length || 0,
        crosshair: vs.crosshair,
        requestedView: vs.requestedView,
        layers: vs.layers?.map((l: any) => ({
          id: l.id,
          volumeId: l.volumeId,
          intensity: l.intensity,
          hasIntensity: !!l.intensity,
          intensityValid: l.intensity && l.intensity.length === 2 && l.intensity.every((v: any) => typeof v === 'number' && !isNaN(v)),
          colormap: l.colormap,
          blendMode: l.blendMode
        }))
      });
    });
    console.groupEnd();
  }, [viewState.sliceAxis]);

  // Render slices in batch
  const renderSlices = useCallback(async () => {
    const viewStates = buildViewStates();
    if (viewStates.length === 0) return;

    setIsLoading(true);
    try {
      console.log(`[MosaicView] Rendering ${viewStates.length} slices...`);
      
      // Debug ViewStates in development mode
      if (process.env.NODE_ENV === 'development') {
        debugViewStates(viewStates);
      }
      
      console.log('[MosaicView] First view state:', JSON.stringify(viewStates[0], null, 2));
      console.log('[MosaicView] Requesting batch render with dimensions:', {
        cellDimensions,
        requestedWidth: cellDimensions.width,
        requestedHeight: cellDimensions.height
      });
      const startTime = performance.now();

      // Call batch render API
      const buffer = await apiService.batchRenderSlices(
        viewStates,
        cellDimensions.width,
        cellDimensions.height
      );

      // Parse the result buffer
      const dataView = new DataView(buffer);
      const width = dataView.getUint32(0, true);
      const height = dataView.getUint32(4, true);
      const sliceCount = dataView.getUint32(8, true);

      console.log(`[MosaicView] Received ${sliceCount} slices (${width}x${height}) in ${Math.round(performance.now() - startTime)}ms`);

      // Store actual render dimensions from backend
      setRenderDimensions({ width, height });

      // Validate buffer structure
      const expectedBytesPerSlice = width * height * 4;
      const expectedTotalBytes = 12 + (sliceCount * expectedBytesPerSlice);
      
      if (buffer.byteLength < expectedTotalBytes) {
        console.error('[MosaicView] Buffer size validation failed:', {
          received: buffer.byteLength,
          expected: expectedTotalBytes,
          header: { width, height, sliceCount },
          bytesPerSlice: expectedBytesPerSlice
        });
        return;
      }

      // Extract individual slice images
      const bytesPerSlice = width * height * 4;
      const newImages = new Map<number, Uint8Array>();

      for (let i = 0; i < sliceCount; i++) {
        const offset = 12 + (i * bytesPerSlice);
        const sliceData = new Uint8Array(buffer, offset, bytesPerSlice);
        
        console.log(`[MosaicView] Extracted slice ${i}:`, {
          sliceIndex: viewState.sliceIndices[i],
          dataSize: sliceData.length,
          expectedSize: bytesPerSlice,
          offset
        });
        
        newImages.set(viewState.sliceIndices[i], sliceData);
      }

      setRenderedImages(newImages);
    } catch (error) {
      console.error('[MosaicView] Batch render failed:', error);
    } finally {
      setIsLoading(false);
    }
  }, [buildViewStates, apiService, cellDimensions, viewState.sliceIndices, debugViewStates]);

  // Trigger rendering when slice indices change
  useEffect(() => {
    console.log('[MosaicView] Render effect triggered. Slice indices:', viewState.sliceIndices.length);
    if (viewState.sliceIndices.length > 0) {
      console.log('[MosaicView] Calling renderSlices()');
      renderSlices();
    } else {
      console.log('[MosaicView] Skipping render - no slice indices');
    }
  }, [viewState.sliceIndices, renderSlices]);

  // Navigation handlers
  const handlePrevPage = useCallback(() => {
    setViewState(prev => ({
      ...prev,
      currentPage: Math.max(0, prev.currentPage - 1)
    }));
  }, []);

  const handleNextPage = useCallback(() => {
    const { rows, cols } = viewState.gridSize;
    const slicesPerPage = rows * cols;
    const maxPage = Math.ceil(viewState.totalSlices / slicesPerPage) - 1;
    
    setViewState(prev => ({
      ...prev,
      currentPage: Math.min(maxPage, prev.currentPage + 1)
    }));
  }, [viewState.gridSize, viewState.totalSlices]);

  // Calculate if navigation should be disabled
  const isPrevDisabled = viewState.currentPage === 0;
  const isNextDisabled = useMemo(() => {
    const { rows, cols } = viewState.gridSize;
    const slicesPerPage = rows * cols;
    const maxPage = Math.ceil(viewState.totalSlices / slicesPerPage) - 1;
    return viewState.currentPage >= maxPage;
  }, [viewState.currentPage, viewState.gridSize, viewState.totalSlices]);

  return (
    <div className="mosaic-view h-full flex flex-col bg-gray-900">
      {/* Header controls */}
      <div className="mosaic-header flex items-center justify-between p-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Grid3x3 className="w-5 h-5 text-gray-400" />
            <span className="text-sm font-medium text-gray-300">
              Mosaic View
            </span>
          </div>
          
          {/* Axis selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Axis:</label>
            <select
              className="h-7 px-2 text-sm bg-gray-700 text-gray-300 border border-gray-600 rounded"
              value={viewState.sliceAxis}
              onChange={(e) => setViewState(prev => ({ 
                ...prev, 
                sliceAxis: e.target.value as any
                // Page will be recalculated in useEffect based on crosshair position
              }))}
              disabled={isLoading}
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
              value={`${viewState.gridSize.rows}x${viewState.gridSize.cols}`}
              onChange={(e) => {
                const [rows, cols] = e.target.value.split('x').map(Number);
                setViewState(prev => ({ 
                  ...prev, 
                  gridSize: { rows, cols }
                  // Page will be recalculated in useEffect based on crosshair position
                }));
              }}
              disabled={isLoading}
            >
              <option value="2x2">2×2</option>
              <option value="3x3">3×3</option>
              <option value="4x4">4×4</option>
              <option value="5x5">5×5</option>
            </select>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handlePrevPage}
            disabled={isPrevDisabled || isLoading}
            className="h-7"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          
          <span className="text-sm text-gray-400 min-w-[100px] text-center">
            Page {viewState.currentPage + 1} / {Math.ceil(viewState.totalSlices / (viewState.gridSize.rows * viewState.gridSize.cols)) || 1}
          </span>
          
          <Button
            size="sm"
            variant="ghost"
            onClick={handleNextPage}
            disabled={isNextDisabled || isLoading}
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
          gridTemplateColumns: `repeat(${viewState.gridSize.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${viewState.gridSize.rows}, minmax(0, 1fr))`,
          gap: '4px',
        }}
      >
        {console.log('[MosaicView] Rendering grid with indices:', viewState.sliceIndices)}
        {viewState.sliceIndices.map((sliceIndex) => (
          <MosaicCell
            key={sliceIndex}
            sliceIndex={sliceIndex}
            width={cellDimensions.width}
            height={cellDimensions.height}
            imageData={renderedImages.get(sliceIndex) || null}
            axis={viewState.sliceAxis}
            renderWidth={renderDimensions?.width}
            renderHeight={renderDimensions?.height}
          />
        ))}
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <div className="text-white">Loading slices...</div>
        </div>
      )}
    </div>
  );
}

// Helper functions
function calculateSliceWorldPositionSimple(
  sliceIndex: number,
  axis: 'axial' | 'sagittal' | 'coronal',
  sliceSpacing: number
): [number, number, number] {
  // Simple calculation without volume metadata
  // Assumes centered volume with 1mm spacing
  const position = sliceIndex * sliceSpacing;
  
  switch (axis) {
    case 'axial':
      return [0, 0, position];
    case 'sagittal':
      return [position, 0, 0];
    case 'coronal':
      return [0, position, 0];
  }
}

function calculateViewPlaneSimple(
  axis: 'axial' | 'sagittal' | 'coronal',
  worldPos: [number, number, number],
  width: number,
  height: number
): any {
  // Simple view plane calculation without volume metadata
  // Assumes a standard 256mm FOV
  const defaultFOV = 256;
  
  const bounds = {
    min: [-defaultFOV/2, -defaultFOV/2, -defaultFOV/2],
    max: [defaultFOV/2, defaultFOV/2, defaultFOV/2]
  };
  
  return calculateViewPlaneFromBounds(axis, worldPos, bounds, width, height);
}

function calculateViewPlaneFromBounds(
  axis: 'axial' | 'sagittal' | 'coronal',
  worldPos: [number, number, number],
  worldBounds: { min: number[], max: number[] },
  width: number,
  height: number
): any {
  // Calculate extent in each dimension
  const extentX = worldBounds.max[0] - worldBounds.min[0];
  const extentY = worldBounds.max[1] - worldBounds.min[1];
  const extentZ = worldBounds.max[2] - worldBounds.min[2];
  
  // Determine FOV based on axis with 10% padding
  let fov_mm_x: number;
  let fov_mm_y: number;
  
  switch (axis) {
    case 'axial':
      // Looking down Z axis: X→right, Y→up
      fov_mm_x = extentX * 1.1;
      fov_mm_y = extentY * 1.1;
      break;
    case 'sagittal':
      // Looking down X axis: Y→right, Z→up
      fov_mm_x = extentY * 1.1;
      fov_mm_y = extentZ * 1.1;
      break;
    case 'coronal':
      // Looking down Y axis: X→right, Z→up
      fov_mm_x = extentX * 1.1;
      fov_mm_y = extentZ * 1.1;
      break;
  }
  
  // Calculate uniform pixel size (square pixels for medical imaging)
  const pixelSize = Math.max(fov_mm_x / width, fov_mm_y / height);
  
  // Adjust FOV to maintain aspect ratio with uniform pixel size
  const actualFovX = pixelSize * width;
  const actualFovY = pixelSize * height;
  
  // Build view plane based on axis
  let origin_mm: [number, number, number];
  let u_mm: [number, number, number];
  let v_mm: [number, number, number];
  
  switch (axis) {
    case 'axial':
      // Center the view on the slice position
      // Origin at top-left corner (0,0) in image coordinates
      // With v_mm = [0, -pixelSize, 0], Y decreases as we go down
      // So top edge is at worldPos[1] + actualFovY/2
      origin_mm = [
        worldPos[0] - actualFovX / 2,  // Left edge
        worldPos[1] + actualFovY / 2,   // Top edge
        worldPos[2]
      ];
      // X increases to the right
      u_mm = [pixelSize, 0, 0];
      // Y decreases downward (matches image convention after backend Y-flip)
      v_mm = [0, -pixelSize, 0];
      break;
      
    case 'sagittal':
      // Center the view on the slice position
      // Origin at top-left corner (0,0) in image coordinates
      // With u_mm = [0, -pixelSize, 0], Y decreases to the right
      // With v_mm = [0, 0, -pixelSize], Z decreases downward
      origin_mm = [
        worldPos[0],
        worldPos[1] + actualFovX / 2,   // Top edge (Y axis)
        worldPos[2] + actualFovY / 2    // Top edge (Z axis)
      ];
      // Y decreases to the right (anterior to posterior)
      u_mm = [0, -pixelSize, 0];
      // Z decreases downward (superior to inferior)
      v_mm = [0, 0, -pixelSize];
      break;
      
    case 'coronal':
      // Center the view on the slice position
      // Origin at top-left corner (0,0) in image coordinates
      // With u_mm = [pixelSize, 0, 0], X increases to the right
      // With v_mm = [0, 0, -pixelSize], Z decreases downward
      origin_mm = [
        worldPos[0] - actualFovX / 2,   // Left edge
        worldPos[1],
        worldPos[2] + actualFovY / 2    // Top edge (Z axis)
      ];
      // X increases to the right
      u_mm = [pixelSize, 0, 0];
      // Z decreases downward (superior to inferior)
      v_mm = [0, 0, -pixelSize];
      break;
  }
  
  return {
    origin_mm,
    u_mm,
    v_mm,
    dim_px: [width, height]
  };
}

