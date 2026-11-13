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

import { ClusterPanel } from '@/components/panels/ClusterPanel';
import React from 'react';

import { BottomWorkbenchDock } from '@/components/layout/BottomWorkbenchDock';
import {
  DOCK_HEIGHT_DEFAULTS,
  dockHeightMin,
  type DockExtraTab,
  type DockHeightKey,
  DEFAULT_DOCK_TAB,
  DOCK_HEIGHT_MAX,
  DOCK_HEIGHT_MIN,
  DOCK_TAB_BAR_HEIGHT,
} from '@/components/layout/bottomWorkbenchDock.constants';
import { ActivityPanel } from '@/components/panels/ActivityPanel';
import { LogPanel } from '@/components/panels/LogPanel';
import { PlotPanel } from '@/components/panels/PlotPanel';
import { useDefaultPlotModeForActiveLayer } from '@/components/plots/plotMode.helpers';
import { bottomDockOpenFor, useLayoutSettingsStore } from '@/stores/layoutSettingsStore';

const noSubscription = () => () => undefined;
const noHeight = (): number | null => null;
const DOCK_MAX_FRACTION = 0.7; // dock never exceeds 70% of the column
const RESIZER_PX = 6;

export interface CenterWithBottomDockProps {
  children: React.ReactNode;
  /**
   * Which tool's dock height and visibility this tab uses and remembers (N13,
   * N24): imaging views share one, Set studio, BIDS and Analysis keep their own.
   */
  heightKey?: DockHeightKey;
  /** Tabs only this workspace's dock has. Pass a stable array. */
  extraTabs?: readonly DockExtraTab[];
  /** A strip below the dock, across the whole column (`footerHeight` px tall). */
  footer?: React.ReactNode;
  footerHeight?: number;
  /**
   * The tab this tool's dock opens on (the Set studio: Values), whatever tab
   * another tool's dock last showed. After that the tool follows the user's
   * choice and any tab a command reveals. Other tools keep the shared default.
   */
  initialTab?: string;
}

export const CenterWithBottomDock: React.FC<CenterWithBottomDockProps> = ({
  children,
  heightKey = 'imaging',
  extraTabs,
  footer,
  footerHeight = 0,
  initialTab,
}) => {
  // Shown or hidden per tool, like the height (QA 2026-10-31 N24).
  const open = useLayoutSettingsStore((s) => bottomDockOpenFor(s, heightKey));
  // A height the user dragged (absent until then); it wins over a tab's own.
  const userHeight = useLayoutSettingsStore((s) => s.bottomDockHeights[heightKey]);
  const storedHeight = userHeight ?? DOCK_HEIGHT_DEFAULTS[heightKey];
  const setBottomDockHeight = useLayoutSettingsStore((s) => s.setBottomDockHeight);
  const minDockHeight = dockHeightMin(heightKey);
  const setBottomDockOpen = useLayoutSettingsStore((s) => s.setBottomDockOpen);
  const minimized = useLayoutSettingsStore((s) => s.bottomDockMinimized);
  const setBottomDockMinimized = useLayoutSettingsStore((s) => s.setBottomDockMinimized);
  const activeTab = useLayoutSettingsStore((s) => s.bottomDockActiveTab);
  const setActiveTab = useLayoutSettingsStore((s) => s.setBottomDockActiveTab);
  // This tool's own tab while it has one: it starts on `initialTab` and then
  // follows the user and commands (openDockTab writes the shared tab).
  const [toolTab, setToolTab] = React.useState<string | null>(initialTab ?? null);
  const seenTab = React.useRef(activeTab);
  React.useEffect(() => {
    if (seenTab.current === activeTab) return;
    seenTab.current = activeTab;
    if (initialTab !== undefined) setToolTab(activeTab ?? null);
  }, [activeTab, initialTab]);
  const shownTab = initialTab !== undefined ? (toolTab ?? activeTab) : activeTab;
  const chooseTab = React.useCallback(
    (tab: string) => {
      if (initialTab !== undefined) setToolTab(tab);
      setActiveTab(tab);
    },
    [initialTab, setActiveTab],
  );
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
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () =>
      setRootHeight((prev) => (prev === el.clientHeight ? prev : el.clientHeight));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A tab that sizes to its content (the Set studio's Values) asks for its
  // body height while it is shown; a dragged height wins until reset.
  const autoTab = extraTabs?.find((tab) => tab.id === (shownTab ?? DEFAULT_DOCK_TAB) && tab.autoHeight);
  const autoBody = React.useSyncExternalStore(
    autoTab?.autoHeight?.subscribe ?? noSubscription,
    autoTab?.autoHeight?.getSnapshot ?? noHeight,
    autoTab?.autoHeight?.getSnapshot ?? noHeight,
  );
  const autoHeight =
    userHeight === undefined && autoBody !== null && autoBody > 0 ? DOCK_TAB_BAR_HEIGHT + autoBody : null;

  const maxDockHeight =
    rootHeight > 0
      ? Math.min(DOCK_HEIGHT_MAX, Math.max(DOCK_HEIGHT_MIN, rootHeight * DOCK_MAX_FRACTION))
      : DOCK_HEIGHT_MAX;
  const dockHeight = Math.min(dragHeight ?? autoHeight ?? storedHeight, maxDockHeight);

  // When minimized, the dock collapses to just its tab bar and is not resizable.
  const effectiveDockHeight = minimized ? DOCK_TAB_BAR_HEIGHT : dockHeight;
  const showResizer = open && !minimized;

  // Reserve space for the dock (+ its resizer when resizable) below the view pane.
  const footerPx = footer ? footerHeight : 0;
  const bottomReserve = (open ? effectiveDockHeight + (showResizer ? RESIZER_PX : 0) : 0) + footerPx;

  const handleResizeStart = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const root = rootRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const footerOffset = footer ? footerHeight : 0;
      const maxPx = Math.min(
        DOCK_HEIGHT_MAX,
        Math.max(DOCK_HEIGHT_MIN, rootRect.height * DOCK_MAX_FRACTION),
      );
      let latest = dockHeight;
      // A press without a drag (or the first click of a double-click that
      // resets the height) never remembers a height.
      let moved = false;

      const onMove = (ev: PointerEvent) => {
        // Dock occupies the bottom; its top edge follows the pointer.
        const fromBottom = rootRect.bottom - footerOffset - ev.clientY - RESIZER_PX / 2;
        latest = Math.round(Math.max(minDockHeight, Math.min(maxPx, fromBottom)));
        moved = true;
        setDragHeight(latest);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) setBottomDockHeight(latest, heightKey);
        setDragHeight(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [dockHeight, footer, footerHeight, heightKey, minDockHeight, setBottomDockHeight],
  );
  // Double-click the resizer: forget the dragged height (the tool's default,
  // or the tab's own size, applies again).
  const resetHeight = React.useCallback(() => {
    useLayoutSettingsStore.setState((state) => {
      if (state.bottomDockHeights[heightKey] === undefined) return state;
      const next = { ...state.bottomDockHeights };
      delete next[heightKey];
      return { bottomDockHeights: next };
    });
  }, [heightKey]);

  return (
    <div
      ref={rootRef}
      data-testid="center-with-bottom-dock"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      {/* View pane — definite height via absolute insets (bottom = reserve).
          It clips and stacks below the dock: a view whose content outgrows
          the pane (Integrated's split panes and surface canvas in a short
          column) drew over the dock, which then looked gone (QA 2026-10-31
          N3). */}
      <div
        data-testid="center-view-pane"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: bottomReserve,
          overflow: 'hidden',
          isolation: 'isolate',
          zIndex: 0,
        }}
      >
        {children}
      </div>

      {open && (
        <>
          {showResizer && (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize bottom dock"
              data-testid="bottom-dock-resizer"
              onPointerDown={handleResizeStart}
              onDoubleClick={resetHeight}
              title="Drag to resize; double-click to reset"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: effectiveDockHeight + footerPx,
                height: `${RESIZER_PX}px`,
                cursor: 'ns-resize',
                background: 'var(--app-border-subtle)',
                zIndex: 2,
              }}
            />
          )}
          <div
            data-testid="center-dock-pane"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: footerPx,
              height: `${effectiveDockHeight}px`,
              zIndex: 3,
            }}
          >
            <BottomWorkbenchDock
              plot={<PlotPanel defaultMode={defaultPlotMode} />}
              activity={<ActivityPanel />}
              log={<LogPanel />}
              clusters={<ClusterPanel />}
              extraTabs={extraTabs}
              activeTab={shownTab ?? DEFAULT_DOCK_TAB}
              onActiveTabChange={chooseTab}
              onClose={() => setBottomDockOpen(false, heightKey)}
              minimized={minimized}
              onMinimize={() => setBottomDockMinimized(true)}
              onRestore={() => setBottomDockMinimized(false)}
            />
          </div>
        </>
      )}

      {footer ? (
        <div
          data-testid="center-dock-footer"
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${footerPx}px`, zIndex: 3 }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
};

export default CenterWithBottomDock;
