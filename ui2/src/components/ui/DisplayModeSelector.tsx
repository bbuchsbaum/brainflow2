/**
 * DisplayModeSelector — the top-bar view-mode switcher.
 *
 * Renders the available display modes as a single segmented control
 * (Design.md §6.2) and routes clicks to workspace activation/creation:
 *   - existing workspace of the target display mode → activate it;
 *   - none → create a new one via `workspaceStore.createWorkspace`.
 *
 * Only *available* modes are rendered. A mode is hidden when it has no
 * associated workspace type yet (Surface) or when its feature flag is off
 * (Integrated when `integratedWorkspaceV1` is false) — we drop dead buttons
 * from the bar rather than showing them disabled.
 *
 * Active highlight is derived from the active workspace's type via
 * `resolveActiveDisplayMode` (multiple workspace types may belong to the same
 * display mode; see `displayModeSelector.helpers.ts`).
 */

import React, { useCallback } from "react";

import { useFeatureFlagStore } from "@/stores/featureFlagStore";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { DisplayModeMetadata } from "@/types/displayModes";

import {
  getDisplayModePillMetadata,
  isViewWorkspaceType,
  resolveActiveDisplayMode,
} from "./displayModeSelector.helpers";

export interface DisplayModeSelectorProps {
  className?: string;
}

export const DisplayModeSelector: React.FC<DisplayModeSelectorProps> = ({
  className,
}) => {
  const integratedWorkspaceEnabled = useFeatureFlagStore(
    (state) => state.integratedWorkspaceV1,
  );
  const activeWorkspaceType = useWorkspaceStore((state) => {
    const id = state.activeWorkspaceId;
    return id ? (state.workspaces.get(id)?.type ?? null) : null;
  });
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const setActiveWorkspaceMode = useWorkspaceStore(
    (state) => state.setActiveWorkspaceMode,
  );
  const setIntegratedDefaultDisplayMode = useLayoutSettingsStore(
    (state) => state.setIntegratedDefaultDisplayMode,
  );

  const activeMode = resolveActiveDisplayMode(activeWorkspaceType);

  const isFlagDisabled = useCallback(
    (mode: DisplayModeMetadata) =>
      mode.featureFlag === "integratedWorkspaceV1" &&
      !integratedWorkspaceEnabled,
    [integratedWorkspaceEnabled],
  );

  // A mode is shown only when it is actually reachable: mapped to a workspace
  // type AND not gated off by a feature flag.
  const visibleModes = getDisplayModePillMetadata().filter(
    (mode) => Boolean(mode.defaultWorkspaceType) && !isFlagDisabled(mode),
  );

  const handleClick = useCallback(
    (mode: DisplayModeMetadata) => {
      if (!mode.defaultWorkspaceType) return; // unmapped (e.g. surface)
      if (isFlagDisabled(mode)) return; // gated by feature flag

      // Pills set the MODE of the active view tab, in place — tabs stay the
      // view substrate. Switching modes reconfigures the current tab rather
      // than spawning/activating a separate per-mode workspace, so the pills
      // and tabs stop being redundant. (Cold edge: no view open yet → create
      // the first one.)
      if (useWorkspaceStore.getState().activeWorkspaceId) {
        setActiveWorkspaceMode(mode.id);
      } else {
        void createWorkspace(mode.defaultWorkspaceType);
      }
      // Record the user's display-mode preference for cold-start fallback.
      setIntegratedDefaultDisplayMode(mode.defaultWorkspaceType);
    },
    [
      createWorkspace,
      isFlagDisabled,
      setActiveWorkspaceMode,
      setIntegratedDefaultDisplayMode,
    ],
  );

  // The pill only governs view workspaces. When a tool destination (BIDS,
  // Analysis, Set Studio) is active there is no mode to switch, so hide the
  // pill rather than show a mode that doesn't apply to what's on screen. When
  // no workspace is open (null), keep it visible so the first view can be created.
  if (
    activeWorkspaceType !== null &&
    !isViewWorkspaceType(activeWorkspaceType)
  ) {
    return null;
  }

  return (
    <div
      role="tablist"
      aria-label="Display mode"
      data-testid="display-mode-selector"
      data-active-mode={activeMode ?? ""}
      className={
        className
          ? `bf-display-mode-selector ${className}`
          : "bf-display-mode-selector"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: "24px",
        border: "1px solid var(--app-border)",
        borderRadius: "var(--app-radius-sm)",
        overflow: "hidden",
      }}
    >
      {visibleModes.map((mode, index) => {
        const isActive = activeMode === mode.id;
        const isLast = index === visibleModes.length - 1;

        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={mode.description}
            data-testid={`display-mode-${mode.id}`}
            data-active={isActive ? "true" : "false"}
            onClick={() => handleClick(mode)}
            className="bf-role-section"
            style={{
              appearance: "none",
              height: "100%",
              padding: "0 12px",
              border: 0,
              borderRight: isLast ? 0 : "1px solid var(--app-border)",
              background: isActive ? "var(--app-bg-active)" : "transparent",
              color: isActive
                ? "var(--app-text-primary)"
                : "var(--app-text-muted)",
              cursor: "pointer",
              fontSize: "var(--app-role-section-size)",
              letterSpacing: "var(--app-role-section-tracking)",
              textTransform: "uppercase",
              fontWeight: isActive ? 600 : 500,
              whiteSpace: "nowrap",
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
