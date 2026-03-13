/**
 * OrthogonalPanelsWorkspace Component
 * Displays three linked anatomical views (axial, sagittal, coronal) in resizable panes.
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { FlexibleSlicePanel } from './FlexibleSlicePanel';
import { useLayoutDragStore } from '@/stores/layoutDragStore';
import { useLayoutStateStore } from '@/stores/layoutStateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import './OrthogonalPanelsWorkspace.css';

export function OrthogonalPanelsWorkspace() {
  const splitSizes = useLayoutStateStore(state => state.layoutState.splitSizes);
  const updateSplitSizes = useLayoutStateStore(state => state.updateSplitSizes);

  const [verticalSizes, setVerticalSizes] = useState<number[]>(splitSizes.vertical);
  const [horizontalSizes, setHorizontalSizes] = useState<number[]>(splitSizes.horizontal);

  const containerRef = useRef<HTMLDivElement>(null);
  const setDragging = useLayoutDragStore(state => state.setDragging);
  const dragTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleDragDetection = useCallback(() => {
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
    }

    const currentDragging = useLayoutDragStore.getState().isDragging;
    if (!currentDragging) {
      console.log('[OrthogonalPanelsWorkspace] Drag detected - starting');
      setDragging(true);
    }

    dragTimeoutRef.current = setTimeout(() => {
      console.log('[OrthogonalPanelsWorkspace] Drag ended - no changes for 200ms');
      setDragging(false);
    }, 200);
  }, [setDragging]);

  const handleVerticalChange = useCallback((sizes: number[]) => {
    setVerticalSizes(sizes);
    updateSplitSizes('vertical', sizes);
    handleDragDetection();
  }, [handleDragDetection, updateSplitSizes]);

  const handleHorizontalChange = useCallback((sizes: number[]) => {
    setHorizontalSizes(sizes);
    updateSplitSizes('horizontal', sizes);
    handleDragDetection();
  }, [handleDragDetection, updateSplitSizes]);

  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const hasLayers = useViewStateStore.getState().viewState.layers.length > 0;
    if (hasLayers) {
      console.log('[OrthogonalPanelsWorkspace] Component mounted with layers. Relying on scheduled coalesced render.');
    }
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full bg-black split-view-container">
      <Allotment
        vertical
        defaultSizes={verticalSizes}
        onChange={handleVerticalChange}
      >
        <Allotment.Pane minSize={200}>
          <FlexibleSlicePanel
            viewId="axial"
            title="Axial"
          />
        </Allotment.Pane>

        <Allotment.Pane minSize={200}>
          <Allotment
            defaultSizes={horizontalSizes}
            onChange={handleHorizontalChange}
          >
            <Allotment.Pane minSize={200}>
              <FlexibleSlicePanel
                viewId="sagittal"
                title="Sagittal"
              />
            </Allotment.Pane>

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
