/**
 * Mouse Coordinate Store
 * 
 * Global store for mouse coordinates using Zustand.
 * Replaces EventBus pattern for mouse position tracking.
 * Works across GoldenLayout's isolated React roots.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { subscribeWithSelector } from 'zustand/middleware';

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
}

// Create the store
export const useMouseCoordinateStore = create<MouseCoordinateStore>()(
  devtools(
    subscribeWithSelector((set, get) => {
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
        
        clearMousePosition: () => {
          set({
            worldCoordinates: null,
            activeView: null,
            voxelCoordinates: null,
            intensity: null
          });
        }
      };
    }),
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
