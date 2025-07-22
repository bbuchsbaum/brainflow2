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
import type { ViewPlane } from '@/types/coordinates';

interface SliceViewProps {
  viewId: 'axial' | 'sagittal' | 'coronal';
  width: number;
  height: number;
  className?: string;
}

export function SliceView({ viewId, width, height, className = '' }: SliceViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
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
  const renderLoopState = useRenderLoopInit(width, height);
  
  const viewPlane: ViewPlane = viewState.views[viewId];
  const hasLayers = layers.length > 0;
  const isLoadingAnyLayer = loadingLayers.size > 0;

  // This component should only display images, not trigger renders
  // The coalescing middleware handles all ViewState → Backend communication
  
  // Create renderCrosshair callback before using it in useEvent
  const renderCrosshair = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !viewState.crosshair.visible) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    try {
      // Transform crosshair world coordinate to screen space
      const screenCoord = CoordinateTransform.worldToScreen(
        viewState.crosshair.world_mm,
        viewPlane
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
  }, [viewState.crosshair, viewPlane]);
  
  // Listen for render complete events and update the canvas
  useEvent('render.complete', useCallback((data) => {
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
          const imageWidth = data.imageBitmap.width;
          const imageHeight = data.imageBitmap.height;
          
          // Clear canvas with background color first
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          
          // The backend returns an image with the correct aspect ratio already
          // We just need to scale it to fit the canvas without distortion
          const imageAspectRatio = imageWidth / imageHeight;
          const canvasAspectRatio = canvasRef.current.width / canvasRef.current.height;
          
          let drawWidth, drawHeight, drawX, drawY;
          
          if (imageAspectRatio > canvasAspectRatio) {
            // Image is wider than canvas - fit to width
            drawWidth = canvasRef.current.width;
            drawHeight = drawWidth / imageAspectRatio;
            drawX = 0;
            drawY = (canvasRef.current.height - drawHeight) / 2;
          } else {
            // Image is taller than canvas - fit to height
            drawHeight = canvasRef.current.height;
            drawWidth = drawHeight * imageAspectRatio;
            drawX = (canvasRef.current.width - drawWidth) / 2;
            drawY = 0;
          }
          
          // Draw image centered and scaled to fit
          ctx.drawImage(
            data.imageBitmap,
            drawX,
            drawY,
            drawWidth,
            drawHeight
          );
          
          // Store the image placement for crosshair calculations
          imagePlacementRef.current = {
            x: drawX,
            y: drawY,
            width: drawWidth,
            height: drawHeight,
            imageWidth: imageWidth,
            imageHeight: imageHeight
          };
          
          console.log(`[SliceView ${viewId}] Image drawn:`, {
            canvas: `${canvasRef.current.width}x${canvasRef.current.height}`,
            image: `${imageWidth}x${imageHeight}`,
            imageAspectRatio: imageAspectRatio.toFixed(3),
            canvasAspectRatio: canvasAspectRatio.toFixed(3),
            drawn: `${drawWidth.toFixed(0)}x${drawHeight.toFixed(0)} at (${drawX.toFixed(0)}, ${drawY.toFixed(0)})`
          });
          
          // Test if image is actually visible by checking a few pixels
          const imageData = ctx.getImageData(0, 0, 10, 10);
          const pixels = imageData.data;
          let allBlack = true;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] > 0 || pixels[i+1] > 0 || pixels[i+2] > 0) {
              allBlack = false;
              break;
            }
          }
          console.log(`[SliceView ${viewId}] First 10x10 pixels are ${allBlack ? 'all black' : 'NOT all black'}`);
        } catch (error) {
          console.error(`[SliceView ${viewId}] Failed to draw image:`, error);
        }
        
        // Redraw crosshair on top
        renderCrosshair();
        setIsRendering(false);
        setError(null);
      } else {
        console.warn(`[SliceView ${viewId}] Missing context or imageBitmap`);
      }
    }
  }, [viewId, renderCrosshair]));
  
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

  // Handle mouse clicks to update crosshair
  const handleMouseClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
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
    
    // Update crosshair position
    setCrosshair(worldCoord, true);
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
    renderCrosshair();
  }, [renderCrosshair]);

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
  }, [viewId, layers]);
  
  const handleSliderChange = useCallback((value: number) => {
    sliceNavService.updateSlicePosition(viewId, value);
  }, [viewId]);
  
  // Log dimension changes for debugging
  useEffect(() => {
    console.log(`[SliceView ${viewId}] Canvas dimensions: ${width}x${height}`);
  }, [width, height, viewId]);
  
  // Debug logging
  useEffect(() => {
    console.log(`SliceView ${viewId}: hasLayers=${hasLayers}, renderLoopState.isInitialized=${renderLoopState.isInitialized}`);
    console.log(`SliceView ${viewId}: sliceRange=`, sliceRange);
  }, [viewId, hasLayers, renderLoopState.isInitialized, sliceRange]);

  return (
    <div className={`flex flex-col ${className}`}>
      <div 
        className={`relative flex-1 min-h-0`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className={`border border-gray-300 cursor-crosshair ${isDragging ? 'border-blue-500 border-2' : ''}`}
          onClick={handleMouseClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ width: '100%', height: '100%' }}
        />
      
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
      
      {/* Slice navigation slider */}
      {hasLayers && (
        <SliceSlider
          viewType={viewId}
          value={sliceRange.current}
          min={sliceRange.min}
          max={sliceRange.max}
          step={sliceRange.step}
          disabled={!renderLoopState.isInitialized || isRendering}
          onChange={handleSliderChange}
        />
      )}
    </div>
  );
}