/**
 * ProgressService - Manages progress tracking for long-running operations
 * Listens to backend progress events and updates the progress store
 */

import { getEventBus, type EventBus } from '@/events/EventBus';
import { useProgressStore, generateTaskId, type ProgressTaskType } from '@/stores/progressStore';
import { safeListen, safeUnlisten, type Unlisten } from '@/utils/eventUtils';

export class ProgressService {
  private eventBus: EventBus;
  private unlisteners: Array<Unlisten> = [];
  private initialized = false;
  
  constructor() {
    if (this.initialized) {
      console.warn('[ProgressService] Already initialized, skipping...');
      return;
    }
    
    this.eventBus = getEventBus();
    this.initializeEventListeners();
    this.initializeTauriListeners();
    this.initialized = true;
  }
  
  /**
   * Initialize listeners for frontend events
   */
  private initializeEventListeners() {
    // Listen for file loading events
    this.eventBus.on('file.loading', ({ path }) => {
      const filename = path.split('/').pop() || path;
      const taskId = generateTaskId('file-load');
      
      useProgressStore.getState().addTask({
        id: taskId,
        type: 'file-load',
        title: `Loading ${filename}`,
        message: 'Reading file...',
        progress: -1, // Start as indeterminate
        status: 'active',
        metadata: { filePath: path }
      });
      
      // Store task ID for later updates
      this.storeTaskMapping(path, taskId);
    });
    
    // Listen for file loaded events
    this.eventBus.on('file.loaded', ({ path, volumeId }) => {
      const taskId = this.getTaskMapping(path);
      if (taskId) {
        useProgressStore.getState().completeTask(taskId);
        this.clearTaskMapping(path);
      }
    });
    
    // Listen for file error events
    this.eventBus.on('file.error', ({ path, error }) => {
      const taskId = this.getTaskMapping(path);
      if (taskId) {
        useProgressStore.getState().completeTask(taskId, error);
        this.clearTaskMapping(path);
      }
    });
  }
  
  /**
   * Initialize listeners for Tauri backend events
   */
  private async initializeTauriListeners() {
    try {
      // Listen for progress start events
      const unlistenStart = await safeListen<{
        taskId: string;
        type: ProgressTaskType;
        title: string;
        message?: string;
        cancellable?: boolean;
      }>('progress:start', (event) => {
        const { taskId, type, title, message, cancellable } = event.payload;
        
        useProgressStore.getState().addTask({
          id: taskId,
          type,
          title,
          message,
          progress: -1, // Start as indeterminate
          status: 'active',
          cancellable
        });
        
        console.log(`[ProgressService] Started task: ${taskId} - ${title}`);
      });
      this.unlisteners.push(unlistenStart);
      
      // Listen for progress update events
      const unlistenUpdate = await safeListen<{
        taskId: string;
        progress: number;
        message?: string;
      }>('progress:update', (event) => {
        const { taskId, progress, message } = event.payload;
        
        useProgressStore.getState().updateTask(taskId, {
          progress,
          ...(message && { message })
        });
      });
      this.unlisteners.push(unlistenUpdate);
      
      // Listen for progress complete events
      const unlistenComplete = await safeListen<{
        taskId: string;
        message?: string;
      }>('progress:complete', (event) => {
        const { taskId, message } = event.payload;
        
        if (message) {
          useProgressStore.getState().updateTask(taskId, { message });
        }
        useProgressStore.getState().completeTask(taskId);
        
        console.log(`[ProgressService] Completed task: ${taskId}`);
      });
      this.unlisteners.push(unlistenComplete);
      
      // Listen for progress error events
      const unlistenError = await safeListen<{
        taskId: string;
        error: string;
      }>('progress:error', (event) => {
        const { taskId, error } = event.payload;
        
        useProgressStore.getState().completeTask(taskId, new Error(error));
        
        console.error(`[ProgressService] Task failed: ${taskId} - ${error}`);
      });
      this.unlisteners.push(unlistenError);
      
      // Listen for progress cancel events
      const unlistenCancel = await safeListen<{
        taskId: string;
      }>('progress:cancel', (event) => {
        const { taskId } = event.payload;
        
        useProgressStore.getState().cancelTask(taskId);
        
        console.log(`[ProgressService] Cancelled task: ${taskId}`);
      });
      this.unlisteners.push(unlistenCancel);
      
      console.log('[ProgressService] Tauri event listeners initialized');
    } catch (error) {
      console.error('[ProgressService] Failed to initialize Tauri listeners:', error);
    }
  }
  
  /**
   * Start a manual progress task (for frontend-only operations)
   */
  startTask(
    type: ProgressTaskType,
    title: string,
    options?: {
      message?: string;
      cancellable?: boolean;
      metadata?: Record<string, any>;
    }
  ): string {
    const taskId = generateTaskId(type);
    
    useProgressStore.getState().addTask({
      id: taskId,
      type,
      title,
      message: options?.message,
      progress: -1,
      status: 'active',
      cancellable: options?.cancellable,
      metadata: options?.metadata
    });
    
    return taskId;
  }
  
  /**
   * Update a manual progress task
   */
  updateTask(taskId: string, progress: number, message?: string) {
    useProgressStore.getState().updateTask(taskId, {
      progress,
      ...(message && { message })
    });
  }
  
  /**
   * Complete a manual progress task
   */
  completeTask(taskId: string, error?: Error) {
    useProgressStore.getState().completeTask(taskId, error);
  }
  
  /**
   * Cancel a progress task
   */
  cancelTask(taskId: string) {
    const task = useProgressStore.getState().getTask(taskId);
    if (task?.cancellable) {
      // Emit cancel event to backend if it's a backend task
      if (task.metadata?.fromBackend) {
        this.eventBus.emit('progress.cancel', { taskId });
      }
      
      useProgressStore.getState().cancelTask(taskId);
    }
  }
  
  /**
   * Clean up listeners
   */
  destroy() {
    this.unlisteners.forEach((unlisten) => {
      // Ensure we swallow promise rejections from Tauri internals
      void safeUnlisten(unlisten);
    });
    this.unlisteners = [];
  }
  
  // Task ID mapping for correlating file paths with progress tasks
  private taskMappings = new Map<string, string>();
  
  private storeTaskMapping(key: string, taskId: string) {
    this.taskMappings.set(key, taskId);
  }
  
  private getTaskMapping(key: string): string | undefined {
    return this.taskMappings.get(key);
  }
  
  private clearTaskMapping(key: string) {
    this.taskMappings.delete(key);
  }
}

// Singleton instance
let progressService: ProgressService | null = null;
let isInitializing = false;
let initCount = 0;

/**
 * Get the progress service instance
 */
export function getProgressService(): ProgressService {
  if (!progressService && !isInitializing) {
    isInitializing = true;
    initCount++;
    console.log(`[ProgressService] Initializing service (attempt ${initCount})`);
    
    if (initCount > 1) {
      console.warn('[ProgressService] Multiple initialization attempts detected!');
    }
    
    progressService = new ProgressService();
    isInitializing = false;
  }
  return progressService!;
}

/**
 * React hook to use the progress service
 */
import { useEffect } from 'react';

export function useProgressService() {
  useEffect(() => {
    // Ensure service is initialized
    getProgressService();
  }, []);
  
  return {
    startTask: (type: ProgressTaskType, title: string, options?: any) => 
      getProgressService().startTask(type, title, options),
    updateTask: (taskId: string, progress: number, message?: string) =>
      getProgressService().updateTask(taskId, progress, message),
    completeTask: (taskId: string, error?: Error) =>
      getProgressService().completeTask(taskId, error),
    cancelTask: (taskId: string) =>
      getProgressService().cancelTask(taskId)
  };
}
