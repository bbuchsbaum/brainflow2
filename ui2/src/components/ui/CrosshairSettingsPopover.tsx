/**
 * CrosshairSettingsPopover Component
 * 
 * Quick settings popover for common crosshair adjustments.
 * Part of the three-tier crosshair settings approach.
 */

import React from 'react';
import { Settings, Palette } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/shadcn/popover';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Slider } from '@/components/ui/shadcn/slider';
import { Switch } from '@/components/ui/shadcn/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/shadcn/radio-group';
import { useCrosshairSettings } from '@/contexts/CrosshairContext';
import { cn } from '@/utils/cn';

interface CrosshairSettingsPopoverProps {
  className?: string;
}

export function CrosshairSettingsPopover({ className }: CrosshairSettingsPopoverProps) {
  const { settings, updateSettings, colorPresets } = useCrosshairSettings();
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", className)}
          aria-label="Crosshair settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Crosshair Settings</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // TODO: Open advanced settings
                console.log('Open advanced settings');
              }}
            >
              Advanced
            </Button>
          </div>
          
          {/* Active Crosshair Color */}
          <div className="space-y-2">
            <Label className="text-xs">Crosshair Color</Label>
            <div className="grid grid-cols-4 gap-2">
              {colorPresets.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => updateSettings({ activeColor: preset.value })}
                  className={cn(
                    "h-8 w-full rounded border-2 transition-all",
                    settings.activeColor === preset.value
                      ? "border-[var(--app-accent)] scale-110"
                      : "border-transparent hover:border-[var(--app-border)]"
                  )}
                  style={{ backgroundColor: preset.value }}
                  title={preset.name}
                  aria-label={`Set crosshair color to ${preset.name}`}
                />
              ))}
            </div>
          </div>
          
          {/* Thickness */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Thickness</Label>
              <span className="text-xs text-[var(--app-text-secondary)]">
                {settings.activeThickness}px
              </span>
            </div>
            <Slider
              value={[settings.activeThickness]}
              onValueChange={([value]) => updateSettings({ activeThickness: value })}
              min={1}
              max={5}
              step={1}
              className="w-full"
            />
          </div>
          
          {/* Line Style */}
          <div className="space-y-2">
            <Label className="text-xs">Line Style</Label>
            <RadioGroup
              value={settings.activeStyle}
              onValueChange={(value: 'solid' | 'dashed' | 'dotted') => 
                updateSettings({ activeStyle: value })
              }
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="solid" id="solid" />
                <Label htmlFor="solid" className="text-xs cursor-pointer">
                  Solid
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="dashed" id="dashed" />
                <Label htmlFor="dashed" className="text-xs cursor-pointer">
                  Dashed
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="dotted" id="dotted" />
                <Label htmlFor="dotted" className="text-xs cursor-pointer">
                  Dotted
                </Label>
              </div>
            </RadioGroup>
          </div>
          
          {/* Mirror Crosshair Toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="mirror" className="text-xs">
              Show Mirror Crosshairs
            </Label>
            <Switch
              id="mirror"
              checked={settings.showMirror}
              onCheckedChange={(checked) => updateSettings({ showMirror: checked })}
            />
          </div>
          
          {/* Mirror Opacity (only shown when mirror is enabled) */}
          {settings.showMirror && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Mirror Opacity</Label>
                <span className="text-xs text-[var(--app-text-secondary)]">
                  {Math.round(settings.mirrorOpacity * 100)}%
                </span>
              </div>
              <Slider
                value={[settings.mirrorOpacity]}
                onValueChange={([value]) => updateSettings({ mirrorOpacity: value })}
                min={0.1}
                max={1}
                step={0.1}
                className="w-full"
              />
            </div>
          )}
          
          {/* Auto Contrast */}
          <div className="flex items-center justify-between">
            <Label htmlFor="autocontrast" className="text-xs">
              Auto Contrast
            </Label>
            <Switch
              id="autocontrast"
              checked={settings.autoContrast}
              onCheckedChange={(checked) => updateSettings({ autoContrast: checked })}
            />
          </div>
          
          {/* Snap to Voxel */}
          <div className="flex items-center justify-between">
            <Label htmlFor="snap" className="text-xs">
              Snap to Voxel
            </Label>
            <Switch
              id="snap"
              checked={settings.snapToVoxel}
              onCheckedChange={(checked) => updateSettings({ snapToVoxel: checked })}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}