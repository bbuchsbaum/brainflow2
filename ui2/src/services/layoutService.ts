/**
 * Layout Service - Manages GoldenLayout component addition and manipulation
 */

import type { ItemConfig, LayoutConfig } from 'golden-layout';
import { useWorkspaceStore } from '@/stores/workspaceStore';

type LayoutComponentState = Record<string, unknown>;

interface LayoutContainerLike {
  initialState?: LayoutComponentState;
  componentState?: LayoutComponentState;
}

interface LayoutItemLike {
  type?: string;
  componentType?: string;
  componentState?: LayoutComponentState;
  container?: LayoutContainerLike;
  contentItems?: LayoutItemLike[];
  addItem?: (config: ItemConfig) => void;
  addChild?: (item: LayoutItemLike) => void;
  removeChild?: (item: LayoutItemLike) => void;
  remove?: () => void;
  setActiveComponentItem?: (item: LayoutItemLike) => void;
}

interface LayoutRefLike {
  rootItem?: LayoutItemLike;
  newItem: (config: ItemConfig) => LayoutItemLike;
  loadLayout: (config: LayoutConfig) => void;
  saveLayout: () => LayoutConfig;
  updateSize?: () => void;
}

const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  root: {
    type: 'row',
    content: [
      {
        type: 'column',
        width: 15,
        content: [
          {
            type: 'component',
            componentType: 'FileBrowser',
            title: 'Files',
            componentState: {},
          },
        ],
      },
      {
        type: 'stack',
        width: 65,
        content: [],
      },
      {
        type: 'column',
        width: 20,
        content: [
          {
            type: 'stack',
            content: [
              {
                type: 'component',
                componentType: 'LayerPanel',
                title: 'Volumes',
                componentState: {},
              },
              {
                type: 'component',
                componentType: 'AtlasPanel',
                title: 'Atlases',
                componentState: {},
              },
              {
                type: 'component',
                componentType: 'SurfacePanel',
                title: 'Surfaces',
                componentState: {},
              },
            ],
          },
        ],
      },
    ],
  },
};

function cloneLayoutConfig(config: LayoutConfig): LayoutConfig {
  return JSON.parse(JSON.stringify(config)) as LayoutConfig;
}

export type SidebarPanelType = 'LayerPanel' | 'AtlasPanel' | 'SurfacePanel';

export interface LayoutService {
  addComponent(config: ItemConfig): void;
  setLayoutRef(layout: unknown): void;
  focusSidebarPanel(panelType: SidebarPanelType): void;
  focusSurfacePanel(): void;
  ensureSurfaceView(surfaceHandle: string, path?: string): void;
  closeSurfaceViewTabs(surfaceHandle: string): void;
  captureLayout(): LayoutConfig | null;
  applyLayout(config: LayoutConfig): boolean;
  resetToDefaultLayout(): boolean;
}

class LayoutServiceImpl implements LayoutService {
  private layoutRef: LayoutRefLike | null = null;

  private getCenterStack(): LayoutItemLike | null {
    if (!this.layoutRef) {
      return null;
    }

    const root = this.layoutRef.rootItem;
    if (!root || root.type !== 'row') {
      return null;
    }

    const centerStack = root.contentItems?.[1];
    if (!centerStack || centerStack.type !== 'stack') {
      return null;
    }

    return centerStack;
  }

  private getSidebarStack(): LayoutItemLike | null {
    if (!this.layoutRef) {
      return null;
    }

    const root = this.layoutRef.rootItem;
    if (!root || root.type !== 'row') {
      return null;
    }

    const rightColumn = root.contentItems?.[2];
    if (!rightColumn || rightColumn.type !== 'column') {
      return null;
    }

    const sidebarStack = rightColumn.contentItems?.[0];
    if (!sidebarStack || sidebarStack.type !== 'stack') {
      return null;
    }

    return sidebarStack;
  }

  private getPanelTitle(panelType: SidebarPanelType): string {
    switch (panelType) {
      case 'LayerPanel':
        return 'Volumes';
      case 'AtlasPanel':
        return 'Atlases';
      case 'SurfacePanel':
        return 'Surfaces';
      default:
        return panelType;
    }
  }

  private normalizeLayoutConfig(config: LayoutConfig): LayoutConfig | null {
    const cloned = cloneLayoutConfig(config);
    const root = (cloned as { root?: LayoutItemLike }).root;

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

    workspaceEntries.forEach((workspace) => {
      const itemConfig = {
        type: 'component' as const,
        componentType: 'Workspace',
        title: workspace.title,
        componentState: {
          workspaceId: workspace.id,
          workspaceType: workspace.type,
        },
      };

      try {
        const newItem = this.layoutRef.newItem(itemConfig);
        centerStack.addChild(newItem);
      } catch (error) {
        console.warn('[LayoutService] Failed to restore workspace tab:', error);
      }
    });

    if (!state.activeWorkspaceId) {
      return;
    }

    const activeItem = (centerStack.contentItems || []).find((item: LayoutItemLike) => {
      const componentState = item.container?.initialState || item.componentState || {};
      return componentState.workspaceId === state.activeWorkspaceId;
    });

    if (activeItem && typeof centerStack.setActiveComponentItem === 'function') {
      try {
        centerStack.setActiveComponentItem(activeItem);
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
      this.layoutRef.loadLayout(config);
      this.addWorkspaceTabsFromStore();
      requestAnimationFrame(() => {
        try {
          this.layoutRef?.updateSize?.();
        } catch (error) {
          console.warn('[LayoutService] Failed to update size after layout restore:', error);
        }
      });
      return true;
    } catch (error) {
      console.error('[LayoutService] Failed to load layout config:', error);
      return false;
    }
  }

  setLayoutRef(layout: unknown): void {
    this.layoutRef = layout as LayoutRefLike;
    console.log('[LayoutService] Layout reference set');
  }

  addComponent(config: ItemConfig): void {
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
            const newItem = this.layoutRef.newItem(config);
            centerStack.addChild(newItem);
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

  ensureSurfaceView(surfaceHandle: string, path?: string): void {
    const centerStack = this.getCenterStack();
    if (!centerStack) {
      console.warn('[LayoutService] Cannot ensure surface view - center stack unavailable');
      return;
    }

    const existing = (centerStack.contentItems || []).find((item: LayoutItemLike) => {
      if (item.componentType !== 'surfaceView') {
        return false;
      }
      const state = item.componentState || {};
      return state.surfaceHandle === surfaceHandle;
    });

    if (existing) {
      try {
        centerStack.setActiveComponentItem(existing);
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
      },
    });
  }

  closeSurfaceViewTabs(surfaceHandle: string): void {
    const centerStack = this.getCenterStack();
    if (!centerStack) {
      console.warn('[LayoutService] Cannot close surface tabs - center stack unavailable');
      return;
    }

    const matchingItems = (centerStack.contentItems || []).filter((item: LayoutItemLike) => {
      if (item.componentType !== 'surfaceView') {
        return false;
      }
      const state = item.componentState || {};
      return state.surfaceHandle === surfaceHandle;
    });

    matchingItems.forEach((item: LayoutItemLike) => {
      try {
        if (typeof item.remove === 'function') {
          item.remove();
          return;
        }
        if (typeof centerStack.removeChild === 'function') {
          centerStack.removeChild(item);
          return;
        }
      } catch (error) {
        console.warn('[LayoutService] Failed to close surface tab:', error);
      }
    });
  }

  focusSidebarPanel(panelType: SidebarPanelType): void {
    const sidebarStack = this.getSidebarStack();
    if (!sidebarStack || !this.layoutRef) {
      console.warn(`[LayoutService] Cannot focus ${panelType} - sidebar stack unavailable`);
      return;
    }

    const existingPanel = (sidebarStack.contentItems || []).find(
      (item: LayoutItemLike) => item.componentType === panelType
    );

    if (existingPanel) {
      try {
        sidebarStack.setActiveComponentItem?.(existingPanel);
        console.log(`[LayoutService] Focused sidebar panel: ${panelType}`);
      } catch (error) {
        console.warn(`[LayoutService] Failed to focus existing ${panelType}:`, error);
      }
      return;
    }

    try {
      const newItem = this.layoutRef.newItem({
        type: 'component',
        componentType: panelType,
        title: this.getPanelTitle(panelType),
        componentState: {},
      });
      sidebarStack.addChild?.(newItem);
      sidebarStack.setActiveComponentItem?.(newItem);
      console.log(`[LayoutService] Added and focused missing sidebar panel: ${panelType}`);
    } catch (error) {
      console.error(`[LayoutService] Failed to add/focus sidebar panel ${panelType}:`, error);
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
      const rawLayout = this.layoutRef.saveLayout() as LayoutConfig;
      const normalized = this.normalizeLayoutConfig(rawLayout);
      if (!normalized) {
        console.warn('[LayoutService] Layout capture produced incompatible config; returning default shell');
        return cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG);
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
      console.warn('[LayoutService] Saved layout incompatible with current schema; restoring default shell');
      return this.resetToDefaultLayout();
    }

    return this.loadLayoutAndRehydrate(normalized);
  }

  resetToDefaultLayout(): boolean {
    return this.loadLayoutAndRehydrate(cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG));
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
