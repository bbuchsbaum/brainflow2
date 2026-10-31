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

import { Suspense, useCallback, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { IconButton, Tabs, tabIds } from '@/components/ui/bf';
import {
  DEFAULT_DOCK_TAB,
  DOCK_TAB_BAR_HEIGHT,
  type CoreDockTabId,
  type DockTabId,
} from './bottomWorkbenchDock.constants';
import { moduleRegistry, useModuleRegistryVersion, type ModuleDockTab } from '@/modules/registry';
import { lazyComponent } from '@/modules/lazyComponent';
import { ActiveModuleGate } from '@/components/modules/ActiveModuleGate';

export interface BottomWorkbenchDockProps {
  /** Plot slot content. */
  plot: ReactNode;
  /** Activity slot content. */
  activity: ReactNode;
  /** Log slot content. */
  log: ReactNode;
  /** Clusters slot content (P3.5 cluster table). */
  clusters?: ReactNode;
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
  /** When true, the dock is collapsed to just its tab bar (body hidden). */
  minimized?: boolean;
  /** When provided, renders a minimize button in the tab bar (expanded state). */
  onMinimize?: () => void;
  /** When provided, renders a restore button in the tab bar (minimized state). */
  onRestore?: () => void;
  /** Optional className appended to the dock root. */
  className?: string;
}

const TAB_BAR_HEIGHT = DOCK_TAB_BAR_HEIGHT;

const DOCK_ID_BASE = 'bottom-dock';

/** Core tabs, then the tabs of enabled modules (stable per registry change). */
const tabItemsCache = new WeakMap<readonly ModuleDockTab[], Array<{ value: string; label: string; testId: string }>>();
function dockTabItems(tabs: readonly ModuleDockTab[]) {
  let items = tabItemsCache.get(tabs);
  if (!items) {
    items = tabs.map(({ id, title }) => ({ value: id, label: title, testId: `bottom-dock-tab-${id}` }));
    tabItemsCache.set(tabs, items);
  }
  return items;
}

function ModuleDockTabBody({ tab }: { tab: ModuleDockTab }) {
  if (!tab.component || !tab.moduleId) return null;
  const Body = lazyComponent(tab.component);
  return (
    <ActiveModuleGate moduleId={tab.moduleId} label={tab.title}>
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </ActiveModuleGate>
  );
}

export function BottomWorkbenchDock({
  plot,
  activity,
  log,
  clusters = null,
  activeTab: controlledTab,
  defaultActiveTab = DEFAULT_DOCK_TAB,
  onActiveTabChange,
  onClose,
  minimized = false,
  onMinimize,
  onRestore,
  className,
}: BottomWorkbenchDockProps) {
  // Controlled/uncontrolled hybrid: when `activeTab` is provided the dock
  // reflects it (so external store changes switch the tab even while mounted);
  // otherwise it manages its own state from `defaultActiveTab`.
  const isControlled = controlledTab !== undefined;
  const [localTab, setLocalTab] = useState<DockTabId>(defaultActiveTab);
  useModuleRegistryVersion();
  const tabs = moduleRegistry.getDockTabs();
  const requestedTab = isControlled ? controlledTab : localTab;
  // A remembered tab of a module that is now off falls back to the default.
  const activeTab = tabs.some((t) => t.id === requestedTab) ? requestedTab : DEFAULT_DOCK_TAB;

  const handleSelect = useCallback(
    (tab: DockTabId) => {
      // Clicking any tab while minimized re-expands the dock.
      if (minimized) onRestore?.();
      if (tab === activeTab) return;
      if (!isControlled) setLocalTab(tab);
      onActiveTabChange?.(tab);
    },
    [activeTab, isControlled, onActiveTabChange, minimized, onRestore],
  );

  const slots: Record<CoreDockTabId, ReactNode> = { activity, plot, clusters, log };
  const activeModuleTab = tabs.find((t) => t.id === activeTab && t.moduleId !== null);

  return (
    <div
      className={className ? `bf-bottom-dock ${className}` : 'bf-bottom-dock'}
      data-testid="bottom-workbench-dock"
      data-active-tab={activeTab}
      style={{
        height: '100%',
        width: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateRows: minimized ? `${TAB_BAR_HEIGHT}px` : `${TAB_BAR_HEIGHT}px 1fr`,
        // Dock content sits on the panel ground, like every docked panel.
        background: 'var(--bf-bg-panel)',
        color: 'var(--app-text-primary)',
      }}
    >
      <div
        className="bf-bottom-dock-tabbar flex min-w-0 items-stretch border-b border-bf-border-subtle bg-bf-bg-shell px-1.5"
      >
        {/* Flat tabs (bf Tabs, neutral edge): ids `bottom-dock-tab-<id>` /
            `bottom-dock-panel-<id>`. A click on any tab (even the active one)
            reaches handleSelect, which restores a minimized dock. */}
        <Tabs
          idBase={DOCK_ID_BASE}
          items={dockTabItems(tabs)}
          value={activeTab}
          onValueChange={(tab) => handleSelect(tab as DockTabId)}
          aria-label="Bottom dock"
          data-testid="bottom-dock-tablist"
        />

        {(onMinimize || onRestore || onClose) && (
          <div className="ml-auto inline-flex items-center gap-0.5">
            {minimized
              ? onRestore && (
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label="Restore bottom dock"
                    title="Restore bottom dock"
                    data-testid="bottom-dock-restore"
                    onClick={onRestore}
                    icon={<ChevronUp />}
                  />
                )
              : onMinimize && (
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label="Minimize bottom dock"
                    title="Minimize bottom dock"
                    data-testid="bottom-dock-minimize"
                    onClick={onMinimize}
                    icon={<ChevronDown />}
                  />
                )}
            {onClose ? (
              <IconButton
                size="xs"
                variant="ghost"
                aria-label="Hide bottom dock"
                title="Hide bottom dock"
                data-testid="bottom-dock-close"
                onClick={onClose}
                icon={<X />}
              />
            ) : null}
          </div>
        )}
      </div>

      {!minimized && (
        <div
          role="tabpanel"
          id={tabIds(DOCK_ID_BASE, activeTab).panel}
          aria-labelledby={tabIds(DOCK_ID_BASE, activeTab).tab}
          data-testid="bottom-dock-panel"
          style={{
            position: 'relative',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {activeModuleTab ? (
            <ModuleDockTabBody tab={activeModuleTab} />
          ) : (
            slots[activeTab as CoreDockTabId]
          )}
        </div>
      )}
    </div>
  );
}

export default BottomWorkbenchDock;
