/**
 * Progress Store - Manages progress state for long-running operations
 * Provides a unified way to track and display progress across the application
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { enableMapSet } from 'immer';

// Enable Map and Set support in Immer
enableMapSet();

// Types of operations that can show progress
export type ProgressTaskType = 'file-load' | 'computation' | 'export' | 'rendering' | 'generic';

// Progress task status
export type ProgressStatus = 'active' | 'completed' | 'error' | 'cancelled';

// Individual progress task
export interface ProgressTask {
  id: string;
  type: ProgressTaskType;
  title: string;
  message?: string;
  progress: number; // 0-100 for determinate, -1 for indeterminate
  status: ProgressStatus;
  startTime: number;
  endTime?: number;
  error?: Error;
  cancellable?: boolean;
  // Optional metadata for specific task types
  metadata?: {
    filePath?: string;
    volumeId?: string;
    layerId?: string;
    [key: string]: any;
  };
}

// Store state interface
export interface ProgressState {
  // All progress tasks keyed by ID
  tasks: Map<string, ProgressTask>;
  
  // Actions
  addTask: (task: Omit<ProgressTask, 'startTime'>) => void;
  updateTask: (id: string, updates: Partial<ProgressTask>) => void;
  removeTask: (id: string) => void;
  completeTask: (id: string, error?: Error) => void;
  cancelTask: (id: string) => void;
  clearCompleted: () => void;
  
  // Queries
  getTask: (id: string) => ProgressTask | undefined;
  getActiveTasks: () => ProgressTask[];
  getTasksByType: (type: ProgressTaskType) => ProgressTask[];
  hasActiveTasks: () => boolean;
  getOverallProgress: () => number; // Average progress of all active tasks
}

// Create the store
export const useProgressStore = create<ProgressState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      tasks: new Map(),
      
      addTask: (task) => {
        const fullTask: ProgressTask = {
          ...task,
          startTime: Date.now()
        };
        
        set((state) => {
          state.tasks.set(task.id, fullTask);
        });
        
        console.log(`[ProgressStore] Added task:`, fullTask);
      },
      
      updateTask: (id, updates) => {
        set((state) => {
          const task = state.tasks.get(id);
          if (task) {
            Object.assign(task, updates);
            
            // Auto-complete if progress reaches 100
            if (updates.progress === 100 && task.status === 'active') {
              task.status = 'completed';
              task.endTime = Date.now();
            }
          }
        });
      },
      
      removeTask: (id) => {
        set((state) => {
          state.tasks.delete(id);
        });
        
        console.log(`[ProgressStore] Removed task: ${id}`);
      },
      
      completeTask: (id, error) => {
        set((state) => {
          const task = state.tasks.get(id);
          if (task) {
            task.status = error ? 'error' : 'completed';
            task.progress = error ? task.progress : 100;
            task.endTime = Date.now();
            task.error = error;
          }
        });
        
        console.log(`[ProgressStore] Completed task: ${id}`, error ? 'with error' : 'successfully');
      },
      
      cancelTask: (id) => {
        set((state) => {
          const task = state.tasks.get(id);
          if (task && task.cancellable) {
            task.status = 'cancelled';
            task.endTime = Date.now();
          }
        });
        
        console.log(`[ProgressStore] Cancelled task: ${id}`);
      },
      
      clearCompleted: () => {
        set((state) => {
          const completedIds: string[] = [];
          state.tasks.forEach((task, id) => {
            if (task.status === 'completed' || task.status === 'cancelled') {
              completedIds.push(id);
            }
          });
          
          completedIds.forEach(id => state.tasks.delete(id));
          
          console.log(`[ProgressStore] Cleared ${completedIds.length} completed tasks`);
        });
      },
      
      // Queries
      getTask: (id) => {
        return get().tasks.get(id);
      },
      
      getActiveTasks: () => {
        const tasks: ProgressTask[] = [];
        get().tasks.forEach(task => {
          if (task.status === 'active') {
            tasks.push(task);
          }
        });
        return tasks;
      },
      
      getTasksByType: (type) => {
        const tasks: ProgressTask[] = [];
        get().tasks.forEach(task => {
          if (task.type === type) {
            tasks.push(task);
          }
        });
        return tasks;
      },
      
      hasActiveTasks: () => {
        let hasActive = false;
        get().tasks.forEach(task => {
          if (task.status === 'active') {
            hasActive = true;
          }
        });
        return hasActive;
      },
      
      getOverallProgress: () => {
        const activeTasks = get().getActiveTasks();
        if (activeTasks.length === 0) return 100;
        
        const determinateTasks = activeTasks.filter(t => t.progress >= 0);
        if (determinateTasks.length === 0) return -1; // All indeterminate
        
        const totalProgress = determinateTasks.reduce((sum, task) => sum + task.progress, 0);
        return Math.round(totalProgress / determinateTasks.length);
      }
    }))
  )
);

// Utility function to generate task IDs
export function generateTaskId(type: ProgressTaskType): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Auto-cleanup completed tasks after a delay - TEMPORARILY DISABLED
// let cleanupInterval: NodeJS.Timeout | null = null;

// if (typeof window !== 'undefined') {
//   // Use a single interval that only updates if there are tasks to remove
//   cleanupInterval = setInterval(() => {
//     const state = useProgressStore.getState();
//     const now = Date.now();
//     const toRemove: string[] = [];
    
//     state.tasks.forEach((task, id) => {
//       // Remove completed/cancelled tasks after 30 seconds
//       if (
//         (task.status === 'completed' || task.status === 'cancelled') && 
//         task.endTime && 
//         now - task.endTime > 30000
//       ) {
//         toRemove.push(id);
//       }
//     });
    
//     // Only update state if there are tasks to remove
//     if (toRemove.length > 0) {
//       // Use immer to batch all removals in a single update
//       useProgressStore.setState((state) => {
//         toRemove.forEach(id => state.tasks.delete(id));
//       });
//     }
//   }, 5000); // Check every 5 seconds
// }

// Export cleanup function for testing
let cleanupInterval: NodeJS.Timeout | null = null;
export function cleanupProgressStore() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}