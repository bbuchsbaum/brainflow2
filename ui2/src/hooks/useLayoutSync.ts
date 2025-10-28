/**
 * useLayoutSync - Synchronizes layout dimensions with ViewState
 * 
 * This hook bridges the gap between LayoutStateStore (UI-only) and ViewStateStore (backend-synced).
 * It ensures that when dragging ends or dimensions stabilize, the ViewState is updated for rendering.
 */

import { useEffect } from 'react';
import { useLayoutStateStore } from '@/stores/layoutStateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayoutDragStore } from '@/stores/layoutDragStore';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';

export function useLayoutSync() {
  useEffect(() => {
    console.log('[useLayoutSync] Hook initialized, setting up subscriptions');
    
    // Subscribe to drag state changes
    const unsubscribeDrag = useLayoutDragStore.subscribe(
      state => state.isDragging,
      (isDragging, wasDragging) => {
        console.log(`[useLayoutSync] Drag state changed: isDragging=${isDragging}, wasDragging=${wasDragging}`);
        
        // When drag ends, sync layout dimensions to ViewState
        if (wasDragging && !isDragging) {
          console.log('[useLayoutSync] Drag ended, syncing layout dimensions to ViewState');
          
          const layoutState = useLayoutStateStore.getState().layoutState;
          const viewStateStore = useViewStateStore.getState();
          
          // Update each view's dimensions from layout store
          const viewTypes: Array<'axial' | 'sagittal' | 'coronal'> = ['axial', 'sagittal', 'coronal'];
          let dimensionsChanged = false;
          
          viewTypes.forEach(viewType => {
            const layoutDim = layoutState.panelDimensions[viewType];
            const currentDim = viewStateStore.viewState.views[viewType].dim_px;
            
            // Only update if dimensions actually changed
            if (layoutDim.width !== currentDim[0] || layoutDim.height !== currentDim[1]) {
              console.log(`[useLayoutSync] Updating ${viewType} dimensions: ${layoutDim.width}x${layoutDim.height}`);
              viewStateStore.updateViewDimensions(viewType, [layoutDim.width, layoutDim.height]);
              dimensionsChanged = true;
            }
          });
          
          // If dimensions changed, force a flush to trigger rendering
          // No forced flush; coalescing middleware will schedule the render
        }
      }
    );
    
    // Also subscribe to layout dimension changes when not dragging
    const unsubscribeLayout = useLayoutStateStore.subscribe(
      state => state.layoutState.panelDimensions,
      (dimensions) => {
        // Only sync if not currently dragging
        if (!useLayoutDragStore.getState().isDragging) {
          console.log('[useLayoutSync] Layout dimensions changed while not dragging, considering sync');
          
          // Add unified debounce timing to batch multiple dimension changes
          setTimeout(() => {
            if (!useLayoutDragStore.getState().isDragging) {
              const viewStateStore = useViewStateStore.getState();
              const viewTypes: Array<'axial' | 'sagittal' | 'coronal'> = ['axial', 'sagittal', 'coronal'];
              
              viewTypes.forEach(viewType => {
                const layoutDim = dimensions[viewType];
                const currentDim = viewStateStore.viewState.views[viewType].dim_px;
                
                if (layoutDim.width !== currentDim[0] || layoutDim.height !== currentDim[1]) {
                  console.log(`[useLayoutSync] Syncing ${viewType} dimensions: ${layoutDim.width}x${layoutDim.height}`);
                  viewStateStore.updateViewDimensions(viewType, [layoutDim.width, layoutDim.height]);
                }
              });
            }
          }, 200); // Unified timing
        }
      }
    );
    
    return () => {
      unsubscribeDrag();
      unsubscribeLayout();
    };
  }, []);
}
