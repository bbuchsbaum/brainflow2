/**
 * Layout Service - Manages GoldenLayout component addition and manipulation
 */

import {
  type ComponentItem,
  type ComponentItemConfig,
  type ContentItem,
  GoldenLayout,
  LayoutConfig,
  type ResolvedLayoutConfig,
  Stack,
} from 'golden-layout';
import { nanoid } from 'nanoid';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useSurfaceStore } from '@/stores/surfaceStore';

type SurfaceStoreState = ReturnType<typeof useSurfaceStore.getState>;
import { workspaceTabLabels } from '@/components/ui/displayModeSelector.helpers';
import { cloneLayoutConfig } from '@/utils/layoutConfigUtils';
import {
  programmaticTabChange,
  programmaticTabRemoval,
} from '@/components/layout/workspaceTabSync';
import { ensureCentreStack, getCentreStack } from '@/components/layout/centreStack';
import { surfaceGroupKey } from '@/utils/surfaceIdentity';

type LayoutComponentState = Record<string, unknown>;

/**
 * How a surface load should target a surface view tab.
 * - `auto` (default): join the existing tab that hosts the surface's scene (same
 *   group key) — or the same handle — instead of minting a duplicate.
 * - `new-view`: always create a fresh tab (explicit "open in new view"/compare).
 */
export type SurfaceViewIntent = 'auto' | 'new-view';

export interface EnsureSurfaceViewOptions {
  intent?: SurfaceViewIntent;
}

/**
 * Group key stored on (or derivable from) a surfaceView tab's component state.
 * Prefer the persisted `groupKey`; fall back to deriving it from the stored path
 * so tabs created before this field existed still match.
 */
const surfaceViewGroupKey = (state: LayoutComponentState): string | null => {
  if (typeof state.groupKey === 'string') {
    return state.groupKey;
  }
  return typeof state.path === 'string' ? surfaceGroupKey(state.path) : null;
};

const isStateRecord = (value: unknown): value is LayoutComponentState =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getComponentState = (item: ComponentItem): LayoutComponentState => {
  const rawState = item.container.initialState;
  return isStateRecord(rawState) ? rawState : {};
};

const isComponentItem = (item: ContentItem): item is ComponentItem => item.type === 'component';

/**
 * A layout `loadLayout` accepts. `saveLayout()` returns a *resolved* config
 * (numeric sizes, `resolved: true`, …) that `loadLayout` rejects ("value.trimStart
 * is not a function"), which is why every saved layout failed to restore
 * (QA 2026-10-30 F2). Layouts saved before this fix are stored resolved, so
 * both shapes are accepted here.
 */
export function toLoadableLayoutConfig(
  config: LayoutConfig | ResolvedLayoutConfig,
): LayoutConfig {
  return LayoutConfig.isResolved(config as LayoutConfig | ResolvedLayoutConfig)
    ? LayoutConfig.fromResolved(config as ResolvedLayoutConfig)
    : (config as LayoutConfig);
}

/**
 * The default app shell: Files/Subjects on the left, the workspace tab stack in
 * the centre, the Inspector on the right. GoldenLayoutRoot boots from it and
 * Reset layout restores it. Header controls keep maximise + close and drop the
 * pop-out (separate-window, brittle in a desktop app) and the tab-dropdown caret.
 */
export function createDefaultLayoutConfig(): LayoutConfig {
  return {
    header: {
      popout: false,
      tabDropdown: false,
    },
    root: {
      type: 'row',
      content: [
        {
          type: 'column',
          width: 17.25,
          content: [
            {
              type: 'stack',
              content: [
                {
                  type: 'component',
                  componentType: 'FileBrowser',
                  title: 'Files',
                  componentState: {},
                },
                {
                  type: 'component',
                  componentType: 'StudioDesignPanel',
                  title: 'Subjects',
                  componentState: {},
                },
              ],
            },
          ],
        },
        {
          type: 'stack', // Center stack for workspace tabs
          width: 59.75,
          content: [], // Workspaces are added from workspaceStore
        },
        {
          type: 'column',
          width: 23,
          content: [
            {
              type: 'stack',
              content: [
                {
                  type: 'component',
                  componentType: 'Inspector',
                  title: 'Inspector',
                  componentState: {},
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

type SavedItem = {
  type?: string;
  componentType?: unknown;
  content?: SavedItem[];
  activeItemIndex?: number;
};

/**
 * Remove surfaceView components under `item` (a saved layout item), dropping
 * stacks, rows and columns that end up empty. True when `item` itself is
 * empty afterwards (and should be dropped by its parent).
 */
function stripSurfaceViews(item: SavedItem): boolean {
  if (item.type === 'component') return item.componentType === 'surfaceView';
  if (!Array.isArray(item.content)) return false;
  const hadContent = item.content.length > 0;
  const active =
    typeof item.activeItemIndex === 'number' ? item.content[item.activeItemIndex] : undefined;
  item.content = item.content.filter((child) => !stripSurfaceViews(child));
  if (typeof item.activeItemIndex === 'number') {
    // GoldenLayout rejects a stack whose active index is out of range.
    const kept = active ? item.content.indexOf(active) : -1;
    item.activeItemIndex = kept >= 0 ? kept : 0;
  }
  return hadContent && item.content.length === 0;
}

/** Legacy per-kind right-rail panels; all resolve to the single Inspector tab. */
const INSPECTOR_ALIASES: ReadonlySet<string> = new Set([
  'LayerPanel',
  'AtlasPanel',
  'SurfacePanel',
  'StudioInspectorPanel',
]);

/** The componentType a panel request actually lives under. */
export function resolvePanelComponentType(panelType: string): string {
  return INSPECTOR_ALIASES.has(panelType) ? 'Inspector' : panelType;
}

/** Every component item of `componentType` anywhere under `root`, in tree order. */
export function findComponentItemsByType(
  root: ContentItem | null | undefined,
  componentType: string,
): ComponentItem[] {
  const found: ComponentItem[] = [];
  const visit = (item: ContentItem | null | undefined) => {
    if (!item) return;
    if (isComponentItem(item)) {
      if (item.componentType === componentType) found.push(item);
      return;
    }
    item.contentItems?.forEach(visit);
  };
  visit(root);
  return found;
}

export type SidebarPanelType =
  | 'FileBrowser'
  | 'StudioDesignPanel'
  | 'Inspector'
  // Legacy aliases — preserved so existing focus calls still resolve. All
  // four redirect to the unified Inspector at the GoldenLayout registration
  // layer (see `GoldenLayoutRoot.tsx`).
  | 'LayerPanel'
  | 'AtlasPanel'
  | 'SurfacePanel'
  | 'StudioInspectorPanel'
  | 'SetPanel';

export interface LayoutService {
  addComponent(config: ComponentItemConfig): void;
  setLayoutRef(layout: unknown): void;
  focusSidebarPanel(panelType: SidebarPanelType): void;
  /**
   * Reveal a side panel: focus the existing tab wherever it is docked, or add
   * it to its home stack when it was closed. Never adds a duplicate.
   */
  showPanel(panelType: string): boolean;
  focusSurfacePanel(): void;
  ensureSurfaceView(surfaceHandle: string, path?: string, options?: EnsureSurfaceViewOptions): void;
  closeSurfaceViewTabs(surfaceHandle: string): void;
  captureLayout(): LayoutConfig | null;
  /** Load a saved shell; on failure the default shell is loaded instead ('reset'). */
  applyLayout(config: LayoutConfig | ResolvedLayoutConfig): LayoutApplyResult;
  resetToDefaultLayout(): boolean;
}

/** What `applyLayout` left on screen. */
export type LayoutApplyResult = 'applied' | 'reset' | 'failed';

class LayoutServiceImpl implements LayoutService {
  private layoutRef: GoldenLayout | null = null;

  private getRootRow(): ContentItem | null {
    const root = this.layoutRef?.rootItem;
    return root && root.type === 'row' ? root : null;
  }

  private getCenterStack(): Stack | null {
    return getCentreStack(this.layoutRef);
  }

  /** The centre stack, re-created when GoldenLayout removed it with its last tab. */
  private ensureCenterStack(): Stack | null {
    return ensureCentreStack(this.layoutRef);
  }

  private getSidebarStack(): Stack | null {
    const root = this.getRootRow();
    const rightColumn = root?.contentItems[2];
    if (!rightColumn || rightColumn.type !== 'column') {
      return null;
    }

    const sidebarStack = rightColumn.contentItems[0];
    return sidebarStack?.type === 'stack' ? (sidebarStack as Stack) : null;
  }

  private getLeftSidebarStack(): Stack | null {
    const root = this.getRootRow();
    const leftColumn = root?.contentItems[0];
    if (!leftColumn || leftColumn.type !== 'column') {
      return null;
    }

    const sidebarStack = leftColumn.contentItems[0];
    return sidebarStack?.type === 'stack' ? (sidebarStack as Stack) : null;
  }

  private getStackForPanelType(panelType: string): Stack | null {
    switch (panelType) {
      case 'FileBrowser':
      case 'StudioDesignPanel':
        return this.getLeftSidebarStack();
      default:
        return this.getSidebarStack();
    }
  }

  private getPanelTitle(panelType: string): string {
    switch (panelType) {
      case 'FileBrowser':
        return 'Files';
      case 'StudioDesignPanel':
        return 'Subjects';
      case 'Inspector':
      // Legacy aliases all collapse to the single Inspector tab.
      case 'LayerPanel':
      case 'AtlasPanel':
      case 'SurfacePanel':
      case 'StudioInspectorPanel':
        return 'Inspector';
      case 'SetPanel':
        return 'Set';
      default:
        return panelType;
    }
  }

  private normalizeLayoutConfig(config: LayoutConfig): LayoutConfig | null {
    let cloned: LayoutConfig;
    try {
      cloned = cloneLayoutConfig(toLoadableLayoutConfig(config));
    } catch (error) {
      console.warn('[LayoutService] Unreadable layout config:', error);
      return null;
    }
    const root = cloned.root;

    if (!root || root.type !== 'row' || !Array.isArray(root.content) || root.content.length < 3) {
      return null;
    }

    const centerStack = root.content[1];
    if (!centerStack || centerStack.type !== 'stack') {
      return null;
    }

    // Workspace tabs are rehydrated from workspaceStore to avoid stale ids.
    centerStack.content = [];
    if (typeof (centerStack as SavedItem).activeItemIndex === 'number') {
      (centerStack as SavedItem).activeItemIndex = 0;
    }
    // Surface tabs are carried across a reload from the live layout, wherever
    // they are docked. A saved copy would show twice (one dragged to a side
    // stack) or come back dead (its surface closed since it was saved).
    // The row's three columns stay in place (the centre must stay second).
    root.content.forEach((item) => stripSurfaceViews(item as SavedItem));

    return cloned;
  }

  private addWorkspaceTabsFromStore(): void {
    const centerStack = this.ensureCenterStack();
    if (!centerStack) {
      console.warn('[LayoutService] Cannot rehydrate workspaces - center stack unavailable');
      return;
    }

    const state = useWorkspaceStore.getState();
    const workspaceEntries = Array.from(state.workspaces.values());
    const layout = this.layoutRef;
    if (!layout) {
      return;
    }

    const tabLabels = workspaceTabLabels(workspaceEntries);
    workspaceEntries.forEach((workspace) => {
      const itemConfig = {
        type: 'component' as const,
        componentType: 'Workspace',
        // Derive from the live type (not the persisted title) so a restored tab
        // matches the mode pill — mirrors GoldenLayoutRoot's tab labelling and
        // avoids reintroducing stale titles after a saved-layout restore.
        title: tabLabels.get(workspace.id) ?? workspace.title,
        componentState: {
          workspaceId: workspace.id,
          workspaceType: workspace.type,
        },
      };

      try {
        centerStack.addItem(itemConfig);
      } catch (error) {
        console.warn('[LayoutService] Failed to restore workspace tab:', error);
      }
    });

    this.focusActiveWorkspaceTab(centerStack);
  }

  /**
   * Surface view tabs have no store of their own, so a layout reload carries
   * them across. Each tab's per-view settings, selection and viewpoint live in
   * surfaceStore under its surfaceViewId; the old panels unmount after the
   * reload, so the entries are captured now and put back unowned: the
   * remounted panel (same id) claims them, the old one's cleanup cannot.
   */
  private captureSurfaceTabs(): {
    tabs: ComponentItemConfig[];
    snapshots: ReadonlyArray<readonly [string, ReturnType<SurfaceStoreState['captureSurfaceView']>]>;
    /** The surface tab in front of the centre stack, if one was. */
    frontSurfaceViewId: string | null;
  } {
    const front = this.getCenterStack()?.getActiveComponentItem?.();
    const frontState = front && front.componentType === 'surfaceView' ? getComponentState(front) : {};
    const frontSurfaceViewId =
      typeof frontState.surfaceViewId === 'string' ? frontState.surfaceViewId : null;
    const tabs = this.layoutRef
      ? findComponentItemsByType(this.layoutRef.rootItem, 'surfaceView').map(
          (item): ComponentItemConfig => ({
            type: 'component',
            componentType: 'surfaceView',
            title: item.title,
            componentState: getComponentState(item),
          }),
        )
      : [];
    const surfaceStore = useSurfaceStore.getState();
    const snapshots = tabs.flatMap((config) => {
      const state = config.componentState as LayoutComponentState | undefined;
      const id = typeof state?.surfaceViewId === 'string' ? state.surfaceViewId : null;
      const snapshot = id ? surfaceStore.captureSurfaceView(id) : null;
      return id && snapshot ? [[id, snapshot] as const] : [];
    });
    return { tabs, snapshots, frontSurfaceViewId };
  }

  private restoreSurfaceTabs(captured: ReturnType<LayoutServiceImpl['captureSurfaceTabs']>): void {
    for (const [id, snapshot] of captured.snapshots) {
      if (snapshot) useSurfaceStore.getState().restoreSurfaceView(id, snapshot);
    }
    const centerStack = this.ensureCenterStack();
    if (!centerStack) return;
    for (const config of captured.tabs) {
      try {
        centerStack.addItem(config);
      } catch (error) {
        console.warn('[LayoutService] Failed to restore surface view tab:', error);
      }
    }
    // Adding a tab brings it to the front: put back the tab that was in front.
    const frontSurface = captured.frontSurfaceViewId
      ? centerStack.contentItems.find(
          (item) =>
            isComponentItem(item) &&
            item.componentType === 'surfaceView' &&
            getComponentState(item).surfaceViewId === captured.frontSurfaceViewId,
        )
      : undefined;
    if (frontSurface && isComponentItem(frontSurface)) {
      try {
        centerStack.setActiveComponentItem(frontSurface, true);
      } catch (error) {
        console.warn('[LayoutService] Failed to activate surface tab after layout restore:', error);
      }
    } else {
      this.focusActiveWorkspaceTab(centerStack);
    }
  }

  private focusActiveWorkspaceTab(centerStack: Stack): void {
    const { activeWorkspaceId } = useWorkspaceStore.getState();
    if (!activeWorkspaceId) return;
    const activeItem = centerStack.contentItems.find(
      (item) =>
        isComponentItem(item) && getComponentState(item).workspaceId === activeWorkspaceId,
    );
    if (activeItem && isComponentItem(activeItem)) {
      try {
        centerStack.setActiveComponentItem(activeItem, true);
      } catch (error) {
        console.warn('[LayoutService] Failed to activate workspace after layout restore:', error);
      }
    }
  }

  /**
   * Reload the shell from `config` and put the workspace and surface tabs back.
   * When `config` cannot be loaded, `fallback` (the default shell) is loaded
   * instead. The result says which one is on screen.
   */
  private loadLayoutAndRehydrate(
    config: LayoutConfig,
    fallback?: LayoutConfig,
  ): LayoutApplyResult {
    if (!this.layoutRef || typeof this.layoutRef.loadLayout !== 'function') {
      console.warn('[LayoutService] Cannot load layout - layout not initialized');
      return 'failed';
    }

    const layout = this.layoutRef;
    const surfaceTabs = this.captureSurfaceTabs();
    // Reloading destroys every workspace tab; that is not the user closing
    // them, so their workspaces stay (and are re-added just below).
    const load = (next: LayoutConfig): boolean => {
      try {
        programmaticTabRemoval.run(() => layout.loadLayout(next));
        return true;
      } catch (error) {
        console.error('[LayoutService] Failed to load layout config:', error);
        return false;
      }
    };

    let result: LayoutApplyResult = 'applied';
    if (!load(config)) {
      if (!fallback || !load(fallback)) return 'failed';
      result = 'reset';
    }
    // Every re-added tab comes to the front; none of that is the user
    // switching tabs, so the store's active workspace stays put.
    programmaticTabChange.run(() => {
      this.addWorkspaceTabsFromStore();
      this.restoreSurfaceTabs(surfaceTabs);
    });
    return result;
  }

  setLayoutRef(layout: unknown): void {
    this.layoutRef = layout as GoldenLayout;
    console.log('[LayoutService] Layout reference set');
  }

  addComponent(config: ComponentItemConfig): void {
    const centerStack = this.ensureCenterStack();
    if (!centerStack) {
      console.error('[LayoutService] Layout center stack not initialized');
      return;
    }

    try {
      // Defer addition to next frame to avoid GoldenLayout tab initialization race
      // where activeTab.element is undefined during addChild → setActiveComponentItem
      requestAnimationFrame(() => {
        try {
          centerStack.addItem(config);
          console.log('[LayoutService] Component added:', config);
        } catch {
          // Fallback: try newItem + addChild if addItem not available
          try {
            const newItem = this.layoutRef!.newItem(config);
            centerStack.addChild(newItem, undefined, true);
            console.log('[LayoutService] Component added (fallback):', config);
          } catch (fallbackError) {
            console.error('[LayoutService] Failed to add component:', fallbackError);
          }
        }
      });
    } catch (error) {
      console.error('[LayoutService] Failed to add component:', error);
    }
  }

  ensureSurfaceView(
    surfaceHandle: string,
    path?: string,
    options?: EnsureSurfaceViewOptions,
  ): void {
    const centerStack = this.ensureCenterStack();
    if (!centerStack) {
      console.warn('[LayoutService] Cannot ensure surface view - center stack unavailable');
      return;
    }

    const intent = options?.intent ?? 'auto';
    const groupKey = surfaceGroupKey(path ?? '');

    // Under `auto`, a surface joins the tab already hosting its scene: same group
    // key (Left/Right of one template) or the same handle (reload). `new-view`
    // skips reuse so explicit "open in new view" / compare always gets a fresh tab.
    const existing =
      intent === 'new-view'
        ? undefined
        : centerStack.contentItems.find((item) => {
            if (!isComponentItem(item) || item.componentType !== 'surfaceView') {
              return false;
            }
            const state = getComponentState(item);
            if (state.surfaceHandle === surfaceHandle) {
              return true;
            }
            return groupKey !== null && surfaceViewGroupKey(state) === groupKey;
          });

    if (existing && isComponentItem(existing)) {
      try {
        centerStack.setActiveComponentItem(existing, true);
      } catch (error) {
        console.warn('[LayoutService] Failed to activate existing surface view tab:', error);
      }
      return;
    }

    const title = path?.split('/').pop() || `Surface ${surfaceHandle.slice(0, 8)}`;
    this.addComponent({
      type: 'component',
      componentType: 'surfaceView',
      title,
      componentState: {
        surfaceHandle,
        path,
        groupKey,
        surfaceViewId: nanoid(),
      },
    });
  }

  closeSurfaceViewTabs(surfaceHandle: string): void {
    const centerStack = this.getCenterStack();
    if (!centerStack) {
      console.warn('[LayoutService] Cannot close surface tabs - center stack unavailable');
      return;
    }

    const matchingItems = centerStack.contentItems.filter((item) => {
      if (!isComponentItem(item) || item.componentType !== 'surfaceView') {
        return false;
      }
      const state = getComponentState(item);
      return state.surfaceHandle === surfaceHandle;
    });

    matchingItems.forEach((item) => {
      try {
        if (typeof item.remove === 'function') {
          item.remove();
          return;
        }
        centerStack.removeChild(item, false);
      } catch (error) {
        console.warn('[LayoutService] Failed to close surface tab:', error);
      }
    });
  }

  focusSidebarPanel(panelType: SidebarPanelType): void {
    this.showPanel(panelType);
  }

  showPanel(panelType: string): boolean {
    const layout = this.layoutRef;
    if (!layout) {
      console.warn(`[LayoutService] Cannot show ${panelType} - layout not initialized`);
      return false;
    }
    // Right-rail unification: every legacy per-kind panel collapses to the
    // single Inspector tab. Resolve the requested type BEFORE looking it up.
    const resolvedType = resolvePanelComponentType(panelType);

    // Look through the whole tree: the user may have dragged the panel to
    // another stack, and adding a second copy is never what a menu or shortcut
    // means (QA 2026-10-29: Cmd+B x3 stacked three more Files panels).
    const [existing] = findComponentItemsByType(layout.rootItem, resolvedType);
    if (existing) {
      const parent = existing.parent;
      try {
        if (parent && parent.type === 'stack') {
          (parent as Stack).setActiveComponentItem(existing, true);
        } else {
          existing.focus?.();
        }
      } catch (error) {
        console.warn(`[LayoutService] Failed to focus existing ${resolvedType}:`, error);
      }
      return true;
    }

    const config: ComponentItemConfig = {
      type: 'component',
      componentType: resolvedType,
      title: this.getPanelTitle(resolvedType),
      componentState: {},
    };
    const homeStack = this.getStackForPanelType(resolvedType);
    try {
      if (homeStack) {
        // Stack.addItem, not layout.newItem: newItem already places the item
        // at GoldenLayout's default location, so adding it here again made a
        // second copy (and threw).
        const index = homeStack.addItem(config);
        const newItem = homeStack.contentItems[index];
        if (newItem && isComponentItem(newItem)) {
          homeStack.setActiveComponentItem(newItem, true);
        }
      } else {
        // The home column was closed: let GoldenLayout place the panel.
        // (Reset layout restores the default shell.)
        layout.addComponent(resolvedType, {}, config.title);
      }
      return true;
    } catch (error) {
      console.error(`[LayoutService] Failed to add sidebar panel ${resolvedType}:`, error);
      return false;
    }
  }

  focusSurfacePanel(): void {
    this.focusSidebarPanel('SurfacePanel');
  }

  captureLayout(): LayoutConfig | null {
    if (!this.layoutRef || typeof this.layoutRef.saveLayout !== 'function') {
      return null;
    }

    try {
      const rawLayout = this.layoutRef.saveLayout() as unknown as LayoutConfig;
      const normalized = this.normalizeLayoutConfig(rawLayout);
      if (!normalized) {
        console.warn(
          '[LayoutService] Layout capture produced incompatible config; returning default shell',
        );
        return createDefaultLayoutConfig();
      }
      return normalized;
    } catch (error) {
      console.error('[LayoutService] Failed to capture layout:', error);
      return null;
    }
  }

  applyLayout(config: LayoutConfig | ResolvedLayoutConfig): LayoutApplyResult {
    const normalized = this.normalizeLayoutConfig(config as LayoutConfig);
    if (!normalized) {
      console.warn(
        '[LayoutService] Saved layout incompatible with current schema; restoring default shell',
      );
      return this.resetToDefaultLayout() ? 'reset' : 'failed';
    }

    return this.loadLayoutAndRehydrate(normalized, createDefaultLayoutConfig());
  }

  resetToDefaultLayout(): boolean {
    return this.loadLayoutAndRehydrate(createDefaultLayoutConfig()) === 'applied';
  }
}

// Singleton instance
let layoutServiceInstance: LayoutService | null = null;

export function getLayoutService(): LayoutService {
  if (!layoutServiceInstance) {
    layoutServiceInstance = new LayoutServiceImpl();
  }
  return layoutServiceInstance;
}

export function initializeLayoutService(): LayoutService {
  return getLayoutService();
}
