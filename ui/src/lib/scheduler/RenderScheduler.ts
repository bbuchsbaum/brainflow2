/**
 * RenderScheduler - Implements dirty-flag pattern for efficient rendering
 * Batches render requests and prevents redundant renders
 */
import { getEventBus } from '$lib/events/EventBus';

export interface RenderTask {
  id: string;
  priority: 'low' | 'normal' | 'high' | 'immediate';
  callback: () => void | Promise<void>;
  dependencies?: string[];
}

export class RenderScheduler {
  private tasks = new Map<string, RenderTask>();
  private dirtyFlags = new Set<string>();
  private isScheduled = false;
  private frameId: number | null = null;
  private eventBus = getEventBus();
  
  // Priority weights for sorting
  private readonly priorityWeights = {
    immediate: 0,
    high: 1,
    normal: 2,
    low: 3
  };
  
  /**
   * Mark a component as dirty and needing render
   */
  markDirty(componentId: string): void {
    this.dirtyFlags.add(componentId);
    this.scheduleRender();
    
    this.eventBus.emit('render.marked_dirty', { componentId });
  }
  
  /**
   * Check if a component is dirty
   */
  isDirty(componentId: string): boolean {
    return this.dirtyFlags.has(componentId);
  }
  
  /**
   * Register a render task
   */
  registerTask(task: RenderTask): void {
    this.tasks.set(task.id, task);
    
    if (task.priority === 'immediate') {
      this.executeTask(task);
    }
  }
  
  /**
   * Unregister a render task
   */
  unregisterTask(taskId: string): void {
    this.tasks.delete(taskId);
  }
  
  /**
   * Schedule a render on the next animation frame
   */
  private scheduleRender(): void {
    if (this.isScheduled) return;
    
    this.isScheduled = true;
    this.frameId = requestAnimationFrame(() => this.performRender());
  }
  
  /**
   * Cancel scheduled render
   */
  cancelRender(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.isScheduled = false;
  }
  
  /**
   * Perform the actual render
   */
  private async performRender(): Promise<void> {
    this.isScheduled = false;
    this.frameId = null;
    
    // Get tasks for dirty components
    const tasksToRun = Array.from(this.tasks.values())
      .filter(task => this.dirtyFlags.has(task.id))
      .sort((a, b) => this.priorityWeights[a.priority] - this.priorityWeights[b.priority]);
    
    // Clear dirty flags before rendering
    const dirtyComponents = Array.from(this.dirtyFlags);
    this.dirtyFlags.clear();
    
    // Check dependencies
    const readyTasks = this.filterByDependencies(tasksToRun);
    
    // Execute tasks
    const startTime = performance.now();
    
    for (const task of readyTasks) {
      try {
        await this.executeTask(task);
      } catch (error) {
        console.error(`Render task ${task.id} failed:`, error);
        this.eventBus.emit('render.task.error', {
          taskId: task.id,
          error
        });
        
        // Re-mark as dirty for retry
        this.dirtyFlags.add(task.id);
      }
    }
    
    const renderTime = performance.now() - startTime;
    
    this.eventBus.emit('render.completed', {
      components: dirtyComponents,
      taskCount: readyTasks.length,
      renderTime
    });
    
    // Schedule another render if new dirty flags were added
    if (this.dirtyFlags.size > 0) {
      this.scheduleRender();
    }
  }
  
  /**
   * Execute a single task
   */
  private async executeTask(task: RenderTask): Promise<void> {
    this.eventBus.emit('render.task.start', { taskId: task.id });
    
    const startTime = performance.now();
    await task.callback();
    const duration = performance.now() - startTime;
    
    this.eventBus.emit('render.task.complete', {
      taskId: task.id,
      duration
    });
  }
  
  /**
   * Filter tasks by dependency readiness
   */
  private filterByDependencies(tasks: RenderTask[]): RenderTask[] {
    const completed = new Set<string>();
    const ready: RenderTask[] = [];
    
    // Multiple passes to handle dependency chains
    let changed = true;
    while (changed) {
      changed = false;
      
      for (const task of tasks) {
        if (completed.has(task.id)) continue;
        
        const depsReady = !task.dependencies || 
          task.dependencies.every(dep => completed.has(dep));
        
        if (depsReady) {
          ready.push(task);
          completed.add(task.id);
          changed = true;
        }
      }
    }
    
    return ready;
  }
  
  /**
   * Force immediate render of all dirty components
   */
  forceRender(): void {
    this.cancelRender();
    this.performRender();
  }
  
  /**
   * Get render statistics
   */
  getStats(): {
    dirtyCount: number;
    taskCount: number;
    isScheduled: boolean;
  } {
    return {
      dirtyCount: this.dirtyFlags.size,
      taskCount: this.tasks.size,
      isScheduled: this.isScheduled
    };
  }
}

// Singleton instance
let scheduler: RenderScheduler | null = null;

export function getRenderScheduler(): RenderScheduler {
  if (!scheduler) {
    scheduler = new RenderScheduler();
  }
  return scheduler;
}

// Helper hook for Svelte components
export function useRenderScheduler(componentId: string) {
  const scheduler = getRenderScheduler();
  
  return {
    markDirty: () => scheduler.markDirty(componentId),
    isDirty: () => scheduler.isDirty(componentId),
    registerTask: (task: Omit<RenderTask, 'id'>) => 
      scheduler.registerTask({ ...task, id: componentId }),
    unregisterTask: () => scheduler.unregisterTask(componentId)
  };
}