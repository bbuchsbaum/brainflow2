/**
 * CrosshairSettingsDialog
 * 
 * Compact modal dialog for configuring crosshair appearance, built from the
 * bf primitives: static/collapsible Sections, FieldRows (96px label column),
 * Switch, Slider and a joined SegmentedControl for the line style. The colour
 * presets keep their swatch semantics (named toggle buttons, inner-ring
 * selection, separate outer focus outline).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import {
  Button,
  ColorInput,
  FieldRow,
  Section,
  SegmentedControl,
  Slider,
  Switch,
} from '@/components/ui/bf';
import { useCrosshairSettings } from '@/contexts/CrosshairContext';
import type { CrosshairSettings } from '@/contexts/CrosshairContext';
import { DEFAULT_SETTINGS, MEDICAL_COLOR_PRESETS } from '@/stores/crosshairSettingsStore';
import { useViewStateStore } from '@/stores/viewStateStore';

interface CrosshairSettingsDialogProps {
  onClose: () => void;
}

const STYLE_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
] as const;

const formatThickness = (v: number) => `${v} px`;
const formatPercent = (v: number) => `${Math.round(v * 100)}%`;
/** One value column for every slider here, so all tracks end at the same x ("2.5 px", "100%"). */
const VALUE_WIDTH = '6ch';

// Selected swatch: an inner 2px neutral ring with a 1px dark inner edge (so it
// reads on light swatches too). Keyboard focus is a separate outer amber
// outline with an offset, so a focused selected swatch shows both.
/**
 * Swatches offered in the dialog: the store's presets minus the residue the
 * visual review flagged (orange #ff7a1a sits 6° from the warning hue and on the
 * hot ramp, yellow #facc15 is the top of hot, #00ff00 is a harsher duplicate
 * of the default green). Any colour, these included, stays reachable through
 * the colour field; a stored one simply shows no pressed swatch.
 */
const PRESET_RESIDUE = new Set(['#ff7a1a', '#facc15', '#00ff00']);
export const DIALOG_COLOR_PRESETS = MEDICAL_COLOR_PRESETS.filter(
  (preset) => !PRESET_RESIDUE.has(preset.value.toLowerCase()),
);

const SWATCH_SELECTED_SHADOW =
  'inset 0 0 0 2px var(--bf-text-primary, #e6e7ea), inset 0 0 0 3px rgba(0, 0, 0, 0.6)';

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
          <Section variant="static" title="Visibility" divider={false}>
            <FieldRow label="Show crosshairs" controlId="crosshair-visible">
              <Switch
                ref={visibleSwitchRef}
                checked={localSettings.visible}
                onCheckedChange={(checked) => updateLocalSetting('visible', checked)}
              />
            </FieldRow>
          </Section>

          <Section variant="static" title="Navigation">
            <FieldRow
              label="Snap to voxel"
              controlId="crosshair-snap-to-voxel"
              hint="Place the crosshair on the nearest voxel centre of the bottom image layer."
            >
              <Switch
                checked={localSettings.snapToVoxel}
                onCheckedChange={(checked) => {
                  updateLocalSetting('snapToVoxel', checked);
                  // Turning snapping on re-centres the current position.
                  if (checked) {
                    const { viewState, setCrosshair } = useViewStateStore.getState();
                    void setCrosshair([...viewState.crosshair.world_mm], true);
                  }
                }}
              />
            </FieldRow>
          </Section>

          <Section variant="static" title="Active crosshair">
            <FieldRow label="Color" controlId="crosshair-active-color">
              {({ id }) => (
              <div className="flex min-w-0 flex-col gap-2 py-0.5">
                <ColorInput
                  id={id}
                  showValue
                  value={localSettings.activeColor}
                  onValueChange={(v) => updateLocalSetting('activeColor', v)}
                  aria-label="Active crosshair color"
                />
                <div role="group" aria-label="Color presets" className="flex flex-wrap gap-1.5 p-0.5">
                  {DIALOG_COLOR_PRESETS.map((preset) => {
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
                        className="h-5 w-5 rounded-sm border border-bf-border-strong outline-none [forced-color-adjust:none] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bf-border-focus)]"
                        style={{
                          backgroundColor: preset.value,
                          boxShadow: selected ? SWATCH_SELECTED_SHADOW : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              )}
            </FieldRow>

            <FieldRow label="Thickness" controlId="crosshair-active-thickness">
              <Slider
                label="Thickness"
                min={1}
                max={5}
                step={0.5}
                snap={0.5}
                value={localSettings.activeThickness}
                onValueChange={(v) => updateLocalSetting('activeThickness', v)}
                format={formatThickness}
                valueText={formatThickness}
                showValue
                valueWidth={VALUE_WIDTH}
                className="flex-1"
              />
            </FieldRow>

            <FieldRow label="Style" controlId="crosshair-active-style">
              {({ id }) => (
                <SegmentedControl
                  id={id}
                  aria-labelledby={`${id}-label`}
                  options={STYLE_OPTIONS}
                  value={localSettings.activeStyle}
                  onValueChange={(v) =>
                    updateLocalSetting('activeStyle', v as 'solid' | 'dashed' | 'dotted')
                  }
                />
              )}
            </FieldRow>

            <FieldRow label="Centre gap" controlId="crosshair-center-gap">
              <Switch
                checked={localSettings.centerGap !== false}
                onCheckedChange={(checked) => updateLocalSetting('centerGap', checked)}
              />
            </FieldRow>
          </Section>

          <Section
            title="Mirror crosshairs"
            open={mirrorExpanded}
            onOpenChange={setMirrorExpanded}
          >
            <FieldRow label="Show lines" controlId="crosshair-mirror-visible">
              <Switch
                checked={localSettings.showMirror}
                onCheckedChange={(checked) => updateLocalSetting('showMirror', checked)}
              />
            </FieldRow>

            {localSettings.showMirror && (
              <>
                <FieldRow label="Color" controlId="crosshair-mirror-color">
                  {({ id }) => (
                  <ColorInput
                    id={id}
                    showValue
                    value={localSettings.mirrorColor}
                    onValueChange={(v) => updateLocalSetting('mirrorColor', v)}
                    aria-label="Mirror crosshair color"
                  />
                  )}
                </FieldRow>

                <FieldRow label="Opacity" controlId="crosshair-mirror-opacity">
                  <Slider
                    label="Mirror opacity"
                    min={0}
                    max={1}
                    step={0.1}
                    snap={0.1}
                    value={localSettings.mirrorOpacity}
                    onValueChange={(v) => updateLocalSetting('mirrorOpacity', v)}
                    format={formatPercent}
                    valueText={formatPercent}
                    showValue
                    valueWidth={VALUE_WIDTH}
                    className="flex-1"
                  />
                </FieldRow>
              </>
            )}
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-bf-border-subtle px-3 py-3">
          <Button onClick={handleReset} variant="secondary" size="sm">
            Reset
          </Button>
          <div className="flex gap-2">
            <Button onClick={handleCancel} variant="secondary" size="sm">
              Cancel
            </Button>
            <Button onClick={handleDone} variant="primary" size="sm">
              Done
            </Button>
          </div>
        </div>
    </Modal>
  );
}
