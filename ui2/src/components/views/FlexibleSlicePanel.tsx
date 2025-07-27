/**
 * FlexibleSlicePanel - Individual slice view panel for flexible layout mode
 * Wraps a SliceView for use in Allotment panes
 */

import React, { useState, useEffect, useLayoutEffect, useRef, memo, useMemo } from 'react';
import { SliceView } from './SliceView';
import type { ViewType } from '@/types/coordinates';
import { clampDimensions } from '@/utils/dimensions';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayoutDragStore } from '@/stores/layoutDragStore';
import { getApiService } from '@/services/apiService';
import { debounce } from 'lodash';

interface FlexibleSlicePanelProps {
  viewId?: ViewType;
  title?: string;
}

// Memoize the component to prevent unnecessary re-renders
export const FlexibleSlicePanel = memo(function FlexibleSlicePanel({ 
  viewId = 'axial', 
  title
}: FlexibleSlicePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 512, height: 512 });
  const lastRenderTargetDims = useRef({ width: 512, height: 512 });
  
  // Create debounced function to update ViewState dimensions
  const debouncedUpdateDimensions = useMemo(
    () => debounce((width: number, height: number) => {
      // Don't update ViewState if we're dragging - wait for drag end
      const isDragging = useLayoutDragStore.getState().isDragging;
      if (isDragging) {
        console.log(`[FlexibleSlicePanel ${viewId}] Skipping ViewState update during drag: ${width}x${height}`);
        return;
      }
      
      // Check if dimensions actually changed to prevent render loops
      const currentView = useViewStateStore.getState().viewState.views[viewId];
      const [currentWidth, currentHeight] = currentView.dim_px;
      
      // Only update if dimensions changed by more than 1 pixel (to avoid float precision issues)
      if (Math.abs(currentWidth - width) > 1 || Math.abs(currentHeight - height) > 1) {
        console.log(`[FlexibleSlicePanel ${viewId}] Updating ViewState dimensions: ${width}x${height} (was ${currentWidth}x${currentHeight})`);
        useViewStateStore.getState().updateViewDimensions(viewId, [width, height]);
      }
    }, 150), // 150ms provides smooth updates
    [viewId]
  );

  // Cleanup debounced function on unmount
  useEffect(() => {
    return () => {
      debouncedUpdateDimensions.cancel();
    };
  }, [debouncedUpdateDimensions]);
  
  // Force dimension update when drag ends
  useEffect(() => {
    let previousDragging = useLayoutDragStore.getState().isDragging;
    
    const unsubscribe = useLayoutDragStore.subscribe((state) => {
      const currentDragging = state.isDragging;
      
      // When drag ends, force update dimensions
      if (previousDragging && !currentDragging) {
        console.log(`[FlexibleSlicePanel ${viewId}] Drag ended, forcing dimension update`);
        const { width, height } = dimensions;
        if (width > 0 && height > 0) {
          // Cancel any pending debounced update
          debouncedUpdateDimensions.cancel();
          
          // Handle resize end asynchronously
          const handleResizeEnd = async () => {
            // Check if we need to update render target
            // Remove threshold for pixel-perfect accuracy
            const widthDiff = Math.abs(width - lastRenderTargetDims.current.width);
            const heightDiff = Math.abs(height - lastRenderTargetDims.current.height);
            
            if (widthDiff > 0 || heightDiff > 0) {
              console.log(`[FlexibleSlicePanel ${viewId}] Updating render target FIRST: ${width}x${height} (was ${lastRenderTargetDims.current.width}x${lastRenderTargetDims.current.height})`);
              try {
                // STEP 1: Await render target creation
                await getApiService().createOffscreenRenderTarget(width, height);
                lastRenderTargetDims.current = { width, height };
                console.log(`[FlexibleSlicePanel ${viewId}] Render target ready`);
              } catch (error) {
                console.error(`[FlexibleSlicePanel ${viewId}] Failed to update render target:`, error);
                return; // Don't update view dimensions if render target failed
              }
            }
            
            // STEP 2: Await view state update (which now includes backend frame update)
            console.log(`[FlexibleSlicePanel ${viewId}] Updating ViewState to ${width}x${height}`);
            try {
              await useViewStateStore.getState().updateViewDimensions(viewId, [width, height]);
              console.log(`[FlexibleSlicePanel ${viewId}] ViewState update complete, render scheduled`);
            } catch (error) {
              console.error(`[FlexibleSlicePanel ${viewId}] Failed to update view dimensions:`, error);
            }
          };
          
          handleResizeEnd();
        }
      }
      
      previousDragging = currentDragging;
    });
    
    return unsubscribe;
  }, [viewId, dimensions, debouncedUpdateDimensions]);
  
  // Use ResizeObserver to track container size internally
  // Using useLayoutEffect to ensure measurements happen synchronously after DOM updates
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        // Clamp dimensions and only update if they actually changed
        const [clampedWidth, clampedHeight] = clampDimensions(width, height);
        setDimensions(prev => {
          if (prev.width === clampedWidth && prev.height === clampedHeight) {
            return prev;
          }
          return { width: clampedWidth, height: clampedHeight };
        });
        
        // Trigger debounced update for backend re-render
        if (clampedWidth > 0 && clampedHeight > 0) {
          debouncedUpdateDimensions(clampedWidth, clampedHeight);
        }
      }
    });
    
    resizeObserver.observe(containerRef.current);
    
    // Get initial size with clamping
    const rect = containerRef.current.getBoundingClientRect();
    const [initialWidth, initialHeight] = clampDimensions(rect.width, rect.height);
    setDimensions({ 
      width: initialWidth, 
      height: initialHeight 
    });
    
    return () => resizeObserver.disconnect();
  }, [viewId, debouncedUpdateDimensions]);
  
  return (
    <div ref={containerRef} className="h-full w-full bg-gray-900 flex flex-col">
      <SliceView
        viewId={viewId}
        width={dimensions.width}
        height={dimensions.height}
        className="flex-1"
      />
    </div>
  );
});