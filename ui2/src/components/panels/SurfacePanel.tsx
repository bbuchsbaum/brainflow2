/**
 * SurfacePanel - Control panel for surface layers
 * 
 * Divided into two sections:
 * 1. Geometry controls (unique to surfaces) - wireframe, smoothing, lighting
 * 2. Data layer controls (same as volumes) - intensity, threshold, colormap, opacity
 */

import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { SharedControls, type DataLayerRender, type DataLayerMetadata } from './SharedControls';
import { SingleSlider } from '../ui/SingleSlider';

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
  
  /**
   * Currently selected data layer ID
   */
  selectedDataLayerId?: string;
  
  /**
   * Callbacks for updates
   */
  onGeometryUpdate?: (updates: Partial<SurfaceGeometry>) => void;
  onDataLayerUpdate?: (layerId: string, updates: Partial<DataLayerRender>) => void;
  onRemapClick?: (layerId: string) => void;
}

/**
 * Collapsible section component
 */
const CollapsibleSection: React.FC<{
  title: string;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, badge, defaultOpen = true, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="border rounded-lg">
      <button
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-accent/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <span className="font-medium text-sm">{title}</span>
        {badge !== undefined && (
          <span className="ml-auto text-xs bg-muted px-2 py-0.5 rounded">
            {badge}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="p-3 border-t">
          {children}
        </div>
      )}
    </div>
  );
};

/**
 * SurfacePanel component - Controls for surface visualization
 */
export const SurfacePanel: React.FC<SurfacePanelProps> = ({
  geometry,
  dataLayers = [],
  selectedDataLayerId,
  onGeometryUpdate,
  onDataLayerUpdate,
  onRemapClick
}) => {
  // Find selected data layer
  const selectedDataLayer = dataLayers.find(l => l.id === selectedDataLayerId) || dataLayers[0];
  
  return (
    <div className="space-y-4">
      {/* === GEOMETRY SECTION === */}
      <CollapsibleSection 
        title="Surface Geometry" 
        badge={geometry ? 'Active' : 'No Surface'}
        defaultOpen={true}
      >
        {geometry ? (
          <div className="space-y-3">
            {/* Wireframe Toggle */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Wireframe</label>
              <input
                type="checkbox"
                checked={geometry.wireframe}
                onChange={(e) => onGeometryUpdate?.({ wireframe: e.target.checked })}
                className="h-4 w-4"
              />
            </div>
            
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
              step={0.1}
            />
            
            {/* Lighting Controls */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Lighting</label>
              <div className="space-y-2 pl-2">
                <SingleSlider
                  label="Ambient"
                  min={0}
                  max={1}
                  value={geometry.lighting.ambient}
                  onChange={(value) => onGeometryUpdate?.({
                    lighting: { ...geometry.lighting, ambient: value }
                  })}
                  step={0.1}
                />
                <SingleSlider
                  label="Diffuse"
                  min={0}
                  max={1}
                  value={geometry.lighting.diffuse}
                  onChange={(value) => onGeometryUpdate?.({
                    lighting: { ...geometry.lighting, diffuse: value }
                  })}
                  step={0.1}
                />
                <SingleSlider
                  label="Specular"
                  min={0}
                  max={1}
                  value={geometry.lighting.specular}
                  onChange={(value) => onGeometryUpdate?.({
                    lighting: { ...geometry.lighting, specular: value }
                  })}
                  step={0.1}
                />
              </div>
            </div>
            
            {/* Base Color (when no data layers) */}
            {dataLayers.length === 0 && (
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Base Color</label>
                <input
                  type="color"
                  value={geometry.baseColor}
                  onChange={(e) => onGeometryUpdate?.({ baseColor: e.target.value })}
                  className="h-8 w-16"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            No surface loaded. Load a .gii file to begin.
          </div>
        )}
      </CollapsibleSection>
      
      {/* === DATA LAYERS SECTION === */}
      <CollapsibleSection 
        title="Data Layers" 
        badge={dataLayers.length}
        defaultOpen={true}
      >
        {dataLayers.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            No data layers. Drop a volume file here to map data to surface.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Layer selector if multiple layers */}
            {dataLayers.length > 1 && (
              <select
                value={selectedDataLayer?.id}
                onChange={(e) => {
                  // In real implementation, this would update selectedDataLayerId
                  console.log('Selected layer:', e.target.value);
                }}
                className="w-full px-3 py-2 border rounded-md"
              >
                {dataLayers.map(layer => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name}
                  </option>
                ))}
              </select>
            )}
            
            {selectedDataLayer && (
              <>
                {/* Use SharedControls for data layer controls */}
                <SharedControls
                  render={selectedDataLayer.render}
                  metadata={selectedDataLayer.metadata}
                  onRenderUpdate={(updates) => 
                    onDataLayerUpdate?.(selectedDataLayer.id, updates)
                  }
                />
                
                {/* Vol2surf specific controls */}
                {selectedDataLayer.sourceVolumeId && (
                  <div className="space-y-2 pt-2 border-t">
                    <label className="text-xs text-muted-foreground">
                      Volume Mapping
                    </label>
                    <div className="text-xs text-muted-foreground">
                      Source: {selectedDataLayer.sourceVolumeName || selectedDataLayer.sourceVolumeId}
                    </div>
                    <button
                      onClick={() => onRemapClick?.(selectedDataLayer.id)}
                      className="px-3 py-1 text-sm border rounded hover:bg-accent"
                    >
                      Remap with Different Settings...
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