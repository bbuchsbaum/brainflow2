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
import * as SliderPrimitive from '@radix-ui/react-slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/shadcn/radio-group';
import { Button } from '@/components/ui/shadcn/button';
import { Modal } from '@/components/ui/Modal';
import { useCrosshairSettings } from '@/contexts/CrosshairContext';
import type { CrosshairSettings } from '@/contexts/CrosshairContext';
import { DEFAULT_SETTINGS, MEDICAL_COLOR_PRESETS } from '@/stores/crosshairSettingsStore';

interface CrosshairSettingsDialogProps {
  onClose: () => void;
}

// Field row for consistent layout. Defined at module scope so it keeps a
// stable component identity across renders (an inline component would remount
// its children, e.g. interrupting a slider drag, on every state change).
const Field: React.FC<{ label: string; htmlFor?: string; children: React.ReactNode }> = ({
  label,
  htmlFor,
  children,
}) => (
  <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
    <Label htmlFor={htmlFor} className="text-bf-sm font-normal text-muted-foreground">
      {label}
    </Label>
    {children}
  </div>
);

// Slider with a named thumb. Radix puts `aria-label` on the thumb (the
// element with role=slider) only when it is passed to the Thumb itself, so the
// shared shadcn Slider would leave it unnamed. Same visuals as that Slider.
const NamedSlider: React.FC<
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { thumbLabel: string; valueText?: string }
> = ({ thumbLabel, valueText, className = '', ...props }) => (
  <SliderPrimitive.Root
    className={`relative flex h-5 w-full touch-none select-none items-center ${className}`}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-[3px] w-full grow overflow-hidden rounded-full bg-[hsl(var(--muted))]">
      <SliderPrimitive.Range className="absolute h-full bg-[hsl(var(--primary))]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={thumbLabel}
      aria-valuetext={valueText}
      className="block h-3 w-3 rounded-full bg-primary ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 hover:bg-foreground cursor-pointer"
      style={{ boxShadow: '0 0 0 1px hsl(220 56% 4% / 0.7)' }}
    />
  </SliderPrimitive.Root>
);

// Selected swatch: an inner 2px neutral ring with a 1px dark inner edge (so it
// reads on light swatches too). Keyboard focus is a separate outer amber
// outline with an offset, so a focused selected swatch shows both.
const SWATCH_SELECTED_SHADOW =
  'inset 0 0 0 2px var(--bf-text-primary, #e6e7ea), inset 0 0 0 3px rgba(0, 0, 0, 0.6)';

// Section headings outrank field labels: same size, heavier and brighter.
const SECTION_HEADING = 'text-bf-sm font-semibold text-foreground';

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
    // Restore the store's canonical defaults exactly (single source of truth).
    const defaults: CrosshairSettings = { ...DEFAULT_SETTINGS };
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

  return (
    <Modal
      isOpen={true}
      onClose={handleCancel}
      title="Crosshair settings"
      ariaLabel="Crosshair settings"
      size="sm"
      initialFocusRef={visibleSwitchRef}
      bodyClassName="p-0"
      className="max-w-sm rounded-sm ring-1 ring-bf-border-strong shadow-2xl"
    >
        <div className="flex-1 overflow-y-auto">
          {/* Visibility Section */}
          <section className="px-6 py-5 border-b space-y-4" style={{ borderColor: 'var(--bf-border-subtle)' }}>
            <h3 className={SECTION_HEADING}>Visibility</h3>
            <Field label="Show crosshairs" htmlFor="crosshair-visible">
              <div className="flex items-center">
                <Switch
                  id="crosshair-visible"
                  ref={visibleSwitchRef}
                  checked={localSettings.visible}
                  onCheckedChange={(checked) => updateLocalSetting('visible', checked)}
                />
              </div>
            </Field>
          </section>

          {/* Active Crosshair Section */}
          <section className="px-6 py-5 border-b space-y-4" style={{ borderColor: 'var(--bf-border-subtle)' }}>
            <h3 className={SECTION_HEADING}>Active crosshair</h3>
            
            <Field label="Color">
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={localSettings.activeColor}
                    onChange={(e) => updateLocalSetting('activeColor', e.target.value)}
                    aria-label="Active crosshair color"
                    className="h-7 w-12 rounded-sm border border-border bg-bf-bg-input cursor-pointer hover:border-bf-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  />
                  <span className="font-mono text-bf-xs text-muted-foreground">{localSettings.activeColor}</span>
                </div>
                <div role="group" aria-label="Color presets" className="flex flex-wrap gap-1.5 p-0.5">
                  {MEDICAL_COLOR_PRESETS.map((preset) => {
                    const selected =
                      localSettings.activeColor.toLowerCase() === preset.value.toLowerCase();
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        aria-label={preset.name}
                        aria-pressed={selected}
                        title={`${preset.name} ${preset.value}`}
                        onClick={() => updateLocalSetting('activeColor', preset.value)}
                        className="h-5 w-5 rounded-sm border border-bf-border-strong outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bf-border-focus)]"
                        style={{
                          backgroundColor: preset.value,
                          boxShadow: selected ? SWATCH_SELECTED_SHADOW : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </Field>

            <Field label="Thickness">
              <div className="flex items-center gap-3">
                <NamedSlider
                  thumbLabel="Thickness"
                  valueText={`${localSettings.activeThickness} px`}
                  min={1}
                  max={5}
                  step={0.5}
                  value={[localSettings.activeThickness]}
                  onValueChange={([v]) => updateLocalSetting('activeThickness', v)}
                  className="flex-1 [&_[role=slider]]:bg-primary [&_[role=slider]:hover]:bg-primary"
                />
                <span className="font-mono text-bf-xs text-bf-text-secondary w-8 text-right">{localSettings.activeThickness}</span>
              </div>
            </Field>

            <Field label="Style">
              <RadioGroup
                value={localSettings.activeStyle}
                onValueChange={(v) => updateLocalSetting('activeStyle', v as 'solid' | 'dashed' | 'dotted')}
                className="flex flex-wrap gap-x-3 gap-y-2"
              >
                {(['solid', 'dashed', 'dotted'] as const).map((style) => (
                  <div key={style} className="flex items-center gap-1.5">
                    <RadioGroupItem value={style} id={`active-${style}`} className="h-4 w-4" />
                    <Label
                      htmlFor={`active-${style}`}
                      className="capitalize text-bf-sm font-normal text-foreground cursor-pointer"
                    >
                      {style}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </Field>

            <Field label="Centre gap" htmlFor="crosshair-center-gap">
              <div className="flex items-center">
                <Switch
                  id="crosshair-center-gap"
                  checked={localSettings.centerGap !== false}
                  onCheckedChange={(checked) => updateLocalSetting('centerGap', checked)}
                />
              </div>
            </Field>
          </section>

          {/* Mirror Crosshairs Section - Collapsible. The heading wraps the
              toggle (accordion pattern) so its rule spans the full width like
              the other sections' headings. */}
          <section className="border-b" style={{ borderColor: 'var(--bf-border-subtle)' }}>
            <div className="px-6 pt-5">
              <h3 className={`${SECTION_HEADING} ${mirrorExpanded ? '' : 'mb-5'}`}>
                <button
                  type="button"
                  aria-expanded={mirrorExpanded}
                  onClick={() => setMirrorExpanded(!mirrorExpanded)}
                  className="-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between rounded-sm px-1 text-left hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                >
                  Mirror crosshairs
                  <ChevronDown
                    aria-hidden="true"
                    className={`w-4 h-4 text-bf-text-secondary transition-transform ${
                      mirrorExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              </h3>
            </div>
            
            {mirrorExpanded && (
              <div className="px-6 pt-1.5 pb-5 space-y-4">
                <Field label="Show lines" htmlFor="crosshair-mirror-visible">
                  <Switch
                    id="crosshair-mirror-visible"
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
                          aria-label="Mirror crosshair color"
                          className="h-7 w-12 rounded-sm border border-border bg-bf-bg-input cursor-pointer hover:border-bf-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                        />
                        <span className="font-mono text-bf-xs text-muted-foreground">{localSettings.mirrorColor}</span>
                      </div>
                    </Field>

                    <Field label="Opacity">
                      <div className="flex items-center gap-3">
                        <NamedSlider
                          thumbLabel="Mirror opacity"
                          valueText={`${Math.round(localSettings.mirrorOpacity * 100)}%`}
                          min={0}
                          max={1}
                          step={0.1}
                          value={[localSettings.mirrorOpacity]}
                          onValueChange={([v]) => updateLocalSetting('mirrorOpacity', v)}
                          className="flex-1 [&_[role=slider]]:bg-primary [&_[role=slider]:hover]:bg-primary"
                        />
                        <span className="font-mono text-bf-xs text-bf-text-secondary w-8 text-right">
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
        <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--bf-border-subtle)' }}>
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
