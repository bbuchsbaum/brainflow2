/**
 * Coalescing Middleware - Batches rapid state changes into single backend calls
 * This prevents UI lag and backend overload during rapid interactions
 */

import type { ViewState } from '@/types/viewState';

// Global state for coalescing
let pendingState: ViewState | null = null;
let rafId: number | null = null;
let backendUpdateCallback: ((state: ViewState) => Promise<void>) | null = null;

/**
 * Flush the pending state to the backend
 */
async function flushState() {
  if (pendingState && backendUpdateCallback) {
    const stateToFlush = pendingState;
    pendingState = null;
    
    try {
      await backendUpdateCallback(stateToFlush);
    } catch (error) {
      console.error('Backend update failed:', error);
      // Could emit error event here for notification system
    }
  }
  rafId = null;
}

/**
 * Set the callback function that will receive coalesced updates
 */
export function setBackendUpdateCallback(callback: (state: ViewState) => Promise<void>) {
  backendUpdateCallback = callback;
}

/**
 * Schedule a backend update with the given state
 * Multiple rapid calls will be coalesced into a single update
 */
export function scheduleBackendUpdate(state: ViewState) {
  // Store the latest state
  pendingState = state;
  
  // Schedule flush if not already scheduled
  if (!rafId) {
    rafId = requestAnimationFrame(flushState);
  }
}

/**
 * Force immediate flush (useful for critical updates)
 */
export function flushImmediately() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  return flushState();
}

/**
 * Hook to automatically coalesce ViewState updates
 */
export function useCoalescedBackendUpdates() {
  // Subscribe to ViewState changes and schedule backend updates
  // This will be used by components that need to trigger renders
  
  return {
    scheduleUpdate: scheduleBackendUpdate,
    flushImmediately,
  };
}