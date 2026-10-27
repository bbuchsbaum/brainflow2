import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneItem } from '@/types/sceneItem';
import { Button, FieldRow, Section, Select, Slider, Switch } from '@/components/ui/bf';
import {
  DEFAULT_SURFACE_VIEW_ID,
  DEFAULT_SURFACE_VIEW_SETTINGS,
  useSurfaceStore,
  type SurfaceDisplaySettings,
  type SurfaceLightingSettings,
  type SurfaceMaterialSettings,
} from '@/stores/surfaceStore';
import { useResolvedActiveSurfaceViewId } from '@/hooks/useResolvedActiveSurfaceViewId';
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
  const surfaceId = item.ref.type === 'surface-geometry' ? item.ref.surfaceId : null;
  return <GeometrySectionBody surfaceId={surfaceId} />;
}

/** All surface-view ids whose appearance should track the inspector controls. */
function collectSurfaceViewTargetIds(state: ReturnType<typeof useSurfaceStore.getState>): string[] {
  const ids = new Set<string>([DEFAULT_SURFACE_VIEW_ID]);
  for (const id of state.surfaceViewSettings.keys()) ids.add(id);
  for (const id of state.surfaceViewHandles.keys()) ids.add(id);
  return Array.from(ids);
}

function GeometrySectionBody({ surfaceId }: { surfaceId: string | null }) {
  // Where this surface's folding underlay comes from (D2).
  const curvatureSource = useSurfaceStore((s) =>
    surfaceId ? (s.surfaces.get(surfaceId)?.curvatureSource ?? null) : null,
  );
  const curvatureHint = !curvatureSource
    ? 'Needs a sulc / curv file next to the mesh, or a matching white or pial surface'
    : curvatureSource.kind === 'file'
      ? `From ${curvatureSource.path.split(/[\\/]/).pop()}`
      : 'Sulcal depth from the matching folded surface';
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
    <Section title="Geometry" icon={<GeometryIcon />} defaultOpen>
      <FieldRow label="Opacity">
        <SurfaceOpacitySlider value={display.opacity} onChange={(v) => applyDisplay({ opacity: v })} />
      </FieldRow>

      <FieldRow label="Lighting preset">
        <Select
          value={lightingPresetName ?? ''}
          onValueChange={(name) => {
            const preset = LIGHTING_PRESETS.find((p) => p.name === name);
            if (preset) applyLighting(preset.values);
          }}
        >
          {lightingPresetName ? null : (
            <option value="" disabled>
              Custom
            </option>
          )}
          {LIGHTING_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
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
          {materialPresetName ? null : (
            <option value="" disabled>
              Custom
            </option>
          )}
          {MATERIAL_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </Select>
      </FieldRow>

      <FieldRow label="Shading">
        <Select
          value={display.flatShading ? 'Flat' : 'Smooth'}
          onValueChange={(v) => applyDisplay({ flatShading: v === 'Flat' })}
          options={[
            { value: 'Smooth', label: 'Smooth' },
            { value: 'Flat', label: 'Flat' },
          ]}
        />
      </FieldRow>

      <FieldRow label="Folding" hint={curvatureHint}>
        <Switch
          aria-label="Folding underlay"
          checked={display.showCurvature !== false && !!curvatureSource}
          disabled={!curvatureSource}
          onCheckedChange={(checked) => applyDisplay({ showCurvature: checked })}
        />
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
            <Button variant="secondary" size="sm" className="w-full" icon={<GearIcon />}>
              Surface settings…
            </Button>
          </PopoverTrigger>
          <PopoverContent
            aria-label="Surface settings"
            align="end"
            // As wide as the trigger (the Inspector column), flush with it, so no
            // Inspector label fragments show at the popover's left edge.
            className="w-[var(--radix-popover-trigger-width)] min-w-[300px] max-h-[60vh] overflow-y-auto p-0"
          >
            <SurfaceGeometryControls surfaceViewId={readId} />
          </PopoverContent>
        </Popover>
      </div>
    </Section>
  );
}

const formatPercent = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Surface opacity. Like the former SingleSlider, the thumb follows the
 * pointer locally and the (fan-out) store write is debounced by 120 ms, so a
 * drag does not broadcast every pixel to every surface view.
 */
function SurfaceOpacitySlider({
  value,
  onChange,
  ...field
}: {
  value: number;
  onChange: (value: number) => void;
  id?: string;
  'aria-describedby'?: string;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => setLocal(value), [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Slider
      {...field}
      label="Opacity"
      value={local}
      min={0}
      max={1}
      format={formatPercent}
      valueText={formatPercent}
      showValue
      className="flex-1"
      onValueChange={(v) => {
        setLocal(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => latest.current(v), 120);
      }}
    />
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
