/**
 * DisplayModeSelector — Phase 7 of the integrated workspace refactor.
 *
 * Renders the five display-mode pills (Orthogonal, Surface, Integrated,
 * Mosaic, Compare) and routes clicks to workspace activation/creation:
 *   - existing workspace of the target type → activate it;
 *   - none → create a new one via `workspaceStore.createWorkspace`.
 *
 * Display modes that have no associated workspace type today (Surface) render
 * as disabled. Display modes whose feature flag is off (Integrated when
 * `integratedWorkspaceV1` is false) also render as disabled, with a tooltip
 * explaining the gating.
 *
 * Active highlight is derived from the active workspace's type via
 * `resolveActiveDisplayMode` (multiple workspace types may belong to the same
 * display mode; see `displayModeSelector.helpers.ts`).
 */

import React, { useCallback } from 'react';

import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { DisplayModeMetadata } from '@/types/displayModes';

import {
  getDisplayModePillMetadata,
  resolveActiveDisplayMode,
} from './displayModeSelector.helpers';

export interface DisplayModeSelectorProps {
  className?: string;
}

export const DisplayModeSelector: React.FC<DisplayModeSelectorProps> = ({ className }) => {
  const integratedWorkspaceEnabled = useFeatureFlagStore((state) => state.integratedWorkspaceV1);
  const activeWorkspaceType = useWorkspaceStore((state) => {
    const id = state.activeWorkspaceId;
    return id ? state.workspaces.get(id)?.type ?? null : null;
  });
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const activateWorkspace = useWorkspaceStore((state) => state.activateWorkspace);
  const setIntegratedDefaultDisplayMode = useLayoutSettingsStore(
    (state) => state.setIntegratedDefaultDisplayMode,
  );

  const activeMode = resolveActiveDisplayMode(activeWorkspaceType);
  const pillMetadata = getDisplayModePillMetadata();

  const isFlagDisabled = useCallback(
    (mode: DisplayModeMetadata) =>
      mode.featureFlag === 'integratedWorkspaceV1' && !integratedWorkspaceEnabled,
    [integratedWorkspaceEnabled],
  );

  const handleClick = useCallback(
    (mode: DisplayModeMetadata) => {
      if (!mode.defaultWorkspaceType) return; // unmapped (e.g. surface)
      if (isFlagDisabled(mode)) return; // gated by feature flag

      // Activate-first-if-exists matches "creates or activates" in the P7 acceptance.
      // Search for an existing workspace whose *display mode* matches (not its
      // exact type), because multiple workspace types satisfy a single pill —
      // e.g. both `orthogonal-locked` and `orthogonal-flexible` belong to the
      // Orthogonal pill, and the app's initial workspace is `orthogonal-flexible`.
      // Searching by exact type equality previously created a duplicate
      // `orthogonal-locked` workspace whenever the user returned to Orthogonal.
      // Snapshot via getState so we read the freshest map without resubscribing.
      const existing = Array.from(useWorkspaceStore.getState().workspaces.values()).find(
        (w) => resolveActiveDisplayMode(w.type) === mode.id,
      );
      if (existing) {
        activateWorkspace(existing.id);
      } else {
        // Fall back to the mode's default workspace type for creation.
        void createWorkspace(mode.defaultWorkspaceType);
      }
      // Record the user's display-mode preference (mote
      // `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`). Used as a cold-start fallback
      // when the workspace map is empty after a migrate/wipe.
      setIntegratedDefaultDisplayMode(mode.defaultWorkspaceType);
    },
    [activateWorkspace, createWorkspace, isFlagDisabled, setIntegratedDefaultDisplayMode],
  );

  return (
    <div
      role="tablist"
      aria-label="Display mode"
      data-testid="display-mode-selector"
      data-active-mode={activeMode ?? ''}
      className={className ? `bf-display-mode-selector ${className}` : 'bf-display-mode-selector'}
      style={{ display: 'inline-flex', gap: '2px' }}
    >
      {pillMetadata.map((mode) => {
        const isActive = activeMode === mode.id;
        const flagDisabled = isFlagDisabled(mode);
        const unmappedDisabled = !mode.defaultWorkspaceType;
        const disabled = flagDisabled || unmappedDisabled;
        const disabledReason = flagDisabled
          ? 'feature-flag'
          : unmappedDisabled
            ? 'unmapped'
            : '';
        const tooltip = flagDisabled
          ? `Enable the ${mode.featureFlag} feature flag to use ${mode.label}.`
          : unmappedDisabled
            ? `${mode.label} mode is not yet routed to a workspace type.`
            : mode.description;

        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            title={tooltip}
            data-testid={`display-mode-${mode.id}`}
            data-active={isActive ? 'true' : 'false'}
            data-disabled={disabled ? 'true' : 'false'}
            data-disabled-reason={disabledReason}
            onClick={() => handleClick(mode)}
            className="bf-role-section"
            style={{
              appearance: 'none',
              padding: '2px 10px',
              height: '22px',
              border: '1px solid var(--app-border)',
              borderColor: isActive ? 'var(--app-border-active)' : 'var(--app-border)',
              background: isActive ? 'var(--app-bg-active)' : 'transparent',
              color: disabled
                ? 'var(--app-text-disabled)'
                : isActive
                  ? 'var(--app-text-primary)'
                  : 'var(--app-text-muted)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              borderRadius: 'var(--app-radius-sm)',
              fontSize: 'var(--app-role-section-size)',
              letterSpacing: 'var(--app-role-section-tracking)',
              textTransform: 'uppercase',
              opacity: disabled ? 0.55 : 1,
            }}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
};

export default DisplayModeSelector;
