/**
 * Layout Service - Manages GoldenLayout component addition and manipulation
 */

import {
  type ComponentItem,
  type ComponentItemConfig,
  type ContentItem,
  GoldenLayout,
  type LayoutConfig,
  type RowOrColumnItemConfig,
  Stack,
} from 'golden-layout';
import { nanoid } from 'nanoid';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { cloneLayoutConfig } from '@/utils/layoutConfigUtils';

type LayoutComponentState = Record<string, unknown>;

const isStateRecord = (value: unknown): value is LayoutComponentState =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getComponentState = (item: ComponentItem): LayoutComponentState => {
  const rawState = item.container.initialState;
  return isStateRecord(rawState) ? rawState : {};
};

const isComponentItem = (item: ContentItem): item is ComponentItem => item.type === 'component';

const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
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
        type: 'stack',
        width: 59.75,
        content: [],
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
              {
                type: 'component',
                componentType: 'StudioInspectorPanel',
                title: 'Details',
                componentState: {},
              },
              {
                type: 'component',
                componentType: 'SetPanel',
                title: 'Set',
                componentState: {},
              },
            ],
          },
        ],
      },
    ],
  },
};

export type SidebarPanelType =
  | 'FileBrowser'
  | 'StudioDesignPanel'
  | 'LayerPanel'
  | 'AtlasPanel'
  | 'SurfacePanel'
  | 'StudioInspectorPanel'
  | 'SetPanel';

export interface LayoutService {
  addComponent(config: ComponentItemConfig): void;
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

  private getStackForPanelType(panelType: SidebarPanelType): Stack | null {
    switch (panelType) {
      case 'FileBrowser':
      case 'StudioDesignPanel':
        return this.getLeftSidebarStack();
      default:
        return this.getSidebarStack();
    }
  }

  private getPanelTitle(panelType: SidebarPanelType): string {
    switch (panelType) {
      case 'LayerPanel':
        return 'Volumes';
      case 'FileBrowser':
        return 'Files';
      case 'StudioDesignPanel':
        return 'Subjects';
      case 'AtlasPanel':
        return 'Atlases';
      case 'SurfacePanel':
        return 'Surfaces';
      case 'StudioInspectorPanel':
        return 'Details';
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
      this.layoutRef.loadLayout(config);
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

  ensureSurfaceView(surfaceHandle: string, path?: string): void {
    const centerStack = this.getCenterStack();
    if (!centerStack) {
      console.warn('[LayoutService] Cannot ensure surface view - center stack unavailable');
      return;
    }

    const existing = centerStack.contentItems.find((item) => {
      if (!isComponentItem(item) || item.componentType !== 'surfaceView') {
        return false;
      }
      const state = getComponentState(item);
      return state.surfaceHandle === surfaceHandle;
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
    const sidebarStack = this.getStackForPanelType(panelType);
    if (!sidebarStack || !this.layoutRef) {
      console.warn(`[LayoutService] Cannot focus ${panelType} - sidebar stack unavailable`);
      return;
    }

    const existingPanel = sidebarStack.contentItems.find(
      (item) => isComponentItem(item) && item.componentType === panelType
    );

    if (existingPanel && isComponentItem(existingPanel)) {
      try {
        sidebarStack.setActiveComponentItem(existingPanel, true);
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
      sidebarStack.addChild(newItem, undefined, true);
      if (newItem.type === 'component') {
        sidebarStack.setActiveComponentItem(newItem as ComponentItem, true);
      }
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
      const rawLayout = this.layoutRef.saveLayout() as unknown as LayoutConfig;
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
