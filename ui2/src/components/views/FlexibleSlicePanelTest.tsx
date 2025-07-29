/**
 * FlexibleSlicePanelTest - Test version using SliceViewComparison
 * This is a temporary file for testing the refactored SliceView
 */

import React, { useState, useEffect, useLayoutEffect, useRef, memo, useMemo } from 'react';
import { SliceViewComparison } from './SliceViewComparison';
import type { ViewType } from '@/types/coordinates';
import { clampDimensions } from '@/utils/dimensions';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayoutDragStore } from '@/stores/layoutDragStore';
import { debounce, throttle } from 'lodash';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';

interface FlexibleSlicePanelTestProps {
  viewId?: ViewType;
  title?: string;
}

export const FlexibleSlicePanelTest = memo(function FlexibleSlicePanelTest({ 
  viewId = 'axial', 
  title
}: FlexibleSlicePanelTestProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 512, height: 512 });
  
  const throttledUpdateDimensions = useMemo(
    () => throttle(async (width: number, height: number) => {
      const currentView = useViewStateStore.getState().viewState.views[viewId];
      const [currentWidth, currentHeight] = currentView.dim_px;
      
      if (Math.abs(currentWidth - width) > 1 || Math.abs(currentHeight - height) > 1) {
        console.log(`[FlexibleSlicePanelTest ${viewId}] Throttled resize update:`, {
          requested: { width, height },
          current: { width: currentWidth, height: currentHeight },
          delta: { width: width - currentWidth, height: height - currentHeight }
        });
        
        await useViewStateStore.getState().updateDimensionsAndPreserveScale(viewId, [width, height]);
        coalesceUtils.flush(true);
      }
    }, 16, { leading: true, trailing: true }),
    [viewId]
  );
  
  const debouncedUpdateDimensions = useMemo(
    () => debounce(async (width: number, height: number) => {
      console.log(`[FlexibleSlicePanelTest ${viewId}] Debounced resize finalized:`, { width, height });
      await throttledUpdateDimensions(width, height);
    }, 150),
    [throttledUpdateDimensions, viewId]
  );
  
  const updateContainerDimensions = useRef(() => {
    if (!containerRef.current) return;
    
    const { width, height } = containerRef.current.getBoundingClientRect();
    const padding = 16;
    const availableWidth = Math.max(width - padding, 64);
    const availableHeight = Math.max(height - padding, 64);
    
    const { width: clampedWidth, height: clampedHeight } = clampDimensions(
      availableWidth,
      availableHeight
    );
    
    const isDragging = useLayoutDragStore.getState().isDragging;
    
    if (!isDragging && (clampedWidth !== dimensions.width || clampedHeight !== dimensions.height)) {
      console.log(`[FlexibleSlicePanelTest ${viewId}] Container size changed:`, {
        container: { width, height },
        available: { width: availableWidth, height: availableHeight },
        clamped: { width: clampedWidth, height: clampedHeight },
        isDragging
      });
      
      setDimensions({ width: clampedWidth, height: clampedHeight });
      debouncedUpdateDimensions(clampedWidth, clampedHeight);
    }
  });
  
  useLayoutEffect(() => {
    updateContainerDimensions.current();
  }, []);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === containerRef.current) {
          updateContainerDimensions.current();
        }
      }
    });
    
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [viewId]);
  
  return (
    <div ref={containerRef} className="w-full h-full bg-gray-900 p-2">
      <SliceViewComparison
        viewId={viewId}
        width={dimensions.width}
        height={dimensions.height}
      />
    </div>
  );
});