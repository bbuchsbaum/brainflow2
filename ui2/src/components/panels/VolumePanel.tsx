/**
 * VolumePanel - Volume-specific property controls
 * 
 * This panel contains all controls specific to volume layers,
 * using SharedControls for common data layer properties.
 * 
 * Part of the separate panels architecture for different layer types.
 */

import React from 'react';
import { SharedControls, type DataLayerRender, type DataLayerMetadata } from './SharedControls';
import type { Layer, LayerRender } from '@/types/layers';
import type { VolumeMetadata } from '@/stores/layerStore';
import { ChevronDown, ChevronRight, Layers, Settings } from 'lucide-react';

interface VolumePanelProps {
  /**
   * The volume layer being edited
   */
  layer: Layer;
  
  /**
   * Current render properties
   */
  render?: LayerRender;
  
  /**
   * Volume metadata (data range, etc.)
   */
  metadata?: VolumeMetadata;
  
  /**
   * Callback when render properties change
   */
  onRenderUpdate: (updates: Partial<LayerRender>) => void;
}

/**
 * Interpolation mode selector component
 */
const InterpolationSelector: React.FC<{
  value: 'nearest' | 'linear';
  onChange: (value: 'nearest' | 'linear') => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">
        Interpolation Mode
      </label>
      <div className="flex gap-2">
        <button
          className={`flex-1 px-3 py-1.5 text-xs border rounded transition-colors ${
            value === 'nearest'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background hover:bg-accent border-input'
          }`}
          onClick={() => onChange('nearest')}
          disabled={disabled}
        >
          Nearest
        </button>
        <button
          className={`flex-1 px-3 py-1.5 text-xs border rounded transition-colors ${
            value === 'linear'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background hover:bg-accent border-input'
          }`}
          onClick={() => onChange('linear')}
          disabled={disabled}
        >
          Linear
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {value === 'nearest' 
          ? 'Blocky appearance, preserves exact values'
          : 'Smooth appearance, interpolates between voxels'}
      </p>
    </div>
  );
};

/**
 * Collapsible section component
 */
const CollapsibleSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = true, children }) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  
  return (
    <div className="border rounded-lg">
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-accent/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{title}</span>
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>
      {isOpen && (
        <div className="px-3 pb-3">
          {children}
        </div>
      )}
    </div>
  );
};

/**
 * VolumePanel - Main component for volume layer controls
 */
export const VolumePanel: React.FC<VolumePanelProps> = ({
  layer,
  render,
  metadata,
  onRenderUpdate
}) => {
  // Adapt LayerRender to DataLayerRender for SharedControls
  const adaptedRender: DataLayerRender | undefined = render ? {
    intensity: render.intensity || [0, 10000],
    threshold: render.threshold || [0, 0],
    colormap: render.colormap || 'gray',
    opacity: render.opacity ?? 1
  } : undefined;
  
  // Adapt metadata
  const adaptedMetadata: DataLayerMetadata | undefined = metadata ? {
    dataRange: metadata.dataRange,
    dataType: metadata.dataType,
    units: metadata.units
  } : undefined;
  
  // Handle interpolation change
  const handleInterpolationChange = (interpolation: 'nearest' | 'linear') => {
    onRenderUpdate({ interpolation });
  };
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Layers className="w-4 h-4" />
          Volume Properties
        </h3>
        <span className="text-xs text-muted-foreground px-2 py-1 bg-accent rounded">
          {layer.type || 'volume'}
        </span>
      </div>
      
      {/* Volume Info */}
      <div className="text-xs text-muted-foreground space-y-1 p-2 bg-accent/30 rounded">
        <div className="flex justify-between">
          <span>Layer:</span>
          <span className="font-medium">{layer.name}</span>
        </div>
        {metadata?.dimensions && (
          <div className="flex justify-between">
            <span>Dimensions:</span>
            <span className="font-mono">{metadata.dimensions.join(' × ')}</span>
          </div>
        )}
        {metadata?.spacing && (
          <div className="flex justify-between">
            <span>Voxel Size:</span>
            <span className="font-mono">
              {metadata.spacing.map(s => s.toFixed(2)).join(' × ')} mm
            </span>
          </div>
        )}
      </div>
      
      {/* Volume-Specific Settings */}
      <CollapsibleSection 
        title="Volume Settings" 
        icon={<Settings className="w-4 h-4" />}
        defaultOpen={true}
      >
        <div className="space-y-4 pt-2">
          <InterpolationSelector
            value={render?.interpolation || 'linear'}
            onChange={handleInterpolationChange}
            disabled={!render}
          />
          
          {/* Future: Add slice thickness control here */}
          {/* Future: Add resampling options here */}
        </div>
      </CollapsibleSection>
      
      {/* Data Layer Controls (Common) */}
      <CollapsibleSection 
        title="Data Mapping" 
        icon={<Layers className="w-4 h-4" />}
        defaultOpen={true}
      >
        <div className="pt-2">
          <SharedControls
            render={adaptedRender}
            metadata={adaptedMetadata}
            onRenderUpdate={onRenderUpdate}
            disabled={!layer || !render}
          />
        </div>
      </CollapsibleSection>
      
      {/* Advanced Settings (collapsed by default) */}
      <CollapsibleSection 
        title="Advanced" 
        icon={<Settings className="w-4 h-4" />}
        defaultOpen={false}
      >
        <div className="space-y-2 pt-2 text-xs text-muted-foreground">
          <p>Advanced volume settings coming soon:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Slice thickness adjustment</li>
            <li>Resampling resolution</li>
            <li>Coordinate system override</li>
            <li>Memory optimization options</li>
          </ul>
        </div>
      </CollapsibleSection>
    </div>
  );
};

/**
 * Export a compatibility version that matches LayerControlsPanel interface
 * This allows gradual migration from LayerControlsPanel
 */
export const VolumePanelCompat: React.FC<{
  selectedLayer: boolean;
  selectedRender?: LayerRender;
  selectedMetadata?: VolumeMetadata;
  onRenderUpdate: (updates: Partial<LayerRender>) => void;
}> = ({ selectedLayer, selectedRender, selectedMetadata, onRenderUpdate }) => {
  if (!selectedLayer) {
    return null;
  }
  
  // Create a minimal layer object for compatibility
  const layer: Layer = {
    id: 'compat-layer',
    name: 'Volume Layer',
    volumeId: '',
    type: 'anatomical',
    visible: true,
    order: 0
  };
  
  return (
    <VolumePanel
      layer={layer}
      render={selectedRender}
      metadata={selectedMetadata}
      onRenderUpdate={onRenderUpdate}
    />
  );
};