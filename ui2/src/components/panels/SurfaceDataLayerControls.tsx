/**
 * Surface Data Layer Controls
 * Controls for surface data overlays (statistical maps, activation maps, etc.)
 *
 * Uses SharedControls for common data layer properties (intensity, threshold,
 * colormap, opacity) to ensure UI consistency with Volume layer controls.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { SharedControls, type DataLayerRender, type DataLayerMetadata } from './SharedControls';
import { PropertyRow, PropertyBox } from '../ui/PropertyRow';
import { SingleSlider } from '../ui/SingleSlider';
import { AtlasService } from '@/services/AtlasService';
import { ATLAS_PALETTE_OPTIONS, type AtlasPaletteKind } from '@/types/atlasPalette';
import { getEventBus } from '@/events/EventBus';
import { withTimeout } from '@/utils/withTimeout';
import {
  BarChart3,
  Palette,
  Layers
} from 'lucide-react';

interface SurfaceDataLayerControlsProps {
  surfaceId: string;
  layerId: string;
}

const PALETTE_TIMEOUT_MS = 45_000;

export const SurfaceDataLayerControls: React.FC<SurfaceDataLayerControlsProps> = ({
  surfaceId,
  layerId,
}) => {
  const { surfaces, updateLayerProperty } = useSurfaceStore();

  const surface = surfaces.get(surfaceId);
  const layer = surface?.layers.get(layerId);
  const [isPaletteLoading, setIsPaletteLoading] = useState(false);

  const updateProperty = useCallback(
    (property: string, value: unknown) => {
      updateLayerProperty(surfaceId, layerId, property, value);
    },
    [layerId, surfaceId, updateLayerProperty]
  );

  const atlasConfig = layer?.atlasConfig;
  const parcellationReferenceId = layer?.parcellationReferenceId;
  const labels = layer?.labels;

  const isAtlasCategorical =
    layer?.rgba instanceof Float32Array &&
    labels instanceof Uint32Array &&
    atlasConfig != null;

  const isReferenceCategorical =
    layer?.rgba instanceof Float32Array &&
    labels instanceof Uint32Array &&
    typeof parcellationReferenceId === 'string' &&
    parcellationReferenceId.length > 0;

  const isCategoricalLayer = isAtlasCategorical || isReferenceCategorical;

  const atlasPaletteKind = (layer.atlasPaletteKind as AtlasPaletteKind | undefined) ?? 'maximin_view';

  const remapLabelsToRgba = useCallback((labels: Uint32Array, lutRgb: number[]) => {
    const rgba = new Float32Array(labels.length * 4);
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i] ?? 0;
      const off = i * 4;
      if (label === 0) {
        rgba[off] = 0;
        rgba[off + 1] = 0;
        rgba[off + 2] = 0;
        rgba[off + 3] = 0;
        continue;
      }
      const lutOff = label * 3;
      const r = lutRgb[lutOff] ?? 0;
      const g = lutRgb[lutOff + 1] ?? 0;
      const b = lutRgb[lutOff + 2] ?? 0;
      rgba[off] = r / 255;
      rgba[off + 1] = g / 255;
      rgba[off + 2] = b / 255;
      rgba[off + 3] = 1;
    }
    return rgba;
  }, []);

  const handlePaletteChange = useCallback(
    async (nextKind: AtlasPaletteKind) => {
      if (!labels || !isCategoricalLayer) {
        return;
      }
      if (nextKind === atlasPaletteKind) {
        return;
      }
      if (isPaletteLoading) {
        return;
      }
      setIsPaletteLoading(true);
      try {
        const palettePromise = isReferenceCategorical && parcellationReferenceId
          ? AtlasService.getParcellationReferencePalette(parcellationReferenceId, {
              kind: nextKind,
              seed: layer?.atlasPaletteSeed,
            })
          : atlasConfig
          ? AtlasService.getAtlasPalette(atlasConfig, {
              kind: nextKind,
              seed: layer?.atlasPaletteSeed,
            })
          : Promise.resolve(null);
        const palette = await withTimeout(
          palettePromise,
          PALETTE_TIMEOUT_MS,
          `surface atlas palette (${nextKind})`
        );
        if (!palette) {
          return;
        }
        const rgba = remapLabelsToRgba(labels, palette.lut.lut_rgb);
        updateProperty('rgba', rgba);
        updateProperty('atlasPaletteKind', palette.lut.kind);
        updateProperty('atlasPaletteSeed', palette.lut.seed);
        updateProperty('atlasMaxLabel', palette.lut.max_label);
      } catch (error) {
        console.error('[SurfaceDataLayerControls] Failed to apply atlas palette:', error);
        const detail = error instanceof Error ? error.message : String(error);
        const isTimeout = detail.includes('timed out');
        const message = isTimeout
          ? `Palette generation for '${nextKind}' timed out after ${Math.round(PALETTE_TIMEOUT_MS / 1000)}s. This may be a slow backend palette computation.`
          : detail.includes('network_harmony')
          ? 'Selected palette is unavailable for this atlas metadata. Try a different palette.'
          : `Failed to apply palette: ${detail}`;
        getEventBus().emit('ui.notification', {
          type: 'error',
          message,
        });
      } finally {
        setIsPaletteLoading(false);
      }
    },
    [
      atlasConfig,
      atlasPaletteKind,
      isCategoricalLayer,
      isReferenceCategorical,
      labels,
      layer?.atlasPaletteSeed,
      isPaletteLoading,
      parcellationReferenceId,
      remapLabelsToRgba,
      updateProperty,
    ]
  );

  // Use dataRange (true data extent) for slider bounds, or fall back to range
  const trueDataRange = layer.dataRange || layer.range;

  const atlasRange = useMemo(() => {
    const maxLabel = layer?.atlasMaxLabel ?? (layer?.dataRange?.[1] ?? 0);
    return `0 – ${maxLabel}`;
  }, [layer?.atlasMaxLabel, layer?.dataRange]);

  if (!surface || !layer) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No data layer selected
      </div>
    );
  }

  // Ensure we have valid [number, number] tuples for the sliders
  // layer.range might be improperly formatted - coerce to proper tuple
  const intensityRange: [number, number] = Array.isArray(layer.range) && layer.range.length >= 2
    ? [layer.range[0], layer.range[1]]
    : [trueDataRange[0], trueDataRange[1]];

  // Default threshold to [min, min] so nothing is masked initially (no filtering)
  const thresholdRange: [number, number] = Array.isArray(layer.threshold) && layer.threshold.length >= 2
    ? [layer.threshold[0], layer.threshold[1]]
    : [trueDataRange[0], trueDataRange[0]];

  // Adapt layer data to SharedControls format
  const adaptedRender: DataLayerRender = {
    intensity: intensityRange,
    threshold: thresholdRange,
    colormap: layer.colormap,
    opacity: layer.opacity ?? 1
  };

  const adaptedMetadata: DataLayerMetadata = {
    dataRange: {
      min: trueDataRange[0],
      max: trueDataRange[1]
    }
  };

  // Handle updates from SharedControls
  const handleRenderUpdate = (updates: Partial<DataLayerRender>) => {
    if (updates.intensity) {
      updateProperty('range', updates.intensity);
    }
    if (updates.threshold) {
      updateProperty('threshold', updates.threshold);
    }
    if (updates.colormap) {
      updateProperty('colormap', updates.colormap);
    }
    if (updates.opacity !== undefined) {
      updateProperty('opacity', updates.opacity);
    }
  };

  return (
    <div className="p-3 space-y-3">
      {/* Header - Instrument Control style (matches VolumePanel) */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-[0.15em] font-bold text-foreground">
            Data Layer Properties
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-accent font-mono">
          overlay
        </span>
      </div>

      {/* Layer Info - Technical Blueprint style (matches VolumePanel) */}
      <PropertyBox>
        <PropertyRow
          label="Layer"
          value={layer.name}
          truncate
          maxValueWidth="140px"
        />
        <PropertyRow
          label="Data Range"
          value={isCategoricalLayer ? atlasRange : `${trueDataRange[0].toFixed(2)} – ${trueDataRange[1].toFixed(2)}`}
          mono
        />
      </PropertyBox>

      {isCategoricalLayer ? (
        <CollapsibleSection
          title="Palette"
          icon={Palette}
          defaultExpanded={true}
        >
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
              value={layer.opacity ?? 1}
              onChange={(v) => updateProperty('opacity', v)}
              showPercentage={true}
              disabled={isPaletteLoading}
              className="mb-0"
              layout="strip"
              compact
              highContrast
            />
          </div>
        </CollapsibleSection>
      ) : (
        <CollapsibleSection
          title="Data Mapping"
          icon={Layers}
          defaultExpanded={true}
        >
          <SharedControls
            render={adaptedRender}
            metadata={adaptedMetadata}
            onRenderUpdate={handleRenderUpdate}
            className="rounded-sm border border-border/50 bg-muted/10 px-2"
            compact
            highContrast
            layout="strip"
            labels={{
              intensity: 'Intensity Window',
              threshold: 'Threshold',
              colormap: 'Colormap',
              opacity: 'Opacity'
            }}
          />
        </CollapsibleSection>
      )}

      {/* Statistical Controls Section */}
      <CollapsibleSection
        title="Statistical"
        icon={BarChart3}
        defaultExpanded={false}
      >
        <div className="space-y-4">
          {/* Show Only Positive/Negative - Instrument Control style */}
          <div className="flex items-center justify-between gap-4">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold shrink-0">
              Value Display
            </label>
            <div className="flex gap-0 shrink-0">
              <button
                className={`px-3 py-1 text-[10px] uppercase tracking-wider font-medium border border-r-0 transition-colors ${
                  !layer.showOnlyPositive && !layer.showOnlyNegative
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent hover:bg-muted/50 border-border text-muted-foreground'
                }`}
                style={{ borderRadius: '1px 0 0 1px' }}
                onClick={() => {
                  updateProperty('showOnlyPositive', false);
                  updateProperty('showOnlyNegative', false);
                }}
              >
                All
              </button>
              <button
                className={`px-3 py-1 text-[10px] uppercase tracking-wider font-medium border border-r-0 transition-colors ${
                  layer.showOnlyPositive === true
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent hover:bg-muted/50 border-border text-muted-foreground'
                }`}
                onClick={() => {
                  updateProperty('showOnlyPositive', true);
                  updateProperty('showOnlyNegative', false);
                }}
              >
                +
              </button>
              <button
                className={`px-3 py-1 text-[10px] uppercase tracking-wider font-medium border transition-colors ${
                  layer.showOnlyNegative === true
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent hover:bg-muted/50 border-border text-muted-foreground'
                }`}
                style={{ borderRadius: '0 1px 1px 0' }}
                onClick={() => {
                  updateProperty('showOnlyPositive', false);
                  updateProperty('showOnlyNegative', true);
                }}
              >
                −
              </button>
            </div>
          </div>

          {/* Cluster Size Threshold - Instrument Control style */}
          <div className="flex items-center justify-between gap-4">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Cluster Threshold
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={layer.clusterThreshold || 0}
                onChange={(e) => updateProperty('clusterThreshold', parseInt(e.target.value))}
                className="w-16 h-6 px-2 text-[10px] font-mono border border-border bg-transparent text-foreground"
                style={{ borderRadius: '1px' }}
                min="0"
                step="1"
              />
              <span className="text-[10px] text-muted-foreground font-mono">vtx</span>
            </div>
          </div>

          {/* Smoothing Kernel - Instrument Control style */}
          <div className="flex items-center justify-between gap-4">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Smoothing
            </label>
            <Select
              value={String(layer.smoothingKernel || 0)}
              onValueChange={(value) => updateProperty('smoothingKernel', parseInt(value))}
            >
              <SelectTrigger
                className="w-20 h-6 text-[10px] font-mono border-border"
                style={{ borderRadius: '1px' }}
              >
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

      {/* Data Statistics - Technical Blueprint style */}
      <PropertyBox>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">
          Statistics
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <PropertyRow
            label="Min"
            value={trueDataRange[0].toFixed(3)}
            mono
          />
          <PropertyRow
            label="Max"
            value={trueDataRange[1].toFixed(3)}
            mono
          />
          {layer.mean !== undefined && (
            <PropertyRow
              label="Mean"
              value={layer.mean.toFixed(3)}
              mono
            />
          )}
          {layer.std !== undefined && (
            <PropertyRow
              label="Std"
              value={layer.std.toFixed(3)}
              mono
            />
          )}
        </div>
      </PropertyBox>
    </div>
  );
};
