/**
 * DisplayModeSelector — the top-bar view-mode switcher.
 *
 * Renders the available display modes as a single segmented control
 * (Design.md §6.2) and routes clicks to workspace activation/creation:
 *   - existing workspace of the target display mode → activate it;
 *   - none → create a new one via `workspaceStore.createWorkspace`.
 *
 * When a tool workspace (BIDS, Analysis, Set studio) is active, the switcher
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
import { useActivePanelStore } from "@/stores/activePanelStore";
import type { DisplayMode, DisplayModeMetadata } from "@/types/displayModes";
import { SegmentedControl } from "@/components/ui/bf";

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

  // A tool TAB (the surface view) inside a view workspace is a tool too: no
  // view mode is active while it is in front (v3 visual critic).
  const surfaceTabActive = useActivePanelStore((state) => state.componentType === "surfaceView");
  const activeMode = surfaceTabActive ? null : resolveActiveDisplayMode(activeWorkspaceType);

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
        // A tool destination (BIDS, Analysis, Set studio) is active. Never
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

  const options = visibleModes.map((mode) => ({
    value: mode.id,
    label: mode.label,
    title: mode.description,
    testId: `display-mode-${mode.id}`,
    data: { "data-active": mode.id === activeMode ? "true" : "false" },
  }));

  // bf SegmentedControl (V5 joined group, radio semantics) with the amber
  // edge reserved for this switcher. Manual activation: a mode switch mounts
  // a whole layout, so arrows only move focus and Enter/Space switch. The
  // `md` size keeps app-level navigation a step above in-panel controls. In a tool workspace `value` is "" so no
  // segment is checked and the tab stop falls on the first segment.
  // In a tool workspace (Studio, BIDS, Analysis) no view mode is active:
  // say where the user is, beside the switcher, as a neutral pill (P3.13).
  const toolLabel = surfaceTabActive
    ? "Surface"
    : activeWorkspaceType && !isViewWorkspaceType(activeWorkspaceType)
      ? (TOOL_LABELS[activeWorkspaceType] ?? "Tool")
      : null;

  return (
    <span className="inline-flex items-center gap-2">
    <SegmentedControl
      aria-label="Display mode"
      data-testid="display-mode-selector"
      data-active-mode={activeMode ?? ""}
      className={
        className
          ? `bf-display-mode-selector ${className}`
          : "bf-display-mode-selector"
      }
      edge="accent"
      size="md"
      activation="manual"
      hideWhenSingle={false}
      options={options}
      value={activeMode ?? ""}
      onValueChange={(id) => {
        const mode = visibleModes.find((m) => m.id === (id as DisplayMode));
        if (mode) handleClick(mode);
      }}
    />
    {toolLabel ? (
      <span
        className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-bf-border-strong bg-bf-bg-selected px-2 text-bf-xs text-bf-text-primary"
        data-testid="display-mode-tool"
        role="status"
        title={`${toolLabel} is open. Choose a view mode to return to your views.`}
      >
        <span className="text-bf-text-muted">In</span>
        {toolLabel}
      </span>
    ) : null}
    </span>
  );
};

/** Names of the tool workspaces (not view modes) for the switcher's pill. */
const TOOL_LABELS: Partial<Record<string, string>> = {
  "set-studio": "Studio",
  "bids-explorer": "BIDS",
  "analysis-workbench": "Analysis",
};

export default DisplayModeSelector;
