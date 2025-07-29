/**
 * FlexibleSlicePanel - Individual slice view panel for flexible layout mode
 * Wraps a SliceView for use in Allotment panes
 */

import React, { useState, useEffect, useLayoutEffect, useRef, memo, useMemo } from 'react';
// import { SliceView } from './SliceView';
import { SliceViewRefactored as SliceView } from './SliceViewRefactored';
import type { ViewType } from '@/types/coordinates';
import { clampDimensions } from '@/utils/dimensions';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayoutDragStore } from '@/stores/layoutDragStore';
import { debounce, throttle } from 'lodash';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';

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
  
  // Create throttled function to update view dimensions with immediate render
  const throttledUpdateDimensions = useMemo(
    () => throttle(async (width: number, height: number) => {
      // Check if dimensions actually changed to prevent render loops
      const currentView = useViewStateStore.getState().viewState.views[viewId];
      const [currentWidth, currentHeight] = currentView.dim_px;
      
      // Only update if dimensions changed by more than 1 pixel
      if (Math.abs(currentWidth - width) > 1 || Math.abs(currentHeight - height) > 1) {
        console.log(`[FlexibleSlicePanel ${viewId}] Throttled resize update:`, {
          requested: { width, height },
          current: { width: currentWidth, height: currentHeight },
          delta: { width: width - currentWidth, height: height - currentHeight }
        });
        
        // Update dimensions and vectors atomically (now async with backend)
        await useViewStateStore.getState().updateDimensionsAndPreserveScale(viewId, [width, height]);
        
        // Force immediate render (skip drag check during resize)
        coalesceUtils.flush(true);
      } else {
        console.log(`[FlexibleSlicePanel ${viewId}] Skipping update - dimension change too small:`, {
          current: [currentWidth, currentHeight],
          new: [width, height]
        });
      }
    }, 30), // 30ms throttle for smooth resizing
    [viewId]
  );

  // Cleanup throttled function on unmount
  useEffect(() => {
    return () => {
      throttledUpdateDimensions.cancel();
    };
  }, [throttledUpdateDimensions]);
  
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
          // Cancel any pending throttled update
          throttledUpdateDimensions.cancel();
          
          // Force final update on drag end
          console.log(`[FlexibleSlicePanel ${viewId}] Drag end - final update:`, {
            dimensions: { width, height },
            timestamp: performance.now()
          });
          
          // Update dimensions and vectors atomically (now async with backend)
          useViewStateStore.getState().updateDimensionsAndPreserveScale(viewId, [width, height]).then(() => {
            console.log(`[FlexibleSlicePanel ${viewId}] Drag end update completed`);
            // Force immediate render after backend update
            coalesceUtils.flush(true);
          });
        }
      }
      
      previousDragging = currentDragging;
    });
    
    return unsubscribe;
  }, [viewId, dimensions, throttledUpdateDimensions]);
  
  // Use ResizeObserver to track container size internally
  // Using useLayoutEffect to ensure measurements happen synchronously after DOM updates
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        console.log(`[FlexibleSlicePanel ${viewId}] ResizeObserver triggered:`, {
          raw: { width, height },
          timestamp: performance.now()
        });
        
        // Clamp dimensions and only update if they actually changed
        const [clampedWidth, clampedHeight] = clampDimensions(width, height);
        setDimensions(prev => {
          if (prev.width === clampedWidth && prev.height === clampedHeight) {
            console.log(`[FlexibleSlicePanel ${viewId}] Dimensions unchanged, skipping state update`);
            return prev;
          }
          console.log(`[FlexibleSlicePanel ${viewId}] Updating local dimensions:`, {
            prev: { width: prev.width, height: prev.height },
            new: { width: clampedWidth, height: clampedHeight }
          });
          return { width: clampedWidth, height: clampedHeight };
        });
        
        // Trigger throttled update for backend re-render
        if (clampedWidth > 0 && clampedHeight > 0) {
          throttledUpdateDimensions(clampedWidth, clampedHeight);
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
  }, [viewId, throttledUpdateDimensions]);
  
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