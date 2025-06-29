/**
 * EventBus - Central event system for decoupled communication
 * Replaces direct store imports and circular dependencies
 */
export type EventHandler<T = any> = (payload: T) => void;

interface EventSubscription {
  unsubscribe: () => void;
}

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private eventLog: Array<{ event: string; payload: any; timestamp: number }> = [];
  private maxLogSize = 100;

  /**
   * Subscribe to an event
   */
  on<T = any>(event: string, handler: EventHandler<T>): EventSubscription {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    
    this.handlers.get(event)!.add(handler);
    
    return {
      unsubscribe: () => {
        const handlers = this.handlers.get(event);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) {
            this.handlers.delete(event);
          }
        }
      }
    };
  }

  /**
   * Subscribe to an event for only one emission
   */
  once<T = any>(event: string, handler: EventHandler<T>): EventSubscription {
    const wrappedHandler = (payload: T) => {
      handler(payload);
      subscription.unsubscribe();
    };
    
    const subscription = this.on(event, wrappedHandler);
    return subscription;
  }

  /**
   * Emit an event
   */
  emit<T = any>(event: string, payload: T): void {
    // Log event in development
    if (import.meta.env.DEV) {
      this.logEvent(event, payload);
    }
    
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Remove all handlers for an event
   */
  off(event: string): void {
    this.handlers.delete(event);
  }

  /**
   * Remove all event handlers
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Get event history (dev mode only)
   */
  getEventLog(): Array<{ event: string; payload: any; timestamp: number }> {
    return [...this.eventLog];
  }

  private logEvent(event: string, payload: any): void {
    this.eventLog.push({ event, payload, timestamp: Date.now() });
    
    // Keep log size manageable
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }
  }
}

// Singleton instance
let eventBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!eventBus) {
    eventBus = new EventBus();
  }
  return eventBus;
}