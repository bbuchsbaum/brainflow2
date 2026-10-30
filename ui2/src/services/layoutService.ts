/**
 * Layout Service - Manages GoldenLayout component addition and manipulation
 */

import {
  type ComponentItem,
  type ComponentItemConfig,
  type ContentItem,
  GoldenLayout,
  type LayoutConfig,
  Stack,
} from 'golden-layout';
import { nanoid } from 'nanoid';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { workspaceTabLabels } from '@/components/ui/displayModeSelector.helpers';
import { cloneLayoutConfig } from '@/utils/layoutConfigUtils';
import { programmaticTabRemoval } from '@/components/layout/workspaceTabSync';
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
  applyLayout(config: LayoutConfig): boolean;
  resetToDefaultLayout(): boolean;
}

class LayoutServiceImpl implements LayoutService {
  private layoutRef: GoldenLayout | null = null;

  private getRootRow(): ContentItem | null {
    const root = this.layoutRef?.rootItem;
    return root && root.type === 'row' ? root : null;
  }

  private getCenterStack(): Stack | null {
    const root = this.getRootRow();
    const centerStack = root?.contentItems[1];
    return centerStack?.type === 'stack' ? (centerStack as Stack) : null;
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
    const cloned = cloneLayoutConfig(config);
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

    return cloned;
  }

  private addWorkspaceTabsFromStore(): void {
    const centerStack = this.getCenterStack();
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
        const newItem = layout.newItem(itemConfig);
        centerStack.addChild(newItem, undefined, false);
      } catch (error) {
        console.warn('[LayoutService] Failed to restore workspace tab:', error);
      }
    });

    if (!state.activeWorkspaceId) {
      return;
    }

    const activeItem = centerStack.contentItems.find((item) => {
      if (!isComponentItem(item)) {
        return false;
      }
      const componentState = getComponentState(item);
      return componentState.workspaceId === state.activeWorkspaceId;
    });

    if (activeItem && isComponentItem(activeItem)) {
      try {
        centerStack.setActiveComponentItem(activeItem, true);
      } catch (error) {
        console.warn('[LayoutService] Failed to activate workspace after layout restore:', error);
      }
    }
  }

  private loadLayoutAndRehydrate(config: LayoutConfig): boolean {
    if (!this.layoutRef || typeof this.layoutRef.loadLayout !== 'function') {
      console.warn('[LayoutService] Cannot load layout - layout not initialized');
      return false;
    }

    try {
      // Reloading destroys every workspace tab; that is not the user closing
      // them, so their workspaces stay (and are re-added just below).
      const layout = this.layoutRef;
      programmaticTabRemoval.run(() => layout.loadLayout(config));
      this.addWorkspaceTabsFromStore();
      return true;
    } catch (error) {
      console.error('[LayoutService] Failed to load layout config:', error);
      return false;
    }
  }

  setLayoutRef(layout: unknown): void {
    this.layoutRef = layout as GoldenLayout;
    console.log('[LayoutService] Layout reference set');
  }

  addComponent(config: ComponentItemConfig): void {
    const centerStack = this.getCenterStack();
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
    const centerStack = this.getCenterStack();
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
        const newItem = layout.newItem(config);
        homeStack.addChild(newItem, undefined, true);
        if (isComponentItem(newItem)) {
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

  applyLayout(config: LayoutConfig): boolean {
    const normalized = this.normalizeLayoutConfig(config);
    if (!normalized) {
      console.warn(
        '[LayoutService] Saved layout incompatible with current schema; restoring default shell',
      );
      return this.resetToDefaultLayout();
    }

    return this.loadLayoutAndRehydrate(normalized);
  }

  resetToDefaultLayout(): boolean {
    // Workspace tabs are rehydrated from workspaceStore; surface view tabs
    // have no store of their own, so carry them across the reload.
    const surfaceTabs = this.layoutRef
      ? findComponentItemsByType(this.layoutRef.rootItem, 'surfaceView').map(
          (item): ComponentItemConfig => ({
            type: 'component',
            componentType: 'surfaceView',
            title: item.title,
            componentState: getComponentState(item),
          }),
        )
      : [];
    // Each tab's per-view settings, selection and viewpoint live in
    // surfaceStore under its surfaceViewId. The old panels unmount after the
    // reload, so capture the entries now and put them back unowned: the
    // remounted panel (same id) claims them, the old one's cleanup cannot.
    const surfaceStore = useSurfaceStore.getState();
    const surfaceSnapshots = surfaceTabs.flatMap((config) => {
      const state = config.componentState as LayoutComponentState | undefined;
      const id = typeof state?.surfaceViewId === 'string' ? state.surfaceViewId : null;
      const snapshot = id ? surfaceStore.captureSurfaceView(id) : null;
      return id && snapshot ? [[id, snapshot] as const] : [];
    });
    if (!this.loadLayoutAndRehydrate(createDefaultLayoutConfig())) {
      return false;
    }
    for (const [id, snapshot] of surfaceSnapshots) {
      useSurfaceStore.getState().restoreSurfaceView(id, snapshot);
    }
    const centerStack = this.getCenterStack();
    if (centerStack && this.layoutRef) {
      for (const config of surfaceTabs) {
        try {
          centerStack.addChild(this.layoutRef.newItem(config), undefined, false);
        } catch (error) {
          console.warn('[LayoutService] Failed to restore surface view tab:', error);
        }
      }
    }
    return true;
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
