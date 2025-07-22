import { createStore } from '$lib/zustand-vanilla';

interface ResizeState {
	width: number;
	height: number;
}

// Create a vanilla Zustand store - no need for React hooks
// It holds the latest dimensions
export const resizeBus = createStore<ResizeState>(() => ({
	width: 0,
	height: 0
}));

// Export the setter directly for convenience
export const setResizeBusDimensions = (width: number, height: number) => {
	resizeBus.setState({ width, height });
};

// Simple subscription function remains similar
export const subscribeToResize = (listener: (width: number, height: number) => void) => {
	let previousWidth = resizeBus.getState().width;
	let previousHeight = resizeBus.getState().height;

	const unsub = resizeBus.subscribe((state) => {
		// Subscribe to the whole state
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
