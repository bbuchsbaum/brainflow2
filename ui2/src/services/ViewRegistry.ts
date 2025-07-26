/**
 * ViewRegistry Service
 * Manages registration and creation of different workspace view types
 */

import type { LayoutConfig } from 'golden-layout';
import type { WorkspaceType, WorkspaceConfig } from '@/types/workspace';

/**
 * Factory interface for creating view layouts
 */
export interface ViewFactory {
  createLayout(config?: WorkspaceConfig): LayoutConfig;
  getDefaultConfig(): Partial<WorkspaceConfig>;
}

/**
 * Registry for managing view factories
 */
export class ViewRegistry {
  private static factories = new Map<WorkspaceType, ViewFactory>();
  
  /**
   * Register a view factory
   */
  static register(type: WorkspaceType, factory: ViewFactory) {
    this.factories.set(type, factory);
    console.log(`[ViewRegistry] Registered factory for ${type}`);
  }
  
  /**
   * Create a layout configuration for a workspace type
   */
  static createLayout(type: WorkspaceType, config?: WorkspaceConfig): LayoutConfig {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(`Unknown workspace type: ${type}. Did you forget to register it?`);
    }
    
    // Merge with default config
    const defaultConfig = factory.getDefaultConfig();
    const mergedConfig = { ...defaultConfig, ...config };
    
    return factory.createLayout(mergedConfig);
  }
  
  /**
   * Check if a workspace type is registered
   */
  static isRegistered(type: WorkspaceType): boolean {
    return this.factories.has(type);
  }
  
  /**
   * Get all registered workspace types
   */
  static getRegisteredTypes(): WorkspaceType[] {
    return Array.from(this.factories.keys());
  }
}

/**
 * Factory for orthogonal locked view
 */
export class OrthogonalLockedFactory implements ViewFactory {
  getDefaultConfig(): Partial<WorkspaceConfig> {
    return {};
  }
  
  createLayout(config?: WorkspaceConfig): LayoutConfig {
    return {
      root: {
        type: 'row',
        content: [
          {
            type: 'column',
            width: 15,
            content: [{
              type: 'component',
              componentType: 'FileBrowser',
              title: 'Files',
              componentState: {}
            }]
          },
          {
            type: 'component',
            componentType: 'OrthogonalView',
            title: 'Orthogonal Views',
            width: 65,
            componentState: {}
          },
          {
            type: 'column',
            width: 20,
            content: [
              {
                type: 'component',
                componentType: 'LayerPanel',
                title: 'Layers',
                height: 60,
                componentState: {}
              },
              {
                type: 'component',
                componentType: 'PlotPanel',
                title: 'Time Series',
                height: 40,
                componentState: {}
              }
            ]
          }
        ]
      }
    };
  }
}

/**
 * Factory for orthogonal flexible view
 */
export class OrthogonalFlexibleFactory implements ViewFactory {
  getDefaultConfig(): Partial<WorkspaceConfig> {
    return {};
  }
  
  createLayout(config?: WorkspaceConfig): LayoutConfig {
    return {
      root: {
        type: 'row',
        content: [
          {
            type: 'column',
            width: 15,
            content: [{
              type: 'component',
              componentType: 'FileBrowser',
              title: 'Files',
              componentState: {}
            }]
          },
          {
            type: 'column',
            width: 65,
            content: [
              {
                type: 'row',
                height: 50,
                content: [
                  {
                    type: 'component',
                    componentType: 'AxialView',
                    title: 'Axial',
                    componentState: { viewId: 'axial' }
                  }
                ]
              },
              {
                type: 'row',
                height: 50,
                content: [
                  {
                    type: 'component',
                    componentType: 'SagittalView',
                    title: 'Sagittal',
                    width: 50,
                    componentState: { viewId: 'sagittal' }
                  },
                  {
                    type: 'component',
                    componentType: 'CoronalView',
                    title: 'Coronal',
                    width: 50,
                    componentState: { viewId: 'coronal' }
                  }
                ]
              }
            ]
          },
          {
            type: 'column',
            width: 20,
            content: [
              {
                type: 'component',
                componentType: 'LayerPanel',
                title: 'Layers',
                height: 60,
                componentState: {}
              },
              {
                type: 'component',
                componentType: 'PlotPanel',
                title: 'Time Series',
                height: 40,
                componentState: {}
              }
            ]
          }
        ]
      }
    };
  }
}

/**
 * Factory for mosaic view
 */
export class MosaicViewFactory implements ViewFactory {
  getDefaultConfig(): Partial<WorkspaceConfig> {
    return {
      rows: 3,
      columns: 3,
      sliceOrientation: 'axial'
    };
  }
  
  createLayout(config?: WorkspaceConfig): LayoutConfig {
    const rows = config?.rows || 3;
    const columns = config?.columns || 3;
    const orientation = config?.sliceOrientation || 'axial';
    
    return {
      root: {
        type: 'row',
        content: [
          {
            type: 'column',
            width: 15,
            content: [{
              type: 'component',
              componentType: 'FileBrowser',
              title: 'Files',
              componentState: {}
            }]
          },
          {
            type: 'component',
            componentType: 'MosaicView',
            title: `Mosaic ${orientation.charAt(0).toUpperCase() + orientation.slice(1)} (${rows}×${columns})`,
            width: 65,
            componentState: {
              rows,
              columns,
              orientation
            }
          },
          {
            type: 'column',
            width: 20,
            content: [
              {
                type: 'component',
                componentType: 'LayerPanel',
                title: 'Layers',
                height: 60,
                componentState: {}
              },
              {
                type: 'component',
                componentType: 'PlotPanel',
                title: 'Time Series',
                height: 40,
                componentState: {}
              }
            ]
          }
        ]
      }
    };
  }
}

/**
 * Factory for lightbox view
 */
export class LightboxViewFactory implements ViewFactory {
  getDefaultConfig(): Partial<WorkspaceConfig> {
    return {
      sliceOrientation: 'axial',
      thumbnailSize: 128
    };
  }
  
  createLayout(config?: WorkspaceConfig): LayoutConfig {
    const orientation = config?.sliceOrientation || 'axial';
    const thumbnailSize = config?.thumbnailSize || 128;
    
    return {
      root: {
        type: 'row',
        content: [
          {
            type: 'column',
            width: 15,
            content: [{
              type: 'component',
              componentType: 'FileBrowser',
              title: 'Files',
              componentState: {}
            }]
          },
          {
            type: 'component',
            componentType: 'LightboxView',
            title: `Lightbox ${orientation.charAt(0).toUpperCase() + orientation.slice(1)}`,
            width: 65,
            componentState: {
              orientation,
              thumbnailSize
            }
          },
          {
            type: 'column',
            width: 20,
            content: [
              {
                type: 'component',
                componentType: 'LayerPanel',
                title: 'Layers',
                height: 60,
                componentState: {}
              },
              {
                type: 'component',
                componentType: 'PlotPanel',
                title: 'Time Series',
                height: 40,
                componentState: {}
              }
            ]
          }
        ]
      }
    };
  }
}

/**
 * Factory for ROI Stats workspace
 */
export class ROIStatsFactory implements ViewFactory {
  getDefaultConfig(): Partial<WorkspaceConfig> {
    return {};
  }
  
  createLayout(config?: WorkspaceConfig): LayoutConfig {
    return {
      root: {
        type: 'row',
        content: [
          {
            type: 'column',
            width: 15,
            content: [{
              type: 'component',
              componentType: 'FileBrowser',
              title: 'Files',
              componentState: {}
            }]
          },
          {
            type: 'component',
            componentType: 'ROIStatsWorkspace',
            title: 'ROI Statistics',
            width: 85,
            componentState: {}
          }
        ]
      }
    };
  }
}

/**
 * Factory for Coordinate Converter workspace
 */
export class CoordinateConverterFactory implements ViewFactory {
  getDefaultConfig(): Partial<WorkspaceConfig> {
    return {};
  }
  
  createLayout(config?: WorkspaceConfig): LayoutConfig {
    return {
      root: {
        type: 'component',
        componentType: 'CoordinateConverterWorkspace',
        title: 'Coordinate Converter',
        componentState: {}
      }
    };
  }
}

// Initialize the registry with all view types
export function initializeViewRegistry() {
  ViewRegistry.register('orthogonal-locked', new OrthogonalLockedFactory());
  ViewRegistry.register('orthogonal-flexible', new OrthogonalFlexibleFactory());
  ViewRegistry.register('mosaic', new MosaicViewFactory());
  ViewRegistry.register('lightbox', new LightboxViewFactory());
  ViewRegistry.register('roi-stats', new ROIStatsFactory());
  ViewRegistry.register('coordinate-converter', new CoordinateConverterFactory());
  
  console.log('[ViewRegistry] Initialized with all view factories');
}