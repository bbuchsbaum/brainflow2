/**
 * CenterWithPlotDock — wraps a center-workspace view with the shared,
 * collapsible bottom `PlotDock`.
 *
 * `WorkspaceRouter` wraps the imaging modes with this component so they gain
 * the plot dock, scoped to the center column. The Files and Inspector columns
 * are separate GoldenLayout panels and stay full height — only the center view
 * loses vertical space, and only while the dock is open.
 *
 * Layout: **absolute insets**, NOT flexbox. The view pane is
 * `position:absolute; inset 0 with bottom = dock height`, so it has a
 * *definite* pixel height — the same contract a GoldenLayout panel gives its
 * content. This matters because the slice views size themselves with
 * `height:100%` + a `ResizeObserver` (orthogonal `OrthogonalViewContainer`,
 * mosaic `.mosaic-container`): a flex-computed parent height does not resolve
 * `height:100%` / fire resize cleanly for all of them (mosaic cells failed to
 * reflow and click-to-world went stale), whereas a definite-height parent
 * does. The root is `position:absolute; inset:0` (fills the positioned GL
 * panel, like `IntegratedVolumeSurfaceWorkspace`).
 *
 * When closed the dock + resizer are not rendered and the view pane fills the
 * panel (bottom:0) — identical to the pre-dock layout. The view wrapper keeps a
 * stable position whether or not the dock is open, so toggling never remounts
 * the (GPU-backed) view.
 */

import React from "react";

import { PlotDock } from "@/components/layout/PlotDock";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";

const PLOT_DOCK_DEFAULT_PX = 240;
const PLOT_DOCK_MIN_PX = 120;
const PLOT_DOCK_MAX_FRACTION = 0.7; // dock never exceeds 70% of the column
const RESIZER_PX = 6;

export interface CenterWithPlotDockProps {
  children: React.ReactNode;
}

export const CenterWithPlotDock: React.FC<CenterWithPlotDockProps> = ({
  children,
}) => {
  const open = useLayoutSettingsStore((s) => s.plotDockOpen);
  const storedHeight = useLayoutSettingsStore((s) => s.plotDockHeight);
  const setPlotDockHeight = useLayoutSettingsStore((s) => s.setPlotDockHeight);

  const rootRef = React.useRef<HTMLDivElement>(null);
  // Local height during a drag for responsiveness; committed to the store on
  // release (core UI stability rules — keep stores authoritative).
  const [dragHeight, setDragHeight] = React.useState<number | null>(null);
  const dockHeight = dragHeight ?? storedHeight ?? PLOT_DOCK_DEFAULT_PX;

  // Reserve space for the dock (+ its resizer) below the view pane when open.
  const bottomReserve = open ? dockHeight + RESIZER_PX : 0;

  const handleResizeStart = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const root = rootRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const maxPx = Math.max(
        PLOT_DOCK_MIN_PX,
        rootRect.height * PLOT_DOCK_MAX_FRACTION,
      );
      let latest = dockHeight;

      const onMove = (ev: PointerEvent) => {
        // Dock occupies the bottom; its top edge follows the pointer.
        const fromBottom = rootRect.bottom - ev.clientY - RESIZER_PX / 2;
        latest = Math.round(
          Math.max(PLOT_DOCK_MIN_PX, Math.min(maxPx, fromBottom)),
        );
        setDragHeight(latest);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setPlotDockHeight(latest);
        setDragHeight(null);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [dockHeight, setPlotDockHeight],
  );

  return (
    <div
      ref={rootRef}
      data-testid="center-with-plot-dock"
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      {/* View pane — definite height via absolute insets (bottom = reserve). */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: bottomReserve,
        }}
      >
        {children}
      </div>

      {open && (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize plot dock"
            data-testid="plot-dock-resizer"
            onPointerDown={handleResizeStart}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: dockHeight,
              height: `${RESIZER_PX}px`,
              cursor: "ns-resize",
              background: "var(--app-border-subtle)",
              zIndex: 2,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: `${dockHeight}px`,
            }}
          >
            <PlotDock />
          </div>
        </>
      )}
    </div>
  );
};

export default CenterWithPlotDock;
