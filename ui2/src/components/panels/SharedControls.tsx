/**
 * SharedControls - Reusable controls for any data layer (volume or surface)
 * 
 * These controls work identically for:
 * - Volume layers (all layers in volume visualization)
 * - Surface data layers (layers 1+ in surface visualization, NOT the geometry)
 * 
 * Includes: Intensity Window, Threshold, Colormap, and Opacity
 */

import React from 'react';
import { ProSlider } from '../ui/ProSlider';
import { SingleSlider } from '../ui/SingleSlider';
import { EnhancedColormapSelector } from './EnhancedColormapSelector';

/**
 * Common render properties for any data layer
 */
export interface DataLayerRender {
  intensity: [number, number];  // [min, max] intensity window
  threshold: [number, number];  // [low, high] threshold values
  colormap: string;             // colormap name
  opacity: number;              // 0-1 opacity value
}

/**
 * Metadata about the data (range, type, etc.)
 */
export interface DataLayerMetadata {
  dataRange?: {
    min: number;
    max: number;
  };
  dataType?: string;
  units?: string;
}

export interface SharedControlsProps {
  /**
   * The current render settings for the layer
   */
  render?: DataLayerRender;
  
  /**
   * Metadata about the layer's data (for setting slider ranges)
   */
  metadata?: DataLayerMetadata;
  
  /**
   * Callback when any render property changes
   */
  onRenderUpdate: (updates: Partial<DataLayerRender>) => void;
  
  /**
   * Whether the controls should be disabled
   */
  disabled?: boolean;
  
  /**
   * Optional class name for styling
   */
  className?: string;
  
  /**
   * Optional labels for customization (e.g., "Curvature Range" instead of "Intensity Window")
   */
  labels?: {
    intensity?: string;
    threshold?: string;
    colormap?: string;
    opacity?: string;
  };
}

/**
 * SharedControls component - Controls that work for any data layer
 * 
 * Usage:
 * - In VolumePanel: For all volume layers
 * - In SurfacePanel: For data layers (NOT the geometry controls)
 * - In Vol2SurfPanel: For the mapped data
 */
export const SharedControls: React.FC<SharedControlsProps> = ({
  render,
  metadata,
  onRenderUpdate,
  disabled = false,
  className = '',
  labels = {}
}) => {
  // Determine if controls should be disabled (no render data or explicitly disabled)
  const isDisabled = disabled || !render;
  
  // Use provided labels or defaults
  const controlLabels = {
    intensity: labels.intensity || 'Intensity Window',
    threshold: labels.threshold || 'Threshold',
    colormap: labels.colormap || 'Colormap',
    opacity: labels.opacity || 'Opacity'
  };
  
  // Determine data range for sliders
  const dataMin = metadata?.dataRange?.min ?? 0;
  const dataMax = metadata?.dataRange?.max ?? 10000;
  
  return (
    <div className={`space-y-4 ${isDisabled ? 'opacity-50 pointer-events-none' : ''} ${className}`}>
      {/* Intensity Window - Maps data values to display range */}
      <ProSlider
        label={controlLabels.intensity}
        min={dataMin}
        max={dataMax}
        value={render?.intensity || [dataMin, dataMax]}
        onChange={(value) => onRenderUpdate({ intensity: value })}
        precision={0}
        disabled={isDisabled}
      />

      {/* Threshold - Filters data visibility */}
      <ProSlider
        label={controlLabels.threshold}
        min={dataMin}
        max={dataMax}
        value={render?.threshold || [dataMin, dataMin]}
        onChange={(value) => onRenderUpdate({ threshold: value })}
        precision={0}
        disabled={isDisabled}
      />

      {/* Colormap - Maps values to colors */}
      <EnhancedColormapSelector
        value={render?.colormap || 'gray'}
        onChange={(colormap) => onRenderUpdate({ colormap })}
        disabled={isDisabled}
      />

      {/* Opacity - Layer transparency */}
      <SingleSlider
        label={controlLabels.opacity}
        min={0}
        max={1}
        value={render?.opacity ?? 1}
        onChange={(opacity) => onRenderUpdate({ opacity })}
        showPercentage={true}
        disabled={isDisabled}
        className="mb-0"
      />
    </div>
  );
};

/**
 * Helper hook to adapt existing layer data to SharedControls format
 */
export function useSharedControlsAdapter(
  layer: any,
  metadata: any,
  onUpdate: (updates: any) => void
): SharedControlsProps {
  // Adapt the layer's render properties to DataLayerRender format
  const render: DataLayerRender | undefined = layer ? {
    intensity: layer.intensity || layer.render?.intensity || [0, 10000],
    threshold: layer.threshold || layer.render?.threshold || [0, 0],
    colormap: layer.colormap || layer.render?.colormap || 'gray',
    opacity: layer.opacity ?? layer.render?.opacity ?? 1
  } : undefined;
  
  // Adapt metadata to DataLayerMetadata format
  const adaptedMetadata: DataLayerMetadata | undefined = metadata ? {
    dataRange: metadata.dataRange,
    dataType: metadata.dataType,
    units: metadata.units
  } : undefined;
  
  return {
    render,
    metadata: adaptedMetadata,
    onRenderUpdate: onUpdate
  };
}