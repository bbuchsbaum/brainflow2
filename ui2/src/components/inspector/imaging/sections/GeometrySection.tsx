import React, { useCallback } from 'react';
import type { SceneItem } from '@/types/sceneItem';
import { InspectorSection, FieldRow } from '../InspectorSection';
import {
  DEFAULT_SURFACE_VIEW_ID,
  DEFAULT_SURFACE_VIEW_SETTINGS,
  useSurfaceStore,
  type SurfaceDisplaySettings,
  type SurfaceLightingSettings,
  type SurfaceMaterialSettings,
} from '@/stores/surfaceStore';
import { useResolvedActiveSurfaceViewId } from '@/hooks/useResolvedActiveSurfaceViewId';
import { SingleSlider } from '@/components/ui/SingleSlider';
import { Switch } from '@/components/ui/shadcn/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { SurfaceGeometryControls } from '@/components/panels/SurfaceGeometryControls';
import {
  LIGHTING_PRESETS,
  MATERIAL_PRESETS,
  matchLightingPreset,
  matchMaterialPreset,
} from '@/utils/surfaceAppearancePresets';

interface GeometrySectionProps {
  item: SceneItem;
}

/**
 * Surface-only section. Exposes the *core* appearance controls a researcher
 * adjusts day-to-day — opacity, lighting preset, material, shading, wireframe —
 * and tucks the full set of knobs (per-light intensities, material detail,
 * smoothing, projection) behind "Surface settings…". The granular panel lives
 * in {@link SurfaceGeometryControls}.
 *
 * Appearance is treated as a property of the surface display: changes broadcast
 * to every surface view (registered tabs plus the Integrated pane's default id)
 * so the visible brain updates regardless of which canvas hosts it.
 */
export function GeometrySection({ item }: GeometrySectionProps) {
  if (item.kind !== 'surface-geometry') return null;
  return <GeometrySectionBody />;
}

/** All surface-view ids whose appearance should track the inspector controls. */
function collectSurfaceViewTargetIds(state: ReturnType<typeof useSurfaceStore.getState>): string[] {
  const ids = new Set<string>([DEFAULT_SURFACE_VIEW_ID]);
  for (const id of state.surfaceViewSettings.keys()) ids.add(id);
  for (const id of state.surfaceViewHandles.keys()) ids.add(id);
  return Array.from(ids);
}

function GeometrySectionBody() {
  // Read from a representative view; writes broadcast to all (kept in sync).
  const readId = useResolvedActiveSurfaceViewId() ?? DEFAULT_SURFACE_VIEW_ID;

  const display = useSurfaceStore(
    (s) =>
      s.surfaceViewSettings.get(readId)?.displaySettings ??
      DEFAULT_SURFACE_VIEW_SETTINGS.displaySettings,
  );
  const lighting = useSurfaceStore(
    (s) =>
      s.surfaceViewSettings.get(readId)?.lightingSettings ??
      DEFAULT_SURFACE_VIEW_SETTINGS.lightingSettings,
  );
  const material = useSurfaceStore(
    (s) =>
      s.surfaceViewSettings.get(readId)?.materialSettings ??
      DEFAULT_SURFACE_VIEW_SETTINGS.materialSettings,
  );

  const applyDisplay = useCallback((partial: Partial<SurfaceDisplaySettings>) => {
    const state = useSurfaceStore.getState();
    for (const id of collectSurfaceViewTargetIds(state)) {
      state.updateSurfaceViewDisplaySettings(id, partial);
    }
  }, []);
  const applyLighting = useCallback((partial: Partial<SurfaceLightingSettings>) => {
    const state = useSurfaceStore.getState();
    for (const id of collectSurfaceViewTargetIds(state)) {
      state.updateSurfaceViewLightingSettings(id, partial);
    }
  }, []);
  const applyMaterial = useCallback((partial: Partial<SurfaceMaterialSettings>) => {
    const state = useSurfaceStore.getState();
    for (const id of collectSurfaceViewTargetIds(state)) {
      state.updateSurfaceViewMaterialSettings(id, partial);
    }
  }, []);

  const lightingPresetName = matchLightingPreset(lighting);
  const materialPresetName = matchMaterialPreset(material);

  return (
    <InspectorSection label="Geometry" icon={<GeometryIcon />} defaultOpen>
      <div className="py-1.5">
        <SingleSlider
          label="Opacity"
          min={0}
          max={1}
          value={display.opacity}
          onChange={(v) => applyDisplay({ opacity: v })}
          layout="strip"
          compact
          highContrast
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
      </div>

      <FieldRow label="Lighting preset">
        <Select
          value={lightingPresetName ?? ''}
          onValueChange={(name) => {
            const preset = LIGHTING_PRESETS.find((p) => p.name === name);
            if (preset) applyLighting(preset.values);
          }}
        >
          <SelectTrigger className="h-7 w-[128px] text-[12px]">
            <SelectValue placeholder="Custom" />
          </SelectTrigger>
          <SelectContent>
            {LIGHTING_PRESETS.map((p) => (
              <SelectItem key={p.name} value={p.name} className="text-[12px]">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      <FieldRow label="Material">
        <Select
          value={materialPresetName ?? ''}
          onValueChange={(name) => {
            const preset = MATERIAL_PRESETS.find((p) => p.name === name);
            if (preset) applyMaterial(preset.values);
          }}
        >
          <SelectTrigger className="h-7 w-[128px] text-[12px]">
            <SelectValue placeholder="Custom" />
          </SelectTrigger>
          <SelectContent>
            {MATERIAL_PRESETS.map((p) => (
              <SelectItem key={p.name} value={p.name} className="text-[12px]">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      <FieldRow label="Shading">
        <Select
          value={display.flatShading ? 'Flat' : 'Smooth'}
          onValueChange={(v) => applyDisplay({ flatShading: v === 'Flat' })}
        >
          <SelectTrigger className="h-7 w-[128px] text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Smooth" className="text-[12px]">
              Smooth
            </SelectItem>
            <SelectItem value="Flat" className="text-[12px]">
              Flat
            </SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>

      <FieldRow label="Wireframe">
        <Switch
          checked={display.wireframe}
          onCheckedChange={(checked) => applyDisplay({ wireframe: checked })}
        />
      </FieldRow>

      <div className="pt-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <GearIcon />
              Surface settings…
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[300px] max-h-[60vh] overflow-y-auto p-0">
            <SurfaceGeometryControls surfaceViewId={readId} />
          </PopoverContent>
        </Popover>
      </div>
    </InspectorSection>
  );
}

function GeometryIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <path d="M3 12l5-9 5 9M5 12h6" strokeLinejoin="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <circle cx="8" cy="8" r="2.2" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
