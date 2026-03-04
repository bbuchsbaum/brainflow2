/**
 * FlexibleSlicePanel - Individual slice view panel for flexible layout mode
 * Wraps a SliceView for use in Allotment panes
 */

import React, { useState, useEffect, useRef, memo, useMemo } from 'react';
import { SliceView } from './SliceView';
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
        
        // Flush is scheduled by middleware; avoid forcing during render
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
          // Temporarily disable backend dimension update during drag end for debugging
        }
      }
      
      previousDragging = currentDragging;
    });
    
    return unsubscribe;
  }, [viewId, dimensions, throttledUpdateDimensions]);
  
  // Use ResizeObserver to track container size internally
  // Use effect + requestAnimationFrame to avoid nested update loops
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        const schedule = () => {
          const [clampedWidth, clampedHeight] = clampDimensions(width, height);
          setDimensions(prev => {
            if (prev.width === clampedWidth && prev.height === clampedHeight) {
              return prev;
            }
            return { width: clampedWidth, height: clampedHeight };
          });
          // DISABLED: Backend dimension updates cause infinite render loop
          // The store update triggers SliceViewCanvas re-renders with mismatched props
          // TODO: Fix prop/store synchronization issue before re-enabling
          // throttledUpdateDimensions(clampedWidth, clampedHeight);
        };
        // Defer updates to next frame to avoid nested layout commits
        requestAnimationFrame(schedule);
      }
    });
    
    resizeObserver.observe(containerRef.current);
    
    // Get initial size with clamping
    const rect = containerRef.current.getBoundingClientRect();
    const [initialWidth, initialHeight] = clampDimensions(rect.width, rect.height);
    // Also defer initial size to next frame
    requestAnimationFrame(() => {
      setDimensions({ width: initialWidth, height: initialHeight });
      // DISABLED: Backend dimension updates cause infinite render loop
      // throttledUpdateDimensions(initialWidth, initialHeight);
    });
    
    return () => resizeObserver.disconnect();
  }, [viewId, throttledUpdateDimensions]);
  
  return (
    <div ref={containerRef} className="h-full w-full bg-black">
      <SliceView
        viewId={viewId}
        width={dimensions.width}
        height={dimensions.height}
      />
    </div>
  );
});
