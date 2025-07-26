/**
 * useStatusBarUpdates Hook
 * Connects various data sources to the StatusContext
 * Handles real-time updates for coordinates, FPS, GPU status, etc.
 */

import { useEffect, useCallback } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useEvent } from '@/events/EventBus';
import { useStatusUpdater } from '@/contexts/StatusContext';

/**
 * Format coordinates for display
 */
const formatCoord = (coord: [number, number, number]): string => {
  return `(${coord[0].toFixed(1)}, ${coord[1].toFixed(1)}, ${coord[2].toFixed(1)})`;
};

/**
 * Hook that subscribes to various data sources and updates status bar
 */
export function useStatusBarUpdates() {
  const { setValue, setBatch } = useStatusUpdater();
  
  // Subscribe to crosshair position changes
  useEffect(() => {
    const unsubscribe = useViewStateStore.subscribe(
      state => state.viewState.crosshair,
      crosshair => {
        console.log('[useStatusBarUpdates] Crosshair updated:', crosshair.world_mm);
        const formatted = formatCoord(crosshair.world_mm);
        console.log('[useStatusBarUpdates] Setting crosshair status to:', formatted);
        setValue('crosshair', formatted);
      }
    );
    
    // Set initial value
    const initialCrosshair = useViewStateStore.getState().viewState.crosshair;
    console.log('[useStatusBarUpdates] Initial crosshair:', initialCrosshair.world_mm);
    setValue('crosshair', formatCoord(initialCrosshair.world_mm));
    
    return unsubscribe;
  }, [setValue]);
  
  // Create stable event handlers with useCallback
  const handleMouseCoordinate = useCallback((data: { world_mm: [number, number, number] }) => {
    setValue('mouse', formatCoord(data.world_mm));
  }, [setValue]);
  
  const handleMouseLeave = useCallback(() => {
    setValue('mouse', '--');
  }, [setValue]);
  
  const handleFpsUpdate = useCallback((data: { fps: number }) => {
    setValue('fps', `${data.fps.toFixed(1)} fps`);
  }, [setValue]);
  
  const handleGpuStatus = useCallback((data: { status: string }) => {
    setValue('gpu', data.status);
  }, [setValue]);
  
  // Listen for mouse coordinate events
  useEvent('mouse.worldCoordinate', handleMouseCoordinate);
  useEvent('mouse.leave', handleMouseLeave);
  
  // Listen for FPS updates (if available)
  useEvent('render.fps', handleFpsUpdate);
  
  // Listen for GPU status updates (if available)
  useEvent('gpu.status', handleGpuStatus);
  
  // Listen for active volume/layer info
  useEffect(() => {
    const unsubscribe = useViewStateStore.subscribe(
      state => state.viewState.layers,
      layers => {
        const activeLayer = layers.find(l => l.visible);
        if (activeLayer) {
          setValue('layer', activeLayer.name || activeLayer.id);
        } else {
          setValue('layer', 'None');
        }
      }
    );
    
    return unsubscribe;
  }, [setValue]);
}