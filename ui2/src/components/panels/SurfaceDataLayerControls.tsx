/**
 * Surface Data Layer Controls
 * Controls for surface data overlays (statistical maps, activation maps, etc.)
 * Similar to volume layer controls but adapted for surface data
 */

import React from 'react';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { Slider } from '@/components/ui/shadcn/slider';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { 
  Palette, 
  Sliders, 
  Filter,
  BarChart3,
  Eye
} from 'lucide-react';

interface SurfaceDataLayerControlsProps {
  surfaceId: string;
  layerId: string;
}

export const SurfaceDataLayerControls: React.FC<SurfaceDataLayerControlsProps> = ({
  surfaceId,
  layerId,
}) => {
  const { surfaces, updateLayerProperty } = useSurfaceStore();
  
  const surface = surfaces.get(surfaceId);
  const layer = surface?.layers.get(layerId);
  
  if (!surface || !layer) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No data layer selected
      </div>
    );
  }

  const updateProperty = (property: string, value: any) => {
    updateLayerProperty(surfaceId, layerId, property, value);
  };

  // Available colormaps
  const colormaps = [
    'viridis',
    'plasma',
    'inferno',
    'magma',
    'hot',
    'cool',
    'rainbow',
    'jet',
    'turbo',
    'gray',
    'red-blue',
    'red-yellow',
    'blue-green',
  ];

  return (
    <div className="p-4 space-y-2">
      {/* Layer Info */}
      <div className="pb-2 border-b">
        <div className="text-sm font-medium">{layer.name}</div>
        <div className="text-xs text-muted-foreground mt-1">
          Range: {layer.range[0].toFixed(2)} to {layer.range[1].toFixed(2)}
        </div>
      </div>

      {/* Display Controls Section */}
      <CollapsibleSection 
        title="Display" 
        icon={Eye} 
        defaultExpanded={true}
      >
        <div className="space-y-3">
          {/* Colormap Selection */}
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-2">
              <Palette className="h-3 w-3" />
              Colormap
            </Label>
            <Select
              value={layer.colormap}
              onValueChange={(value) => updateProperty('colormap', value)}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {colormaps.map((cmap) => (
                  <SelectItem key={cmap} value={cmap}>
                    {cmap}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Intensity Range */}
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-2">
              <Sliders className="h-3 w-3" />
              Intensity Range
            </Label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={layer.range[0]}
                  onChange={(e) => updateProperty('range', [parseFloat(e.target.value), layer.range[1]])}
                  className="w-20 h-7 px-2 text-xs border rounded"
                  step="0.01"
                />
                <Slider
                  value={layer.range}
                  onValueChange={(value) => updateProperty('range', value)}
                  min={Math.min(layer.range[0] - 1, -10)}
                  max={Math.max(layer.range[1] + 1, 10)}
                  step={0.01}
                  className="flex-1"
                  multiple
                />
                <input
                  type="number"
                  value={layer.range[1]}
                  onChange={(e) => updateProperty('range', [layer.range[0], parseFloat(e.target.value)])}
                  className="w-20 h-7 px-2 text-xs border rounded"
                  step="0.01"
                />
              </div>
            </div>
          </div>

          {/* Threshold Range */}
          {layer.threshold && (
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-2">
                <Filter className="h-3 w-3" />
                Threshold
              </Label>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={layer.threshold[0]}
                    onChange={(e) => updateProperty('threshold', [parseFloat(e.target.value), layer.threshold![1]])}
                    className="w-20 h-7 px-2 text-xs border rounded"
                    step="0.01"
                  />
                  <Slider
                    value={layer.threshold}
                    onValueChange={(value) => updateProperty('threshold', value)}
                    min={layer.range[0]}
                    max={layer.range[1]}
                    step={0.01}
                    className="flex-1"
                    multiple
                  />
                  <input
                    type="number"
                    value={layer.threshold[1]}
                    onChange={(e) => updateProperty('threshold', [layer.threshold![0], parseFloat(e.target.value)])}
                    className="w-20 h-7 px-2 text-xs border rounded"
                    step="0.01"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Opacity */}
          <div className="space-y-1">
            <Label className="text-xs">Opacity</Label>
            <Slider
              value={[layer.opacity]}
              onValueChange={([value]) => updateProperty('opacity', value)}
              min={0}
              max={1}
              step={0.01}
              className="w-full"
            />
            <div className="text-xs text-muted-foreground text-right">
              {(layer.opacity * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Statistical Controls Section */}
      <CollapsibleSection 
        title="Statistical" 
        icon={BarChart3} 
        defaultExpanded={false}
      >
        <div className="space-y-3">
          {/* Show Only Positive/Negative */}
          <div className="space-y-2">
            <Label className="text-xs">Value Display</Label>
            <div className="flex gap-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="valueDisplay"
                  value="all"
                  checked={!layer.showOnlyPositive && !layer.showOnlyNegative}
                  onChange={() => {
                    updateProperty('showOnlyPositive', false);
                    updateProperty('showOnlyNegative', false);
                  }}
                />
                All
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="valueDisplay"
                  value="positive"
                  checked={layer.showOnlyPositive === true}
                  onChange={() => {
                    updateProperty('showOnlyPositive', true);
                    updateProperty('showOnlyNegative', false);
                  }}
                />
                Positive
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="valueDisplay"
                  value="negative"
                  checked={layer.showOnlyNegative === true}
                  onChange={() => {
                    updateProperty('showOnlyPositive', false);
                    updateProperty('showOnlyNegative', true);
                  }}
                />
                Negative
              </label>
            </div>
          </div>

          {/* Cluster Size Threshold */}
          <div className="space-y-1">
            <Label className="text-xs">Cluster Size Threshold</Label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={layer.clusterThreshold || 0}
                onChange={(e) => updateProperty('clusterThreshold', parseInt(e.target.value))}
                className="w-24 h-7 px-2 text-xs border rounded"
                min="0"
                step="1"
              />
              <span className="text-xs text-muted-foreground">vertices</span>
            </div>
          </div>

          {/* Smoothing Kernel */}
          <div className="space-y-1">
            <Label className="text-xs">Smoothing Kernel Size</Label>
            <Select
              value={String(layer.smoothingKernel || 0)}
              onValueChange={(value) => updateProperty('smoothingKernel', parseInt(value))}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">None</SelectItem>
                <SelectItem value="3">3mm</SelectItem>
                <SelectItem value="5">5mm</SelectItem>
                <SelectItem value="8">8mm</SelectItem>
                <SelectItem value="10">10mm</SelectItem>
                <SelectItem value="15">15mm</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleSection>

      {/* Data Statistics */}
      <div className="pt-2 border-t space-y-2 mt-4">
        <div className="text-xs font-medium text-muted-foreground">Statistics</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Min: </span>
            <span>{layer.range[0].toFixed(3)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Max: </span>
            <span>{layer.range[1].toFixed(3)}</span>
          </div>
          {layer.mean !== undefined && (
            <div>
              <span className="text-muted-foreground">Mean: </span>
              <span>{layer.mean.toFixed(3)}</span>
            </div>
          )}
          {layer.std !== undefined && (
            <div>
              <span className="text-muted-foreground">Std: </span>
              <span>{layer.std.toFixed(3)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};