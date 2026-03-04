/**
 * LayerPropertiesManager - Central dispatcher for layer property panels
 * 
 * Routes to the appropriate panel based on layer type:
 * - VolumePanel for volume layers
 * - SurfacePanel for surface layers
 * - Vol2SurfPanel for surfaces with mapped volume data (future)
 * 
 * This implements the separate panels architecture based on expert consensus
 * to avoid conditional complexity and maintain clean separation of concerns.
 */

import React from 'react';
import { LayerControlsPanel } from './LayerControlsPanel';
import { VolumePanel } from './VolumePanel';
import { SurfacePanel } from './SurfacePanel';
import type { Layer, LayerRender } from '@/types/layers';
import type { VolumeMetadata } from '@/stores/layerStore';

/**
 * Extended layer type that includes dataType discriminator
 * In the future, this will come from the layer itself
 */
interface ExtendedLayer extends Layer {
  dataType?: 'volume' | 'surface';
  sourceVolumeId?: string; // For vol2surf layers
}

interface LayerPropertiesManagerProps {
  /**
   * The currently selected layer
   */
  selectedLayer?: ExtendedLayer | boolean;

  /**
   * Render properties for the selected layer
   */
  selectedRender?: LayerRender;

  /**
   * Metadata for the selected layer
   */
  selectedMetadata?: VolumeMetadata;

  /**
   * Callback when render properties are updated
   */
  onRenderUpdate: (updates: Partial<LayerRender>) => void;
}

/**
 * Bauhaus Empty State - Properties panel "Empty Slot" pattern
 * Quiet, structural void indicating where content belongs
 */
const EmptyState: React.FC<{ message?: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center p-6 select-none">
    {/* Dashed boundary - the "empty slot" */}
    <div
      className="w-full flex flex-col items-center justify-center py-8"
      style={{
        border: '1px dashed hsl(var(--muted-foreground) / 0.15)',
        backgroundColor: 'transparent',
        borderRadius: '1px'
      }}
    >
      {/* Geometric sliders icon - representing properties */}
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.75"
        strokeLinecap="square"
        strokeLinejoin="miter"
        className="text-muted-foreground/25 mb-3"
      >
        <line x1="4" y1="6" x2="20" y2="6" />
        <circle cx="8" cy="6" r="2" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <circle cx="14" cy="12" r="2" />
        <line x1="4" y1="18" x2="20" y2="18" />
        <circle cx="10" cy="18" r="2" />
      </svg>

      {/* Technical status */}
      <span className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-[0.2em]">
        {message || 'No Selection'}
      </span>
    </div>
  </div>
);

// VolumePanel is now imported from ./VolumePanel.tsx
// The actual implementation has been moved to a dedicated file

/**
 * Vol2Surf panel for surfaces with mapped volume data
 * This is a placeholder for future implementation
 */
const Vol2SurfPanel: React.FC<{
  layer: ExtendedLayer;
  render?: LayerRender;
  metadata?: VolumeMetadata;
  onRenderUpdate: (updates: Partial<LayerRender>) => void;
}> = ({ layer, render, metadata, onRenderUpdate }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Volume-on-Surface Properties</h3>
        <span className="text-xs text-muted-foreground">Vol2Surf</span>
      </div>
      <div className="text-sm text-muted-foreground mb-4">
        Source Volume: {layer.sourceVolumeId || 'Unknown'}
      </div>
      <LayerControlsPanel
        selectedLayer={!!layer}
        selectedRender={render}
        selectedMetadata={metadata}
        onRenderUpdate={onRenderUpdate}
      />
      <div className="pt-4 border-t">
        <button className="px-3 py-1 text-sm border rounded hover:bg-accent">
          Remap with Different Settings...
        </button>
      </div>
    </div>
  );
};

/**
 * LayerPropertiesManager - Routes to appropriate panel based on layer type
 * 
 * This is the central dispatcher that implements the architecture decision
 * to use separate panels for different layer types, avoiding conditional
 * complexity within a single monolithic panel.
 */
export const LayerPropertiesManager: React.FC<LayerPropertiesManagerProps> = ({
  selectedLayer,
  selectedRender,
  selectedMetadata,
  onRenderUpdate
}) => {
  // Handle no selection
  if (!selectedLayer) {
    return <EmptyState />;
  }
  
  // Handle boolean selectedLayer (backward compatibility)
  if (typeof selectedLayer === 'boolean') {
    if (!selectedLayer) {
      return <EmptyState />;
    }
    // Default to volume panel for backward compatibility
    return (
      <LayerControlsPanel
        selectedLayer={selectedLayer}
        selectedRender={selectedRender}
        selectedMetadata={selectedMetadata}
        onRenderUpdate={onRenderUpdate}
      />
    );
  }
  
  // Get the layer as ExtendedLayer
  const layer = selectedLayer as ExtendedLayer;
  
  // Determine layer type (default to volume for now)
  const dataType = layer.dataType || 'volume';
  
  // Dispatch to appropriate panel based on layer type
  switch (dataType) {
    case 'volume':
      return (
        <VolumePanel
          layer={layer}
          render={selectedRender}
          metadata={selectedMetadata}
          onRenderUpdate={onRenderUpdate}
        />
      );
      
    case 'surface':
      // Check if it's a vol2surf layer
      if (layer.sourceVolumeId) {
        return (
          <Vol2SurfPanel
            layer={layer}
            render={selectedRender}
            metadata={selectedMetadata}
            onRenderUpdate={onRenderUpdate}
          />
        );
      }
      
      // Pure surface panel (placeholder for now)
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Surface Properties</h3>
            <span className="text-xs text-muted-foreground">Mesh</span>
          </div>
          <SurfacePanel
            // For now, use example data
            geometry={{
              wireframe: false,
              smoothing: 0.5,
              baseOpacity: 1.0,
              lighting: {
                ambient: 0.3,
                diffuse: 0.7,
                specular: 0.2
              },
              baseColor: '#888888'
            }}
            dataLayers={[]}
          />
        </div>
      );
      
    default:
      console.warn(`Unknown layer type: ${dataType}`);
      return (
        <EmptyState message={`Unsupported layer type: ${dataType}`} />
      );
  }
};

/**
 * Export a version that maintains backward compatibility with LayerControlsPanel
 * This allows gradual migration from LayerControlsPanel to LayerPropertiesManager
 */
export const LayerControlsPanelCompat = LayerPropertiesManager;