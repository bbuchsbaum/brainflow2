/**
 * WebWorker wrapper for heavy computations
 * Offloads CPU-intensive tasks from main thread
 */

export interface WorkerTask<T = any, R = any> {
  id: string;
  type: string;
  data: T;
}

export interface WorkerResult<R = any> {
  id: string;
  type: string;
  result?: R;
  error?: string;
}

export class ComputeWorker {
  private worker: Worker | null = null;
  private tasks = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeout?: number;
  }>();
  
  constructor(private workerPath: string) {}
  
  /**
   * Initialize the worker
   */
  async init(): Promise<void> {
    if (this.worker) return;
    
    try {
      this.worker = new Worker(this.workerPath, { type: 'module' });
      
      this.worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        this.handleMessage(event.data);
      };
      
      this.worker.onerror = (error) => {
        console.error('Worker error:', error);
        this.handleError(error);
      };
      
      // Send init message
      await this.execute('init', {});
      
    } catch (error) {
      console.error('Failed to initialize worker:', error);
      throw error;
    }
  }
  
  /**
   * Execute a task in the worker
   */
  async execute<T, R>(type: string, data: T, timeout = 30000): Promise<R> {
    if (!this.worker) {
      await this.init();
    }
    
    const id = crypto.randomUUID();
    const task: WorkerTask<T> = { id, type, data };
    
    return new Promise((resolve, reject) => {
      // Set timeout
      const timeoutId = timeout > 0 ? setTimeout(() => {
        this.tasks.delete(id);
        reject(new Error(`Worker task ${type} timed out after ${timeout}ms`));
      }, timeout) : undefined;
      
      // Store promise handlers
      this.tasks.set(id, { 
        resolve, 
        reject,
        timeout: timeoutId
      });
      
      // Send task to worker
      this.worker!.postMessage(task);
    });
  }
  
  /**
   * Execute with transferable objects for zero-copy
   */
  async executeTransferable<T, R>(
    type: string, 
    data: T, 
    transferables: Transferable[],
    timeout = 30000
  ): Promise<R> {
    if (!this.worker) {
      await this.init();
    }
    
    const id = crypto.randomUUID();
    const task: WorkerTask<T> = { id, type, data };
    
    return new Promise((resolve, reject) => {
      const timeoutId = timeout > 0 ? setTimeout(() => {
        this.tasks.delete(id);
        reject(new Error(`Worker task ${type} timed out after ${timeout}ms`));
      }, timeout) : undefined;
      
      this.tasks.set(id, { 
        resolve, 
        reject,
        timeout: timeoutId
      });
      
      // Send with transferables
      this.worker!.postMessage(task, transferables);
    });
  }
  
  /**
   * Handle message from worker
   */
  private handleMessage(result: WorkerResult): void {
    const task = this.tasks.get(result.id);
    if (!task) return;
    
    // Clear timeout
    if (task.timeout) {
      clearTimeout(task.timeout);
    }
    
    this.tasks.delete(result.id);
    
    if (result.error) {
      task.reject(new Error(result.error));
    } else {
      task.resolve(result.result);
    }
  }
  
  /**
   * Handle worker error
   */
  private handleError(error: ErrorEvent): void {
    // Reject all pending tasks
    for (const [id, task] of this.tasks) {
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      task.reject(error);
    }
    this.tasks.clear();
  }
  
  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    // Reject pending tasks
    for (const [id, task] of this.tasks) {
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      task.reject(new Error('Worker terminated'));
    }
    this.tasks.clear();
  }
  
  /**
   * Check if worker is ready
   */
  isReady(): boolean {
    return this.worker !== null;
  }
}

// Create singleton workers for different task types
let workers: Map<string, ComputeWorker> | null = null;

export function getComputeWorker(type: 'math' | 'image' | 'data'): ComputeWorker {
  if (!workers) {
    workers = new Map();
  }
  
  if (!workers.has(type)) {
    const workerPath = `/workers/${type}.worker.js`;
    workers.set(type, new ComputeWorker(workerPath));
  }
  
  return workers.get(type)!;
}

// Helper for math operations
export async function computeInWorker<T, R>(
  operation: string,
  data: T,
  transferables?: Transferable[]
): Promise<R> {
  const worker = getComputeWorker('math');
  
  if (transferables) {
    return worker.executeTransferable<T, R>(operation, data, transferables);
  }
  
  return worker.execute<T, R>(operation, data);
}