/**
 * PlotDock — the shared, collapsible plot pane for the standard imaging
 * workspaces (Orthogonal / Mosaic / Compare).
 *
 * It is the lightweight counterpart to the integrated workspace's full
 * `BottomWorkbenchDock` (Plot | Activity | Log): this dock hosts only the
 * `PlotPanel`, since the standard workspaces want a focused, RStudio-style
 * plot pane below the slice views rather than the full three-pane workbench.
 *
 * Visibility is owned by `layoutSettingsStore.plotDockOpen`; the surrounding
 * `CenterWithPlotDock` Allotment pane snaps closed when that flag is false, so
 * this component always renders assuming it is visible. The header carries the
 * single dock-level affordance the `PlotHost` toolbar does not own: a close
 * button that collapses the dock.
 *
 * Mode selection (histogram vs. crosshair time-series) is delegated entirely
 * to `PlotPanel` → `usePlotModeSelection`, which adapts to the active layer in
 * `auto` mode and preserves manual picks. The `defaultMode` we pass is only a
 * fallback for the rare empty-resolver case, mirroring the integrated dock.
 */

import React from "react";

import { PlotPanel } from "@/components/panels/PlotPanel";
import { useDefaultPlotModeForActiveLayer } from "@/components/plots/plotMode.helpers";
import { DOCK_COLLAPSED_LOG_WIDTH } from "@/components/layout/bottomWorkbenchDock.constants";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";

const HEADER_PX = DOCK_COLLAPSED_LOG_WIDTH;

export const PlotDock: React.FC = () => {
  const defaultPlotMode = useDefaultPlotModeForActiveLayer();
  const setPlotDockOpen = useLayoutSettingsStore((s) => s.setPlotDockOpen);

  return (
    <div
      data-testid="plot-dock"
      className="bf-plot-dock"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--app-surface-panel-raised)",
        color: "var(--app-text-primary)",
        overflow: "hidden",
      }}
    >
      <div
        className="bf-plot-dock-header bf-role-section"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "4px",
          padding: "0 8px",
          height: `${HEADER_PX}px`,
          minHeight: `${HEADER_PX}px`,
          borderBottom: "1px solid var(--app-border-subtle)",
          color: "var(--app-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "var(--app-role-section-tracking)",
          fontSize: "var(--app-role-section-size)",
          fontWeight: "var(--app-role-section-weight)" as never,
          flex: "0 0 auto",
        }}
      >
        <span>Plot</span>
        <button
          type="button"
          aria-label="Close plot dock"
          title="Close plot dock"
          data-testid="plot-dock-close"
          onClick={() => setPlotDockOpen(false)}
          style={{
            appearance: "none",
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
      </div>
      <div
        className="bf-plot-dock-body"
        style={{
          flex: "1 1 auto",
          overflow: "hidden",
          minHeight: 0,
          position: "relative",
        }}
      >
        <PlotPanel defaultMode={defaultPlotMode} />
      </div>
    </div>
  );
};

export default PlotDock;
