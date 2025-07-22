import { writable, get } from 'svelte/store';

// Define the state structure
export interface CrosshairState {
  crosshairWorldCoord: [number, number, number] | null;
  activeViewPlane: 0 | 1 | 2; // 0=Axial, 1=Coronal, 2=Sagittal
}

// Create the writable stores
const crosshairWorldCoord = writable<[number, number, number] | null>(null);
const activeViewPlane = writable<0 | 1 | 2>(0); // Default to Axial

// Create the crosshair store with methods
function createCrosshairSlice() {
  const setCrosshairWorldCoord = (coords: [number, number, number] | null) => {
    crosshairWorldCoord.set(coords);
  };

  const setActiveViewPlane = (planeId: 0 | 1 | 2) => {
    activeViewPlane.set(planeId);
  };

  const getState = () => ({
    crosshairWorldCoord: get(crosshairWorldCoord),
    activeViewPlane: get(activeViewPlane)
  });

  return {
    // Expose the readable stores
    crosshairWorldCoord: { subscribe: crosshairWorldCoord.subscribe },
    activeViewPlane: { subscribe: activeViewPlane.subscribe },
    
    // Expose methods
    setCrosshairWorldCoord,
    setActiveViewPlane,
    getState
  };
}

// Create and export the store instance
export const crosshairSlice = createCrosshairSlice();