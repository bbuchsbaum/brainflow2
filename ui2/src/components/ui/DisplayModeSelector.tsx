/**
 * DisplayModeSelector — the top-bar layout switcher.
 *
 * Renders the available display modes as a single segmented control
 * (Design.md §6.2). A click applies that layout to the CURRENT view tab, in
 * place; it never jumps to or creates another tab (qa-design-decisions
 * 2026-10-30 §1, `services/workspaceNavigation.ts`). Only with no tab open at
 * all does a click create the first view.
 *
 * When a tool (BIDS, Analysis, Set studio) or the surface tab is in front, the
 * switcher stays visible but disabled with no active segment, and a pill says
 * which tool is open: those tabs have no slice layout to change.
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
import { isSurfaceTabComponent, useCenterTabStore } from "@/stores/centerTabStore";
import type { DisplayMode, DisplayModeMetadata } from "@/types/displayModes";
import { SegmentedControl } from "@/components/ui/bf";
import { setCurrentTabLayout } from "@/services/workspaceNavigation";

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
  const setIntegratedDefaultDisplayMode = useLayoutSettingsStore(
    (state) => state.setIntegratedDefaultDisplayMode,
  );

  // A tool TAB (the surface view) inside a view workspace is a tool too: no
  // view mode is active while it is in front (v3 visual critic). Read the
  // centre stack's front tab, not focus, which moves with clicks in Files,
  // Subjects or the dock.
  const surfaceTabActive = useCenterTabStore(
    (state) => isSurfaceTabComponent(state.frontComponentType),
  );
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

      const result = setCurrentTabLayout(mode.id);
      // Record the user's display-mode preference for cold-start fallback.
      if (result === "applied" || result === "created") {
        setIntegratedDefaultDisplayMode(mode.defaultWorkspaceType);
      }
    },
    [isFlagDisabled, setIntegratedDefaultDisplayMode],
  );

  // A tool tab, or the surface tab, has no slice layout: the pills stay
  // visible but disabled, with no segment checked.
  const toolInFront =
    surfaceTabActive ||
    Boolean(activeWorkspaceType && !isViewWorkspaceType(activeWorkspaceType));

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
  const toolLabel = !toolInFront
    ? null
    : surfaceTabActive
      ? "Surface"
      : (TOOL_LABELS[activeWorkspaceType ?? ""] ?? "Tool");

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
      disabled={toolInFront}
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
        title={`${toolLabel} is open. Layouts apply to view tabs: pick a view tab, or press Cmd/Ctrl+T for a new view.`}
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
