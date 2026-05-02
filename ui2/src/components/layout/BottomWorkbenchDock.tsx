/**
 * BottomWorkbenchDock — Phase 3 of the integrated workspace refactor.
 *
 * A horizontal three-pane dock (Plot | Activity | Log) backed by Allotment.
 * Acts as a layout primitive: content for each slot is provided by the parent.
 * Activity/Log slot content lives in separate motes; this component supplies
 * only the dock chrome, splitter behavior, and maximize/collapse affordances.
 *
 * Splitter sizes are exposed via `defaultSizes` + `onSizesChange` so the
 * persistence mote can wire them to a Zustand store later.
 */

import { Allotment, type AllotmentHandle } from 'allotment';
import 'allotment/dist/style.css';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_DOCK_SIZES,
  DOCK_COLLAPSED_LOG_WIDTH,
  type DockSizes,
} from './bottomWorkbenchDock.constants';

export interface BottomWorkbenchDockProps {
  /** Plot slot content. The plot host is delivered by Phase 4. */
  plot: ReactNode;
  /** Activity slot content. Owned by the Activity panel mote. */
  activity: ReactNode;
  /** Log slot content. Owned by the Log panel mote. */
  log: ReactNode;
  /**
   * Initial pane sizes as `[plot, activity, log]`. Allotment treats them as
   * ratios when they don't sum to the container width. Defaults to 50/30/20.
   */
  defaultSizes?: DockSizes;
  /**
   * Fired when the user drags a splitter. Persistence-ready hook — sizes are
   * always reported as a tuple of three pixel values (Allotment's runtime
   * coordinates).
   */
  onSizesChange?: (sizes: DockSizes) => void;
  /** Initial maximized state for the Plot pane. */
  defaultPlotMaximized?: boolean;
  onPlotMaximizedChange?: (maximized: boolean) => void;
  /** Initial collapsed state for the Log pane. */
  defaultLogCollapsed?: boolean;
  onLogCollapsedChange?: (collapsed: boolean) => void;
  /** Optional className appended to the dock root. */
  className?: string;
}

interface DockPaneProps {
  title: string;
  testid: string;
  collapsed?: boolean;
  axisAccent?: 'plot' | 'activity' | 'log';
  actions?: ReactNode;
  children: ReactNode;
}

function DockPane({ title, testid, collapsed = false, actions, children }: DockPaneProps) {
  return (
    <div
      data-testid={testid}
      data-collapsed={collapsed ? 'true' : 'false'}
      className="bf-dock-pane"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--app-surface-panel-raised)',
        color: 'var(--app-text-primary)',
        overflow: 'hidden',
      }}
    >
      <div
        className="bf-dock-pane-header bf-role-section"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '4px',
          padding: '0 8px',
          height: `${DOCK_COLLAPSED_LOG_WIDTH}px`,
          minHeight: `${DOCK_COLLAPSED_LOG_WIDTH}px`,
          borderBottom: collapsed ? 'none' : '1px solid var(--app-border-subtle)',
          color: 'var(--app-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--app-role-section-tracking)',
          fontSize: 'var(--app-role-section-size)',
          fontWeight: 'var(--app-role-section-weight)' as never,
          flex: '0 0 auto',
        }}
      >
        <span aria-hidden={collapsed && !actions}>{title}</span>
        {actions ? <span style={{ display: 'flex', gap: '4px' }}>{actions}</span> : null}
      </div>
      {!collapsed && (
        <div className="bf-dock-pane-body" style={{ flex: '1 1 auto', overflow: 'auto', minHeight: 0 }}>
          {children}
        </div>
      )}
    </div>
  );
}

interface DockActionButtonProps {
  label: string;
  onClick: () => void;
  testid: string;
  glyph: string;
}

function DockActionButton({ label, onClick, testid, glyph }: DockActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testid}
      style={{
        appearance: 'none',
        background: 'transparent',
        border: 'none',
        padding: '0 4px',
        cursor: 'pointer',
        color: 'var(--app-text-muted)',
        fontSize: '11px',
        lineHeight: 1,
        height: '20px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {glyph}
    </button>
  );
}

export function BottomWorkbenchDock({
  plot,
  activity,
  log,
  defaultSizes = DEFAULT_DOCK_SIZES,
  onSizesChange,
  defaultPlotMaximized = false,
  onPlotMaximizedChange,
  defaultLogCollapsed = false,
  onLogCollapsedChange,
  className,
}: BottomWorkbenchDockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const allotmentRef = useRef<AllotmentHandle>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [restoreSizes, setRestoreSizes] = useState<DockSizes>(defaultSizes);
  const [plotMaximized, setPlotMaximized] = useState(defaultPlotMaximized);
  const [logCollapsed, setLogCollapsed] = useState(defaultLogCollapsed);
  const suppressChangeRef = useRef(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const computeSizes = useCallback(
    (restore: DockSizes, maximized: boolean, collapsed: boolean, width: number): DockSizes => {
      if (width <= 0) return restore;
      if (maximized) return [width, 0, 0];
      if (collapsed) {
        const remaining = Math.max(0, width - DOCK_COLLAPSED_LOG_WIDTH);
        const plotR = restore[0];
        const actR = restore[1];
        const totalR = plotR + actR || 1;
        return [
          remaining * (plotR / totalR),
          remaining * (actR / totalR),
          DOCK_COLLAPSED_LOG_WIDTH,
        ];
      }
      const total = restore[0] + restore[1] + restore[2] || 1;
      return [
        width * (restore[0] / total),
        width * (restore[1] / total),
        width * (restore[2] / total),
      ];
    },
    [],
  );

  useEffect(() => {
    if (containerWidth <= 0) return;
    const target = computeSizes(restoreSizes, plotMaximized, logCollapsed, containerWidth);
    suppressChangeRef.current = true;
    allotmentRef.current?.resize([target[0], target[1], target[2]]);
    queueMicrotask(() => {
      suppressChangeRef.current = false;
    });
  }, [plotMaximized, logCollapsed, containerWidth, restoreSizes, computeSizes]);

  const handleChange = useCallback(
    (sizes: number[]) => {
      if (suppressChangeRef.current) return;
      if (sizes.length !== 3) return;
      const tuple: DockSizes = [sizes[0], sizes[1], sizes[2]];

      if (plotMaximized) {
        setPlotMaximized(false);
        onPlotMaximizedChange?.(false);
      }
      if (logCollapsed && tuple[2] > DOCK_COLLAPSED_LOG_WIDTH + 8) {
        setLogCollapsed(false);
        onLogCollapsedChange?.(false);
      }
      setRestoreSizes(tuple);
      onSizesChange?.(tuple);
    },
    [plotMaximized, logCollapsed, onSizesChange, onPlotMaximizedChange, onLogCollapsedChange],
  );

  const togglePlotMaximize = useCallback(() => {
    setPlotMaximized((prev) => {
      const next = !prev;
      if (next) {
        setLogCollapsed(false);
        onLogCollapsedChange?.(false);
      }
      onPlotMaximizedChange?.(next);
      return next;
    });
  }, [onPlotMaximizedChange, onLogCollapsedChange]);

  const toggleLogCollapse = useCallback(() => {
    setLogCollapsed((prev) => {
      const next = !prev;
      if (next && plotMaximized) {
        setPlotMaximized(false);
        onPlotMaximizedChange?.(false);
      }
      onLogCollapsedChange?.(next);
      return next;
    });
  }, [plotMaximized, onLogCollapsedChange, onPlotMaximizedChange]);

  const initialSizes = [defaultSizes[0], defaultSizes[1], defaultSizes[2]];

  return (
    <div
      ref={containerRef}
      className={className ? `bf-bottom-dock ${className}` : 'bf-bottom-dock'}
      data-testid="bottom-workbench-dock"
      data-plot-maximized={plotMaximized ? 'true' : 'false'}
      data-log-collapsed={logCollapsed ? 'true' : 'false'}
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        background: 'var(--app-bg-primary)',
      }}
    >
      <Allotment
        ref={allotmentRef}
        defaultSizes={initialSizes}
        onChange={handleChange}
        proportionalLayout
      >
        <Allotment.Pane minSize={0} snap>
          <DockPane
            title="PLOT"
            testid="dock-plot-pane"
            actions={
              <DockActionButton
                label={plotMaximized ? 'Restore plot pane' : 'Maximize plot pane'}
                onClick={togglePlotMaximize}
                testid="dock-plot-maximize"
                glyph={plotMaximized ? '▢' : '▣'}
              />
            }
          >
            {plot}
          </DockPane>
        </Allotment.Pane>

        <Allotment.Pane minSize={0} snap>
          <DockPane title="ACTIVITY" testid="dock-activity-pane">
            {activity}
          </DockPane>
        </Allotment.Pane>

        <Allotment.Pane minSize={DOCK_COLLAPSED_LOG_WIDTH}>
          <DockPane
            title="LOG"
            testid="dock-log-pane"
            collapsed={logCollapsed}
            actions={
              <DockActionButton
                label={logCollapsed ? 'Expand log pane' : 'Collapse log pane'}
                onClick={toggleLogCollapse}
                testid="dock-log-collapse"
                glyph={logCollapsed ? '‹' : '›'}
              />
            }
          >
            {log}
          </DockPane>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}

export default BottomWorkbenchDock;
