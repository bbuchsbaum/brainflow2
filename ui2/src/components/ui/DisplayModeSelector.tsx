/**
 * DisplayModeSelector — the top-bar view-mode switcher.
 *
 * Renders the available display modes as a single segmented control
 * (Design.md §6.2) and routes clicks to workspace activation/creation:
 *   - existing workspace of the target display mode → activate it;
 *   - none → create a new one via `workspaceStore.createWorkspace`.
 *
 * When a tool workspace (BIDS, Analysis, Set Studio) is active, the switcher
 * stays visible with no active segment; a click returns to the latest view in
 * that mode, or opens one.
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
  findLatestViewInMode,
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
  const activateWorkspace = useWorkspaceStore(
    (state) => state.activateWorkspace,
  );
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
      const { activeWorkspaceId, workspaces } = useWorkspaceStore.getState();
      const active = activeWorkspaceId
        ? workspaces.get(activeWorkspaceId)
        : undefined;
      if (active && isViewWorkspaceType(active.type)) {
        setActiveWorkspaceMode(mode.id);
      } else if (active) {
        // A tool destination (BIDS, Analysis, Set Studio) is active. Never
        // reconfigure the tool tab itself: go back to the most recent view
        // already in this mode, or open a new view in it.
        const existing = findLatestViewInMode(workspaces.values(), mode.id);
        if (existing) {
          activateWorkspace(existing.id);
        } else {
          void createWorkspace(mode.defaultWorkspaceType);
        }
      } else {
        void createWorkspace(mode.defaultWorkspaceType);
      }
      // Record the user's display-mode preference for cold-start fallback.
      setIntegratedDefaultDisplayMode(mode.defaultWorkspaceType);
    },
    [
      activateWorkspace,
      createWorkspace,
      isFlagDisabled,
      setActiveWorkspaceMode,
      setIntegratedDefaultDisplayMode,
    ],
  );

  // The switcher stays visible when a tool destination (BIDS, Analysis, Set
  // Studio) is active: no segment is marked active (the tool is not a view
  // mode), and a click returns to a view in that mode (see handleClick).

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
            // Active = raised neutral fill + 2px accent bottom edge (a state
            // edge, never an area fill); inactive = muted text; hover = the
            // neutral accent fill. Focus is a separate 2px amber ring with a
            // 1px offset; the group does not clip, and the focused segment is
            // lifted above its neighbours so the ring is never cut off.
            className={[
              "relative h-full whitespace-nowrap px-3 text-bf-sm transition-colors",
              "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isActive
                ? "bg-bf-bg-active font-medium text-foreground shadow-[inset_0_-2px_0_var(--bf-accent)]"
                : "bg-transparent font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
            ].join(" ")}
            style={{
              appearance: "none",
              border: 0,
              borderRight: isLast ? 0 : "1px solid var(--app-border-subtle)",
              cursor: "pointer",
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
