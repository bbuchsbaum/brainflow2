import { createStore, type StateCreator } from '$lib/zustand-vanilla';

// Define the state structure
export interface CrosshairSlice {
  crosshairWorldCoord: [number, number, number] | null;
  activeViewPlane: 0 | 1 | 2; // 0=Axial, 1=Coronal, 2=Sagittal
  setCrosshairWorldCoord: (coords: [number, number, number] | null) => void;
  setActiveViewPlane: (planeId: 0 | 1 | 2) => void;
}

// Define the slice creator
export const createCrosshairSlice: StateCreator<
  CrosshairSlice,
  [], // No middleware Signatures
  [], // No named part Signatures
  CrosshairSlice // Slice Interface
> = (set) => ({
  crosshairWorldCoord: null,
  activeViewPlane: 0, // Default to Axial
  setCrosshairWorldCoord: (coords) => set({ crosshairWorldCoord: coords }),
  setActiveViewPlane: (planeId) => set({ activeViewPlane: planeId }),
});

// --- Create and export the store instance ---
export const crosshairSlice = createStore<CrosshairSlice>(createCrosshairSlice); 