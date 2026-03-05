/**
 * ProgressService - Manages progress tracking for long-running operations
 * Listens to backend progress events and updates the progress store
 */

import { getEventBus, type EventBus } from '@/events/EventBus';
import { useProgressStore, generateTaskId, type ProgressTaskType } from '@/stores/progressStore';
import { useLoadingQueueStore, type LoadingQueueItem } from '@/stores/loadingQueueStore';
import { safeListen, safeUnlisten, type Unlisten } from '@/utils/eventUtils';

interface AtlasStageProgressPayload {
  atlas_id?: string;
  stage?: string;
  progress?: number;
  message?: string;
}

interface TemplateStageProgressPayload {
  template_id?: string;
  stage?: string;
  progress?: number;
  message?: string;
}

export class ProgressService {
  private eventBus: EventBus;
  private unlisteners: Array<Unlisten> = [];
  private loadingQueueUnsubscribe: (() => void) | null = null;
  private initialized = false;
  private loadingQueueTaskIds = new Map<string, string>();
  private processedCompletedQueueItems = new Set<string>();
  
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
    this.initializeLoadingQueueBridge();

    // Fallback listeners for file.* events that may not be queue-backed.
    // Listen for file loading events
    this.eventBus.on('file.loading', ({ path }) => {
      const queueItem = useLoadingQueueStore.getState().getByPath(path);
      if (queueItem) {
        return;
      }

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
    this.eventBus.on('file.loaded', ({ path }) => {
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

  private initializeLoadingQueueBridge() {
    if (this.loadingQueueUnsubscribe) {
      return;
    }

    this.loadingQueueUnsubscribe = useLoadingQueueStore.subscribe(
      (state) => ({
        activeLoads: state.activeLoads,
        queue: state.queue,
        completed: state.completed,
      }),
      ({ activeLoads, queue, completed }) => {
        activeLoads.forEach((item) => {
          this.upsertLoadingQueueTask(item, 'loading');
        });

        queue.forEach((item) => {
          this.upsertLoadingQueueTask(item, 'queued');
        });

        completed.forEach((item) => {
          if (this.processedCompletedQueueItems.has(item.id)) {
            return;
          }
          this.processedCompletedQueueItems.add(item.id);
          this.finishLoadingQueueTask(item);
        });
      }
    );
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

      const unlistenAtlasStage = await safeListen<AtlasStageProgressPayload>(
        'atlas-progress',
        (event) => {
          this.applyAtlasStageProgress(event.payload);
        }
      );
      this.unlisteners.push(unlistenAtlasStage);

      const unlistenTemplateStage = await safeListen<TemplateStageProgressPayload>(
        'template-progress',
        (event) => {
          this.applyTemplateStageProgress(event.payload);
        }
      );
      this.unlisteners.push(unlistenTemplateStage);
      
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
      metadata?: Record<string, unknown>;
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

    if (this.loadingQueueUnsubscribe) {
      this.loadingQueueUnsubscribe();
      this.loadingQueueUnsubscribe = null;
    }
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

  private getTaskTypeFromLoadingItem(item: LoadingQueueItem): ProgressTaskType {
    switch (item.type) {
      case 'file':
      case 'template':
      case 'atlas':
        return 'file-load';
      default:
        return 'generic';
    }
  }

  private getTaskTitleFromLoadingItem(item: LoadingQueueItem): string {
    switch (item.type) {
      case 'template':
        return `Loading template: ${item.displayName}`;
      case 'atlas':
        return `Loading atlas: ${item.displayName}`;
      case 'file':
      default:
        return `Loading ${item.displayName}`;
    }
  }

  private upsertLoadingQueueTask(item: LoadingQueueItem, queuePhase: 'queued' | 'loading') {
    let taskId = this.loadingQueueTaskIds.get(item.id);

    if (!taskId) {
      taskId = `load-${item.id}`;
      this.loadingQueueTaskIds.set(item.id, taskId);

      useProgressStore.getState().addTask({
        id: taskId,
        type: this.getTaskTypeFromLoadingItem(item),
        title: this.getTaskTitleFromLoadingItem(item),
        message: queuePhase === 'queued' ? 'Queued' : 'Starting…',
        progress: queuePhase === 'queued' ? -1 : (item.progress ?? -1),
        status: 'active',
        metadata: {
          queueId: item.id,
          sourcePath: item.path,
          sourceType: item.type,
        },
      });
      return;
    }

    useProgressStore.getState().updateTask(taskId, {
      title: this.getTaskTitleFromLoadingItem(item),
      progress: queuePhase === 'queued' ? -1 : (item.progress ?? -1),
      message:
        queuePhase === 'queued'
          ? 'Queued'
          : item.progress !== undefined
            ? `${item.progress}%`
            : 'Working…',
    });
  }

  private finishLoadingQueueTask(item: LoadingQueueItem) {
    const taskId = this.loadingQueueTaskIds.get(item.id) ?? `load-${item.id}`;
    this.loadingQueueTaskIds.set(item.id, taskId);

    if (item.status === 'error') {
      useProgressStore
        .getState()
        .completeTask(taskId, item.error ?? new Error(`Failed to load ${item.displayName}`));
      return;
    }

    if (item.status === 'cancelled') {
      useProgressStore.getState().updateTask(taskId, { cancellable: true });
      useProgressStore.getState().cancelTask(taskId);
      this.scheduleTaskCleanup(taskId, 5_000);
      return;
    }

    useProgressStore.getState().updateTask(taskId, {
      title: this.getTaskTitleFromLoadingItem(item),
      message: `Loaded ${item.displayName}`,
      progress: 100,
    });
    useProgressStore.getState().completeTask(taskId);
    this.scheduleTaskCleanup(taskId, 8_000);
  }

  private scheduleTaskCleanup(taskId: string, delayMs: number) {
    setTimeout(() => {
      const task = useProgressStore.getState().getTask(taskId);
      if (!task) {
        return;
      }
      if (task.status === 'active') {
        return;
      }
      useProgressStore.getState().removeTask(taskId);
    }, delayMs);
  }

  private applyAtlasStageProgress(payload: AtlasStageProgressPayload) {
    const atlasId = payload.atlas_id;
    if (!atlasId) {
      return;
    }

    const queueItem = this.findQueueItem((item) => item.type === 'atlas' && item.path.startsWith(`atlas|${atlasId}|`));
    if (!queueItem) {
      return;
    }

    this.applyBackendStageUpdate(queueItem, payload.stage, payload.message, payload.progress);
  }

  private applyTemplateStageProgress(payload: TemplateStageProgressPayload) {
    const templateId = payload.template_id;
    if (!templateId) {
      return;
    }

    const queueItem = this.findQueueItem(
      (item) => item.type === 'template' && item.path === `template:${templateId}`
    );
    if (!queueItem) {
      return;
    }

    this.applyBackendStageUpdate(queueItem, payload.stage, payload.message, payload.progress);
  }

  private applyBackendStageUpdate(
    queueItem: LoadingQueueItem,
    stage: string | undefined,
    message: string | undefined,
    rawProgress: number | undefined
  ) {
    const normalizedProgress = this.normalizeProgressPercent(rawProgress);
    if (normalizedProgress !== undefined) {
      useLoadingQueueStore.getState().updateProgress(queueItem.id, normalizedProgress);
    }

    const stageLabel = stage ? this.humanizeStage(stage) : null;
    const composedMessage = [stageLabel, message].filter(Boolean).join(' - ');

    const taskId = this.loadingQueueTaskIds.get(queueItem.id);
    if (!taskId) {
      return;
    }

    useProgressStore.getState().updateTask(taskId, {
      ...(normalizedProgress !== undefined ? { progress: normalizedProgress } : {}),
      ...(composedMessage ? { message: composedMessage } : {}),
    });
  }

  private normalizeProgressPercent(rawProgress: number | undefined): number | undefined {
    if (typeof rawProgress !== 'number' || !Number.isFinite(rawProgress)) {
      return undefined;
    }

    if (rawProgress >= 0 && rawProgress <= 1) {
      return Math.round(rawProgress * 100);
    }

    if (rawProgress > 1 && rawProgress <= 100) {
      return Math.round(rawProgress);
    }

    if (rawProgress > 100) {
      return 100;
    }

    return 0;
  }

  private humanizeStage(stage: string): string {
    return stage
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private findQueueItem(
    predicate: (item: LoadingQueueItem) => boolean
  ): LoadingQueueItem | null {
    const queueState = useLoadingQueueStore.getState();

    for (const item of queueState.activeLoads.values()) {
      if (predicate(item)) {
        return item;
      }
    }

    for (const item of queueState.queue) {
      if (predicate(item)) {
        return item;
      }
    }

    return null;
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
    startTask: (
      type: ProgressTaskType,
      title: string,
      options?: {
        message?: string;
        cancellable?: boolean;
        metadata?: Record<string, unknown>;
      }
    ) =>
      getProgressService().startTask(type, title, options),
    updateTask: (taskId: string, progress: number, message?: string) =>
      getProgressService().updateTask(taskId, progress, message),
    completeTask: (taskId: string, error?: Error) =>
      getProgressService().completeTask(taskId, error),
    cancelTask: (taskId: string) =>
      getProgressService().cancelTask(taskId)
  };
}
