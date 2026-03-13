/**
 * Surface Geometry Controls
 * Reworked into high-density instrument strips (label left, control center, value right)
 */

import React from 'react';
import {
  DEFAULT_SURFACE_VIEW_SETTINGS,
  useSurfaceStore,
} from '@/stores/surfaceStore';
import { Switch } from '@/components/ui/shadcn/switch';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { SingleSlider } from '@/components/ui/SingleSlider';
import { Lightbulb, Eye, Sparkles, Zap } from 'lucide-react';

const labelWidth = '6.2rem';
const valueWidth = '3.6rem';
const rowBase = 'flex items-center gap-3 py-1.5 px-2 border-b border-border/40 last:border-b-0';
const labelClass = 'text-[10px] uppercase tracking-wider font-bold text-right shrink-0 text-foreground/80';
const valueClass = 'text-[10px] font-mono text-foreground text-right shrink-0';

const SegmentedControl: React.FC<{
  options: string[];
  active: string;
  onSelect: (value: string) => void;
}> = ({ options, active, onSelect }) => (
  <div className="flex flex-1 items-center border border-border rounded-[2px] overflow-hidden h-7">
    {options.map((option, idx) => (
      <button
        key={option}
        className={`flex-1 py-1 text-[10px] font-medium uppercase border-r border-border last:border-0 transition-colors ${
          active === option
            ? 'bg-accent text-accent-foreground'
            : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
        onClick={() => onSelect(option)}
      >
        {option}
      </button>
    ))}
  </div>
);

const ToggleRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <div className={rowBase}>
    <span className={labelClass} style={{ width: labelWidth }}>
      {label}
    </span>
    <div className="flex-1 flex justify-end">
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  </div>
);

const ColorRow: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, value, onChange }) => (
  <div className={rowBase}>
    <span className={labelClass} style={{ width: labelWidth }}>
      {label}
    </span>
    <div className="flex items-center gap-2 flex-1">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-10 border border-border/60 rounded-[2px] bg-transparent cursor-pointer"
      />
      <span className={`${valueClass} text-left`}>{value}</span>
    </div>
  </div>
);

interface SurfaceGeometryControlsProps {
  surfaceViewId: string;
}

export const SurfaceGeometryControls: React.FC<SurfaceGeometryControlsProps> = ({ surfaceViewId }) => {
  const lightingSettings = useSurfaceStore(
    (state) =>
      state.surfaceViewSettings.get(surfaceViewId)?.lightingSettings ??
      DEFAULT_SURFACE_VIEW_SETTINGS.lightingSettings
  );
  const displaySettings = useSurfaceStore(
    (state) =>
      state.surfaceViewSettings.get(surfaceViewId)?.displaySettings ??
      DEFAULT_SURFACE_VIEW_SETTINGS.displaySettings
  );
  const materialSettings = useSurfaceStore(
    (state) =>
      state.surfaceViewSettings.get(surfaceViewId)?.materialSettings ??
      DEFAULT_SURFACE_VIEW_SETTINGS.materialSettings
  );
  const projectionSettings = useSurfaceStore(
    (state) =>
      state.surfaceViewSettings.get(surfaceViewId)?.projectionSettings ??
      DEFAULT_SURFACE_VIEW_SETTINGS.projectionSettings
  );
  const updateLightingSettings = useSurfaceStore((state) => state.updateSurfaceViewLightingSettings);
  const updateDisplaySettings = useSurfaceStore((state) => state.updateSurfaceViewDisplaySettings);
  const updateMaterialSettings = useSurfaceStore((state) => state.updateSurfaceViewMaterialSettings);
  const updateProjectionSettings = useSurfaceStore((state) => state.updateSurfaceViewProjectionSettings);

  const lightPresets = [
    { name: 'Bright', values: { ambientLightIntensity: 1.2, directionalLightIntensity: 1.5, fillLightIntensity: 0.7 } },
    { name: 'Soft', values: { ambientLightIntensity: 1.0, directionalLightIntensity: 0.8, fillLightIntensity: 0.6 } },
    { name: 'Dramatic', values: { ambientLightIntensity: 0.4, directionalLightIntensity: 2.0, fillLightIntensity: 0.1 } },
    { name: 'Dark', values: { ambientLightIntensity: 0.3, directionalLightIntensity: 0.5, fillLightIntensity: 0.2 } },
    { name: 'Clinical', values: { ambientLightIntensity: 1.1, directionalLightIntensity: 1.0, fillLightIntensity: 0.8 } },
    { name: 'Default', values: { ambientLightIntensity: 0.4, directionalLightIntensity: 1.0, fillLightIntensity: 0.5 } },
  ];

  const lightPositions = [
    { name: 'Front', position: [0, 0, 100] as [number, number, number] },
    { name: 'Top', position: [0, 100, 0] as [number, number, number] },
    { name: 'Side', position: [100, 0, 0] as [number, number, number] },
    { name: 'Default', position: [100, 100, 100] as [number, number, number] },
  ];

  const activePosition = lightingSettings.lightPosition || lightPositions[3].position;
  const activePositionName =
    lightPositions.find((p) => p.position.every((v, idx) => v === activePosition[idx]))?.name || 'Default';

  const handlePositionSelect = (name: string) => {
    const preset = lightPositions.find((p) => p.name === name);
    if (preset) {
      updateLightingSettings(surfaceViewId, { lightPosition: preset.position });
    }
  };

  const handlePresetApply = (presetName: string) => {
    const preset = lightPresets.find((p) => p.name === presetName);
    if (preset) {
      updateLightingSettings(surfaceViewId, preset.values);
    }
  };

  return (
    <div className="p-3 space-y-3">
      {/* Lighting */}
      <CollapsibleSection title="Lighting" icon={Lightbulb} defaultExpanded>
        <div className="rounded-sm border border-border/50 bg-muted/10">
          <SingleSlider
            label="Ambient"
            min={0}
            max={1}
            value={lightingSettings.ambientLightIntensity}
            onChange={(value) => updateLightingSettings(surfaceViewId, { ambientLightIntensity: value })}
            layout="strip"
            compact
            highContrast
            labelWidth={labelWidth}
            valueWidth={valueWidth}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            className="px-2"
          />
          <SingleSlider
            label="Directional"
            min={0}
            max={2}
            value={lightingSettings.directionalLightIntensity}
            onChange={(value) => updateLightingSettings(surfaceViewId, { directionalLightIntensity: value })}
            layout="strip"
            compact
            highContrast
            labelWidth={labelWidth}
            valueWidth={valueWidth}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            className="px-2"
          />
          <SingleSlider
            label="Fill"
            min={0}
            max={1}
            value={lightingSettings.fillLightIntensity || 0.5}
            onChange={(value) => updateLightingSettings(surfaceViewId, { fillLightIntensity: value })}
            layout="strip"
            compact
            highContrast
            labelWidth={labelWidth}
            valueWidth={valueWidth}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            className="px-2"
          />

          <div className={`${rowBase} px-2`}>
            <span className={labelClass} style={{ width: labelWidth }}>
              Position
            </span>
            <SegmentedControl
              options={lightPositions.map((p) => p.name)}
              active={activePositionName}
              onSelect={handlePositionSelect}
            />
          </div>

          <div className="grid grid-cols-3 gap-1 py-2 pl-[110px] pr-2">
            {lightPresets.map((preset) => (
              <button
                key={preset.name}
                className="bg-muted/30 hover:bg-accent hover:text-white border border-transparent hover:border-accent/50 text-[10px] uppercase tracking-wide py-1.5 rounded-[1px] transition-all"
                onClick={() => handlePresetApply(preset.name)}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      </CollapsibleSection>

      {/* Appearance */}
      <CollapsibleSection title="Appearance" icon={Eye} defaultExpanded={false}>
        <div className="rounded-sm border border-border/50 bg-muted/10">
          <ToggleRow
            label="Wireframe"
            checked={displaySettings.wireframe}
            onChange={(checked) => updateDisplaySettings(surfaceViewId, { wireframe: checked })}
          />
          <ToggleRow
            label="Flat Shading"
            checked={displaySettings.flatShading}
            onChange={(checked) => updateDisplaySettings(surfaceViewId, { flatShading: checked })}
          />
          <SingleSlider
            label="Opacity"
            min={0}
            max={1}
            value={displaySettings.opacity}
            onChange={(value) => updateDisplaySettings(surfaceViewId, { opacity: value })}
            layout="strip"
            compact
            highContrast
            labelWidth={labelWidth}
            valueWidth={valueWidth}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            className="px-2"
          />
          <SingleSlider
            label="Smoothing"
            min={0}
            max={1}
            value={displaySettings.smoothing}
            onChange={(value) => updateDisplaySettings(surfaceViewId, { smoothing: value })}
            layout="strip"
            compact
            highContrast
            labelWidth={labelWidth}
            valueWidth={valueWidth}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            className="px-2"
          />
        </div>
      </CollapsibleSection>

      {/* Material */}
      <CollapsibleSection title="Material" icon={Sparkles} defaultExpanded={false}>
        <div className="rounded-sm border border-border/50 bg-muted/10">
          <ColorRow
            label="Surface Color"
            value={materialSettings.surfaceColor}
            onChange={(value) => updateMaterialSettings(surfaceViewId, { surfaceColor: value })}
          />
          <ColorRow
            label="Specular Color"
            value={materialSettings.specularColor}
            onChange={(value) => updateMaterialSettings(surfaceViewId, { specularColor: value })}
          />
          <SingleSlider
            label="Shininess"
            min={0}
            max={200}
            value={materialSettings.shininess}
            onChange={(value) => updateMaterialSettings(surfaceViewId, { shininess: value })}
            layout="strip"
            compact
            highContrast
            labelWidth={labelWidth}
            valueWidth={valueWidth}
            formatValue={(v) => v.toFixed(0)}
            className="px-2"
          />
          <ColorRow
            label="Emissive Color"
            value={materialSettings.emissiveColor}
            onChange={(value) => updateMaterialSettings(surfaceViewId, { emissiveColor: value })}
          />
          <SingleSlider
            label="Emissive Intensity"
            min={0}
            max={1}
            value={materialSettings.emissiveIntensity}
            onChange={(value) => updateMaterialSettings(surfaceViewId, { emissiveIntensity: value })}
            layout="strip"
            compact
            highContrast
            labelWidth={labelWidth}
            valueWidth={valueWidth}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            className="px-2"
          />
        </div>
      </CollapsibleSection>

      {/* Volume Projection */}
      <CollapsibleSection title="Volume Projection" icon={Zap} defaultExpanded={false}>
        <div className="rounded-sm border border-border/50 bg-muted/10">
          <ToggleRow
            label="GPU Mode"
            checked={projectionSettings.useGPUProjection}
            onChange={(checked) => updateProjectionSettings(surfaceViewId, { useGPUProjection: checked })}
          />
          <div className="px-2 py-2 text-[10px] text-muted-foreground">
            {projectionSettings.useGPUProjection ? (
              <span>GPU mode: Volume data is sampled directly in the shader. Better for 4D time series.</span>
            ) : (
              <span>CPU mode: Per-vertex values are pre-computed. More reliable on all hardware.</span>
            )}
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};
