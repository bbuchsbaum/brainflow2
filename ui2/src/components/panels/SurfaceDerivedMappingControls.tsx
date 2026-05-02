import React, { useCallback, useMemo } from 'react';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useLayerStore } from '@/stores/layerStore';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { PropertyBox, PropertyRow } from '@/components/ui/PropertyRow';
import { SurfaceGeometryControls } from './SurfaceGeometryControls';
import { GitBranch, Info, Settings2 } from 'lucide-react';

interface SurfaceDerivedMappingControlsProps {
  surfaceId: string;
  surfaceViewId?: string | null;
}

function formatMappingMethod(method: string | undefined): string {
  switch (method) {
    case 'nearest':
      return 'Nearest';
    case 'trilinear':
      return 'Trilinear';
    case 'weighted':
      return 'Weighted';
    default:
      return 'Unknown';
  }
}

export const SurfaceDerivedMappingControls: React.FC<SurfaceDerivedMappingControlsProps> = ({
  surfaceId,
  surfaceViewId,
}) => {
  const surface = useSurfaceStore((state) => state.surfaces.get(surfaceId));
  const volumeLayers = useLayerStore((state) => state.layers);
  const selectLayer = useLayerStore((state) => state.selectLayer);

  const sourceVolumeId = surface?.metadata?.sourceVolumeId ?? null;
  const mappingOptions = surface?.metadata?.mappingOptions;

  const sourceVolume = useMemo(() => {
    if (!sourceVolumeId) {
      return null;
    }
    return volumeLayers.find((layer) => layer.id === sourceVolumeId || layer.volumeId === sourceVolumeId) ?? null;
  }, [sourceVolumeId, volumeLayers]);

  const handleSelectSourceVolume = useCallback(() => {
    if (!sourceVolumeId) {
      return;
    }
    selectLayer(sourceVolumeId);
  }, [selectLayer, sourceVolumeId]);

  if (!surface || !sourceVolumeId) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Info className="h-8 w-8 text-muted-foreground/30 mb-2" />
        <p className="text-sm text-muted-foreground">No derived surface selected</p>
        <p className="text-xs text-muted-foreground mt-1">
          Select a mapped surface to inspect its source and geometry settings
        </p>
      </div>
    );
  }

  const sourceVolumeLabel = sourceVolume?.name ?? sourceVolumeId;

  return (
    <div className="p-3 space-y-3">
      <CollapsibleSection title="Mapping Context" icon={GitBranch} defaultExpanded>
        <div className="space-y-3">
          <PropertyBox>
            <PropertyRow
              label="Derived Surface"
              value={surface.name}
              truncate
              maxValueWidth="60%"
            />
            <PropertyRow
              label="Source Volume"
              value={sourceVolumeLabel}
              truncate
              maxValueWidth="60%"
            />
            <PropertyRow
              label="Mapping Method"
              value={formatMappingMethod(mappingOptions?.method)}
              mono
            />
            <PropertyRow
              label="Projection Depth"
              value={
                typeof mappingOptions?.projectionDepth === 'number'
                  ? `${mappingOptions.projectionDepth.toFixed(1)} mm`
                  : '—'
              }
              mono
            />
            <PropertyRow
              label="Smoothing"
              value={
                typeof mappingOptions?.smoothingKernel === 'number'
                  ? `${mappingOptions.smoothingKernel.toFixed(1)}`
                  : '—'
              }
              mono
            />
          </PropertyBox>

          <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 bg-muted/10 px-3 py-2">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Mapping parameters are exposed here as contextual metadata. Geometry display settings remain per-view.
            </p>
            <button
              type="button"
              onClick={handleSelectSourceVolume}
              className="shrink-0 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold border border-border rounded-[2px] hover:bg-muted/40 transition-colors"
            >
              Select Source Volume
            </button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Geometry" icon={Settings2} defaultExpanded={false}>
        {surfaceViewId ? (
          <SurfaceGeometryControls surfaceViewId={surfaceViewId} />
        ) : (
          <div className="rounded-sm border border-dashed border-border/60 bg-muted/10 px-3 py-4 text-center">
            <Info className="h-7 w-7 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No active surface view</p>
            <p className="text-xs text-muted-foreground mt-1">
              Focus a surface tab to edit lighting, material, and projection settings for this derived surface.
            </p>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
};
