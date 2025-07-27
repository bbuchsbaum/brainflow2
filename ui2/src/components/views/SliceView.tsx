/**
 * SliceView Component
 * Core component that displays rendered slices from the backend
 * Handles mouse interactions and coordinate transforms
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

interface SliceViewProps {
  viewId: 'axial' | 'sagittal' | 'coronal';
  width: number;
  height: number;
  className?: string;
}

export function SliceView({ viewId, width, height, className = '' }: SliceViewProps) {
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
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Store the last rendered image to redraw on canvas resize
  const lastImageRef = useRef<ImageBitmap | null>(null);
  
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
  
  const { viewState, setCrosshair } = useViewStateStore();
  const layers = useLayerStore(state => state.layers);
  const loadingLayers = useLayerStore(state => state.loadingLayers);
  const renderLoopState = useRenderLoopInit(validWidth, validHeight);
  
  const viewPlane: ViewPlane = viewState.views[viewId];
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
    
    if (!canvas || !currentViewState.crosshair.visible) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    try {
      // Transform crosshair world coordinate to screen space
      const screenCoord = CoordinateTransform.worldToScreen(
        currentViewState.crosshair.world_mm,
        currentViewPlane
      );
      
      if (screenCoord && imagePlacementRef.current) {
        const [screenX, screenY] = screenCoord;
        const placement = imagePlacementRef.current;
        
        // Transform screen coordinates to account for image placement
        // The screenCoord is relative to the original image dimensions
        const scaleX = placement.width / placement.imageWidth;
        const scaleY = placement.height / placement.imageHeight;
        
        const canvasX = placement.x + screenX * scaleX;
        const canvasY = placement.y + screenY * scaleY;
        
        // Only draw if crosshair is within the image bounds
        if (canvasX >= placement.x && canvasX <= placement.x + placement.width &&
            canvasY >= placement.y && canvasY <= placement.y + placement.height) {
          // Draw crosshair
          ctx.save();
          ctx.strokeStyle = '#00ff00';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);
          
          // Horizontal line (only within image bounds)
          ctx.beginPath();
          ctx.moveTo(placement.x, canvasY);
          ctx.lineTo(placement.x + placement.width, canvasY);
          ctx.stroke();
          
          // Vertical line (only within image bounds)
          ctx.beginPath();
          ctx.moveTo(canvasX, placement.y);
          ctx.lineTo(canvasX, placement.y + placement.height);
          ctx.stroke();
          
          ctx.restore();
        }
      }
    } catch (err) {
      console.warn('Failed to render crosshair:', err);
    }
  };
  
  // Store the function in ref to keep it stable
  renderCrosshairRef.current = renderCrosshairImpl;
  
  // Create stable event handler
  const handleRenderComplete = React.useCallback((data: any) => {
    console.log(`[SliceView ${viewId}] render.complete event received:`, data);
    console.log(`  - viewType: ${data.viewType}`);
    console.log(`  - imageBitmap:`, data.imageBitmap);
    console.log(`  - imageBitmap type:`, data.imageBitmap ? Object.prototype.toString.call(data.imageBitmap) : 'null');
    
    if (data.viewType === viewId && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx && data.imageBitmap) {
        console.log(`[SliceView ${viewId}] Drawing image to canvas`);
        console.log(`  - Canvas size: ${canvasRef.current.width}x${canvasRef.current.height}`);
        console.log(`  - ImageBitmap size: ${data.imageBitmap.width}x${data.imageBitmap.height}`);
        
        // Clear and draw the new image
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        
        try {
          // Store the image for redrawing on canvas resize
          lastImageRef.current = data.imageBitmap;
          
          // Use the redraw function to draw the image
          if (redrawCanvasRef.current) {
            redrawCanvasRef.current();
          }
          
          console.log(`[SliceView ${viewId}] New image received and drawn`);
        } catch (error) {
          console.error(`[SliceView ${viewId}] Failed to draw image:`, error);
        }
        
        setIsRendering(false);
        setError(null);
      } else {
        console.warn(`[SliceView ${viewId}] Missing context or imageBitmap`);
      }
    }
  }, [viewId]); // Only depend on viewId which is stable
  
  // Listen for render complete events
  useEvent('render.complete', handleRenderComplete);
  
  // Listen for render errors
  useEvent('render.error', useCallback((data) => {
    if (!data.viewType || data.viewType === viewId) {
      setError(data.error.message);
      setIsRendering(false);
    }
  }, [viewId]));
  
  // Listen for render start
  useEvent('render.start', useCallback(() => {
    setIsRendering(true);
  }, []));

  // This component now only displays images
  // Dimension updates are handled by FlexibleSlicePanel

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
  const eventBus = getEventBus();
  
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
    
    // Emit event for StatusBar
    eventBus.emit('mouse.worldCoordinate', { world_mm: worldCoord, viewType: viewId });
  }, [viewPlane, viewId, eventBus]);

  const handleMouseLeave = useCallback(() => {
    setHoverCoord(null);
    // Emit event for StatusBar
    eventBus.emit('mouse.leave', { viewType: viewId });
  }, [viewId, eventBus]);

  // Draw crosshair when it changes
  useEffect(() => {
    if (renderCrosshairRef.current) {
      renderCrosshairRef.current();
    }
  }, [viewState.crosshair]);
  
  // Create a stable redraw function
  const redrawCanvasImpl = () => {
    if (!canvasRef.current || !lastImageRef.current) {
      console.warn(`[SliceView ${viewId}] Cannot redraw - canvas or image missing`);
      console.warn(`  - canvas exists: ${!!canvasRef.current}`);
      console.warn(`  - lastImage exists: ${!!lastImageRef.current}`);
      return;
    }
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) {
      console.error(`[SliceView ${viewId}] Failed to get 2d context`);
      return;
    }
    
    const imageBitmap = lastImageRef.current;
    const imageWidth = imageBitmap.width;
    const imageHeight = imageBitmap.height;
    
    console.log(`[SliceView ${viewId}] Redrawing canvas at ${canvasRef.current.width}x${canvasRef.current.height}`);
    console.log(`[SliceView ${viewId}] Image dimensions: ${imageWidth}x${imageHeight}`);
    
    // Clear canvas with background color
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    // Calculate new placement
    const imageAspectRatio = imageWidth / imageHeight;
    const canvasAspectRatio = canvasRef.current.width / canvasRef.current.height;
    
    let drawWidth, drawHeight, drawX, drawY;
    
    if (imageAspectRatio > canvasAspectRatio) {
      drawWidth = canvasRef.current.width;
      drawHeight = drawWidth / imageAspectRatio;
      drawX = 0;
      drawY = (canvasRef.current.height - drawHeight) / 2;
    } else {
      drawHeight = canvasRef.current.height;
      drawWidth = drawHeight * imageAspectRatio;
      drawX = (canvasRef.current.width - drawWidth) / 2;
      drawY = 0;
    }
    
    // Round positions
    drawX = Math.round(drawX);
    drawY = Math.round(drawY);
    drawWidth = Math.round(drawWidth);
    drawHeight = Math.round(drawHeight);
    
    // Draw image
    console.log(`[SliceView ${viewId}] Drawing image at ${drawX},${drawY} size ${drawWidth}x${drawHeight}`);
    
    try {
      ctx.drawImage(
        imageBitmap,
        drawX,
        drawY,
        drawWidth,
        drawHeight
      );
      
      console.log(`[SliceView ${viewId}] Image drawn successfully`);
      
      // Verify pixels were actually drawn
      const sampleData = ctx.getImageData(drawX + 10, drawY + 10, 1, 1);
      console.log(`[SliceView ${viewId}] Sample pixel at (${drawX + 10},${drawY + 10}):`, 
        `R=${sampleData.data[0]}, G=${sampleData.data[1]}, B=${sampleData.data[2]}, A=${sampleData.data[3]}`);
    } catch (error) {
      console.error(`[SliceView ${viewId}] Failed to draw image:`, error);
    }
    
    // Update image placement for crosshair
    imagePlacementRef.current = {
      x: drawX,
      y: drawY,
      width: drawWidth,
      height: drawHeight,
      imageWidth: imageWidth,
      imageHeight: imageHeight
    };
    
    // Redraw crosshair on top
    if (renderCrosshairRef.current) {
      renderCrosshairRef.current();
    }
  };
  
  // Store the redraw function in ref
  redrawCanvasRef.current = redrawCanvasImpl;
  
  // Redraw when canvas dimensions change
  useEffect(() => {
    if (!canvasRef.current || !lastImageRef.current) return;
    
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
    console.log(`[SliceView ${viewId}] Component mounted`);
    
    // Give a small delay to ensure event listeners are set up
    const timer = setTimeout(() => {
      if (!lastImageRef.current) {
        console.log(`[SliceView ${viewId}] No image on mount - requesting render`);
        // Force a render by triggering coalescing flush
        const viewState = useViewStateStore.getState().viewState;
        if (viewState.layers.length > 0) {
          console.log(`[SliceView ${viewId}] Found ${viewState.layers.length} layers, forcing render`);
          coalesceUtils.flush(true);
        }
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
  const sliceRange = React.useMemo(() => {
    try {
      return sliceNavService.getSliceRange(viewId);
    } catch (error) {
      console.warn(`SliceView ${viewId}: Failed to get slice range, using defaults`, error);
      return {
        min: -100,
        max: 100,
        step: 1,
        current: 0
      };
    }
  }, [viewId, layers, viewState.crosshair.world_mm]);
  
  const handleSliderChange = useCallback((value: number) => {
    console.log(`[SliceView ${viewId}] Slider changed to: ${value}`);
    sliceNavService.updateSlicePosition(viewId, value);
  }, [viewId]);
  
  // Log dimension changes for debugging
  useEffect(() => {
    console.log(`[SliceView ${viewId}] Requested dimensions: ${width}x${height}`);
    console.log(`[SliceView ${viewId}] Validated dimensions: ${validWidth}x${validHeight}`);
    console.log(`[SliceView ${viewId}] Calculated canvas: ${canvasWidth}x${canvasHeight}`);
  }, [width, height, validWidth, validHeight, viewId, canvasWidth, canvasHeight]);
  
  // Debug logging
  useEffect(() => {
    console.log(`SliceView ${viewId}: hasLayers=${hasLayers}, renderLoopState.isInitialized=${renderLoopState.isInitialized}`);
    console.log(`SliceView ${viewId}: sliceRange=`, sliceRange);
    console.log(`SliceView ${viewId}: current slider value=${sliceRange.current}`);
    console.log(`SliceView ${viewId}: slider disabled=${!renderLoopState.isInitialized || isRendering} (isInitialized=${renderLoopState.isInitialized}, isRendering=${isRendering})`);
    console.log(`SliceView ${viewId}: using dimensions ${validWidth}x${validHeight} (requested: ${width}x${height})`);
  }, [viewId, hasLayers, renderLoopState.isInitialized, sliceRange, isRendering, validWidth, validHeight, width, height]);

  // Filter out h-full from className to allow flex container to accommodate slider
  const filteredClassName = className?.replace(/\bh-full\b/g, '').trim() || '';
  
  return (
    <div className={`relative h-full ${filteredClassName}`}>
      <div 
        ref={containerRef}
        className={`h-full relative overflow-hidden`}
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
        
        {/* Loading overlay */}
        {isRendering && renderLoopState.isInitialized && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <div className="text-white text-sm">Rendering...</div>
          </div>
        )}
        
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
      
      {/* Slice navigation slider - absolutely positioned at bottom */}
      {hasLayers && (
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gray-900 bg-opacity-75">
          <SliceSlider
            viewType={viewId}
            value={sliceRange.current}
            min={sliceRange.min}
            max={sliceRange.max}
            step={sliceRange.step}
            disabled={!renderLoopState.isInitialized || isRendering}
            onChange={handleSliderChange}
          />
        </div>
      )}
    </div>
  );
}