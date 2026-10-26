import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import type { DockTabId } from './bottomWorkbenchDock.constants';

/**
 * Reveal a bottom-dock tab: open the dock, restore it when minimized and
 * select the tab. Used by menus, the command palette and Inspector links.
 */
export function openDockTab(tab: DockTabId): void {
  const store = useLayoutSettingsStore.getState();
  store.setBottomDockOpen(true);
  store.setBottomDockMinimized(false);
  store.setBottomDockActiveTab(tab);
}
