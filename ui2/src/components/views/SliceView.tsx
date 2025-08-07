/**
 * SliceView Component
 * Core component that displays rendered slices from the backend
 * Handles mouse interactions and coordinate transforms
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useRenderStateStore, useRenderState } from '@/stores/renderStateStore';
import { CoordinateTransform } from '@/utils/coordinates';
import { useRenderLoopInit } from '@/hooks/useRenderLoopInit';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { SliceSlider } from '@/components/ui/SliceSlider';
import { getSliceNavigationService } from '@/services/SliceNavigationService';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import type { ViewPlane } from '@/types/coordinates';
import { drawScaledImage } from '@/utils/canvasUtils';
import { drawCrosshair, transformCrosshairCoordinates, getLineDash, type CrosshairStyle } from '@/utils/crosshairUtils';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { useTimeNavigation } from '@/hooks/useTimeNavigation';
import { useTransientOverlay } from '@/components/ui/TransientOverlay';
import { getTimeNavigationService } from '@/services/TimeNavigationService';
import { throttle } from 'lodash';

interface SliceViewProps {
  viewId: 'axial' | 'sagittal' | 'coronal';
  width: number;
  height: number;
  className?: string;
}

export function SliceView({ viewId, width, height, className = '' }: SliceViewProps) {
  // Use Zustand store for crosshair settings - works across all React roots
  const crosshairSettings = useCrosshairSettingsStore(state => state.getViewSettings(viewId));
  
  // Debug: Log when settings change
  useEffect(() => {
    console.log(`[SliceView ${viewId}] Crosshair settings updated:`, crosshairSettings);
  }, [crosshairSettings, viewId]);
  
  const timeNav = useTimeNavigation();
  const timeNavService = getTimeNavigationService(); // Keep for mode navigation until fully migrated
  const { show: showTimeOverlay, overlay: timeOverlay } = useTransientOverlay({
    duration: 500,
    position: 'center'
  });
  
  // Validate props using useMemo to ensure stable values
  const { validWidth, validHeight } = React.useMemo(() => {
    const w = (width > 0 && width <= 8192) ? width : 512;
    const h = (height > 0 && height <= 8192) ? height : 512;
    
    if (width !== w || height !== h) {
      console.error(`[SliceView ${viewId}] Invalid dimensions provided: ${width}x${height}, using ${w}x${h}`);
    }
    
    return { validWidth: w, validHeight: h };
  }, [width, height, viewId]);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Use RenderStateStore instead of local state
  const renderState = useRenderState(viewId);
  const { isRendering, error, lastImage } = renderState;
  
  // Note: Memory monitoring is now handled by RenderStateStore
  
  // Store refs to avoid recreation of functions
  const redrawCanvasRef = useRef<() => void>();
  const renderCrosshairRef = useRef<() => void>();
  
  // Store the image placement for crosshair coordinate transformation
  const imagePlacementRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  } | null>(null);
  
  // Cache for expensive computations used in wheel event handling
  const timeNavCacheRef = useRef({
    has4DVolume: false,
    mode: 'slice' as 'time' | 'slice',
    lastUpdate: 0
  });
  
  // Use selective store subscriptions to reduce unnecessary re-renders
  const viewPlane = useViewStateStore(state => state.viewState.views[viewId]);
  const crosshair = useViewStateStore(state => state.viewState.crosshair);
  const viewStateLayers = useViewStateStore(state => state.viewState.layers);
  const setCrosshair = useViewStateStore(state => state.setCrosshair);
  
  const layers = useLayerStore(state => state.layers);
  const loadingLayers = useLayerStore(state => state.loadingLayers);
  const renderLoopState = useRenderLoopInit(validWidth, validHeight);
  
  const hasLayers = layers.length > 0;
  const isLoadingAnyLayer = loadingLayers.size > 0;
  
  // Use the validated props directly as canvas dimensions
  // FlexibleSlicePanel already provides the correct container size
  const canvasWidth = validWidth;
  const canvasHeight = validHeight;

  // This component should only display images, not trigger renders
  // The coalescing middleware handles all ViewState → Backend communication
  
  // Create renderCrosshair function that doesn't cause re-renders
  const renderCrosshairImpl = () => {
    const canvas = canvasRef.current;
    const currentViewState = useViewStateStore.getState().viewState;
    const currentViewPlane = currentViewState.views[viewId];
    // Use settings directly from closure - Zustand ensures they're always current
    const currentCrosshairSettings = crosshairSettings;
    console.log(`[SliceView ${viewId}] renderCrosshairImpl using settings:`, {
      activeColor: currentCrosshairSettings?.activeColor,
      activeThickness: currentCrosshairSettings?.activeThickness
    });
    
    // Only check for canvas existence, not crosshair visibility
    if (!canvas) return;
    
    // If crosshair is not visible, we don't need to draw it but don't block other rendering
    if (!currentViewState.crosshair.visible || !currentCrosshairSettings.visible) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    try {
      // Transform crosshair world coordinate to screen space
      const screenCoord = CoordinateTransform.worldToScreen(
        currentViewState.crosshair.world_mm,
        currentViewPlane
      );
      
      if (screenCoord && imagePlacementRef.current) {
        const coords = transformCrosshairCoordinates(
          screenCoord,
          imagePlacementRef.current
        );
        
        if (coords) {
          const style: CrosshairStyle = {
            color: currentCrosshairSettings.activeColor,
            lineWidth: currentCrosshairSettings.activeThickness,
            lineDash: getLineDash(currentCrosshairSettings.activeStyle, currentCrosshairSettings.activeThickness),
            opacity: 1
          };
          
          drawCrosshair({
            ctx,
            canvasX: coords.canvasX,
            canvasY: coords.canvasY,
            bounds: imagePlacementRef.current,
            style
          });
        }
      }
    } catch (err) {
      console.warn('Failed to render crosshair:', err);
    }
  };
  
  // Update the function in ref whenever it changes
  // This ensures we always have the latest version with fresh closures
  useEffect(() => {
    renderCrosshairRef.current = renderCrosshairImpl;
  });
  
  // React to changes in lastImage from the store
  // When RenderStateStore updates with a new image, redraw the canvas
  useEffect(() => {
    if (lastImage && canvasRef.current && redrawCanvasRef.current) {
      console.log(`[SliceView ${viewId}] New image from store, redrawing canvas`);
      redrawCanvasRef.current();
    }
  }, [lastImage, viewId]);
  
  // Removed render.start listener to prevent rapid state changes during slider dragging
  // This was causing unnecessary re-renders and contributing to flickering

  // This component now only displays images
  // Dimension updates are handled by FlexibleSlicePanel
  
  // Force initial render when component mounts and render loop is ready
  useEffect(() => {
    if (renderLoopState.isInitialized && hasLayers && canvasWidth > 0 && canvasHeight > 0) {
      console.log(`[SliceView ${viewId}] Forcing initial render on mount`);
      // Just log - the coalescing middleware will trigger render automatically
      // when ViewState changes
    }
  }, [renderLoopState.isInitialized, hasLayers, viewId]);

  // Handle mouse clicks to update crosshair
  const handleMouseClick = useCallback(async (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    // Convert click position to canvas coordinates
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    
    // Check if we have image placement info
    if (!imagePlacementRef.current) {
      console.warn(`[SliceView ${viewId}] No image placement info available`);
      return;
    }
    
    const placement = imagePlacementRef.current;
    
    // Check if click is within the image bounds
    if (canvasX < placement.x || canvasX > placement.x + placement.width ||
        canvasY < placement.y || canvasY > placement.y + placement.height) {
      console.log(`[SliceView ${viewId}] Click outside image bounds`);
      return;
    }
    
    // Transform canvas coordinates to image coordinates
    const imageX = (canvasX - placement.x) / placement.width * placement.imageWidth;
    const imageY = (canvasY - placement.y) / placement.height * placement.imageHeight;
    
    console.log(`[SliceView ${viewId}] Mouse click:`, {
      canvasX,
      canvasY,
      imageX,
      imageY,
      viewPlane: JSON.stringify(viewPlane)
    });
    
    // Transform to world coordinates using image coordinates
    const worldCoord = CoordinateTransform.screenToWorld(imageX, imageY, viewPlane);
    
    console.log(`[SliceView ${viewId}] World coordinate:`, worldCoord);
    
    // Update crosshair position (now waits for any pending resizes)
    try {
      await setCrosshair(worldCoord, true);
      console.log(`[SliceView ${viewId}] Crosshair updated successfully`);
    } catch (error) {
      console.error(`[SliceView ${viewId}] Failed to update crosshair:`, error);
    }
  }, [viewPlane, setCrosshair]);

  // Handle mouse move for hover coordinates
  const [hoverCoord, setHoverCoord] = useState<[number, number, number] | null>(null);
  const setMousePositionThrottled = useMouseCoordinateStore(state => state.setMousePositionThrottled);
  const clearMousePosition = useMouseCoordinateStore(state => state.clearMousePosition);
  
  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    
    const viewX = canvasX;
    const viewY = canvasY;
    
    const worldCoord = CoordinateTransform.screenToWorld(viewX, viewY, viewPlane);
    setHoverCoord(worldCoord);
    
    // Update global mouse coordinate store (throttled)
    setMousePositionThrottled(worldCoord, viewId);
  }, [viewPlane, viewId, setMousePositionThrottled]);

  const handleMouseLeave = useCallback(() => {
    setHoverCoord(null);
    // Clear global mouse position
    clearMousePosition();
  }, [clearMousePosition]);

  // Update cache periodically to avoid expensive computations on every wheel event
  useEffect(() => {
    const updateCache = () => {
      timeNavCacheRef.current = {
        has4DVolume: timeNav.has4DVolume(),
        mode: timeNavService.getMode(),
        lastUpdate: Date.now()
      };
    };
    
    updateCache();
    const interval = setInterval(updateCache, 1000); // Cache for 1s
    return () => clearInterval(interval);
  }, [layers, timeNav, timeNavService]);

  // Proper ImageBitmap lifecycle management
  // Cleanup on unmount - clear state from store
  useEffect(() => {
    return () => {
      // Clear render state for this view when unmounting
      useRenderStateStore.getState().clearState(viewId);
      console.debug(`[SliceView ${viewId}] Cleared render state on unmount`);
    };
  }, [viewId]);

  // Handle mouse wheel for time navigation (4D volumes) or slice navigation (3D volumes)
  const handleWheelImpl = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    
    // Use cached values for expensive computations
    const has4D = timeNavCacheRef.current.has4DVolume;
    const navMode = timeNavCacheRef.current.mode;
    
    // Determine if we should navigate time or slices
    const shouldNavigateTime = has4D && (
      (navMode === 'time' && !event.shiftKey) || 
      (navMode === 'slice' && event.shiftKey)
    );
    
    if (shouldNavigateTime) {
      // Navigate time
      const delta = event.deltaY > 0 ? 1 : -1;
      timeNav.jumpTimepoints(delta);
      
      // Show transient overlay
      const display = timeNav.formatTimepointDisplay();
      if (display) {
        showTimeOverlay(display);
      }
    } else {
      // Navigate slices (existing behavior)
      const sliceNavService = getSliceNavigationService();
      const delta = event.deltaY > 0 ? 1 : -1;
      sliceNavService.navigateSliceByDelta(viewId, delta);
    }
  }, [viewId, timeNav, showTimeOverlay]);

  // Create throttled wheel handler to prevent flooding with events
  const throttledHandleWheel = useMemo(
    () => throttle(handleWheelImpl, 200), // 5 events/sec max instead of unlimited
    [handleWheelImpl]
  );

  // Cleanup throttled function on unmount
  useEffect(() => {
    return () => {
      throttledHandleWheel.cancel();
    };
  }, [throttledHandleWheel]);

  // Redraw canvas (image + crosshair) when crosshair changes
  useEffect(() => {
    console.log(`[SliceView ${viewId}] crosshair/settings useEffect triggered:`, {
      crosshair,
      crosshairSettings,
      hasLastImage: !!lastImage
    });
    
    if (lastImage) {
      // Redraw the entire canvas to avoid crosshair artifacts
      requestAnimationFrame(() => {
        redrawCanvasImpl();
      });
    }
  }, [crosshair, crosshairSettings, viewId]);
  
  // Create a stable redraw function
  const redrawCanvasImpl = () => {
    const startTime = performance.now();
    
    if (!canvasRef.current || !lastImage) {
      console.warn(`[SliceView ${viewId}] Cannot redraw - canvas or image missing:`, {
        hasCanvas: !!canvasRef.current,
        hasLastImage: !!lastImage,
        timestamp: startTime
      });
      return;
    }
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) {
      console.error(`[SliceView ${viewId}] Failed to get 2d context`);
      return;
    }
    
    const imageBitmap = lastImage;
    const imageWidth = imageBitmap.width;
    const imageHeight = imageBitmap.height;
    
    console.log(`[SliceView ${viewId}] Redrawing canvas:`, {
      canvasSize: `${canvasRef.current.width}x${canvasRef.current.height}`,
      imageSize: `${imageWidth}x${imageHeight}`,
      timestamp: startTime
    });
    
    try {
      // Use the shared canvas utility to draw the image with proper scaling
      const placement = drawScaledImage(ctx, imageBitmap, canvasRef.current.width, canvasRef.current.height);
      
      const drawTime = performance.now() - startTime;
      console.log(`[SliceView ${viewId}] Image drawn successfully in ${drawTime.toFixed(1)}ms`);
      
      // Verify pixels were actually drawn
      const sampleX = Math.min(placement.x + 10, placement.x + placement.width - 1);
      const sampleY = Math.min(placement.y + 10, placement.y + placement.height - 1);
      const sampleData = ctx.getImageData(sampleX, sampleY, 1, 1);
      console.log(`[SliceView ${viewId}] Sample pixel at (${sampleX},${sampleY}):`, {
        rgba: `rgba(${sampleData.data[0]}, ${sampleData.data[1]}, ${sampleData.data[2]}, ${sampleData.data[3] / 255})`
      });
      
      // Update image placement for crosshair
      imagePlacementRef.current = placement;
    } catch (error) {
      console.error(`[SliceView ${viewId}] Failed to draw image:`, error);
    }
    
    // Redraw crosshair on top
    if (renderCrosshairRef.current) {
      renderCrosshairRef.current();
    }
  };
  
  // Update the redraw function in ref on every render
  // This ensures it's always available with the latest closures
  redrawCanvasRef.current = redrawCanvasImpl;
  
  // Redraw when canvas dimensions change
  useEffect(() => {
    if (!canvasRef.current || !lastImage) return;
    
    // Canvas dimensions have changed - the drawing buffer is now blank
    // Schedule a redraw in the next animation frame
    const rafId = requestAnimationFrame(() => {
      if (redrawCanvasRef.current) {
        redrawCanvasRef.current();
      }
    });
    
    return () => cancelAnimationFrame(rafId);
  }, [canvasWidth, canvasHeight]);
  
  // SliceView now uses dimensions from props directly
  // FlexibleSlicePanel handles container size tracking
  
  // Check on mount if we missed any renders
  useEffect(() => {
    console.log(`[SliceView ${viewId}] Component mounted at ${performance.now().toFixed(0)}ms`);
    
    // Give a small delay to ensure event listeners are set up
    const timer = setTimeout(() => {
      if (!lastImage) {
        console.log(`[SliceView ${viewId}] No image on mount - checking state`);
        // Force a render by triggering coalescing flush
        const viewState = useViewStateStore.getState().viewState;
        console.log(`[SliceView ${viewId}] Current state:`, {
          layerCount: viewStateLayers.length,
          hasVisibleLayers: viewStateLayers.some(l => l.visible && l.opacity > 0),
          timestamp: performance.now()
        });
        
        if (viewStateLayers.length > 0) {
          console.log(`[SliceView ${viewId}] Found ${viewStateLayers.length} layers, forcing render`);
          coalesceUtils.flush(true);
        }
      } else {
        console.log(`[SliceView ${viewId}] Already has image on mount`);
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [viewId]);

  // Handle file drop
  const [isDragging, setIsDragging] = useState(false);
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);
  
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const validExtensions = ['.nii', '.nii.gz', '.gii'];
    
    // Get FileLoadingService
    const { getFileLoadingService } = await import('@/services/FileLoadingService');
    const fileLoadingService = getFileLoadingService();
    
    for (const file of files) {
      const hasValidExtension = validExtensions.some(ext => 
        file.name.toLowerCase().endsWith(ext)
      );
      
      if (hasValidExtension) {
        // Use the loadDroppedFile method which handles Tauri file paths
        await fileLoadingService.loadDroppedFile(file);
      }
    }
  }, []);

  // Format hover coordinates for display
  const formatCoordinate = (coord: [number, number, number]) => {
    return `(${coord[0].toFixed(1)}, ${coord[1].toFixed(1)}, ${coord[2].toFixed(1)})`;
  };

  // Get slice range for the slider
  const sliceNavService = getSliceNavigationService();
  
  // Get min/max/step (only depends on layers, not crosshair)
  const sliderBounds = React.useMemo(() => {
    try {
      const range = sliceNavService.getSliceRange(viewId);
      return {
        min: range.min,
        max: range.max,
        step: range.step
      };
    } catch (error) {
      console.warn(`SliceView ${viewId}: Failed to get slice range, using defaults`, error);
      return {
        min: -100,
        max: 100,
        step: 1
      };
    }
  }, [viewId, layers]);
  
  // Get current value from crosshair
  const sliderValue = React.useMemo(() => {
    switch (viewId) {
      case 'axial':
        return crosshair.world_mm[2];
      case 'sagittal':
        return crosshair.world_mm[0];
      case 'coronal':
        return crosshair.world_mm[1];
      default:
        return 0;
    }
  }, [viewId, crosshair.world_mm]);
  
  const handleSliderChange = useCallback((value: number) => {
    console.log(`[SliceView ${viewId}] Slider changed to: ${value}`);
    sliceNavService.updateSlicePosition(viewId, value);
  }, [viewId]);
  
  // Log dimension changes for debugging
  useEffect(() => {
    console.log(`[SliceView ${viewId}] Dimension update:`, {
      requested: `${width}x${height}`,
      validated: `${validWidth}x${validHeight}`,
      canvas: `${canvasWidth}x${canvasHeight}`,
      timestamp: performance.now()
    });
  }, [width, height, validWidth, validHeight, viewId, canvasWidth, canvasHeight]);
  
  // Debug logging
  useEffect(() => {
    console.log(`SliceView ${viewId}: hasLayers=${hasLayers}, renderLoopState.isInitialized=${renderLoopState.isInitialized}`);
    console.log(`SliceView ${viewId}: sliderBounds=`, sliderBounds);
    console.log(`SliceView ${viewId}: current slider value=${sliderValue}`);
    console.log(`SliceView ${viewId}: slider disabled=${!renderLoopState.isInitialized || isRendering} (isInitialized=${renderLoopState.isInitialized}, isRendering=${isRendering})`);
    console.log(`SliceView ${viewId}: using dimensions ${validWidth}x${validHeight} (requested: ${width}x${height})`);
  }, [viewId, hasLayers, renderLoopState.isInitialized, sliderBounds, sliderValue, isRendering, validWidth, validHeight, width, height]);

  // Filter out h-full from className to allow flex container to accommodate slider
  const filteredClassName = className?.replace(/\bh-full\b/g, '').trim() || '';
  
  return (
    <>
      {timeOverlay}
      <div className={`flex flex-col h-full ${filteredClassName}`}>
      <div 
        ref={containerRef}
        className={`flex-1 relative overflow-hidden`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Canvas wrapper for centering */}
        <div className="w-full h-full flex items-center justify-center">
          <canvas
            ref={canvasRef}
            width={canvasWidth || validWidth}
            height={canvasHeight || validHeight}
            className={`block border border-gray-300 cursor-crosshair ${isDragging ? 'border-blue-500 border-2' : ''}`}
            onClick={handleMouseClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onWheel={throttledHandleWheel}
          />
        </div>
      
        {/* Absolute positioned overlays */}
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-blue-500 bg-opacity-20 pointer-events-none flex items-center justify-center">
            <div className="bg-white rounded-lg px-4 py-2 shadow-lg">
              <div className="text-blue-600 font-medium">Drop file to load</div>
            </div>
          </div>
        )}
        
        {/* Initialization overlay */}
        {renderLoopState.isInitializing && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <div className="text-white text-sm">Initializing GPU...</div>
          </div>
        )}
        
        {/* Loading overlay - Removed to prevent flickering during rapid updates */}
        
        {/* Error overlay */}
        {(error || renderLoopState.error) && (
          <div className="absolute inset-0 bg-red-500 bg-opacity-75 flex items-center justify-center">
            <div className="text-white text-sm text-center p-2">
              Error: {error || renderLoopState.error?.message}
            </div>
          </div>
        )}
        
        {/* Coordinate display */}
        {hoverCoord && (
          <div className="absolute top-2 left-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
            {formatCoordinate(hoverCoord)}
          </div>
        )}
        
        {/* View label */}
        <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
          {viewId.charAt(0).toUpperCase() + viewId.slice(1)}
        </div>
        
        {/* No layers indicator */}
        {!hasLayers && !isLoadingAnyLayer && renderLoopState.isInitialized && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-gray-400 text-center">
              <div className="text-4xl mb-2">🧠</div>
              <div className="text-sm">No volumes loaded</div>
              <div className="text-xs mt-1 opacity-75">Double-click a file or drag & drop</div>
            </div>
          </div>
        )}
        
        {/* Layer loading indicator */}
        {isLoadingAnyLayer && (
          <div className="absolute top-2 right-2 bg-yellow-500 bg-opacity-90 text-white text-xs px-2 py-1 rounded animate-pulse">
            Loading volume...
          </div>
        )}
      </div>
      
      {/* Slice navigation slider - part of flex layout */}
      {hasLayers && (
        <SliceSlider
          viewType={viewId}
          value={sliderValue}
          min={sliderBounds.min}
          max={sliderBounds.max}
          step={sliderBounds.step}
          disabled={!renderLoopState.isInitialized || isRendering}
          onChange={handleSliderChange}
        />
      )}
    </div>
    </>
  );
}