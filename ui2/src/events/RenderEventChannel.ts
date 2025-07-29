/**
 * RenderEventChannel
 * 
 * Provides isolated event channels for render events, preventing cross-contamination
 * between different rendering contexts (e.g., SliceView vs MosaicView).
 * 
 * Each channel has a unique namespace to ensure events are properly isolated.
 */

import { getEventBus } from './EventBus';

export type RenderEventType = 'start' | 'complete' | 'error';

export interface RenderEvent {
  type: RenderEventType;
  imageBitmap?: ImageBitmap;
  error?: Error;
}

export class RenderEventChannel {
  private channelId: string;
  private eventBus = getEventBus();
  
  constructor(channelId: string) {
    this.channelId = channelId;
  }
  
  /**
   * Emit a render event on this channel
   */
  emit(type: RenderEventType, data: Omit<RenderEvent, 'type'> = {}) {
    const eventName = `render.${type}.${this.channelId}`;
    this.eventBus.emit(eventName, {
      type,
      ...data
    });
  }
  
  /**
   * Subscribe to render events on this channel
   */
  subscribe(type: RenderEventType, callback: (event: RenderEvent) => void) {
    const eventName = `render.${type}.${this.channelId}`;
    // Return unsubscribe function
    return this.eventBus.on(eventName, callback);
  }
  
  /**
   * Create a unique channel ID for a specific context
   */
  static forSliceView(viewType: 'axial' | 'sagittal' | 'coronal'): string {
    return `sliceview.${viewType}`;
  }
  
  static forMosaicCell(cellId: string): string {
    return `mosaic.${cellId}`;
  }
  
  static forLightbox(index: number): string {
    return `lightbox.${index}`;
  }
}

// Factory for creating render channels
export const createRenderChannel = (channelId: string) => new RenderEventChannel(channelId);