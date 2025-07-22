import { writable, get } from 'svelte/store';

interface ResizeState {
  width: number;
  height: number;
}

// Create the writable store for resize state
const resizeState = writable<ResizeState>({
  width: 0,
  height: 0,
});

// Export the setter directly for convenience
export const setResizeBusDimensions = (width: number, height: number) => {
  resizeState.set({ width, height });
};

// Simple subscription function remains similar
export const subscribeToResize = (listener: (width: number, height: number) => void) => {
  let previousWidth = get(resizeState).width;
  let previousHeight = get(resizeState).height;

  const unsub = resizeState.subscribe((state) => { // Subscribe to the whole state
    const { width, height } = state;

    // Fire only if dimensions actually changed and are non-zero
    if ((width !== previousWidth || height !== previousHeight) && width > 0 && height > 0) { 
      listener(width, height);
    }

    // Update previous values for the next comparison
    previousWidth = width;
    previousHeight = height;
  });
  
  return unsub;
};

// Export a zustand-compatible interface for backward compatibility
export const resizeBus = {
  getState: () => get(resizeState),
  setState: (newState: Partial<ResizeState>) => {
    resizeState.update(current => ({ ...current, ...newState }));
  },
  subscribe: resizeState.subscribe
}; 