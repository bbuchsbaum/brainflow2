import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { BIDS_RUNS_TAB } from '@/components/bids/bidsDock';
import type { DockTabId } from './bottomWorkbenchDock.constants';

/**
 * Reveal a bottom-dock tab: open the dock, restore it when minimized and
 * select the tab. Used by menus, the command palette and Inspector links.
 */
export function openDockTab(tab: DockTabId, options: { focus?: boolean } = {}): void {
  const store = useLayoutSettingsStore.getState();
  store.setBottomDockOpen(true);
  store.setBottomDockMinimized(false);
  store.setBottomDockActiveTab(tab);
  if (options.focus) focusDockTab(tab);
}

/** The dock tab a View › Panels request opens, or null for a non-dock panel. */
export function dockTabForPanel(panelType: string): DockTabId | null {
  if (panelType === 'ClusterPanel') return 'clusters';
  if (panelType === 'PlotPanel') return 'plot';
  return null;
}

/** First control to focus in a tab when a command opens it. */
const FOCUS_TARGET: Partial<Record<DockTabId, string>> = {
  clusters: '[data-testid="cluster-panel"] #cluster-threshold:not([disabled]), [data-testid="cluster-panel"] button:not([disabled])',
  [BIDS_RUNS_TAB]: '[data-testid="bids-runs-list"]',
};

/**
 * Move focus into a just-opened tab (a command that "shows" a panel takes
 * the user there). Retries for a few frames: the tab mounts, and a closing
 * dialog (the command palette) returns focus first.
 */
function focusDockTab(tab: DockTabId): void {
  const selector = FOCUS_TARGET[tab];
  if (!selector || typeof document === 'undefined') return;
  let tries = 0;
  const attempt = () => {
    tries += 1;
    const el = document.querySelector<HTMLElement>(selector);
    if (el && document.activeElement !== el) el.focus();
    // Keep re-asserting for a few frames (a closing dialog restores focus).
    if (tries < 8) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}
