/**
 * CrosshairSettingsDialog
 * 
 * Compact modal dialog for configuring crosshair appearance.
 * Uses a clean two-column grid layout with collapsible sections.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { Slider } from '@/components/ui/shadcn/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/shadcn/radio-group';
import { Button } from '@/components/ui/shadcn/button';
import { Modal } from '@/components/ui/Modal';
import { useCrosshairSettings } from '@/contexts/CrosshairContext';
import type { CrosshairSettings } from '@/contexts/CrosshairContext';

interface CrosshairSettingsDialogProps {
  onClose: () => void;
}

export function CrosshairSettingsDialog({ onClose }: CrosshairSettingsDialogProps) {
  const { settings: currentSettings, updateSettings } = useCrosshairSettings();
  const [localSettings, setLocalSettings] = useState<CrosshairSettings>(currentSettings);
  const [mirrorExpanded, setMirrorExpanded] = useState(localSettings.showMirror);
  const visibleSwitchRef = useRef<HTMLButtonElement | null>(null);
  // Store the initial settings to revert on cancel
  const initialSettingsRef = useRef<CrosshairSettings>(currentSettings);

  const updateLocalSetting = <K extends keyof CrosshairSettings>(
    key: K,
    value: CrosshairSettings[K]
  ) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
    // Immediately update the actual settings for real-time preview
    updateSettings({ [key]: value } as Partial<CrosshairSettings>);
  };

  const handleDone = useCallback(() => {
    // Settings have been applied in real-time, just close the dialog
    onClose();
  }, [onClose]);

  const handleCancel = useCallback(() => {
    // Revert to the original settings that were active when dialog opened
    updateSettings(initialSettingsRef.current);
    onClose();
  }, [updateSettings, onClose]);

  const handleReset = () => {
    const defaults: CrosshairSettings = {
      visible: true,
      activeColor: '#ffff00',
      activeThickness: 1,
      activeStyle: 'solid',
      showMirror: false,
      mirrorColor: '#ff0000',
      mirrorOpacity: 0.6,
      mirrorThickness: 1,
      mirrorStyle: 'dashed',
      autoContrast: false,
      snapToVoxel: true,
      showCoordinates: false,
      coordinateFormat: 'mm'
    };
    setLocalSettings(defaults);
    // Apply the reset immediately
    updateSettings(defaults);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleDone();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCancel, handleDone]);

  // Field component for consistent layout
  const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="grid grid-cols-[100px_1fr] items-center gap-3">
      <Label className="text-sm text-gray-300">{label}</Label>
      {children}
    </div>
  );

  return (
    <Modal
      isOpen={true}
      onClose={handleCancel}
      title="Crosshair Settings"
      ariaLabel="Crosshair Settings"
      size="sm"
      initialFocusRef={visibleSwitchRef}
      bodyClassName="p-0"
      className="max-w-sm rounded-xl ring-1 ring-white/10 shadow-2xl"
    >
        <div className="flex-1 overflow-y-auto">
          {/* Visibility Section */}
          <section className="px-6 py-5 border-b space-y-4" style={{ borderColor: 'var(--app-border-subtle, #1e293b)' }}>
            <h3 className="font-medium text-gray-200">Visibility</h3>
            <Field label="Show crosshairs">
              <div className="flex items-center justify-between">
                <Switch
                  ref={visibleSwitchRef}
                  checked={localSettings.visible}
                  onCheckedChange={(checked) => updateLocalSetting('visible', checked)}
                />
                <span className="text-xs text-gray-500">Hotkey: C</span>
              </div>
            </Field>
          </section>

          {/* Active Crosshair Section */}
          <section className="px-6 py-5 border-b space-y-4" style={{ borderColor: 'var(--app-border-subtle, #1e293b)' }}>
            <h3 className="font-medium text-gray-200">Active crosshair</h3>
            
            <Field label="Color">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={localSettings.activeColor}
                  onChange={(e) => updateLocalSetting('activeColor', e.target.value)}
                  className="h-8 w-16 rounded border border-gray-700 bg-gray-800 cursor-pointer hover:border-gray-600"
                />
                <span className="text-xs text-gray-500">{localSettings.activeColor}</span>
              </div>
            </Field>

            <Field label="Thickness">
              <div className="flex items-center gap-3">
                <Slider
                  min={1}
                  max={5}
                  step={0.5}
                  value={[localSettings.activeThickness]}
                  onValueChange={([v]) => updateLocalSetting('activeThickness', v)}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-8 text-right">{localSettings.activeThickness}</span>
              </div>
            </Field>

            <Field label="Style">
              <RadioGroup
                value={localSettings.activeStyle}
                onValueChange={(v) => updateLocalSetting('activeStyle', v as 'solid' | 'dashed' | 'dotted')}
                className="flex gap-4"
              >
                {(['solid', 'dashed', 'dotted'] as const).map((style) => (
                  <div key={style} className="flex items-center gap-1.5">
                    <RadioGroupItem value={style} id={`active-${style}`} className="h-4 w-4" />
                    <Label htmlFor={`active-${style}`} className="capitalize text-sm cursor-pointer">
                      {style}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </Field>
          </section>

          {/* Mirror Crosshairs Section - Collapsible */}
          <section className="border-b" style={{ borderColor: 'var(--app-border-subtle, #1e293b)' }}>
            <button
              onClick={() => setMirrorExpanded(!mirrorExpanded)}
              className="w-full px-6 py-5 flex items-center justify-between hover:bg-gray-800/30 transition-colors"
            >
              <h3 className="font-medium text-gray-200">Mirror crosshairs</h3>
              <ChevronDown 
                className={`w-4 h-4 text-gray-400 transition-transform ${
                  mirrorExpanded ? 'rotate-180' : ''
                }`} 
              />
            </button>
            
            {mirrorExpanded && (
              <div className="px-6 pb-5 space-y-4">
                <Field label="Show lines">
                  <Switch
                    checked={localSettings.showMirror}
                    onCheckedChange={(checked) => updateLocalSetting('showMirror', checked)}
                  />
                </Field>

                {localSettings.showMirror && (
                  <>
                    <Field label="Color">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={localSettings.mirrorColor}
                          onChange={(e) => updateLocalSetting('mirrorColor', e.target.value)}
                          className="h-8 w-16 rounded border border-gray-700 bg-gray-800 cursor-pointer hover:border-gray-600"
                        />
                        <span className="text-xs text-gray-500">{localSettings.mirrorColor}</span>
                      </div>
                    </Field>

                    <Field label="Opacity">
                      <div className="flex items-center gap-3">
                        <Slider
                          min={0}
                          max={1}
                          step={0.1}
                          value={[localSettings.mirrorOpacity]}
                          onValueChange={([v]) => updateLocalSetting('mirrorOpacity', v)}
                          className="flex-1"
                        />
                        <span className="text-xs text-gray-400 w-8 text-right">
                          {Math.round(localSettings.mirrorOpacity * 100)}%
                        </span>
                      </div>
                    </Field>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--app-border-subtle, #1e293b)' }}>
          <Button
            onClick={handleReset}
            variant="outline"
            size="sm"
          >
            Reset
          </Button>
          <div className="flex gap-2">
            <Button
              onClick={handleCancel}
              variant="ghost"
              size="sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDone}
              variant="default"
              size="sm"
            >
              Done
            </Button>
          </div>
        </div>
    </Modal>
  );
}
