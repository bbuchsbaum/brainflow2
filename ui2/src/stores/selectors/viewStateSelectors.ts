/**
 * Specialized selectors for ViewState store
 * Provides selective subscriptions to reduce unnecessary re-renders
 */

import { useViewStateStore } from '../viewStateStore';
import { shallow } from 'zustand/shallow';

/**
 * Subscribe only to timepoint changes
 */
export const useTimepointSelector = () => 
  useViewStateStore(state => state.viewState.timepoint);

/**
 * Subscribe only to crosshair changes
 */
export const useCrosshairSelector = () => 
  useViewStateStore(state => state.viewState.crosshair, shallow);

/**
 * Subscribe only to specific slice position
 */
export const useSlicePositionSelector = (viewId: string) => 
  useViewStateStore(state => state.viewState.slicePositions[viewId]);

/**
 * Subscribe to time navigation data (timepoint + navigation state)
 */
export const useTimeNavDataSelector = () => 
  useViewStateStore(
    state => ({
      timepoint: state.viewState.timepoint,
      hasTimeNavigation: state.viewState.timeNavigation?.enabled
    }),
    shallow // Use shallow comparison for object stability
  );

/**
 * Subscribe to view-specific data (view plane + crosshair)
 */
export const useViewDataSelector = (viewId: 'axial' | 'sagittal' | 'coronal') => 
  useViewStateStore(
    state => ({
      viewPlane: state.viewState.views[viewId],
      crosshair: state.viewState.crosshair
    }),
    shallow
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
    })),
    shallow
  );

/**
 * Subscribe to render-relevant data only
 */
export const useRenderDataSelector = () => 
  useViewStateStore(
    state => ({
      layers: state.viewState.layers.filter(l => l.visible && l.opacity > 0),
      crosshairVisible: state.viewState.crosshair.visible,
      timepoint: state.viewState.timepoint
    }),
    shallow
  );