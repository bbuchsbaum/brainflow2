/**
 * Debug utilities for the render event system
 * 
 * Enable with: localStorage.setItem('debug:renderEvents', 'true')
 * Disable with: localStorage.removeItem('debug:renderEvents')
 */

import { getEventBus } from '@/events/EventBus';
import type { RenderEvent } from '@/types/renderEvents';
import { validateRenderEvent, isSliceViewEvent, isMosaicViewEvent } from '@/types/renderEvents';

interface RenderEventStats {
  totalEvents: number;
  sliceViewEvents: number;
  mosaicViewEvents: number;
  invalidEvents: number;
  errorEvents: number;
  byViewType: Record<string, number>;
  byTag: Record<string, number>;
  lastEvent?: {
    type: string;
    timestamp: number;
    data: any;
  };
}

class RenderDebugger {
  private enabled: boolean = false;
  private stats: RenderEventStats = {
    totalEvents: 0,
    sliceViewEvents: 0,
    mosaicViewEvents: 0,
    invalidEvents: 0,
    errorEvents: 0,
    byViewType: {},
    byTag: {},
  };
  private eventLog: Array<{ type: string; data: any; timestamp: number; errors?: string[] }> = [];
  private maxLogSize = 100;
  private unsubscribers: Array<() => void> = [];

  constructor() {
    // Check if debug mode is enabled in localStorage
    this.enabled = localStorage.getItem('debug:renderEvents') === 'true';
    
    if (this.enabled) {
      this.start();
    }
  }

  /**
   * Start debugging render events
   */
  start(): void {
    if (this.unsubscribers.length > 0) {
      console.warn('[RenderDebugger] Already started');
      return;
    }

    console.log('[RenderDebugger] Starting render event debugging');
    
    const eventBus = getEventBus();
    
    // Subscribe to render.complete events
    this.unsubscribers.push(
      eventBus.on('render.complete', (event) => {
        this.handleRenderEvent('render.complete', event);
      })
    );
    
    // Subscribe to render.start events
    this.unsubscribers.push(
      eventBus.on('render.start', (event) => {
        this.handleRenderEvent('render.start', event);
      })
    );
    
    // Subscribe to render.error events
    this.unsubscribers.push(
      eventBus.on('render.error', (event) => {
        this.handleRenderEvent('render.error', event);
        this.stats.errorEvents++;
      })
    );
    
    this.enabled = true;
    localStorage.setItem('debug:renderEvents', 'true');
  }

  /**
   * Stop debugging render events
   */
  stop(): void {
    console.log('[RenderDebugger] Stopping render event debugging');
    
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
    
    this.enabled = false;
    localStorage.removeItem('debug:renderEvents');
  }

  /**
   * Handle a render event
   */
  private handleRenderEvent(type: string, event: any): void {
    const errors = validateRenderEvent(event);
    const timestamp = performance.now();
    
    // Update stats
    this.stats.totalEvents++;
    
    if (errors.length > 0) {
      this.stats.invalidEvents++;
      console.error(`[RenderDebugger] Invalid ${type} event:`, errors, event);
    }
    
    if (isSliceViewEvent(event as RenderEvent)) {
      this.stats.sliceViewEvents++;
      this.stats.byViewType[event.viewType] = (this.stats.byViewType[event.viewType] || 0) + 1;
      console.log(`[RenderDebugger] SliceView ${type}:`, {
        viewType: event.viewType,
        hasImageBitmap: !!event.imageBitmap,
        timestamp,
      });
    } else if (isMosaicViewEvent(event as RenderEvent)) {
      this.stats.mosaicViewEvents++;
      this.stats.byTag[event.tag] = (this.stats.byTag[event.tag] || 0) + 1;
      console.log(`[RenderDebugger] MosaicView ${type}:`, {
        tag: event.tag,
        hasImageBitmap: !!event.imageBitmap,
        timestamp,
      });
    } else if (errors.length === 0) {
      console.warn(`[RenderDebugger] Unknown event type for ${type}:`, event);
    }
    
    // Update last event
    this.stats.lastEvent = {
      type,
      timestamp,
      data: event,
    };
    
    // Log event
    this.eventLog.push({
      type,
      data: event,
      timestamp,
      errors: errors.length > 0 ? errors : undefined,
    });
    
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }
  }

  /**
   * Get current stats
   */
  getStats(): RenderEventStats {
    return { ...this.stats };
  }

  /**
   * Get event log
   */
  getEventLog(): typeof this.eventLog {
    return [...this.eventLog];
  }

  /**
   * Clear stats and log
   */
  clear(): void {
    this.stats = {
      totalEvents: 0,
      sliceViewEvents: 0,
      mosaicViewEvents: 0,
      invalidEvents: 0,
      errorEvents: 0,
      byViewType: {},
      byTag: {},
    };
    this.eventLog = [];
    console.log('[RenderDebugger] Cleared stats and log');
  }

  /**
   * Print a summary to console
   */
  printSummary(): void {
    console.group('[RenderDebugger] Summary');
    console.table({
      'Total Events': this.stats.totalEvents,
      'SliceView Events': this.stats.sliceViewEvents,
      'MosaicView Events': this.stats.mosaicViewEvents,
      'Invalid Events': this.stats.invalidEvents,
      'Error Events': this.stats.errorEvents,
    });
    
    if (Object.keys(this.stats.byViewType).length > 0) {
      console.group('By ViewType:');
      console.table(this.stats.byViewType);
      console.groupEnd();
    }
    
    if (Object.keys(this.stats.byTag).length > 0) {
      console.group('By Tag:');
      console.table(this.stats.byTag);
      console.groupEnd();
    }
    
    if (this.stats.lastEvent) {
      console.group('Last Event:');
      console.log(this.stats.lastEvent);
      console.groupEnd();
    }
    
    console.groupEnd();
  }

  /**
   * Check if debugging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Create singleton instance
let debuggerInstance: RenderDebugger | null = null;

/**
 * Get the render debugger instance
 */
export function getRenderDebugger(): RenderDebugger {
  if (!debuggerInstance) {
    debuggerInstance = new RenderDebugger();
    
    // Attach to window for console access
    if (typeof window !== 'undefined') {
      (window as any).renderDebugger = debuggerInstance;
    }
  }
  return debuggerInstance;
}

/**
 * Quick start debugging from console
 * Usage: startRenderDebug()
 */
export function startRenderDebug(): void {
  const dbg = getRenderDebugger();
  dbg.start();
  console.log('Render debugging started. Use window.renderDebugger to access the debugger.');
  console.log('Commands:');
  console.log('  window.renderDebugger.printSummary() - Show stats');
  console.log('  window.renderDebugger.getEventLog() - Get event history');
  console.log('  window.renderDebugger.clear() - Clear stats');
  console.log('  window.renderDebugger.stop() - Stop debugging');
}

/**
 * Quick stop debugging from console
 */
export function stopRenderDebug(): void {
  const dbg = getRenderDebugger();
  dbg.stop();
  console.log('Render debugging stopped.');
}

// Auto-initialize if enabled
if (typeof window !== 'undefined') {
  // Create debugger instance (will auto-start if enabled in localStorage)
  getRenderDebugger();
  
  // Attach convenience functions to window
  (window as any).startRenderDebug = startRenderDebug;
  (window as any).stopRenderDebug = stopRenderDebug;
}
