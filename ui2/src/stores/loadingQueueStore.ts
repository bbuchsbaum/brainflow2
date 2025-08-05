/**
 * LoadingQueueStore - Unified file loading queue management
 * Single source of truth for all loading operations
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { nanoid } from 'nanoid';

export type LoadingItemType = 'file' | 'template' | 'atlas';
export type LoadingStatus = 'queued' | 'loading' | 'complete' | 'error' | 'cancelled';

export interface LoadingQueueItem {
  id: string; // unique queue ID
  type: LoadingItemType;
  path: string; // file path or template/atlas ID
  displayName: string;
  status: LoadingStatus;
  progress?: number; // 0-100
  startTime?: number;
  endTime?: number;
  error?: Error;
  result?: {
    layerId?: string;
    volumeId?: string;
  };
}

export interface LoadingQueueState {
  // Queue of pending loads (FIFO)
  queue: LoadingQueueItem[];
  
  // Currently loading items (allows parallel loads)
  activeLoads: Map<string, LoadingQueueItem>;
  
  // Completed loads (success or error) - limited history
  completed: LoadingQueueItem[];
  maxCompletedHistory: number;
  
  // Actions
  enqueue: (item: Omit<LoadingQueueItem, 'id' | 'status'>) => string;
  dequeue: () => LoadingQueueItem | undefined;
  startLoading: (queueId: string) => void;
  updateProgress: (queueId: string, progress: number) => void;
  markComplete: (queueId: string, result?: { layerId?: string; volumeId?: string }) => void;
  markError: (queueId: string, error: Error) => void;
  cancel: (queueId: string) => void;
  clearCompleted: () => void;
  
  // Queries
  getActiveCount: () => number;
  getQueuedCount: () => number;
  isLoading: (path: string) => boolean;
  getByPath: (path: string) => LoadingQueueItem | undefined;
}

const MAX_COMPLETED_HISTORY = 50;

export const useLoadingQueueStore = create<LoadingQueueState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      // Initial state
      queue: [],
      activeLoads: new Map(),
      completed: [],
      maxCompletedHistory: MAX_COMPLETED_HISTORY,
      
      // Actions
      enqueue: (item) => {
        const id = nanoid();
        const queueItem: LoadingQueueItem = {
          ...item,
          id,
          status: 'queued'
        };
        
        set((state) => {
          // Check if already loading or queued
          const existing = state.queue.find(q => q.path === item.path) ||
                          Array.from(state.activeLoads.values()).find(a => a.path === item.path);
          
          if (existing) {
            console.warn(`[LoadingQueue] Item already in queue or loading: ${item.path}`);
            return;
          }
          
          state.queue.push(queueItem);
          console.log(`[LoadingQueue] Enqueued ${item.type}: ${item.displayName} (${id})`);
        });
        
        return id;
      },
      
      dequeue: () => {
        let item: LoadingQueueItem | undefined;
        
        set((state) => {
          if (state.queue.length > 0) {
            item = state.queue.shift();
          }
        });
        
        return item;
      },
      
      startLoading: (queueId) => {
        set((state) => {
          // Find in queue
          const queueIndex = state.queue.findIndex(item => item.id === queueId);
          if (queueIndex !== -1) {
            const item = state.queue.splice(queueIndex, 1)[0];
            item.status = 'loading';
            item.startTime = Date.now();
            state.activeLoads.set(queueId, item);
            console.log(`[LoadingQueue] Started loading: ${item.displayName} (${queueId})`);
            return;
          }
          
          // Check if already active
          const activeItem = state.activeLoads.get(queueId);
          if (activeItem) {
            console.warn(`[LoadingQueue] Item already loading: ${activeItem.displayName} (${queueId})`);
          }
        });
      },
      
      updateProgress: (queueId, progress) => {
        set((state) => {
          const item = state.activeLoads.get(queueId);
          if (item) {
            item.progress = Math.min(100, Math.max(0, progress));
          }
        });
      },
      
      markComplete: (queueId, result) => {
        set((state) => {
          const item = state.activeLoads.get(queueId);
          if (item) {
            item.status = 'complete';
            item.endTime = Date.now();
            item.progress = 100;
            item.result = result;
            
            // Move to completed
            state.activeLoads.delete(queueId);
            state.completed.push(item);
            
            // Trim completed history
            if (state.completed.length > state.maxCompletedHistory) {
              state.completed = state.completed.slice(-state.maxCompletedHistory);
            }
            
            const duration = item.endTime - (item.startTime || 0);
            console.log(`[LoadingQueue] Completed: ${item.displayName} (${queueId}) in ${duration}ms`);
          }
        });
      },
      
      markError: (queueId, error) => {
        set((state) => {
          // Check active loads
          let item = state.activeLoads.get(queueId);
          if (item) {
            state.activeLoads.delete(queueId);
          } else {
            // Check queue
            const queueIndex = state.queue.findIndex(q => q.id === queueId);
            if (queueIndex !== -1) {
              item = state.queue.splice(queueIndex, 1)[0];
            }
          }
          
          if (item) {
            item.status = 'error';
            item.endTime = Date.now();
            item.error = error;
            
            // Add to completed (with error)
            state.completed.push(item);
            
            // Trim completed history
            if (state.completed.length > state.maxCompletedHistory) {
              state.completed = state.completed.slice(-state.maxCompletedHistory);
            }
            
            console.error(`[LoadingQueue] Error loading ${item.displayName} (${queueId}):`, error);
          }
        });
      },
      
      cancel: (queueId) => {
        set((state) => {
          // Check queue first
          const queueIndex = state.queue.findIndex(item => item.id === queueId);
          if (queueIndex !== -1) {
            const item = state.queue.splice(queueIndex, 1)[0];
            item.status = 'cancelled';
            item.endTime = Date.now();
            state.completed.push(item);
            console.log(`[LoadingQueue] Cancelled queued item: ${item.displayName} (${queueId})`);
            return;
          }
          
          // Check active loads
          const item = state.activeLoads.get(queueId);
          if (item) {
            item.status = 'cancelled';
            item.endTime = Date.now();
            state.activeLoads.delete(queueId);
            state.completed.push(item);
            console.log(`[LoadingQueue] Cancelled active load: ${item.displayName} (${queueId})`);
          }
          
          // Trim completed history
          if (state.completed.length > state.maxCompletedHistory) {
            state.completed = state.completed.slice(-state.maxCompletedHistory);
          }
        });
      },
      
      clearCompleted: () => {
        set((state) => {
          const cleared = state.completed.length;
          state.completed = [];
          console.log(`[LoadingQueue] Cleared ${cleared} completed items`);
        });
      },
      
      // Queries
      getActiveCount: () => {
        return get().activeLoads.size;
      },
      
      getQueuedCount: () => {
        return get().queue.length;
      },
      
      isLoading: (path) => {
        const state = get();
        
        // Check queue
        if (state.queue.some(item => item.path === path)) {
          return true;
        }
        
        // Check active loads
        for (const item of state.activeLoads.values()) {
          if (item.path === path) {
            return true;
          }
        }
        
        return false;
      },
      
      getByPath: (path) => {
        const state = get();
        
        // Check active loads first
        for (const item of state.activeLoads.values()) {
          if (item.path === path) {
            return item;
          }
        }
        
        // Check queue
        const queued = state.queue.find(item => item.path === path);
        if (queued) return queued;
        
        // Check completed (most recent first)
        for (let i = state.completed.length - 1; i >= 0; i--) {
          if (state.completed[i].path === path) {
            return state.completed[i];
          }
        }
        
        return undefined;
      }
    }))
  )
);

// Typed selectors
export const loadingQueueSelectors = {
  queue: (state: LoadingQueueState) => state.queue,
  activeLoads: (state: LoadingQueueState) => state.activeLoads,
  completed: (state: LoadingQueueState) => state.completed,
  
  // Computed selectors
  totalActive: (state: LoadingQueueState) => state.activeLoads.size,
  totalQueued: (state: LoadingQueueState) => state.queue.length,
  totalPending: (state: LoadingQueueState) => state.queue.length + state.activeLoads.size,
  
  activeLoadsList: (state: LoadingQueueState) => Array.from(state.activeLoads.values()),
  
  isLoadingPath: (state: LoadingQueueState, path: string) => state.isLoading(path),
  
  recentErrors: (state: LoadingQueueState) => 
    state.completed.filter(item => item.status === 'error').slice(-10),
  
  recentSuccesses: (state: LoadingQueueState) => 
    state.completed.filter(item => item.status === 'complete').slice(-10)
};

// Export convenience hooks
export const useLoadingQueue = <T>(selector: (state: LoadingQueueState) => T): T => {
  return useLoadingQueueStore(selector);
};

export const useIsLoading = (path: string) => 
  useLoadingQueue(state => state.isLoading(path));

export const useActiveLoadsCount = () => 
  useLoadingQueue(loadingQueueSelectors.totalActive);

export const useQueuedCount = () => 
  useLoadingQueue(loadingQueueSelectors.totalQueued);