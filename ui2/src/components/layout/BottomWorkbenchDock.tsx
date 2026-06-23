/**
 * BottomWorkbenchDock — the integrated workspace's bottom analysis dock.
 *
 * A single TABBED dock: `Activity | Plot | Log`, one panel full-width at a
 * time (Design.md §11.1 "Single dock, three tabs"; §20 acceptance: "Bottom
 * dock uses `Activity | Plot | Log`"). The selected tab owns the entire dock
 * width, so Plot (first-class — §1.5) can use the full bottom space. Slot
 * content is supplied by the parent; this component owns only the tab chrome.
 *
 * The active tab is reported via `defaultActiveTab` + `onActiveTabChange` so
 * the persistence layer can round-trip it through a Zustand store, mirroring
 * the other layout preferences.
 */

import { useCallback, useState, type ReactNode } from "react";
import {
  DEFAULT_DOCK_TAB,
  DOCK_TABS,
  type DockTabId,
} from "./bottomWorkbenchDock.constants";

export interface BottomWorkbenchDockProps {
  /** Plot slot content. */
  plot: ReactNode;
  /** Activity slot content. */
  activity: ReactNode;
  /** Log slot content. */
  log: ReactNode;
  /** Controlled active tab. When provided, the dock reflects it (and external
   *  changes, e.g. the inspector's "Open in dock") rather than only its own
   *  local state. */
  activeTab?: DockTabId;
  /** Initial active tab when uncontrolled. Defaults to Plot. */
  defaultActiveTab?: DockTabId;
  /** Fired when the user selects a different tab — persistence-ready hook. */
  onActiveTabChange?: (tab: DockTabId) => void;
  /** When provided, renders a right-aligned hide button in the tab bar. */
  onClose?: () => void;
  /** Optional className appended to the dock root. */
  className?: string;
}

/** Tab-bar height (px) — Design.md §11.2 (`grid-template-rows: 34px 1fr`). */
const TAB_BAR_HEIGHT = 34;

export function BottomWorkbenchDock({
  plot,
  activity,
  log,
  activeTab: controlledTab,
  defaultActiveTab = DEFAULT_DOCK_TAB,
  onActiveTabChange,
  onClose,
  className,
}: BottomWorkbenchDockProps) {
  // Controlled/uncontrolled hybrid: when `activeTab` is provided the dock
  // reflects it (so external store changes switch the tab even while mounted);
  // otherwise it manages its own state from `defaultActiveTab`.
  const isControlled = controlledTab !== undefined;
  const [localTab, setLocalTab] = useState<DockTabId>(defaultActiveTab);
  const activeTab = isControlled ? controlledTab : localTab;

  const handleSelect = useCallback(
    (tab: DockTabId) => {
      if (tab === activeTab) return;
      if (!isControlled) setLocalTab(tab);
      onActiveTabChange?.(tab);
    },
    [activeTab, isControlled, onActiveTabChange],
  );

  const slots: Record<DockTabId, ReactNode> = { activity, plot, log };

  return (
    <div
      className={className ? `bf-bottom-dock ${className}` : "bf-bottom-dock"}
      data-testid="bottom-workbench-dock"
      data-active-tab={activeTab}
      style={{
        height: "100%",
        width: "100%",
        minHeight: 0,
        display: "grid",
        gridTemplateRows: `${TAB_BAR_HEIGHT}px 1fr`,
        background: "var(--app-bg-primary)",
        color: "var(--app-text-primary)",
      }}
    >
      <div
        role="tablist"
        aria-label="Bottom dock"
        data-testid="bottom-dock-tablist"
        className="bf-bottom-dock-tabbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "2px",
          padding: "0 8px",
          borderBottom: "1px solid var(--app-border-subtle)",
          background: "var(--app-surface-panel-raised)",
        }}
      >
        {DOCK_TABS.map(({ id, label }) => {
          const active = id === activeTab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`bottom-dock-tab-${id}`}
              aria-selected={active}
              aria-controls={`bottom-dock-panel-${id}`}
              data-testid={`bottom-dock-tab-${id}`}
              data-active={active ? "true" : "false"}
              onClick={() => handleSelect(id)}
              className="bf-role-section"
              style={{
                appearance: "none",
                padding: "2px 10px",
                height: "22px",
                border: "1px solid",
                borderColor: active
                  ? "var(--app-border-active)"
                  : "transparent",
                background: active ? "var(--app-bg-active)" : "transparent",
                color: active
                  ? "var(--app-text-primary)"
                  : "var(--app-text-muted)",
                cursor: "pointer",
                borderRadius: "var(--app-radius-sm)",
                fontSize: "var(--app-role-section-size)",
                letterSpacing: "var(--app-role-section-tracking)",
                textTransform: "uppercase",
              }}
            >
              {label}
            </button>
          );
        })}

        {onClose ? (
          <button
            type="button"
            aria-label="Hide bottom dock"
            title="Hide bottom dock"
            data-testid="bottom-dock-close"
            onClick={onClose}
            style={{
              appearance: "none",
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              padding: "0 4px",
              cursor: "pointer",
              color: "var(--app-text-muted)",
              fontSize: "12px",
              lineHeight: 1,
              height: "20px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div
        role="tabpanel"
        id={`bottom-dock-panel-${activeTab}`}
        aria-labelledby={`bottom-dock-tab-${activeTab}`}
        data-testid="bottom-dock-panel"
        style={{
          position: "relative",
          minHeight: 0,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {slots[activeTab]}
      </div>
    </div>
  );
}

export default BottomWorkbenchDock;
