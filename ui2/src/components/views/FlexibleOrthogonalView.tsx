/**
 * FlexibleOrthogonalView Component
 * Displays three anatomical views (axial, sagittal, coronal) in resizable panes
 * Using allotment (modern split pane component) as recommended by the architecture review
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { FlexibleSlicePanel } from './FlexibleSlicePanel';
import { useLayoutDragStore } from '@/stores/layoutDragStore';
import { useLayoutStateStore } from '@/stores/layoutStateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import './FlexibleOrthogonalView.css';

interface FlexibleOrthogonalViewProps {
  workspaceId: string;
}

export function FlexibleOrthogonalView({ workspaceId }: FlexibleOrthogonalViewProps) {
  // Get initial sizes from layout store
  const splitSizes = useLayoutStateStore(state => state.layoutState.splitSizes);
  const updateSplitSizes = useLayoutStateStore(state => state.updateSplitSizes);
  
  // Track pane sizes locally for immediate visual feedback
  const [verticalSizes, setVerticalSizes] = useState<number[]>(splitSizes.vertical);
  const [horizontalSizes, setHorizontalSizes] = useState<number[]>(splitSizes.horizontal);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const setDragging = useLayoutDragStore(state => state.setDragging);
  const dragTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Helper to detect drag end via timeout
  const handleDragDetection = useCallback(() => {
    // Clear any existing timeout
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
    }
    
    // If not already dragging, mark as started
    const currentDragging = useLayoutDragStore.getState().isDragging;
    if (!currentDragging) {
      console.log('[FlexibleOrthogonalView] Drag detected - starting');
      setDragging(true);
    }
    
    // Set timeout to detect drag end (no change events for 200ms = drag ended)
    dragTimeoutRef.current = setTimeout(() => {
      console.log('[FlexibleOrthogonalView] Drag ended - no changes for 200ms');
      const wasDragging = useLayoutDragStore.getState().isDragging;
      setDragging(false);
      
      if (wasDragging) {
        console.log('[FlexibleOrthogonalView] Drag ended - forcing flush after delay');
        // Force a flush after dimensions have been updated
        setTimeout(() => {
          console.log('[FlexibleOrthogonalView] Executing forced flush with dimension update');
          coalesceUtils.flush(true);
        }, 200); // Wait a bit longer to ensure all dimension updates are complete
      }
    }, 200);
  }, [setDragging]);
  
  // Handle vertical split changes during drag
  const handleVerticalChange = useCallback((sizes: number[]) => {
    setVerticalSizes(sizes);
    updateSplitSizes('vertical', sizes);
    handleDragDetection();
  }, [handleDragDetection, updateSplitSizes]);
  
  // Handle horizontal split changes during drag
  const handleHorizontalChange = useCallback((sizes: number[]) => {
    setHorizontalSizes(sizes);
    updateSplitSizes('horizontal', sizes);
    handleDragDetection();
  }, [handleDragDetection, updateSplitSizes]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
      }
    };
  }, []);
  
  // Force initial render when component mounts
  useEffect(() => {
    const hasLayers = useViewStateStore.getState().viewState.layers.length > 0;
    if (hasLayers) {
      console.log('[FlexibleOrthogonalView] Component mounted with layers, forcing initial render');
      // Small delay to ensure all views are mounted
      setTimeout(() => {
        coalesceUtils.flush(true);
      }, 100);
    }
  }, []);

  // FlexibleSlicePanel now handles all dimension updates via ResizeObserver

  return (
    <div ref={containerRef} className="h-full w-full bg-gray-950 split-view-container">
      <Allotment 
        vertical 
        defaultSizes={verticalSizes}
        onChange={handleVerticalChange}
      >
        {/* Top half - Axial view */}
        <Allotment.Pane minSize={200}>
          <FlexibleSlicePanel 
            viewId="axial"
            title="Axial"
          />
        </Allotment.Pane>
        
        {/* Bottom half - Sagittal and Coronal side by side */}
        <Allotment.Pane minSize={200}>
          <Allotment 
            defaultSizes={horizontalSizes}
            onChange={handleHorizontalChange}
          >
            {/* Sagittal view */}
            <Allotment.Pane minSize={200}>
              <FlexibleSlicePanel 
                viewId="sagittal"
                title="Sagittal"
              />
            </Allotment.Pane>
            
            {/* Coronal view */}
            <Allotment.Pane minSize={200}>
              <FlexibleSlicePanel 
                viewId="coronal"
                title="Coronal"
              />
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}