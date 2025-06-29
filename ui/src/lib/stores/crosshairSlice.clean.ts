/**
 * Clean Crosshair Store - Pure state management without business logic
 * Uses CrosshairService for all crosshair operations
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface CrosshairStoreState {
  // State
  worldCoord: [number, number, number];
  voxelCoords: Map<string, [number, number, number]>;
  visible: boolean;
  color: string;
  thickness: number;
  isAnimating: boolean;
  
  // Pure state mutations
  setWorldCoord: (coord: [number, number, number]) => void;
  setVoxelCoord: (volumeId: string, coord: [number, number, number]) => void;
  removeVoxelCoord: (volumeId: string) => void;
  setVisible: (visible: boolean) => void;
  setAppearance: (appearance: { color?: string; thickness?: number }) => void;
  setAnimating: (animating: boolean) => void;
  
  // Computed getters
  getVoxelCoord: (volumeId: string) => [number, number, number] | undefined;
  getSliceIndices: (volumeId: string) => { axial: number; sagittal: number; coronal: number } | null;
}

/**
 * Create clean crosshair store
 * All business logic is handled by CrosshairService
 */
export const useCrosshairStore = create<CrosshairStoreState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    worldCoord: [0, 0, 0],
    voxelCoords: new Map(),
    visible: true,
    color: '#FF0000',
    thickness: 2,
    isAnimating: false,
    
    // Pure state mutations
    setWorldCoord: (coord) => set({ worldCoord: coord }),
    
    setVoxelCoord: (volumeId, coord) => set((state) => {
      const voxelCoords = new Map(state.voxelCoords);
      voxelCoords.set(volumeId, coord);
      return { voxelCoords };
    }),
    
    removeVoxelCoord: (volumeId) => set((state) => {
      const voxelCoords = new Map(state.voxelCoords);
      voxelCoords.delete(volumeId);
      return { voxelCoords };
    }),
    
    setVisible: (visible) => set({ visible }),
    
    setAppearance: (appearance) => set((state) => ({
      color: appearance.color ?? state.color,
      thickness: appearance.thickness ?? state.thickness
    })),
    
    setAnimating: (animating) => set({ isAnimating: animating }),
    
    // Computed getters
    getVoxelCoord: (volumeId) => {
      return get().voxelCoords.get(volumeId);
    },
    
    getSliceIndices: (volumeId) => {
      const voxelCoord = get().voxelCoords.get(volumeId);
      if (!voxelCoord) return null;
      
      return {
        axial: Math.round(voxelCoord[2]),
        sagittal: Math.round(voxelCoord[0]),
        coronal: Math.round(voxelCoord[1])
      };
    }
  }))
);

// Selectors for common use cases
export const crosshairStoreSelectors = {
  // Check if crosshair is at specific world position
  isAtPosition: (targetCoord: [number, number, number]) => (state: CrosshairStoreState) => {
    return state.worldCoord[0] === targetCoord[0] &&
           state.worldCoord[1] === targetCoord[1] &&
           state.worldCoord[2] === targetCoord[2];
  },
  
  // Get all volume IDs with voxel coordinates
  volumeIds: (state: CrosshairStoreState) => {
    return Array.from(state.voxelCoords.keys());
  },
  
  // Check if crosshair has voxel coord for volume
  hasVoxelCoord: (volumeId: string) => (state: CrosshairStoreState) => {
    return state.voxelCoords.has(volumeId);
  },
  
  // Get appearance settings
  appearance: (state: CrosshairStoreState) => ({
    color: state.color,
    thickness: state.thickness
  })
};