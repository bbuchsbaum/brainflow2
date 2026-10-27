/**
 * Surface Geometry controls: the full set of surface-appearance knobs shown in
 * the Inspector's "Surface settings…" popover (GeometrySection). Built on the
 * shared `ui/bf` primitives: Section, FieldRow, Slider, Switch,
 * SegmentedControl, Button.
 */

import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_SURFACE_VIEW_SETTINGS, useSurfaceStore } from '@/stores/surfaceStore';
import {
  Button,
  FieldRow,
  FOCUS_RING,
  Section,
  SegmentedControl,
  Slider,
  Switch,
} from '@/components/ui/bf';
import { LIGHTING_PRESETS } from '@/utils/surfaceAppearancePresets';
import { cn } from '@/utils/cn';
import { Lightbulb, Eye, Sparkles, Zap } from 'lucide-react';

/** Store writes trail the thumb by this long, as with the former SingleSlider. */
const WRITE_DEBOUNCE_MS = 120;

const formatPercent = (v: number) => `${Math.round(v * 100)}%`;
const formatInteger = (v: number) => v.toFixed(0);

const ICON = 'h-3.5 w-3.5';

/**
 * bf Slider with the former SingleSlider's write semantics: the thumb follows
 * the pointer locally and the store write is debounced (120 ms), so a drag
 * does not push every pixel through the surface store. A pending write is
 * flushed (not dropped) when the popover closes mid-drag.
 */
function DebouncedSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  ...field
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  id?: string;
  'aria-describedby'?: string;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => setLocal(value), [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current !== null) latest.current(pending.current);
    },
    [],
  );

  return (
    <Slider
      {...field}
      label={label}
      value={local}
      min={min}
      max={max}
      step={step}
      format={format}
      valueText={format}
      showValue
      className="flex-1"
      onValueChange={(v) => {
        setLocal(v);
        pending.current = v;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          pending.current = null;
          latest.current(v);
        }, WRITE_DEBOUNCE_MS);
      }}
    />
  );
}

/** Colour swatch input. bf has no colour primitive yet; this follows the field box. */
function ColorSwatch({
  value,
  onChange,
  ...field
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  'aria-describedby'?: string;
  disabled?: boolean;
}) {
  return (
    <input
      {...field}
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-6 w-10 shrink-0 cursor-pointer rounded-sm border border-bf-border bg-bf-bg-input p-0.5 hover:border-bf-border-strong',
        FOCUS_RING,
      )}
    />
  );
}

const LIGHT_POSITIONS = [
  { name: 'Front', position: [0, 0, 100] as [number, number, number] },
  { name: 'Top', position: [0, 100, 0] as [number, number, number] },
  { name: 'Side', position: [100, 0, 0] as [number, number, number] },
  { name: 'Default', position: [100, 100, 100] as [number, number, number] },
];

const LIGHT_POSITION_OPTIONS = LIGHT_POSITIONS.map((p) => ({ value: p.name, label: p.name }));

interface SurfaceGeometryControlsProps {
  surfaceViewId: string;
}

export const SurfaceGeometryControls: React.FC<SurfaceGeometryControlsProps> = ({
  surfaceViewId,
}) => {
  const lightingSettings = useSurfaceStore(
    (state) =>
      state.surfaceViewSettings.get(surfaceViewId)?.lightingSettings ??
      DEFAULT_SURFACE_VIEW_SETTINGS.lightingSettings,
  );
  const displaySettings = useSurfaceStore(
    (state) =>
      state.surfaceViewSettings.get(surfaceViewId)?.displaySettings ??
      DEFAULT_SURFACE_VIEW_SETTINGS.displaySettings,
  );
  const materialSettings = useSurfaceStore(
    (state) =>
      state.surfaceViewSettings.get(surfaceViewId)?.materialSettings ??
      DEFAULT_SURFACE_VIEW_SETTINGS.materialSettings,
  );
  const projectionSettings = useSurfaceStore(
    (state) =>
      state.surfaceViewSettings.get(surfaceViewId)?.projectionSettings ??
      DEFAULT_SURFACE_VIEW_SETTINGS.projectionSettings,
  );
  const updateLightingSettings = useSurfaceStore(
    (state) => state.updateSurfaceViewLightingSettings,
  );
  const updateDisplaySettings = useSurfaceStore((state) => state.updateSurfaceViewDisplaySettings);
  const updateMaterialSettings = useSurfaceStore(
    (state) => state.updateSurfaceViewMaterialSettings,
  );
  const updateProjectionSettings = useSurfaceStore(
    (state) => state.updateSurfaceViewProjectionSettings,
  );

  const activePosition = lightingSettings.lightPosition || LIGHT_POSITIONS[3].position;
  const activePositionName =
    LIGHT_POSITIONS.find((p) => p.position.every((v, idx) => v === activePosition[idx]))?.name ||
    'Default';

  const handlePositionSelect = (name: string) => {
    const preset = LIGHT_POSITIONS.find((p) => p.name === name);
    if (preset) {
      updateLightingSettings(surfaceViewId, { lightPosition: preset.position });
    }
  };

  const handlePresetApply = (presetName: string) => {
    const preset = LIGHTING_PRESETS.find((p) => p.name === presetName);
    if (preset) {
      updateLightingSettings(surfaceViewId, preset.values);
    }
  };

  return (
    <div className="py-1">
      <Section title="Lighting" icon={<Lightbulb className={ICON} />} defaultOpen divider={false}>
        <FieldRow label="Ambient">
          <DebouncedSlider
            label="Ambient"
            min={0}
            max={1}
            value={lightingSettings.ambientLightIntensity}
            format={formatPercent}
            onChange={(value) =>
              updateLightingSettings(surfaceViewId, { ambientLightIntensity: value })
            }
          />
        </FieldRow>
        <FieldRow label="Directional">
          <DebouncedSlider
            label="Directional"
            min={0}
            max={2}
            value={lightingSettings.directionalLightIntensity}
            format={formatPercent}
            onChange={(value) =>
              updateLightingSettings(surfaceViewId, { directionalLightIntensity: value })
            }
          />
        </FieldRow>
        <FieldRow label="Fill">
          <DebouncedSlider
            label="Fill"
            min={0}
            max={1}
            value={lightingSettings.fillLightIntensity || 0.5}
            format={formatPercent}
            onChange={(value) =>
              updateLightingSettings(surfaceViewId, { fillLightIntensity: value })
            }
          />
        </FieldRow>
        <FieldRow label="Position">
          {(field) => (
            <SegmentedControl
              id={field.id}
              aria-labelledby={`${field.id}-label`}
              options={LIGHT_POSITION_OPTIONS}
              value={activePositionName}
              onValueChange={handlePositionSelect}
              fullWidth
              className="w-full"
            />
          )}
        </FieldRow>
        <FieldRow label="Presets">
          {() => (
            <div className="grid w-full grid-cols-3 gap-1">
              {LIGHTING_PRESETS.map((preset) => (
                <Button
                  key={preset.name}
                  variant="secondary"
                  size="sm"
                  className="min-w-0 px-1"
                  onClick={() => handlePresetApply(preset.name)}
                >
                  {preset.name}
                </Button>
              ))}
            </div>
          )}
        </FieldRow>
      </Section>

      <Section title="Appearance" icon={<Eye className={ICON} />} defaultOpen={false}>
        <FieldRow label="Wireframe">
          <Switch
            checked={displaySettings.wireframe}
            onCheckedChange={(checked) =>
              updateDisplaySettings(surfaceViewId, { wireframe: checked })
            }
          />
        </FieldRow>
        <FieldRow label="Flat shading">
          <Switch
            checked={displaySettings.flatShading}
            onCheckedChange={(checked) =>
              updateDisplaySettings(surfaceViewId, { flatShading: checked })
            }
          />
        </FieldRow>
        <FieldRow label="Opacity">
          <DebouncedSlider
            label="Opacity"
            min={0}
            max={1}
            value={displaySettings.opacity}
            format={formatPercent}
            onChange={(value) => updateDisplaySettings(surfaceViewId, { opacity: value })}
          />
        </FieldRow>
        <FieldRow label="Smoothing">
          <DebouncedSlider
            label="Smoothing"
            min={0}
            max={1}
            value={displaySettings.smoothing}
            format={formatPercent}
            onChange={(value) => updateDisplaySettings(surfaceViewId, { smoothing: value })}
          />
        </FieldRow>
      </Section>

      <Section title="Material" icon={<Sparkles className={ICON} />} defaultOpen={false}>
        <FieldRow label="Surface color" meta={materialSettings.surfaceColor}>
          <ColorSwatch
            value={materialSettings.surfaceColor}
            onChange={(value) => updateMaterialSettings(surfaceViewId, { surfaceColor: value })}
          />
        </FieldRow>
        <FieldRow label="Specular color" meta={materialSettings.specularColor}>
          <ColorSwatch
            value={materialSettings.specularColor}
            onChange={(value) => updateMaterialSettings(surfaceViewId, { specularColor: value })}
          />
        </FieldRow>
        <FieldRow label="Shininess">
          <DebouncedSlider
            label="Shininess"
            min={0}
            max={200}
            step={1}
            value={materialSettings.shininess}
            format={formatInteger}
            onChange={(value) => updateMaterialSettings(surfaceViewId, { shininess: value })}
          />
        </FieldRow>
        <FieldRow label="Emissive color" meta={materialSettings.emissiveColor}>
          <ColorSwatch
            value={materialSettings.emissiveColor}
            onChange={(value) => updateMaterialSettings(surfaceViewId, { emissiveColor: value })}
          />
        </FieldRow>
        <FieldRow label="Emissive">
          <DebouncedSlider
            label="Emissive intensity"
            min={0}
            max={1}
            value={materialSettings.emissiveIntensity}
            format={formatPercent}
            onChange={(value) =>
              updateMaterialSettings(surfaceViewId, { emissiveIntensity: value })
            }
          />
        </FieldRow>
      </Section>

      <Section title="Volume projection" icon={<Zap className={ICON} />} defaultOpen={false}>
        <FieldRow
          label="GPU mode"
          layout="stacked"
          hint={
            projectionSettings.useGPUProjection
              ? 'GPU mode: Volume data is sampled directly in the shader. Better for 4D time series.'
              : 'CPU mode: Per-vertex values are pre-computed. More reliable on all hardware.'
          }
        >
          <Switch
            checked={projectionSettings.useGPUProjection}
            onCheckedChange={(checked) =>
              updateProjectionSettings(surfaceViewId, { useGPUProjection: checked })
            }
          />
        </FieldRow>
      </Section>
    </div>
  );
};
