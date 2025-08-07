/**
 * RenderContext - Unified interface for rendering operations
 * 
 * This replaces the confusing tag/viewType split with a single,
 * consistent interface that both SliceView and MosaicView can use.
 */

import type { ViewPlane } from './coordinates';

/**
 * Type of render context - helps with debugging and routing
 */
export type RenderContextType = 'slice' | 'mosaic-cell';

/**
 * Unified render context that works for both SliceView and MosaicView
 */
export interface RenderContext {
  /**
   * Identifier for this render context
   * For SliceView: 'axial', 'sagittal', or 'coronal'
   * For MosaicCell: 'mosaic-{workspace}-{axis}-{index}'
   */
  id: string;
  
  /**
   * Type of context for debugging and special handling
   */
  type: RenderContextType;
  
  /**
   * View plane for this render
   */
  viewPlane?: ViewPlane;
  
  /**
   * Dimensions of the render target
   */
  dimensions: {
    width: number;
    height: number;
  };
  
  /**
   * Optional metadata for debugging and special cases
   */
  metadata?: {
    // For slice views
    viewType?: 'axial' | 'sagittal' | 'coronal';
    
    // For mosaic cells
    sliceIndex?: number;
    workspaceId?: string;
    
    // Any other context-specific data
    [key: string]: any;
  };
}


/**
 * Factory functions to create render contexts
 */
export class RenderContextFactory {
  /**
   * Create a render context for a slice view
   */
  static createSliceContext(
    viewType: 'axial' | 'sagittal' | 'coronal',
    width: number,
    height: number,
    viewPlane?: ViewPlane
  ): RenderContext {
    return {
      id: viewType,  // Use viewType directly as ID
      type: 'slice',
      viewPlane,
      dimensions: { width, height },
      metadata: { viewType }
    };
  }
  
  /**
   * Create a render context for a mosaic cell
   */
  static createMosaicCellContext(
    workspaceId: string,
    axis: 'axial' | 'sagittal' | 'coronal',
    sliceIndex: number,
    width: number,
    height: number,
    viewPlane?: ViewPlane
  ): RenderContext {
    const id = `mosaic-${workspaceId}-${axis}-${sliceIndex}`;
    return {
      id,  // Use the tag directly as ID
      type: 'mosaic-cell',
      viewPlane,
      dimensions: { width, height },
      metadata: {
        workspaceId,
        viewType: axis,
        sliceIndex
      }
    };
  }
  
  /**
   * Extract viewType from context
   */
  static getViewType(context: RenderContext): string | undefined {
    return context.metadata?.viewType;
  }
}