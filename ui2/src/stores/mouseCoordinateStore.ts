/**
 * Mouse Coordinate Store
 * 
 * Global store for mouse coordinates using Zustand.
 * Replaces EventBus pattern for mouse position tracking.
 * Works across GoldenLayout's isolated React roots.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { throttle } from 'lodash';

export interface MouseCoordinateState {
  // Current world coordinates (null when mouse not over any view)
  worldCoordinates: [number, number, number] | null;
  
  // Which view the mouse is currently over
  activeView: 'axial' | 'sagittal' | 'coronal' | null;
  
  // Voxel coordinates (if available)
  voxelCoordinates: [number, number, number] | null;
  
  // Intensity value at current position (if available)
  intensity: number | null;
}

interface MouseCoordinateStore extends MouseCoordinateState {
  // Actions
  setMousePosition: (
    worldCoords: [number, number, number],
    viewType: 'axial' | 'sagittal' | 'coronal',
    voxelCoords?: [number, number, number],
    intensity?: number
  ) => void;
  clearMousePosition: () => void;
  
  // Throttled version for high-frequency updates
  setMousePositionThrottled: (
    worldCoords: [number, number, number],
    viewType: 'axial' | 'sagittal' | 'coronal',
    voxelCoords?: [number, number, number],
    intensity?: number
  ) => void;
}

// Create the store
export const useMouseCoordinateStore = create<MouseCoordinateStore>()(
  devtools(
    (set, get) => {
      // Create throttled update function (50ms throttle for smooth updates)
      const throttledUpdate = throttle(
        (
          worldCoords: [number, number, number],
          viewType: 'axial' | 'sagittal' | 'coronal',
          voxelCoords?: [number, number, number],
          intensity?: number
        ) => {
          set({
            worldCoordinates: worldCoords,
            activeView: viewType,
            voxelCoordinates: voxelCoords || null,
            intensity: intensity !== undefined ? intensity : null
          });
        },
        50, // Update at most every 50ms
        { leading: true, trailing: true }
      );
      
      return {
        // Initial state
        worldCoordinates: null,
        activeView: null,
        voxelCoordinates: null,
        intensity: null,
        
        // Actions
        setMousePosition: (worldCoords, viewType, voxelCoords, intensity) => {
          set({
            worldCoordinates: worldCoords,
            activeView: viewType,
            voxelCoordinates: voxelCoords || null,
            intensity: intensity !== undefined ? intensity : null
          });
        },
        
        setMousePositionThrottled: throttledUpdate,
        
        clearMousePosition: () => {
          set({
            worldCoordinates: null,
            activeView: null,
            voxelCoordinates: null,
            intensity: null
          });
        }
      };
    },
    {
      name: 'mouse-coordinate'
    }
  )
);

// Helper hooks for common use cases
export const useMouseWorldCoordinates = () => 
  useMouseCoordinateStore(state => state.worldCoordinates);

export const useMouseActiveView = () => 
  useMouseCoordinateStore(state => state.activeView);

export const useFormattedMouseCoordinates = () => {
  const coords = useMouseCoordinateStore(state => state.worldCoordinates);
  if (!coords) return '--';
  return `(${coords[0].toFixed(1)}, ${coords[1].toFixed(1)}, ${coords[2].toFixed(1)})`;
};