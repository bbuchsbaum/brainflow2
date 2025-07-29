/**
 * RenderCell Component
 * 
 * A basic building block for displaying rendered images from the backend.
 * This component listens for render.complete events and displays the received ImageBitmap.
 * 
 * Key features:
 * - Subscribes to render.complete events with optional tag filtering
 * - Displays images using the shared canvas utility
 * - Can be reused in both SliceView and MosaicView contexts
 * - Handles image scaling and placement
 */

import React, { useEffect } from 'react';
import { useRenderCanvas } from '@/hooks/useRenderCanvas';

interface RenderCellProps {
  width: number;
  height: number;
  tag?: string; // Optional tag to filter render events
  onImageReceived?: (imageBitmap: ImageBitmap) => void;
  className?: string;
  showLabel?: boolean;
  label?: string;
}

export function RenderCell({ 
  width, 
  height, 
  tag, 
  onImageReceived,
  className = '',
  showLabel = false,
  label = ''
}: RenderCellProps) {
  // Use the shared rendering hook
  const { 
    canvasRef, 
    isLoading, 
    error, 
    lastImage,
    redrawCanvas 
  } = useRenderCanvas({ tag, onImageReceived });
  
  // Redraw when dimensions change
  useEffect(() => {
    if (!canvasRef.current || !lastImage) return;
    
    // Schedule a redraw in the next animation frame
    const rafId = requestAnimationFrame(() => {
      redrawCanvas();
    });
    
    return () => cancelAnimationFrame(rafId);
  }, [width, height, lastImage, redrawCanvas]);
  
  return (
    <div className={`relative ${className}`}>
      {/* Canvas wrapper for centering - matches SliceView approach */}
      <div className="w-full h-full flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="block"
        />
      </div>
      
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="text-white text-sm">Loading...</div>
        </div>
      )}
      
      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 bg-red-500 bg-opacity-75 flex items-center justify-center">
          <div className="text-white text-sm text-center p-2">{error}</div>
        </div>
      )}
      
      {/* Label overlay */}
      {showLabel && label && (
        <div className="absolute bottom-1 left-1 text-xs text-white bg-black/50 px-1 rounded">
          {label}
        </div>
      )}
    </div>
  );
}