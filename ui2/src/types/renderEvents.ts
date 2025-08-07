/**
 * Type-safe render event definitions for the Brainflow2 rendering system.
 * 
 * CRITICAL: These types document the two-path rendering architecture:
 * - Path 1: SliceView uses 'viewType' for single slice rendering
 * - Path 2: MosaicView uses 'tag' for grid cell rendering
 * 
 * Never mix tags and viewTypes in the same component!
 */

import type { ViewType } from './coordinates';

/**
 * Base render event data shared by all render events
 */
interface BaseRenderEvent {
  /** Timestamp when the event was emitted */
  timestamp?: number;
  /** Optional error information */
  error?: Error | { message: string };
}

/**
 * SliceView render event - uses viewType for filtering
 * Used by SliceView.tsx for single slice rendering
 */
export interface SliceViewRenderEvent extends BaseRenderEvent {
  /** The view type (axial, sagittal, coronal) - NEVER use with tag */
  viewType: ViewType;
  /** The rendered image bitmap */
  imageBitmap?: ImageBitmap;
  /** Never include tag in SliceView events */
  tag?: never;
}

/**
 * MosaicView render event - uses tag for filtering
 * Used by MosaicCell.tsx for grid cell rendering
 */
export interface MosaicViewRenderEvent extends BaseRenderEvent {
  /** Unique tag for this mosaic cell (e.g., 'mosaic-default-axial-96') */
  tag: string;
  /** The rendered image bitmap */
  imageBitmap?: ImageBitmap;
  /** Never include viewType in MosaicView events */
  viewType?: never;
}

/**
 * Combined render event type for EventBus
 * Components must check for either tag OR viewType, never both
 */
export type RenderEvent = SliceViewRenderEvent | MosaicViewRenderEvent;

/**
 * Type guard to check if event is for SliceView
 */
export function isSliceViewEvent(event: RenderEvent): event is SliceViewRenderEvent {
  return 'viewType' in event && event.viewType !== undefined && !('tag' in event);
}

/**
 * Type guard to check if event is for MosaicView
 */
export function isMosaicViewEvent(event: RenderEvent): event is MosaicViewRenderEvent {
  return 'tag' in event && event.tag !== undefined && !('viewType' in event);
}

/**
 * Render start event - signals rendering has begun
 */
export interface RenderStartEvent {
  /** For SliceView */
  viewType?: ViewType;
  /** For MosaicView */
  tag?: string;
  /** Optional message */
  message?: string;
}

/**
 * Render complete event - signals rendering has finished
 */
export interface RenderCompleteEvent extends RenderEvent {
  /** Rendering duration in milliseconds */
  duration?: number;
  /** Optional metadata about the render */
  metadata?: {
    width?: number;
    height?: number;
    sliceIndex?: number;
    volumeId?: string;
  };
}

/**
 * Render error event - signals rendering failed
 */
export interface RenderErrorEvent {
  /** For SliceView */
  viewType?: ViewType;
  /** For MosaicView */
  tag?: string;
  /** The error that occurred */
  error: Error | { message: string; stack?: string };
  /** Optional context about when the error occurred */
  context?: string;
}

/**
 * Crosshair render event - for crosshair updates
 */
export interface CrosshairRenderEvent {
  /** World coordinates [x, y, z] in mm */
  world_mm: [number, number, number];
  /** Whether crosshair is visible */
  visible: boolean;
  /** Which view triggered the update (optional) */
  source?: ViewType;
}

/**
 * Event names used in the EventBus
 */
export const RenderEventNames = {
  START: 'render.start',
  COMPLETE: 'render.complete',
  ERROR: 'render.error',
  CROSSHAIR_UPDATE: 'crosshair.update',
  CROSSHAIR_SETTINGS: 'crosshair.settings.updated',
} as const;

/**
 * Type for event name keys
 */
export type RenderEventName = typeof RenderEventNames[keyof typeof RenderEventNames];

/**
 * Helper to create a properly typed SliceView render event
 */
export function createSliceViewEvent(
  viewType: ViewType,
  imageBitmap?: ImageBitmap,
  error?: Error
): SliceViewRenderEvent {
  return {
    viewType,
    imageBitmap,
    error,
    timestamp: performance.now(),
  };
}

/**
 * Helper to create a properly typed MosaicView render event
 */
export function createMosaicViewEvent(
  tag: string,
  imageBitmap?: ImageBitmap,
  error?: Error
): MosaicViewRenderEvent {
  return {
    tag,
    imageBitmap,
    error,
    timestamp: performance.now(),
  };
}

/**
 * Debug helper to validate render events
 */
export function validateRenderEvent(event: any): string[] {
  const errors: string[] = [];
  
  if (event.tag && event.viewType) {
    errors.push('Event has both tag and viewType - this violates the two-path architecture');
  }
  
  if (!event.tag && !event.viewType) {
    errors.push('Event has neither tag nor viewType - cannot be routed');
  }
  
  if (event.tag && typeof event.tag !== 'string') {
    errors.push(`Tag must be a string, got ${typeof event.tag}`);
  }
  
  if (event.viewType && !['axial', 'sagittal', 'coronal'].includes(event.viewType)) {
    errors.push(`Invalid viewType: ${event.viewType}`);
  }
  
  if (event.imageBitmap && !(event.imageBitmap instanceof ImageBitmap)) {
    errors.push('imageBitmap is not an ImageBitmap instance');
  }
  
  return errors;
}

/**
 * Debug logger for render events
 */
export function logRenderEvent(eventName: string, event: any, source?: string): void {
  if (process.env.NODE_ENV === 'development') {
    const errors = validateRenderEvent(event);
    if (errors.length > 0) {
      console.error(`[RenderEvent] Invalid event '${eventName}' from ${source || 'unknown'}:`, errors);
    }
    
    console.log(`[RenderEvent] ${eventName}`, {
      source,
      tag: event.tag,
      viewType: event.viewType,
      hasImageBitmap: !!event.imageBitmap,
      timestamp: event.timestamp || performance.now(),
    });
  }
}