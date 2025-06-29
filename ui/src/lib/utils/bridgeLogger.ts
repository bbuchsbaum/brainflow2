import { writable, derived } from 'svelte/store';
import { nanoid } from 'nanoid';

export interface BridgeLogEntry {
  id: string;
  timestamp: number;
  command: string;
  params: any;
  result?: any;
  error?: any;
  duration?: number;
  status: 'pending' | 'success' | 'error';
}

class BridgeLogger {
  private static instance: BridgeLogger;
  private logs = writable<BridgeLogEntry[]>([]);
  private maxLogs = 100;
  private enabled = true;
  
  private constructor() {}
  
  static getInstance(): BridgeLogger {
    if (!BridgeLogger.instance) {
      BridgeLogger.instance = new BridgeLogger();
    }
    return BridgeLogger.instance;
  }
  
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }
  
  isEnabled(): boolean {
    return this.enabled;
  }
  
  enable() {
    this.enabled = true;
  }
  
  disable() {
    this.enabled = false;
  }
  
  logCommand(command: string, params: any): string {
    if (!this.enabled) return '';
    
    const id = nanoid();
    const entry: BridgeLogEntry = {
      id,
      timestamp: Date.now(),
      command,
      params: this.sanitizeParams(params),
      status: 'pending'
    };
    
    this.logs.update(logs => {
      const newLogs = [entry, ...logs];
      // Keep only the last N logs
      return newLogs.slice(0, this.maxLogs);
    });
    
    return id;
  }
  
  logSuccess(id: string, result: any, duration: number) {
    if (!this.enabled) return;
    
    this.logs.update(logs => {
      return logs.map(log => {
        if (log.id === id) {
          return {
            ...log,
            result: this.sanitizeResult(result),
            duration,
            status: 'success' as const
          };
        }
        return log;
      });
    });
  }
  
  logError(id: string, error: any, duration: number) {
    if (!this.enabled) return;
    
    this.logs.update(logs => {
      return logs.map(log => {
        if (log.id === id) {
          return {
            ...log,
            error: this.sanitizeError(error),
            duration,
            status: 'error' as const
          };
        }
        return log;
      });
    });
  }
  
  clear() {
    this.logs.set([]);
  }
  
  getLogs() {
    return this.logs;
  }
  
  private sanitizeParams(params: any): any {
    // Remove sensitive data or large arrays
    if (typeof params === 'object' && params !== null) {
      const sanitized = { ...params };
      
      // Truncate large arrays
      Object.keys(sanitized).forEach(key => {
        if (Array.isArray(sanitized[key]) && sanitized[key].length > 10) {
          sanitized[key] = [...sanitized[key].slice(0, 10), `... (${sanitized[key].length} items)`];
        }
      });
      
      return sanitized;
    }
    return params;
  }
  
  private sanitizeResult(result: any): any {
    // Similar to sanitizeParams but for results
    if (typeof result === 'object' && result !== null) {
      if (Array.isArray(result) && result.length > 20) {
        return [...result.slice(0, 20), `... (${result.length} items)`];
      }
      
      // Handle TreePayload with many nodes
      if (result.nodes && Array.isArray(result.nodes) && result.nodes.length > 20) {
        return {
          ...result,
          nodes: [...result.nodes.slice(0, 20), `... (${result.nodes.length} nodes)`]
        };
      }
    }
    return result;
  }
  
  private sanitizeError(error: any): any {
    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n')
      };
    }
    return error;
  }
}

export const bridgeLogger = BridgeLogger.getInstance();
export type { BridgeLogger };

// Derived stores for filtering
export const bridgeLogs = bridgeLogger.getLogs();
export const errorLogs = derived(bridgeLogs, $logs => 
  $logs.filter(log => log.status === 'error')
);
export const slowCommands = derived(bridgeLogs, $logs => 
  $logs.filter(log => log.duration && log.duration > 100)
);

// Wrap the API to add logging
export function wrapApiWithLogging(api: any): any {
  const wrapped: any = {};
  
  Object.keys(api).forEach(key => {
    const original = api[key];
    if (typeof original === 'function') {
      wrapped[key] = async (...args: any[]) => {
        const logId = bridgeLogger.logCommand(key, args);
        const startTime = performance.now();
        
        try {
          const result = await original(...args);
          const duration = performance.now() - startTime;
          bridgeLogger.logSuccess(logId, result, duration);
          return result;
        } catch (error) {
          const duration = performance.now() - startTime;
          bridgeLogger.logError(logId, error, duration);
          throw error;
        }
      };
    } else {
      wrapped[key] = original;
    }
  });
  
  return wrapped;
}