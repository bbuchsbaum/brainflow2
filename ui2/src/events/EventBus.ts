/**
 * Type-safe Event Bus for service communication
 * Enables decoupled communication between services
 */

import type { ViewType } from '@/types/viewState';
import type { Layer, LayerRender } from '@/types/layers';
import type { Annotation } from '@/types/annotations';
import type { CrosshairSettings } from '@/contexts/CrosshairContext';
import type { 
  RenderCompleteEvent, 
  RenderErrorEvent, 
  RenderStartEvent
} from '@/types/renderEvents';
import type { AtlasStats } from '@/types/atlas';

// Define all events in the system
export interface EventMap {
  // Crosshair events
  'crosshair.updated': { world_mm: [number, number, number] };
  'crosshair.clicked': { world_mm: [number, number, number]; button: number };
  'crosshair.visibility': { visible: boolean };
  'crosshair.settings.updated': CrosshairSettings;

  // Layer events  
  'layer.added': { layer: Layer };
  'layer.removed': { layerId: string };
  'layer.patched': { layerId: string; patch: Partial<LayerRender> };
  'layer.reordered': { layerIds: string[] };
  'layer.visibility': { layerId: string; visible: boolean };
  'layer.loading': { layerId: string; loading: boolean };
  'layer.error': { layerId: string; error: Error };
  'layer.metadata.updated': { layerId: string; metadata: any };
  'layer.updated': { layerId: string; updates?: Record<string, unknown> };
  'layer.render.changed': { layerId: string; renderProps: Record<string, unknown> };

  // Annotation events
  'annotation.added': { annotation: Annotation };
  'annotation.removed': { annotationId: string };
  'annotation.updated': { annotationId: string; annotation: Annotation };
  'annotation.selected': { annotationIds: string[] };
  'annotation.hover': { annotationId: string | null };

  // View events
  'view.resized': { viewType: ViewType; size: [number, number] };
  'view.mouse.enter': { viewType: ViewType };
  'view.mouse.leave': { viewType: ViewType };
  'view.plane.updated': { viewType: ViewType; plane: any };
  
  // Render events (using type-safe definitions)
  'render.complete': RenderCompleteEvent;
  'render.error': RenderErrorEvent;
  'render.start': RenderStartEvent;
  
  // Volume events
  'volume.loaded': { volumeId: string; metadata: any };
  'volume.unloaded': { volumeId: string };
  'volume.sample': { world_mm: [number, number, number]; value: number };
  'volume.load.complete': { volumeId: string; layerId: string; source: string; duration: number };
  'volume.load.error': { volumeId: string; source: string; error: Error };

  // File browser events
  'file.selected': { path: string };
  'file.loading': { path: string; filename?: string };
  'file.loaded': { path: string; volumeId: string };
  'file.error': { path: string; error: Error };
  'filebrowser.file.selected': { path: string };
  'filebrowser.file.doubleclick': { path: string };
  'filebrowser.directory.loaded': { path: string };

  // General UI events
  'ui.notification': {
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
    durationMs?: number;
  };
  'ui.progress': { taskId: string; progress: number; message?: string };

  // Services initialization events
  'services.initialized': { service: string };
  'services.error': { service?: string; error: string; fatal?: boolean };
  'services.allInitialized': { success: boolean };

  // Atlas events
  'atlas.metrics': { stats: AtlasStats; timestamp: number };
  'atlas.pressure': { 
    level: 'warning' | 'critical' | 'recovered';
    stats: AtlasStats;
    timestamp: number;
    reason: 'low-watermark' | 'full-event' | 'recovered' | 'evicted';
  };
  'atlas.eviction': {
    layerId: string | null;
    stats: AtlasStats | null;
    timestamp: number;
    reason: 'auto' | 'manual';
    message?: string;
  };

  // Time navigation events
  'time.changed': {
    timepoint: number;
    timeInfo?: {
      currentTimepoint: number;
      totalTimepoints: number;
      tr: number | null;
      currentTime: number;
      totalTime: number;
    };
  };
  'navigation.modeChanged': { mode: 'time' | 'slice' };
  'playback.toggle': {};
  'playback.stateChanged': { playing: boolean };

  // Surface events
  'surface.loading': { path: string; filename: string };
  'surface.loaded': { path: string; filename: string; handle: string };
  'surface.load.error': { path: string; filename: string; error: string };
  'surface.template.loading': { space: string; geometry_type: string; hemisphere: string };
  'surface.template.loaded': {
    handle: string;
    space: string;
    geometry_type: string;
    hemisphere: string;
    vertexCount: number;
    faceCount: number;
  };
  'surface.template.error': {
    space: string;
    geometry_type: string;
    hemisphere: string;
    error: string;
  };
  'surface.overlayApplied': {
    surfaceId: string;
    layerId: string;
    dataHandle?: string;
    colormap?: string;
    range?: [number, number];
    opacity?: number;
  };
  'surface.dataLayerAdded': { surfaceId: string; layerId: string };
  'surface.dataLayerUpdated': {
    surfaceId: string;
    layerId: string;
    updates: Record<string, unknown>;
  };
  'surface.dataLayerRemoved': { surfaceId: string; layerId: string };

  // Projection events
  'projection:start': { volumeId: string; surfaceId: string };
  'projection:complete': { volumeId: string; surfaceId: string; result: unknown };
  'projection:error': { volumeId: string; surfaceId: string; error: unknown };
  
  // Progress events from backend
  'progress.start': { 
    taskId: string; 
    type: 'file-load' | 'computation' | 'export' | 'rendering' | 'generic';
    title: string;
    message?: string;
    cancellable?: boolean;
  };
  'progress.update': { 
    taskId: string; 
    progress: number; // 0-100 or -1 for indeterminate
    message?: string;
  };
  'progress.complete': { 
    taskId: string;
    message?: string;
  };
  'progress.error': { 
    taskId: string;
    error: string;
  };
  'progress.cancel': {
    taskId: string;
  };
  
  // Mouse coordinate events
  'mouse.worldCoordinate': { world_mm: [number, number, number]; viewType: ViewType };
  'mouse.leave': { viewType: ViewType };
  
  // Performance events
  'render.fps': { fps: number };
  'gpu.status': { status: string };
}

type EventHandler<T> = (data: T) => void;
type WildcardHandler = (event: keyof EventMap, data: any) => void;

export class EventBus {
  private handlers = new Map<keyof EventMap, Set<EventHandler<any>>>();
  private wildcardHandlers = new Set<WildcardHandler>();
  private eventHistory: Array<{ event: keyof EventMap; data: any; timestamp: number }> = [];
  private maxHistorySize = 100;
  private isDebugMode = import.meta.env.DEV;

  /**
   * Emit an event with type-safe data
   */
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    // Record in history if debug mode
    if (this.isDebugMode) {
      this.eventHistory.push({ event, data, timestamp: Date.now() });
      if (this.eventHistory.length > this.maxHistorySize) {
        this.eventHistory.shift();
      }
    }

    // Call specific handlers
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }

    // Call wildcard handlers
    this.wildcardHandlers.forEach(handler => {
      try {
        handler(event, data);
      } catch (error) {
        console.error(`Error in wildcard handler for ${event}:`, error);
      }
    });
  }

  /**
   * Subscribe to an event
   * Returns unsubscribe function
   */
  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    
    const handlers = this.handlers.get(event)!;
    handlers.add(handler);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(event);
      }
    };
  }

  /**
   * Subscribe to an event for one emission only
   */
  once<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    const wrappedHandler = (data: EventMap[K]) => {
      handler(data);
      unsubscribe();
    };
    
    const unsubscribe = this.on(event, wrappedHandler);
    return unsubscribe;
  }

  /**
   * Subscribe to all events (useful for debugging)
   */
  onAny(handler: WildcardHandler): () => void {
    this.wildcardHandlers.add(handler);
    return () => {
      this.wildcardHandlers.delete(handler);
    };
  }

  off<K extends keyof EventMap>(event: K, handler?: EventHandler<EventMap[K]>): void;
  off(event?: keyof EventMap): void;
  /**
   * Remove handlers. If only event is provided, all handlers for that event are removed.
   * If event and handler are provided, only that specific handler is removed.
   * If no args are provided, all handlers are cleared.
   */
  off(event?: keyof EventMap, handler?: EventHandler<any>): void {
    if (!event) {
      this.handlers.clear();
      this.wildcardHandlers.clear();
      return;
    }

    if (!handler) {
      this.handlers.delete(event);
      return;
    }

    const handlers = this.handlers.get(event);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);
    if (handlers.size === 0) {
      this.handlers.delete(event);
    }
  }

  /**
   * Get event history (debug mode only)
   */
  getHistory(): ReadonlyArray<{ event: keyof EventMap; data: any; timestamp: number }> {
    return this.eventHistory;
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get handler counts for debugging
   */
  getHandlerCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    this.handlers.forEach((handlers, event) => {
      counts[event] = handlers.size;
    });
    counts['*'] = this.wildcardHandlers.size;
    return counts;
  }

  /**
   * Get the number of listeners for a specific event
   */
  listenerCount(event: keyof EventMap): number {
    const handlers = this.handlers.get(event);
    return handlers ? handlers.size : 0;
  }
}

// Global event bus instance
let globalEventBus: EventBus | null = null;

/**
 * Get the global event bus instance
 */
export function getEventBus(): EventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBus();
    
    // Debug logging in development
    if (import.meta.env.DEV) {
      globalEventBus.onAny((event, data) => {
        console.debug(`[EventBus] ${event}`, data);
      });
    }
  }
  return globalEventBus;
}

/**
 * React hook for event bus
 */
import { useEffect } from 'react';

export function useEvent<K extends keyof EventMap>(
  event: K,
  handler: EventHandler<EventMap[K]>
): void {
  useEffect(() => {
    const eventBus = getEventBus();
    return eventBus.on(event, handler);
  }, [event, handler]);
}

/**
 * Type-safe emit helper
 * Provides compile-time type checking for event names and payloads
 * This is a thin wrapper that adds no runtime overhead
 * 
 * @example
 * ```typescript
 * // Instead of: eventBus.emit('render.complete', data)
 * // Use: emitTyped('render.complete', { viewType: 'axial', imageBitmap })
 * ```
 */
export function emitTyped<K extends keyof EventMap>(
  event: K,
  data: EventMap[K]
): void {
  getEventBus().emit(event, data);
}
