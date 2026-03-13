/**
 * Specialized selectors for ViewState store
 * Provides selective subscriptions to reduce unnecessary re-renders
 */

import { useViewStateStore } from '../viewStateStore';

/**
 * Subscribe only to timepoint changes
 */
export const useTimepointSelector = () => 
  useViewStateStore(state => state.viewState.timepoint ?? 0);

/**
 * Subscribe only to crosshair changes
 */
export const useCrosshairSelector = () => 
  useViewStateStore(state => state.viewState.crosshair);

/**
 * Subscribe only to specific slice position
 */
export const useSlicePositionSelector = (viewId: string) => 
  useViewStateStore(state => {
    const view = state.viewState.views[viewId as keyof typeof state.viewState.views];
    return view?.origin_mm;
  });

/**
 * Subscribe to time navigation data (timepoint + navigation state)
 */
export const useTimeNavDataSelector = () => 
  useViewStateStore(
    state => ({
      timepoint: state.viewState.timepoint ?? 0,
      hasTimeNavigation: state.viewState.timepoint !== undefined
    })
  );

/**
 * Subscribe to view-specific data (view plane + crosshair)
 */
export const useViewDataSelector = (viewId: 'axial' | 'sagittal' | 'coronal') => 
  useViewStateStore(
    state => ({
      viewPlane: state.viewState.views[viewId],
      crosshair: state.viewState.crosshair
    })
  );

/**
 * Subscribe to layer visibility data
 */
export const useLayerVisibilitySelector = () => 
  useViewStateStore(
    state => state.viewState.layers.map(layer => ({
      id: layer.id,
      visible: layer.visible,
      opacity: layer.opacity
    }))
  );

/**
 * Subscribe to render-relevant data only
 */
export const useRenderDataSelector = () => 
  useViewStateStore(
    state => ({
      layers: state.viewState.layers.filter(l => l.visible && l.opacity > 0),
      crosshairVisible: state.viewState.crosshair.visible,
      timepoint: state.viewState.timepoint ?? 0
    })
  );
