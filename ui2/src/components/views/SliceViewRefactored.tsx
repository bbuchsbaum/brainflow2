/**
 * SliceViewRefactored Component
 * 
 * Refactored version of SliceView that uses SliceRenderer for the core rendering logic
 * while preserving all existing functionality.
 * 
 * This is a safe refactoring that will be tested before replacing the original.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { CoordinateTransform } from '@/utils/coordinates';
import { useRenderLoopInit } from '@/hooks/useRenderLoopInit';
import { useEvent } from '@/events/EventBus';
import { getEventBus } from '@/events/EventBus';
import { SliceSlider } from '@/components/ui/SliceSlider';
import { getSliceNavigationService } from '@/services/SliceNavigationService';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import type { ViewPlane } from '@/types/coordinates';
import { SliceRenderer } from './SliceRenderer';
import { LoadingOverlay, LoadingVolumeOverlay } from '@/components/ui/RenderOverlays';

interface SliceViewRefactoredProps {
  viewId: 'axial' | 'sagittal' | 'coronal';
  width: number;
  height: number;
  className?: string;
}

export function SliceViewRefactored({ viewId, width, height, className = '' }: SliceViewRefactoredProps) {
  // Validate props using useMemo to ensure stable values
  const { validWidth, validHeight } = React.useMemo(() => {
    const w = (width > 0 && width <= 8192) ? width : 512;
    const h = (height > 0 && height <= 8192) ? height : 512;
    
    if (width !== w || height !== h) {
      console.error(`[SliceView ${viewId}] Invalid dimensions provided: ${width}x${height}, using ${w}x${h}`);
    }
    
    return { validWidth: w, validHeight: h };
  }, [width, height, viewId]);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverCoord, setHoverCoord] = useState<[number, number, number] | null>(null);
  
  const { viewState, setCrosshair } = useViewStateStore();
  const layers = useLayerStore(state => state.layers);
  const loadingLayers = useLayerStore(state => state.loadingLayers);
  const renderLoopState = useRenderLoopInit(validWidth, validHeight);
  
  const viewPlane: ViewPlane = viewState.views[viewId];
  const hasLayers = layers.length > 0;
  const isLoadingAnyLayer = loadingLayers.size > 0;
  
  // Use the validated props directly as canvas dimensions
  const canvasWidth = validWidth;
  const canvasHeight = validHeight;

  // Store the image placement for coordinate transformation
  const imagePlacementRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  } | null>(null);

  // Handle image received from SliceRenderer
  const handleImageReceived = useCallback((imageBitmap: ImageBitmap) => {
    console.log(`[SliceViewRefactored ${viewId}] Image received:`, {
      size: `${imageBitmap.width}x${imageBitmap.height}`,
      timestamp: performance.now()
    });
    
    // Calculate image placement for coordinate transforms
    const canvasAspect = canvasWidth / canvasHeight;
    const imageAspect = imageBitmap.width / imageBitmap.height;
    
    let placement;
    if (imageAspect > canvasAspect) {
      // Image is wider - fit to width
      const scaledWidth = canvasWidth;
      const scaledHeight = canvasWidth / imageAspect;
      placement = {
        x: 0,
        y: (canvasHeight - scaledHeight) / 2,
        width: scaledWidth,
        height: scaledHeight,
        imageWidth: imageBitmap.width,
        imageHeight: imageBitmap.height
      };
    } else {
      // Image is taller - fit to height
      const scaledHeight = canvasHeight;
      const scaledWidth = canvasHeight * imageAspect;
      placement = {
        x: (canvasWidth - scaledWidth) / 2,
        y: 0,
        width: scaledWidth,
        height: scaledHeight,
        imageWidth: imageBitmap.width,
        imageHeight: imageBitmap.height
      };
    }
    
    imagePlacementRef.current = placement;
  }, [canvasWidth, canvasHeight, viewId]);

  // Handle mouse clicks to update crosshair
  const handleMouseDown = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    const canvas = event.currentTarget.querySelector('canvas');
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    // Convert click position to canvas coordinates
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    
    // Check if we have image placement info
    if (!imagePlacementRef.current) {
      console.warn(`[SliceViewRefactored ${viewId}] No image placement info available`);
      return;
    }
    
    const placement = imagePlacementRef.current;
    
    // Check if click is within the image bounds
    if (canvasX < placement.x || canvasX > placement.x + placement.width ||
        canvasY < placement.y || canvasY > placement.y + placement.height) {
      console.log(`[SliceViewRefactored ${viewId}] Click outside image bounds`);
      return;
    }
    
    // Transform canvas coordinates to image coordinates
    const imageX = (canvasX - placement.x) / placement.width * placement.imageWidth;
    const imageY = (canvasY - placement.y) / placement.height * placement.imageHeight;
    
    console.log(`[SliceViewRefactored ${viewId}] Mouse click:`, {
      canvasX,
      canvasY,
      imageX,
      imageY,
      viewPlane: JSON.stringify(viewPlane)
    });
    
    // Transform to world coordinates
    const worldCoord = CoordinateTransform.screenToWorld([imageX, imageY], viewPlane);
    
    if (worldCoord) {
      console.log(`[SliceViewRefactored ${viewId}] Setting crosshair to:`, worldCoord);
      setCrosshair({ world_mm: worldCoord, visible: true });
      getEventBus().emit('view.clicked', { viewType: viewId, worldCoord });
    }
  }, [viewId, viewPlane, setCrosshair]);

  // Handle mouse move for hover coordinates
  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const canvas = event.currentTarget.querySelector('canvas');
    if (!canvas || !imagePlacementRef.current) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    
    const placement = imagePlacementRef.current;
    
    if (canvasX >= placement.x && canvasX <= placement.x + placement.width &&
        canvasY >= placement.y && canvasY <= placement.y + placement.height) {
      const imageX = (canvasX - placement.x) / placement.width * placement.imageWidth;
      const imageY = (canvasY - placement.y) / placement.height * placement.imageHeight;
      
      const worldCoord = CoordinateTransform.screenToWorld([imageX, imageY], viewPlane);
      if (worldCoord) {
        setHoverCoord(worldCoord);
      }
    } else {
      setHoverCoord(null);
    }
  }, [viewPlane]);

  const handleMouseLeave = useCallback(() => {
    setHoverCoord(null);
  }, []);

  // Handle wheel events for slice navigation
  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const sliceNavService = getSliceNavigationService();
    sliceNavService.navigateSlice(viewId, direction);
  }, [viewId]);

  // Handle file drop
  const handleFileDrop = useCallback(async (file: File) => {
    const validExtensions = ['.nii', '.nii.gz', '.gii'];
    const hasValidExtension = validExtensions.some(ext => 
      file.name.toLowerCase().endsWith(ext)
    );
    
    if (hasValidExtension) {
      const { getFileLoadingService } = await import('@/services/FileLoadingService');
      const fileLoadingService = getFileLoadingService();
      await fileLoadingService.loadDroppedFile(file);
    }
  }, []);

  // Check on mount if we missed any renders
  useEffect(() => {
    console.log(`[SliceViewRefactored ${viewId}] Component mounted at ${performance.now().toFixed(0)}ms`);
    
    // Give a small delay to ensure event listeners are set up
    const timer = setTimeout(() => {
      // Force a render by triggering coalescing flush
      const viewState = useViewStateStore.getState().viewState;
      console.log(`[SliceViewRefactored ${viewId}] Current state:`, {
        layerCount: viewState.layers.length,
        hasVisibleLayers: viewState.layers.some(l => l.visible && l.opacity > 0),
        timestamp: performance.now()
      });
      
      if (viewState.layers.length > 0) {
        console.log(`[SliceViewRefactored ${viewId}] Found ${viewState.layers.length} layers, forcing render`);
        coalesceUtils.flush(true);
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [viewId]);

  // Get slice range for the slider
  const sliceNavService = getSliceNavigationService();
  const sliceRange = React.useMemo(() => {
    try {
      return sliceNavService.getSliceRange(viewId);
    } catch (error) {
      console.warn(`SliceViewRefactored ${viewId}: Failed to get slice range, using defaults`, error);
      return {
        min: -100,
        max: 100,
        step: 1,
        current: 0
      };
    }
  }, [viewId, layers, viewState.crosshair.world_mm]);
  
  const handleSliderChange = useCallback((value: number) => {
    console.log(`[SliceViewRefactored ${viewId}] Slider changed to: ${value}`);
    sliceNavService.updateSlicePosition(viewId, value);
  }, [viewId]);

  // Filter out h-full from className to allow flex container to accommodate slider
  const filteredClassName = className?.replace(/\bh-full\b/g, '').trim() || '';
  
  return (
    <div className={`relative h-full ${filteredClassName}`}>
      <div 
        ref={containerRef}
        className={`h-full relative overflow-hidden`}
      >
        <SliceRenderer
          width={canvasWidth}
          height={canvasHeight}
          viewType={viewId}
          showLoading={false} // We'll handle loading states ourselves
          showError={true}
          showCoordinates={true}
          coordinates={hoverCoord || undefined}
          coordinatesPosition="top-left"
          showNoLayers={!hasLayers && !isLoadingAnyLayer && renderLoopState.isInitialized}
          showLoadingVolume={isLoadingAnyLayer}
          enableDragDrop={true}
          onFileDrop={handleFileDrop}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          onImageReceived={handleImageReceived}
          canvasClassName={`border border-gray-300 cursor-crosshair`}
        />
        
        {/* Custom loading overlays */}
        {renderLoopState.isInitializing && (
          <LoadingOverlay message="Initializing GPU..." />
        )}
        
        {/* View label */}
        <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
          {viewId.charAt(0).toUpperCase() + viewId.slice(1)}
        </div>
        
        {/* Error overlay for render loop errors */}
        {renderLoopState.error && (
          <div className="absolute inset-0 bg-red-500 bg-opacity-75 flex items-center justify-center">
            <div className="text-white text-sm text-center p-2">
              Error: {renderLoopState.error.message}
            </div>
          </div>
        )}
      </div>
      
      {/* Slice navigation slider - absolutely positioned at bottom */}
      {hasLayers && (
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gray-900 bg-opacity-75">
          <SliceSlider
            viewType={viewId}
            value={sliceRange.current}
            min={sliceRange.min}
            max={sliceRange.max}
            step={sliceRange.step}
            disabled={!renderLoopState.isInitialized}
            onChange={handleSliderChange}
          />
        </div>
      )}
    </div>
  );
}