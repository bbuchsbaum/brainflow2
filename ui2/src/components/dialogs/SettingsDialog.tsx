/**
 * SettingsDialog
 *
 * App-wide preferences that have no other home. Each switch applies at once
 * and is persisted by its store; Done closes.
 *   - Status bar › Pointer readout (`hoverSettingsStore.showInStatusBar`, the
 *     same setting as the view menu's pointer-readout toggle).
 *   - Start › MNI anatomy on the first screen
 *     (`layoutSettingsStore.firstScreenTemplate`, on by default;
 *     qa-features-2026-10-31 §7).
 *   - Experimental features (`featureFlagStore.experimentalFeatures`, off by
 *     default): shows unfinished UI, the Inspector's Annotate tab and the
 *     empty Advanced section (QA design decisions 2026-10-30, section 4).
 */

import React, { useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button, FieldRow, Section, Switch } from '@/components/ui/bf';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { useHoverSettingsStore } from '@/stores/hoverSettingsStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const firstSwitchRef = useRef<HTMLButtonElement | null>(null);
  const showPointer = useHoverSettingsStore((s) => s.showInStatusBar);
  const setShowPointer = useHoverSettingsStore((s) => s.setShowInStatusBar);
  const experimental = useFeatureFlagStore((s) => s.experimentalFeatures);
  const setExperimental = useFeatureFlagStore((s) => s.setExperimentalFeatures);
  const firstScreen = useLayoutSettingsStore((s) => s.firstScreenTemplate);
  const setFirstScreen = useLayoutSettingsStore((s) => s.setFirstScreenTemplate);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Settings"
      ariaLabel="Settings"
      size="sm"
      initialFocusRef={firstSwitchRef}
      bodyClassName="p-0"
      className="max-w-sm rounded-sm ring-1 ring-bf-border-strong shadow-2xl"
    >
      <div className="flex-1 overflow-y-auto">
        <Section variant="static" title="Status bar" divider={false}>
          <FieldRow
            label="Pointer readout"
            labelWidth="wide"
            controlId="settings-pointer-readout"
            hint="Position, value and region under the pointer, beside the crosshair's."
          >
            <Switch ref={firstSwitchRef} checked={showPointer} onCheckedChange={setShowPointer} />
          </FieldRow>
        </Section>

        <Section variant="static" title="Start">
          <FieldRow
            label="MNI anatomy at start"
            labelWidth="wide"
            controlId="settings-first-screen"
            hint="With nothing restored, open on the MNI152 T1 with the crosshair at the origin."
          >
            <Switch checked={firstScreen} onCheckedChange={setFirstScreen} />
          </FieldRow>
        </Section>

        <Section variant="static" title="Experimental features">
          <FieldRow
            // Wide column, short label: "Show unfinished features" was cut
            // to "Show unfinishe…" (QA 2026-10-30 F47).
            label="Unfinished features"
            labelWidth="wide"
            controlId="settings-experimental"
            hint="The Inspector's Annotate tab and Advanced section. They do not work yet."
          >
            <Switch checked={experimental} onCheckedChange={setExperimental} />
          </FieldRow>
        </Section>
      </div>

      <div className="flex items-center justify-end border-t border-bf-border-subtle px-3 py-3">
        <Button onClick={onClose} variant="primary" size="sm">
          Done
        </Button>
      </div>
    </Modal>
  );
}
