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
 * Compact interpolation mode selector
 */
const CompactInterpolationSelector: React.FC<{
  value: 'nearest' | 'linear';
  onChange: (value: 'nearest' | 'linear') => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  return (
    <div className="flex items-center justify-between">
      <label className="text-xs text-muted-foreground">
        Interpolation
      </label>
      <div className="flex gap-1">
        <button
          className={`px-2 py-0.5 text-xs border rounded transition-colors ${
            value === 'nearest'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background hover:bg-accent border-input'
          }`}
          onClick={() => onChange('nearest')}
          disabled={disabled}
          title="Blocky appearance, preserves exact values"
        >
          Nearest
        </button>
        <button
          className={`px-2 py-0.5 text-xs border rounded transition-colors ${
            value === 'linear'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background hover:bg-accent border-input'
          }`}
          onClick={() => onChange('linear')}
          disabled={disabled}
          title="Smooth appearance, interpolates between voxels"
        >
          Linear
        </button>
      </div>
    </div>
  );
};

/**
 * Compact toggle switch component
 */
const CompactToggle: React.FC<{
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  title?: string;
}> = ({ label, value, onChange, disabled, title }) => {
  return (
    <div className="flex items-center justify-between" title={title}>
      <label className="text-xs text-muted-foreground">
        {label}
      </label>
      <button
        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
          value
            ? 'bg-primary'
            : 'bg-input'
        }`}
        onClick={() => onChange(!value)}
        disabled={disabled}
        aria-pressed={value}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            value ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
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

  // Per-layer display settings state (future: move to layer state/metadata)
  const [showBorder, setShowBorder] = React.useState(false);
  const [showOrientationMarkers, setShowOrientationMarkers] = React.useState(true);
  const [showValueOnHover, setShowValueOnHover] = React.useState(true);

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

      {/* Display Settings - Compact */}
      <CollapsibleSection
        title="Display Settings"
        icon={<Settings className="w-4 h-4" />}
        defaultOpen={false}
      >
        <div className="space-y-2 pt-2">
          <CompactInterpolationSelector
            value={render?.interpolation || 'linear'}
            onChange={handleInterpolationChange}
            disabled={!render}
          />

          <CompactToggle
            label="Slice Border"
            value={showBorder}
            onChange={setShowBorder}
            disabled={!render}
            title="Show border around slice extent (useful for multi-volume viewing)"
          />

          <CompactToggle
            label="Orientation Markers"
            value={showOrientationMarkers}
            onChange={setShowOrientationMarkers}
            disabled={!render}
            title="Show L/R/A/P markers on slice views"
          />

          <CompactToggle
            label="Value on Hover"
            value={showValueOnHover}
            onChange={setShowValueOnHover}
            disabled={!render}
            title="Display voxel values when hovering over the slice"
          />

          {/* Future: Add slice thickness control here */}
          {/* Future: Add resampling quality here */}
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