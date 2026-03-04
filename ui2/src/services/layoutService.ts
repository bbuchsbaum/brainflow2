/**
 * Layout Service - Manages GoldenLayout component addition and manipulation
 */

import type { ItemConfig } from 'golden-layout';

export interface LayoutService {
  addComponent(config: ItemConfig): void;
  setLayoutRef(layout: any): void;
  focusSurfacePanel(): void;
  ensureSurfaceView(surfaceHandle: string, path?: string): void;
  closeSurfaceViewTabs(surfaceHandle: string): void;
}

class LayoutServiceImpl implements LayoutService {
  private layoutRef: any = null;

  private getCenterStack(): any | null {
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

  setLayoutRef(layout: any): void {
    this.layoutRef = layout;
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
        } catch (innerError) {
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

    const existing = (centerStack.contentItems || []).find((item: any) => {
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
    } as any);
  }

  closeSurfaceViewTabs(surfaceHandle: string): void {
    const centerStack = this.getCenterStack();
    if (!centerStack) {
      console.warn('[LayoutService] Cannot close surface tabs - center stack unavailable');
      return;
    }

    const matchingItems = (centerStack.contentItems || []).filter((item: any) => {
      if (item.componentType !== 'surfaceView') {
        return false;
      }
      const state = item.componentState || {};
      return state.surfaceHandle === surfaceHandle;
    });

    matchingItems.forEach((item: any) => {
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

  focusSurfacePanel(): void {
    if (!this.layoutRef) {
      console.warn('[LayoutService] Cannot focus Surfaces panel - layout not initialized');
      return;
    }

    try {
      const root = this.layoutRef.rootItem;
      if (!root || root.type !== 'row') {
        console.warn('[LayoutService] Cannot focus Surfaces panel - root is not a row');
        return;
      }

      // Right column is the third item (index 2) in the root row
      const rightColumn = root.contentItems[2];
      if (!rightColumn || rightColumn.type !== 'column') {
        console.warn('[LayoutService] Cannot focus Surfaces panel - right column not found');
        return;
      }

      // The tabbed stack is the first item in the right column
      const tabbedStack = rightColumn.contentItems[0];
      if (!tabbedStack || tabbedStack.type !== 'stack') {
        console.warn('[LayoutService] Cannot focus Surfaces panel - tabbed stack not found');
        return;
      }

      // Find the SurfacePanel component in the stack
      const surfacePanel = tabbedStack.contentItems.find(
        (item: any) => item.componentType === 'SurfacePanel'
      );

      if (surfacePanel) {
        // Use setActiveComponentItem to focus the Surfaces tab
        try {
          tabbedStack.setActiveComponentItem(surfacePanel);
          console.log('[LayoutService] Focused Surfaces tab');
        } catch (error) {
          console.warn('[LayoutService] Could not focus Surfaces tab:', error);
        }
      } else {
        console.warn('[LayoutService] SurfacePanel not found in tabbed stack');
      }
    } catch (error) {
      console.error('[LayoutService] Failed to focus Surfaces panel:', error);
    }
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
