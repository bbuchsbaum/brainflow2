/**
 * LayerControlsPanel - Layer property editing panel for volumes
 * Now uses SharedControls for the common data layer controls
 * 
 * This component maintains backward compatibility while using
 * the new SharedControls component internally.
 */

import React from 'react';
import { SharedControls, type DataLayerRender, type DataLayerMetadata } from './SharedControls';
import type { LayerRender } from '@/types/layers';
import type { VolumeMetadata } from '@/stores/layerStore';

interface LayerControlsPanelProps {
  selectedLayer: boolean;
  selectedRender?: LayerRender;
  selectedMetadata?: VolumeMetadata;
  onRenderUpdate: (updates: Partial<LayerRender>) => void;
}

/**
 * LayerControlsPanel - Maintains backward compatibility while using SharedControls
 * 
 * This component acts as an adapter between the existing layer system
 * and the new SharedControls component.
 */
export const LayerControlsPanel: React.FC<LayerControlsPanelProps> = ({
  selectedLayer,
  selectedRender,
  selectedMetadata,
  onRenderUpdate
}) => {
  // Adapt LayerRender to DataLayerRender format for SharedControls
  const adaptedRender: DataLayerRender | undefined = selectedRender ? {
    intensity: selectedRender.intensity || [0, 10000],
    threshold: selectedRender.threshold || [0, 0],
    colormap: selectedRender.colormap || 'gray',
    opacity: selectedRender.opacity ?? 1
  } : undefined;
  
  // Adapt VolumeMetadata to DataLayerMetadata format
  const adaptedMetadata: DataLayerMetadata | undefined = selectedMetadata ? {
    dataRange: selectedMetadata.dataRange,
    dataType: selectedMetadata.dataType,
    units: selectedMetadata.units
  } : undefined;
  
  return (
    <SharedControls
      render={adaptedRender}
      metadata={adaptedMetadata}
      onRenderUpdate={onRenderUpdate}
      disabled={!selectedLayer || !selectedRender}
    />
  );
};