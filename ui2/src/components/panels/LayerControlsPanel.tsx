/**
 * LayerControlsPanel - Extracted UI controls from LayerPanel
 * Focused component for layer property editing
 */

import React from 'react';
import { ProSlider } from '../ui/ProSlider';
import { SingleSlider } from '../ui/SingleSlider';
import { EnhancedColormapSelector } from './EnhancedColormapSelector';
import type { LayerRender } from '@/types/layers';
import type { VolumeMetadata } from '@/stores/layerStore';

interface LayerControlsPanelProps {
  selectedLayer: boolean;
  selectedRender?: LayerRender;
  selectedMetadata?: VolumeMetadata;
  onRenderUpdate: (updates: Partial<LayerRender>) => void;
}

export const LayerControlsPanel: React.FC<LayerControlsPanelProps> = ({
  selectedLayer,
  selectedRender,
  selectedMetadata,
  onRenderUpdate
}) => {
  const isDisabled = !selectedLayer || !selectedRender;
  
  return (
    <div className={`space-y-4 ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Intensity Window */}
      <ProSlider
        label="Intensity Window"
        min={selectedMetadata?.dataRange?.min ?? 0}
        max={selectedMetadata?.dataRange?.max ?? 10000}
        value={selectedRender?.intensity || [0, 10000]}
        onChange={(value) => onRenderUpdate({ intensity: value })}
        precision={0}
      />

      {/* Threshold */}
      <ProSlider
        label="Threshold"
        min={selectedMetadata?.dataRange?.min ?? 0}
        max={selectedMetadata?.dataRange?.max ?? 10000}
        value={selectedRender?.threshold || [0, 0]}
        onChange={(value) => onRenderUpdate({ threshold: value })}
        precision={0}
      />

      {/* Colormap */}
      <EnhancedColormapSelector
        value={selectedRender?.colormap || 'gray'}
        onChange={(colormap) => onRenderUpdate({ colormap })}
      />

      {/* Opacity */}
      <SingleSlider
        label="Opacity"
        min={0}
        max={1}
        value={selectedRender?.opacity || 1}
        onChange={(opacity) => onRenderUpdate({ opacity })}
        showPercentage={true}
        className="mb-0"
      />
    </div>
  );
};