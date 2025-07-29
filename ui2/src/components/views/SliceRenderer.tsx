/**
 * SliceRenderer Component
 * 
 * Unified component for rendering slice images from the backend.
 * Combines the common logic from SliceView and RenderCell into a single reusable component.
 * 
 * Features:
 * - Canvas-based rendering with proper aspect ratio preservation
 * - Event-driven architecture using render.complete events
 * - Configurable overlays (loading, error, labels, coordinates)
 * - Drag and drop support
 * - Mouse interaction handling
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useRenderCanvas } from '@/hooks/useRenderCanvas';
import { RenderOverlays, CoordinateDisplay, NoLayersOverlay, LoadingVolumeOverlay } from '@/components/ui/RenderOverlays';

export interface SliceRendererProps {
  // Dimensions
  width: number;
  height: number;
  
  // Rendering
  tag?: string; // For RenderCell-style tagged rendering
  viewType?: 'axial' | 'sagittal' | 'coronal'; // For SliceView-style rendering
  
  // Overlays
  showLoading?: boolean;
  showError?: boolean;
  showLabel?: boolean;
  label?: string;
  labelPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  
  // Advanced overlays
  showCoordinates?: boolean;
  coordinates?: [number, number, number];
  coordinatesPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  showNoLayers?: boolean;
  showLoadingVolume?: boolean;
  
  // Drag and drop
  enableDragDrop?: boolean;
  onFileDrop?: (file: File) => void;
  
  // Mouse interactions
  onMouseMove?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseDown?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseUp?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onWheel?: (event: React.WheelEvent<HTMLDivElement>) => void;
  
  // Callbacks
  onImageReceived?: (imageBitmap: ImageBitmap) => void;
  
  // Styling
  className?: string;
  canvasClassName?: string;
}

export function SliceRenderer({
  width,
  height,
  tag,
  viewType,
  showLoading = true,
  showError = true,
  showLabel = false,
  label,
  labelPosition,
  showCoordinates = false,
  coordinates,
  coordinatesPosition,
  showNoLayers = false,
  showLoadingVolume = false,
  enableDragDrop = false,
  onFileDrop,
  onMouseMove,
  onMouseDown,
  onMouseUp,
  onMouseLeave,
  onWheel,
  onImageReceived,
  className = '',
  canvasClassName = ''
}: SliceRendererProps) {
  // Use the shared rendering hook
  const { 
    canvasRef, 
    isLoading, 
    error, 
    lastImage,
    redrawCanvas 
  } = useRenderCanvas({ tag, viewType, onImageReceived });
  
  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  
  // Redraw when dimensions change
  useEffect(() => {
    if (!canvasRef.current || !lastImage) return;
    
    // Schedule a redraw in the next animation frame
    const rafId = requestAnimationFrame(() => {
      redrawCanvas();
    });
    
    return () => cancelAnimationFrame(rafId);
  }, [width, height, lastImage, redrawCanvas]);
  
  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!enableDragDrop) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, [enableDragDrop]);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!enableDragDrop) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, [enableDragDrop]);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!enableDragDrop || !onFileDrop) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onFileDrop(files[0]);
    }
  }, [enableDragDrop, onFileDrop]);
  
  return (
    <div 
      className={`relative w-full h-full ${className}`}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onWheel={onWheel}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Canvas wrapper for centering */}
      <div className="w-full h-full flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className={`block ${canvasClassName}`}
        />
      </div>
      
      {/* Overlays */}
      <RenderOverlays
        isLoading={showLoading && isLoading}
        error={showError ? error : null}
        isDragging={isDragging}
        label={showLabel ? label : undefined}
        labelPosition={labelPosition}
      >
        {/* Additional overlays */}
        {showCoordinates && coordinates && (
          <CoordinateDisplay 
            coordinates={coordinates} 
            position={coordinatesPosition}
          />
        )}
        {showNoLayers && !lastImage && !isLoading && (
          <NoLayersOverlay showLoadingHint={enableDragDrop} />
        )}
        {showLoadingVolume && (
          <LoadingVolumeOverlay />
        )}
      </RenderOverlays>
    </div>
  );
}