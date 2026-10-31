/**
 * SettingsDialog
 *
 * App-wide preferences that have no other home. Each control applies at once
 * and is persisted by its store; Done closes.
 *   - Status bar › Pointer readout (`hoverSettingsStore.showInStatusBar`, the
 *     same setting as the view menu's pointer-readout toggle).
 *   - Start › MNI anatomy on the first screen
 *     (`layoutSettingsStore.firstScreenTemplate`, on by default;
 *     qa-features-2026-10-31 §7).
 *   - Modules: one switch per module this host supports, with its stage
 *     ("Experimental", "Preview") and a one-line description
 *     (`modules/settingsStore.ts`; unset switches follow the stage default).
 *     Switching a module off hides its tabs, menu items, commands and
 *     shortcuts and switches off its bridge commands; its data is kept.
 *   - Top bar: which tools are pinned as buttons in the top bar, and which
 *     tabs open at startup (restore the last session, the default, or a
 *     fixed list).
 *   - Experimental features (`featureFlagStore.experimentalFeatures`, off by
 *     default): shows unfinished UI, the Inspector's Annotate tab and the
 *     empty Advanced section (QA design decisions 2026-10-30, section 4).
 */

import React, { useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import {
  Button,
  Checkbox,
  Chip,
  FieldRow,
  Section,
  SegmentedControl,
  Switch,
} from '@/components/ui/bf';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { useHoverSettingsStore } from '@/stores/hoverSettingsStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import {
  moduleRegistry,
  moduleStageLabel,
  useModuleRegistryVersion,
  useTools,
} from '@/modules/registry';
import { useModuleSettingsStore, type StartupMode } from '@/modules/settingsStore';
import { startupTabCandidates } from '@/services/workspaceNavigation';

interface SettingsDialogProps {
  onClose: () => void;
}

const STARTUP_OPTIONS = [
  { value: 'restore', label: 'Restore last session' },
  { value: 'fixed', label: 'Fixed tabs' },
] as const;

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

        <ModulesSection />
        <TopBarSection />

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

/** Settings › Modules: every module this host supports, at every stage. */
function ModulesSection() {
  useModuleRegistryVersion();
  // Subscribing to the switches re-renders the rows; the registry decides.
  useModuleSettingsStore((s) => s.enabled);
  const setModuleEnabled = useModuleSettingsStore((s) => s.setModuleEnabled);
  const modules = moduleRegistry.getModules().filter((m) => moduleRegistry.isSupported(m.id));
  if (modules.length === 0) return null;

  return (
    <Section variant="static" title="Modules">
      {modules.map((module) => {
        const stage = moduleStageLabel(module.stage);
        return (
          <FieldRow
            key={module.id}
            label={module.title}
            controlId={`settings-module-${module.id}`}
            labelable={false}
            hint={module.description}
          >
            {(control) => (
              <>
                <Switch
                  {...control}
                  checked={moduleRegistry.isSwitchedOn(module.id)}
                  onCheckedChange={(on) => setModuleEnabled(module.id, on)}
                />
                {stage ? <Chip>{stage}</Chip> : null}
              </>
            )}
          </FieldRow>
        );
      })}
    </Section>
  );
}

/** Settings › Top bar: pinned tools and startup tabs. */
function TopBarSection() {
  const tools = useTools();
  const pinned = useModuleSettingsStore((s) => s.pinned);
  const startup = useModuleSettingsStore((s) => s.startup);
  const setToolPinned = useModuleSettingsStore((s) => s.setToolPinned);
  const setStartupMode = useModuleSettingsStore((s) => s.setStartupMode);
  const setStartupTab = useModuleSettingsStore((s) => s.setStartupTab);
  // Subscribed so the choices follow the Integrated flag (and `tools`).
  useFeatureFlagStore((s) => s.integratedWorkspaceV1);
  const candidates = startupTabCandidates();
  const order = candidates.map((c) => c.type);

  return (
    <Section variant="static" title="Top bar">
      <FieldRow
        label="Pinned tools"
        controlId="settings-pinned-tools"
        labelable={false}
        hint="Pinned tools get a button in the top bar. All tools stay in the Workspace menu."
      >
        {(control) => (
          <div role="group" {...control} className="flex flex-col">
            {tools.map((tool) => (
              <Checkbox
                key={tool.type}
                checked={pinned.includes(tool.type)}
                onCheckedChange={(checked) => setToolPinned(tool.type, checked)}
              >
                {tool.label}
              </Checkbox>
            ))}
          </div>
        )}
      </FieldRow>

      <FieldRow
        label="Startup tabs"
        controlId="settings-startup-mode"
        labelable={false}
        hint={
          startup.mode === 'restore'
            ? 'Relaunch reopens the tabs you had open.'
            : 'Relaunch opens these tabs, the first in front.'
        }
      >
        <SegmentedControl
          aria-label="Startup tabs"
          options={STARTUP_OPTIONS}
          value={startup.mode}
          onValueChange={(mode) => setStartupMode(mode as StartupMode)}
        />
      </FieldRow>

      {startup.mode === 'fixed' ? (
        <FieldRow label="Open at startup" controlId="settings-startup-tabs" labelable={false}>
          {(control) => (
            <div role="group" {...control} className="flex flex-col">
              {candidates.map((candidate) => {
                const checked = startup.tabs.includes(candidate.type);
                // The last tab of the list cannot be removed (never an empty list).
                const onlyOne = checked && startup.tabs.length === 1;
                return (
                  <Checkbox
                    key={candidate.type}
                    checked={checked}
                    disabled={onlyOne}
                    title={onlyOne ? 'At least one tab opens at startup' : undefined}
                    onCheckedChange={(next) => setStartupTab(candidate.type, next, order)}
                  >
                    {candidate.label}
                  </Checkbox>
                );
              })}
            </div>
          )}
        </FieldRow>
      ) : null}
    </Section>
  );
}
