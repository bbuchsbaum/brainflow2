/**
 * Layout Service - Manages GoldenLayout component addition and manipulation
 */

import type { ComponentItem, ItemConfig } from 'golden-layout';

export interface LayoutService {
  addComponent(config: ItemConfig): void;
  setLayoutRef(layout: any): void;
  focusSurfacePanel(): void;
}

class LayoutServiceImpl implements LayoutService {
  private layoutRef: any = null;

  setLayoutRef(layout: any): void {
    this.layoutRef = layout;
    console.log('[LayoutService] Layout reference set');
  }

  addComponent(config: ItemConfig): void {
    if (!this.layoutRef) {
      console.error('[LayoutService] Layout not initialized');
      return;
    }

    try {
      // Find the center stack in the layout
      const root = this.layoutRef.rootItem;
      if (!root || root.type !== 'row') {
        console.error('[LayoutService] Root is not a row');
        return;
      }

      // The center stack should be the second item (index 1) in the row
      const centerStack = root.contentItems[1];
      if (!centerStack || centerStack.type !== 'stack') {
        console.error('[LayoutService] Center stack not found');
        return;
      }

      // Create the new item and add it to the center stack
      const newItem = this.layoutRef.newItem(config);
      centerStack.addChild(newItem);
      
      console.log('[LayoutService] Component added:', config);
    } catch (error) {
      console.error('[LayoutService] Failed to add component:', error);
    }
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