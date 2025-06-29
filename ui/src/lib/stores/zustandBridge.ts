import { readable, type Readable } from 'svelte/store';

// Define a generic interface for a Zustand vanilla store
interface ZustandVanillaStore<T> {
  getState: () => T;
  subscribe: (listener: (state: T, previousState: T) => void) => () => void;
}

/**
 * Creates a Svelte readable store from a Zustand vanilla store.
 *
 * This allows using the `$` prefix for automatic subscription in Svelte components.
 *
 * @template T The type of the state managed by the Zustand store.
 * @param {ZustandVanillaStore<T>} store The Zustand vanilla store instance.
 * @returns {Readable<T>} A Svelte readable store that reflects the Zustand store's state.
 */
export function zustandToReadable<T>(store: ZustandVanillaStore<T>): Readable<T> {
  // Get the initial state
  const initialState = store.getState();

  // Create a Svelte readable store
  const svelteStore = readable<T>(initialState, (set) => {
    // Subscribe to the Zustand store
    const unsubscribe = store.subscribe((state) => {
      // Update the Svelte store whenever the Zustand store changes
      set(state);
    });

    // Return the unsubscribe function to be called when the last subscriber unsubscribes
    return unsubscribe;
  });

  return svelteStore;
} 