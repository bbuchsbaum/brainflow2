/**
 * Layout Service - Manages GoldenLayout component addition and manipulation
 */

import type { ComponentItem, ItemConfig } from 'golden-layout';

export interface LayoutService {
  addComponent(config: ItemConfig): void;
  setLayoutRef(layout: any): void;
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