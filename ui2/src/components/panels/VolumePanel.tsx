/**
 * VolumePanel - Volume-specific property controls
 *
 * This panel contains all controls specific to volume layers,
 * using SharedControls for common data layer properties.
 *
 * Part of the separate panels architecture for different layer types.
 * Follows "Instrument Control" aesthetic (Neutra/Cody design principles).
 */

import React from 'react';
import { SharedControls, type DataLayerRender, type DataLayerMetadata } from './SharedControls';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { PropertyRow, PropertyBox } from '../ui/PropertyRow';
import { SingleSlider } from '../ui/SingleSlider';
import type { LayerRender } from '@/types/layers';
import type { LayerInfo, VolumeMetadata } from '@/stores/layerStore';
import { AtlasPaletteService } from '@/services/AtlasPaletteService';
import { ATLAS_PALETTE_OPTIONS, type AtlasPaletteKind } from '@/types/atlasPalette';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Layers, Palette, Settings } from 'lucide-react';
import { setLayerBorder } from '@brainflow/api';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getOptimizedRenderService } from '@/services/OptimizedRenderService';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';

const DEFAULT_LAYER_DISPLAY_OPTIONS = Object.freeze({
  showBorder: false,
  showOrientationMarkers: true,
  showValueOnHover: true,
});

interface VolumePanelProps {
  /**
   * The volume layer being edited
   */
  layer: LayerInfo;
  
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
 * Compact interpolation mode selector - Instrument Control style
 */
const CompactInterpolationSelector: React.FC<{
  value: 'nearest' | 'linear';
  onChange: (value: 'nearest' | 'linear') => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold shrink-0">
        Interpolation
      </label>
      <div className="flex gap-0 shrink-0">
        <button
          className={`px-3 py-1 text-[10px] uppercase tracking-wider font-medium border border-r-0 transition-colors ${
            value === 'nearest'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-transparent hover:bg-muted/50 border-border text-muted-foreground'
          }`}
          style={{ borderRadius: '1px 0 0 1px' }}
          onClick={() => onChange('nearest')}
          disabled={disabled}
          title="Blocky appearance, preserves exact values"
        >
          Nearest
        </button>
        <button
          className={`px-3 py-1 text-[10px] uppercase tracking-wider font-medium border transition-colors ${
            value === 'linear'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-transparent hover:bg-muted/50 border-border text-muted-foreground'
          }`}
          style={{ borderRadius: '0 1px 1px 0' }}
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
 * Compact toggle switch component - Instrument Control style (rectangular)
 */
const CompactToggle: React.FC<{
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  title?: string;
}> = ({ label, value, onChange, disabled, title }) => {
  return (
    <div className="flex items-center justify-between gap-4" title={title}>
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        {label}
      </label>
      <button
        className={`relative inline-flex h-4 w-8 items-center transition-colors border ${
          value
            ? 'bg-primary border-primary'
            : 'bg-muted border-border'
        }`}
        style={{ borderRadius: '1px' }}
        onClick={() => onChange(!value)}
        disabled={disabled}
        aria-pressed={value}
      >
        <span
          className={`inline-block h-3 w-3 transform bg-card transition-transform ${
            value ? 'translate-x-4' : 'translate-x-0.5'
          }`}
          style={{ borderRadius: '1px' }}
        />
      </button>
    </div>
  );
};

/* CollapsibleSection is now imported from '../ui/CollapsibleSection' */

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

  const [isPaletteLoading, setIsPaletteLoading] = React.useState(false);

  const isAtlasCategorical =
    layer.source === 'atlas' &&
    layer.type === 'label' &&
    render?.colormapId != null &&
    render?.atlasConfig != null &&
    typeof render?.atlasPaletteKind === 'string';

  const atlasPaletteKind = render?.atlasPaletteKind as AtlasPaletteKind | undefined;

  const handlePaletteChange = async (nextKind: AtlasPaletteKind) => {
    const atlasConfig = render?.atlasConfig;
    if (!atlasConfig) return;
    setIsPaletteLoading(true);
    try {
      await AtlasPaletteService.applyToVolumeLayer(layer.id, atlasConfig, { kind: nextKind });
    } finally {
      setIsPaletteLoading(false);
    }
  };

  // Select a stable reference directly from store; avoid creating objects in selector.
  const storedDisplayOptions = useDisplayOptionsStore(s => s.options.get(layer.id));
  const displayOptions = storedDisplayOptions ?? DEFAULT_LAYER_DISPLAY_OPTIONS;
  const setDisplayOptions = useDisplayOptionsStore(s => s.setOptions);

  const [showBorder, setShowBorder] = React.useState<boolean>(displayOptions.showBorder);
  const [showOrientationMarkers, setShowOrientationMarkers] = React.useState<boolean>(displayOptions.showOrientationMarkers);
  const [showValueOnHover, setShowValueOnHover] = React.useState<boolean>(displayOptions.showValueOnHover);

  // Keep local state in sync if store changes from elsewhere
  React.useEffect(() => {
    setShowBorder((prev) => (Object.is(prev, displayOptions.showBorder) ? prev : displayOptions.showBorder));
    setShowOrientationMarkers((prev) => (
      Object.is(prev, displayOptions.showOrientationMarkers) ? prev : displayOptions.showOrientationMarkers
    ));
    setShowValueOnHover((prev) => (
      Object.is(prev, displayOptions.showValueOnHover) ? prev : displayOptions.showValueOnHover
    ));
  }, [displayOptions.showBorder, displayOptions.showOrientationMarkers, displayOptions.showValueOnHover]);

  const handleBorderToggle = async (next: boolean) => {
    // Always update UI + store immediately so border is drawn without flicker
    setShowBorder(next);
    setDisplayOptions(layer.id, { showBorder: next });
    // Best-effort backend hint; if not supported, just log and keep UI state
    try {
      await setLayerBorder(layer.id, next, 1);
      console.log('[VolumePanel] GPU border override applied for layer', layer.id, '=>', next);
    } catch (err) {
      console.warn('[VolumePanel] setLayerBorder backend hint failed (non-fatal):', err);
    }
    // Trigger a quick re-render so GPU border shows up immediately
    try {
      const viewState = useViewStateStore.getState().viewState;
      await getOptimizedRenderService().forceRenderAll(viewState);
    } catch (e) {
      console.warn('[VolumePanel] Border toggle force render failed (non-fatal):', e);
    }
  };

  const handleOrientationToggle = (next: boolean) => {
    setShowOrientationMarkers(next);
    setDisplayOptions(layer.id, { showOrientationMarkers: next });
  };

  const handleHoverToggle = (next: boolean) => {
    setShowValueOnHover(next);
    setDisplayOptions(layer.id, { showValueOnHover: next });
  };

  return (
    <div className="space-y-6">
      {/* Header - Instrument Control style */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-[0.15em] font-bold text-foreground">
            Volume Properties
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-accent font-mono">
          {layer.type || 'volume'}
        </span>
      </div>

      {/* Volume Info - Technical Blueprint style */}
      <PropertyBox>
        <PropertyRow
          label="Layer"
          value={layer.name}
          truncate
          maxValueWidth="140px"
        />
        {metadata?.dimensions && (
          <PropertyRow
            label="Dimensions"
            value={metadata.dimensions.join(' × ')}
            mono
          />
        )}
        {metadata?.spacing && (
          <PropertyRow
            label="Voxel Size"
            value={`${metadata.spacing.map(s => s.toFixed(2)).join(' × ')} mm`}
            mono
          />
        )}
        {metadata?.dataRange && (
          <PropertyRow
            label="Data Range"
            value={`${metadata.dataRange.min.toFixed(1)} – ${metadata.dataRange.max.toFixed(1)}`}
            mono
          />
        )}
      </PropertyBox>

      {/* Display Settings - Compact */}
      <CollapsibleSection
        title="Display Settings"
        icon={Settings}
        defaultExpanded={false}
      >
        <div className="space-y-3">
          <CompactInterpolationSelector
            value={render?.interpolation || 'linear'}
            onChange={handleInterpolationChange}
            disabled={!render}
          />

          <CompactToggle
            label="Slice Border"
            value={showBorder}
            onChange={handleBorderToggle}
            disabled={!render}
            title="Show border around slice extent (useful for multi-volume viewing)"
          />

          <CompactToggle
            label="Orientation Markers"
            value={showOrientationMarkers}
            onChange={handleOrientationToggle}
            disabled={!render}
            title="Show view orientation labels"
          />

          <CompactToggle
            label="Value on Hover"
            value={showValueOnHover}
            onChange={handleHoverToggle}
            disabled={!render}
            title="Display voxel values when hovering over the slice"
          />
        </div>
      </CollapsibleSection>

      {isAtlasCategorical ? (
        <CollapsibleSection title="Palette" icon={Palette} defaultExpanded={true}>
          <div className="space-y-3 rounded-sm border border-border/50 bg-muted/10 p-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                Palette
              </span>
              <Select
                value={atlasPaletteKind}
                onValueChange={(v) => void handlePaletteChange(v as AtlasPaletteKind)}
                disabled={isPaletteLoading}
              >
                <SelectTrigger className="h-7 w-[180px] text-[11px]">
                  <SelectValue placeholder="Select palette" />
                </SelectTrigger>
                <SelectContent>
                  {ATLAS_PALETTE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <SingleSlider
              label="Opacity"
              min={0}
              max={1}
              value={render?.opacity ?? 1}
              onChange={(opacity) => onRenderUpdate({ opacity })}
              showPercentage={true}
              disabled={!render || isPaletteLoading}
              className="mb-0"
              layout="strip"
              compact
              highContrast
            />
          </div>
        </CollapsibleSection>
      ) : (
        <CollapsibleSection title="Data Mapping" icon={Layers} defaultExpanded={true}>
          <SharedControls
            render={adaptedRender}
            metadata={adaptedMetadata}
            onRenderUpdate={onRenderUpdate}
            disabled={!layer || !render}
          />
        </CollapsibleSection>
      )}

      {/* Advanced Settings (collapsed by default) */}
      <CollapsibleSection
        title="Advanced"
        icon={Settings}
        defaultExpanded={false}
      >
        <div className="space-y-2 text-[11px] text-muted-foreground">
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
  const layer: LayerInfo = {
    id: 'compat-layer',
    name: 'Volume Layer',
    volumeId: '',
    type: 'anatomical',
    visible: true,
    order: 0,
    source: 'other',
    sourcePath: 'compat'
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
