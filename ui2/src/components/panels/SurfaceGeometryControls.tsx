/**
 * Surface Geometry Controls
 * Controls for surface mesh appearance, lighting, and material properties
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { Slider } from '@/components/ui/shadcn/slider';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { Button } from '@/components/ui/Button';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { 
  Sun, 
  Lightbulb, 
  Palette, 
  Box,
  Grid3x3,
  Eye,
  Sparkles
} from 'lucide-react';

export const SurfaceGeometryControls: React.FC = () => {
  const { renderSettings, updateRenderSettings } = useSurfaceStore();
  
  // Debounce smoothing updates to avoid excessive re-renders
  const [localSmoothing, setLocalSmoothing] = useState(renderSettings.smoothing);
  
  // Sync local state when global state changes
  useEffect(() => {
    setLocalSmoothing(renderSettings.smoothing);
  }, [renderSettings.smoothing]);
  
  const debouncedSmoothingUpdate = useMemo(
    () => {
      let timeoutId: NodeJS.Timeout;
      return (value: number) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          updateRenderSettings({ smoothing: value });
        }, 100); // 100ms debounce
      };
    },
    [updateRenderSettings]
  );

  // Preset light positions
  const lightPresets = [
    { name: 'Front', position: [0, 0, 100] as [number, number, number] },
    { name: 'Top', position: [0, 100, 0] as [number, number, number] },
    { name: 'Side', position: [100, 0, 0] as [number, number, number] },
    { name: 'Default', position: [100, 100, 100] as [number, number, number] },
  ];

  return (
    <div className="p-4 space-y-2">
      {/* Lighting Section */}
      <CollapsibleSection 
        title="Lighting" 
        icon={Lightbulb} 
        defaultExpanded={true}
      >
        <div className="space-y-3">
          {/* Ambient Light */}
          <div className="space-y-1">
            <Label className="text-xs">Ambient Light</Label>
            <Slider
              value={[renderSettings.ambientLightIntensity]}
              onValueChange={([value]) => updateRenderSettings({ ambientLightIntensity: value })}
              min={0}
              max={1}
              step={0.01}
              className="w-full"
            />
            <div className="text-xs text-muted-foreground text-right">
              {(renderSettings.ambientLightIntensity * 100).toFixed(0)}%
            </div>
          </div>

          {/* Directional Light */}
          <div className="space-y-1">
            <Label className="text-xs">Directional Light</Label>
            <Slider
              value={[renderSettings.directionalLightIntensity]}
              onValueChange={([value]) => updateRenderSettings({ directionalLightIntensity: value })}
              min={0}
              max={2}
              step={0.01}
              className="w-full"
            />
            <div className="text-xs text-muted-foreground text-right">
              {(renderSettings.directionalLightIntensity * 100).toFixed(0)}%
            </div>
          </div>
          
          {/* Fill Light (Secondary) */}
          <div className="space-y-1">
            <Label className="text-xs">Fill Light</Label>
            <Slider
              value={[renderSettings.fillLightIntensity || 0.5]}
              onValueChange={([value]) => updateRenderSettings({ fillLightIntensity: value })}
              min={0}
              max={1}
              step={0.01}
              className="w-full"
            />
            <div className="text-xs text-muted-foreground text-right">
              {((renderSettings.fillLightIntensity || 0.5) * 100).toFixed(0)}%
            </div>
          </div>

          {/* Light Position Presets */}
          <div className="space-y-1">
            <Label className="text-xs">Light Position</Label>
            <div className="grid grid-cols-2 gap-1">
              {lightPresets.map((preset) => (
                <Button
                  key={preset.name}
                  size="sm"
                  variant={
                    JSON.stringify(renderSettings.lightPosition) === JSON.stringify(preset.position)
                      ? 'default'
                      : 'secondary'
                  }
                  onClick={() => updateRenderSettings({ lightPosition: preset.position })}
                  className="h-7 text-xs"
                >
                  {preset.name}
                </Button>
              ))}
            </div>
          </div>
          
          {/* Lighting Presets */}
          <div className="space-y-1">
            <Label className="text-xs">Lighting Presets</Label>
            <div className="grid grid-cols-3 gap-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => updateRenderSettings({ 
                  ambientLightIntensity: 1.2, 
                  directionalLightIntensity: 1.5,
                  fillLightIntensity: 0.7
                })}
                className="h-7 text-xs"
              >
                Bright
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => updateRenderSettings({ 
                  ambientLightIntensity: 1.0, 
                  directionalLightIntensity: 0.8,
                  fillLightIntensity: 0.6
                })}
                className="h-7 text-xs"
              >
                Soft
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => updateRenderSettings({ 
                  ambientLightIntensity: 0.4, 
                  directionalLightIntensity: 2.0,
                  fillLightIntensity: 0.1
                })}
                className="h-7 text-xs"
              >
                Dramatic
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => updateRenderSettings({ 
                  ambientLightIntensity: 0.3, 
                  directionalLightIntensity: 0.5,
                  fillLightIntensity: 0.2
                })}
                className="h-7 text-xs"
              >
                Dark
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => updateRenderSettings({ 
                  ambientLightIntensity: 1.1, 
                  directionalLightIntensity: 1.0,
                  fillLightIntensity: 0.8
                })}
                className="h-7 text-xs"
              >
                Clinical
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => updateRenderSettings({ 
                  ambientLightIntensity: 0.4, 
                  directionalLightIntensity: 1.0,
                  fillLightIntensity: 0.5
                })}
                className="h-7 text-xs"
              >
                Default
              </Button>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Appearance Section */}
      <CollapsibleSection 
        title="Appearance" 
        icon={Eye} 
        defaultExpanded={false}
      >
        <div className="space-y-3">
          {/* Wireframe Toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-xs flex items-center gap-2">
              <Grid3x3 className="h-3 w-3" />
              Wireframe
            </Label>
            <Switch
              checked={renderSettings.wireframe}
              onCheckedChange={(checked) => updateRenderSettings({ wireframe: checked })}
            />
          </div>

          {/* Flat Shading Toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-xs flex items-center gap-2">
              <Box className="h-3 w-3" />
              Flat Shading
            </Label>
            <Switch
              checked={renderSettings.flatShading}
              onCheckedChange={(checked) => updateRenderSettings({ flatShading: checked })}
            />
          </div>

          {/* Show Normals Toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-xs">Show Normals</Label>
            <Switch
              checked={renderSettings.showNormals}
              onCheckedChange={(checked) => updateRenderSettings({ showNormals: checked })}
            />
          </div>

          {/* Opacity */}
          <div className="space-y-1">
            <Label className="text-xs">Opacity</Label>
            <Slider
              value={[renderSettings.opacity]}
              onValueChange={([value]) => updateRenderSettings({ opacity: value })}
              min={0}
              max={1}
              step={0.01}
              className="w-full"
            />
            <div className="text-xs text-muted-foreground text-right">
              {(renderSettings.opacity * 100).toFixed(0)}%
            </div>
          </div>

          {/* Geometry Smoothing (Laplacian) */}
          <div className="space-y-1">
            <Label className="text-xs">Geometry Smoothing</Label>
            <Slider
              value={[localSmoothing]}
              onValueChange={([value]) => {
                setLocalSmoothing(value);
                debouncedSmoothingUpdate(value);
              }}
              min={0}
              max={1}
              step={0.01}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {localSmoothing === 0 ? 'Off' : 
                 localSmoothing < 0.3 ? 'Gentle' :
                 localSmoothing < 0.6 ? 'Moderate' : 'Strong'}
              </span>
              <span>{(localSmoothing * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Material Properties Section */}
      <CollapsibleSection 
        title="Material" 
        icon={Sparkles} 
        defaultExpanded={false}
      >
        <div className="space-y-3">
          {/* Surface Color */}
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-2">
              <Palette className="h-3 w-3" />
              Surface Color
            </Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={renderSettings.surfaceColor}
                onChange={(e) => updateRenderSettings({ surfaceColor: e.target.value })}
                className="h-8 w-16 rounded border cursor-pointer flex-shrink-0"
              />
              <span className="text-xs text-muted-foreground">
                {renderSettings.surfaceColor}
              </span>
            </div>
          </div>

          {/* Specular Color */}
          <div className="space-y-1">
            <Label className="text-xs">Specular Color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={renderSettings.specularColor}
                onChange={(e) => updateRenderSettings({ specularColor: e.target.value })}
                className="h-8 w-16 rounded border cursor-pointer flex-shrink-0"
              />
              <span className="text-xs text-muted-foreground">
                {renderSettings.specularColor}
              </span>
            </div>
          </div>

          {/* Shininess */}
          <div className="space-y-1">
            <Label className="text-xs">Shininess</Label>
            <Slider
              value={[renderSettings.shininess]}
              onValueChange={([value]) => updateRenderSettings({ shininess: value })}
              min={0}
              max={200}
              step={1}
              className="w-full"
            />
            <div className="text-xs text-muted-foreground text-right">
              {renderSettings.shininess}
            </div>
          </div>

          {/* Emissive Color */}
          <div className="space-y-1">
            <Label className="text-xs">Emissive Color (Glow)</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={renderSettings.emissiveColor}
                onChange={(e) => updateRenderSettings({ emissiveColor: e.target.value })}
                className="h-8 w-16 rounded border cursor-pointer flex-shrink-0"
              />
              <span className="text-xs text-muted-foreground">
                {renderSettings.emissiveColor}
              </span>
            </div>
          </div>

          {/* Emissive Intensity */}
          <div className="space-y-1">
            <Label className="text-xs">Emissive Intensity</Label>
            <Slider
              value={[renderSettings.emissiveIntensity]}
              onValueChange={([value]) => updateRenderSettings({ emissiveIntensity: value })}
              min={0}
              max={1}
              step={0.01}
              className="w-full"
            />
            <div className="text-xs text-muted-foreground text-right">
              {(renderSettings.emissiveIntensity * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};