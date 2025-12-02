/**
 * SurfacePanel - Control panel for surface layers
 *
 * Divided into two sections:
 * 1. Geometry controls (unique to surfaces) - wireframe, smoothing, lighting
 * 2. Data layer controls (same as volumes) - intensity, threshold, colormap, opacity
 *
 * Follows "Instrument Control" aesthetic (Neutra/Cody design principles).
 */

import React from 'react';
import { SharedControls, type DataLayerRender, type DataLayerMetadata } from './SharedControls';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { SingleSlider } from '../ui/SingleSlider';
import { LayerList } from '../ui/LayerList';
import { Box, Layers } from 'lucide-react';
import type { DisplayLayer } from '@/types/displayLayer';

/**
 * Surface geometry properties (the mesh itself, not data on it)
 */
interface SurfaceGeometry {
  wireframe: boolean;
  smoothing: number;
  baseOpacity: number;
  lighting: {
    ambient: number;
    diffuse: number;
    specular: number;
  };
  baseColor: string; // Color when no data layers
}

/**
 * Surface data layer (data mapped onto the geometry)
 */
interface SurfaceDataLayer {
  id: string;
  name: string;
  render: DataLayerRender;
  metadata?: DataLayerMetadata;
  sourceVolumeId?: string; // If this is vol2surf mapped data
  sourceVolumeName?: string;
}

interface SurfacePanelProps {
  /**
   * The surface geometry properties
   */
  geometry?: SurfaceGeometry;
  
  /**
   * Data layers on the surface (can be empty)
   */
  dataLayers?: SurfaceDataLayer[];
  displayLayers?: DisplayLayer[];
  selectedDataLayerId?: string;
  selectedDisplayLayerId?: string | null;
  onGeometryUpdate?: (updates: Partial<SurfaceGeometry>) => void;
  onDataLayerUpdate?: (layerId: string, updates: Partial<DataLayerRender>) => void;
  onDisplayLayerSelect?: (id: string) => void;
  onDisplayLayerToggle?: (id: string) => void;
  onRemapClick?: (layerId: string) => void;
}

/* CollapsibleSection is now imported from '../ui/CollapsibleSection' */

/**
 * Compact toggle switch - Instrument Control style
 */
const CompactToggle: React.FC<{
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}> = ({ label, value, onChange, disabled }) => {
  return (
    <div className="flex items-center justify-between gap-4">
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

/**
 * SurfacePanel component - Controls for surface visualization
 */
export const SurfacePanel: React.FC<SurfacePanelProps> = ({
  geometry,
  dataLayers = [],
  displayLayers = [],
  selectedDataLayerId,
  selectedDisplayLayerId,
  onGeometryUpdate,
  onDataLayerUpdate,
  onDisplayLayerSelect,
  onDisplayLayerToggle,
  onRemapClick
}) => {
  // Find selected data layer
  const selectedDataLayer = dataLayers.find(l => l.id === selectedDataLayerId) || dataLayers[0];
  
  return (
    <div className="space-y-6">
      {/* === GEOMETRY SECTION === */}
      <CollapsibleSection
        title="Surface Geometry"
        icon={Box}
        defaultExpanded={true}
      >
        {geometry ? (
          <div className="space-y-4">
            {/* Wireframe Toggle */}
            <CompactToggle
              label="Wireframe"
              value={geometry.wireframe}
              onChange={(value) => onGeometryUpdate?.({ wireframe: value })}
            />

            {/* Surface Opacity */}
            <SingleSlider
              label="Surface Opacity"
              min={0}
              max={1}
              value={geometry.baseOpacity}
              onChange={(value) => onGeometryUpdate?.({ baseOpacity: value })}
              showPercentage={true}
            />

            {/* Smoothing */}
            <SingleSlider
              label="Smoothing"
              min={0}
              max={1}
              value={geometry.smoothing}
              onChange={(value) => onGeometryUpdate?.({ smoothing: value })}
            />

            {/* Lighting Controls - Nested section */}
            <div className="space-y-3 pt-2 border-t border-border">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                Lighting
              </span>
              <div className="space-y-3">
                <SingleSlider
                  label="Ambient"
                  min={0}
                  max={1}
                  value={geometry.lighting.ambient}
                  onChange={(value) => onGeometryUpdate?.({
                    lighting: { ...geometry.lighting, ambient: value }
                  })}
                />
                <SingleSlider
                  label="Diffuse"
                  min={0}
                  max={1}
                  value={geometry.lighting.diffuse}
                  onChange={(value) => onGeometryUpdate?.({
                    lighting: { ...geometry.lighting, diffuse: value }
                  })}
                />
                <SingleSlider
                  label="Specular"
                  min={0}
                  max={1}
                  value={geometry.lighting.specular}
                  onChange={(value) => onGeometryUpdate?.({
                    lighting: { ...geometry.lighting, specular: value }
                  })}
                />
              </div>
            </div>

            {/* Base Color (when no data layers) */}
            {dataLayers.length === 0 && (
              <div className="flex items-center justify-between gap-4">
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  Base Color
                </label>
                <input
                  type="color"
                  value={geometry.baseColor}
                  onChange={(e) => onGeometryUpdate?.({ baseColor: e.target.value })}
                  className="h-6 w-12 border border-border"
                  style={{ borderRadius: '1px' }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground text-center py-4">
            No surface loaded. Load a .gii file to begin.
          </div>
        )}
      </CollapsibleSection>

      {/* === DATA LAYERS SECTION === */}
      <CollapsibleSection
        title="Data Layers"
        icon={Layers}
        defaultExpanded={true}
      >
        {displayLayers.length === 0 ? (
          <div className="text-[11px] text-muted-foreground text-center py-4">
            No data layers. Drop a volume file here to map data to surface.
          </div>
        ) : (
          <div className="space-y-4">
            <LayerList
              layers={displayLayers}
              selectedId={selectedDisplayLayerId || undefined}
              onSelect={onDisplayLayerSelect}
              onToggleVisibility={onDisplayLayerToggle}
            />

            {selectedDataLayer && (
              <>
                <SharedControls
                  render={selectedDataLayer.render}
                  metadata={selectedDataLayer.metadata}
                  onRenderUpdate={(updates) =>
                    onDataLayerUpdate?.(selectedDataLayer.id, updates)
                  }
                />

                {selectedDataLayer.sourceVolumeId && (
                  <div className="space-y-2 pt-3 border-t border-border">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Volume Mapping
                    </span>
                    <div className="text-[11px] font-mono text-muted-foreground">
                      Source: {selectedDataLayer.sourceVolumeName || selectedDataLayer.sourceVolumeId}
                    </div>
                    <button
                      onClick={() => onRemapClick?.(selectedDataLayer.id)}
                      className="px-3 py-1 text-[10px] uppercase tracking-wider font-medium border border-border hover:bg-muted/50 transition-colors"
                      style={{ borderRadius: '1px' }}
                    >
                      Remap Settings...
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
};

/**
 * Example/placeholder data for testing
 */
export const exampleSurfaceData = {
  geometry: {
    wireframe: false,
    smoothing: 0.5,
    baseOpacity: 1.0,
    lighting: {
      ambient: 0.3,
      diffuse: 0.7,
      specular: 0.2
    },
    baseColor: '#888888'
  },
  dataLayers: [
    {
      id: 'curvature',
      name: 'Curvature',
      render: {
        intensity: [-1, 1] as [number, number],
        threshold: [-1, -1] as [number, number],
        colormap: 'viridis',
        opacity: 1.0
      },
      metadata: {
        dataRange: { min: -1, max: 1 },
        dataType: 'float32',
        units: 'mm⁻¹'
      }
    },
    {
      id: 'thickness',
      name: 'Cortical Thickness',
      render: {
        intensity: [1, 5] as [number, number],
        threshold: [0, 0] as [number, number],
        colormap: 'jet',
        opacity: 0.8
      },
      metadata: {
        dataRange: { min: 0, max: 6 },
        dataType: 'float32',
        units: 'mm'
      }
    }
  ] as SurfaceDataLayer[]
};
