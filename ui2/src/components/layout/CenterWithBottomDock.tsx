/**
 * CenterWithBottomDock — wraps a center-workspace view with the shared,
 * collapsible bottom dock (`BottomWorkbenchDock` — Activity | Plot | Log).
 *
 * `WorkspaceRouter` wraps EVERY imaging mode (orthogonal, mosaic, comparison,
 * integrated) with this component so the analysis dock is workspace-agnostic
 * (Design.md §1.5/§1.6/§20 — the dock is a shell concern, not Integrated-only).
 * The Files and Inspector columns are separate GoldenLayout panels and stay
 * full height — only the center view loses vertical space, and only while the
 * dock is open.
 *
 * Layout: **absolute insets**, NOT flexbox. The view pane is
 * `position:absolute; inset 0 with bottom = dock height`, so it has a
 * *definite* pixel height — the same contract a GoldenLayout panel gives its
 * content. This matters because the slice views size themselves with
 * `height:100%` + a `ResizeObserver`: a flex-computed parent height does not
 * resolve `height:100%` / fire resize cleanly for all of them, whereas a
 * definite-height parent does.
 *
 * When closed the dock + resizer are not rendered and the view pane fills the
 * panel — identical to the pre-dock layout. The view wrapper keeps a stable
 * position whether or not the dock is open, so toggling never remounts the
 * (GPU-backed) view.
 */

import React from "react";

import { BottomWorkbenchDock } from "@/components/layout/BottomWorkbenchDock";
import {
  DEFAULT_DOCK_TAB,
  DOCK_HEIGHT_MAX,
  DOCK_HEIGHT_MIN,
  DOCK_HEIGHT_PREFERRED,
} from "@/components/layout/bottomWorkbenchDock.constants";
import { ActivityPanel } from "@/components/panels/ActivityPanel";
import { LogPanel } from "@/components/panels/LogPanel";
import { PlotPanel } from "@/components/panels/PlotPanel";
import { useDefaultPlotModeForActiveLayer } from "@/components/plots/plotMode.helpers";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";

const DOCK_MAX_FRACTION = 0.7; // dock never exceeds 70% of the column
const RESIZER_PX = 6;

export interface CenterWithBottomDockProps {
  children: React.ReactNode;
}

export const CenterWithBottomDock: React.FC<CenterWithBottomDockProps> = ({
  children,
}) => {
  const open = useLayoutSettingsStore((s) => s.bottomDockOpen);
  const storedHeight = useLayoutSettingsStore((s) => s.bottomDockHeight);
  const setBottomDockHeight = useLayoutSettingsStore(
    (s) => s.setBottomDockHeight,
  );
  const setBottomDockOpen = useLayoutSettingsStore((s) => s.setBottomDockOpen);
  const activeTab = useLayoutSettingsStore((s) => s.bottomDockActiveTab);
  const setActiveTab = useLayoutSettingsStore((s) => s.setBottomDockActiveTab);
  const defaultPlotMode = useDefaultPlotModeForActiveLayer();

  const rootRef = React.useRef<HTMLDivElement>(null);
  // Local height during a drag for responsiveness; committed to the store on
  // release (core UI stability rules — keep stores authoritative).
  const [dragHeight, setDragHeight] = React.useState<number | null>(null);
  // Track the container height so the dock can never over-reserve and starve
  // the view pane in a short center column (the dock is open by default).
  const [rootHeight, setRootHeight] = React.useState(0);

  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () =>
      setRootHeight((prev) =>
        prev === el.clientHeight ? prev : el.clientHeight,
      );
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxDockHeight =
    rootHeight > 0
      ? Math.min(
          DOCK_HEIGHT_MAX,
          Math.max(DOCK_HEIGHT_MIN, rootHeight * DOCK_MAX_FRACTION),
        )
      : DOCK_HEIGHT_MAX;
  const dockHeight = Math.min(
    dragHeight ?? storedHeight ?? DOCK_HEIGHT_PREFERRED,
    maxDockHeight,
  );

  // Reserve space for the dock (+ its resizer) below the view pane when open.
  const bottomReserve = open ? dockHeight + RESIZER_PX : 0;

  const handleResizeStart = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const root = rootRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const maxPx = Math.min(
        DOCK_HEIGHT_MAX,
        Math.max(DOCK_HEIGHT_MIN, rootRect.height * DOCK_MAX_FRACTION),
      );
      let latest = dockHeight;

      const onMove = (ev: PointerEvent) => {
        // Dock occupies the bottom; its top edge follows the pointer.
        const fromBottom = rootRect.bottom - ev.clientY - RESIZER_PX / 2;
        latest = Math.round(
          Math.max(DOCK_HEIGHT_MIN, Math.min(maxPx, fromBottom)),
        );
        setDragHeight(latest);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setBottomDockHeight(latest);
        setDragHeight(null);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [dockHeight, setBottomDockHeight],
  );

  return (
    <div
      ref={rootRef}
      data-testid="center-with-bottom-dock"
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
            aria-label="Resize bottom dock"
            data-testid="bottom-dock-resizer"
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
            <BottomWorkbenchDock
              plot={<PlotPanel defaultMode={defaultPlotMode} />}
              activity={<ActivityPanel />}
              log={<LogPanel />}
              activeTab={activeTab ?? DEFAULT_DOCK_TAB}
              onActiveTabChange={setActiveTab}
              onClose={() => setBottomDockOpen(false)}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default CenterWithBottomDock;
