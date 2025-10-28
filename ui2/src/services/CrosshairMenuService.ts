/**
 * Service to handle crosshair-related menu events from Tauri
 * Uses viewStateStore to toggle crosshair visibility
 */

import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import { useViewStateStore } from '@/stores/viewStateStore';

export class CrosshairMenuService {
  private static instance: CrosshairMenuService | null = null;
  private unlistenFn: (() => void) | null = null;

  private constructor() {
    this.init();
  }

  static getInstance(): CrosshairMenuService {
    if (!CrosshairMenuService.instance) {
      CrosshairMenuService.instance = new CrosshairMenuService();
    }
    return CrosshairMenuService.instance;
  }

  private async init() {
    // Listen for crosshair menu events from Tauri
    this.unlistenFn = await safeListen('crosshair-action', (event) => {
      console.log('[CrosshairMenuService] Received event:', event.payload);
      
      const payload = event.payload as { action: string };
      
      switch (payload.action) {
        case 'toggle':
          this.toggleCrosshair();
          break;
        case 'open-settings':
          this.openSettings();
          break;
        default:
          console.warn(`[CrosshairMenuService] Unknown action: ${payload.action}`);
      }
    });
    
    console.log('[CrosshairMenuService] Initialized and listening for menu events');
  }

  private toggleCrosshair() {
    // Get the current crosshair visibility from viewStateStore
    const viewState = useViewStateStore.getState();
    const currentVisible = viewState.viewState.crosshair.visible;
    viewState.setCrosshairVisible(!currentVisible);
    console.log(`[CrosshairMenuService] Toggled crosshair visibility to: ${!currentVisible}`);
  }

  private openSettings() {
    console.log('[CrosshairMenuService] Opening crosshair settings dialog');
    
    // Emit event to open the settings dialog
    // The App component will listen for this and render the dialog
    window.dispatchEvent(new CustomEvent('open-crosshair-settings'));
  }

  destroy() {
    if (this.unlistenFn) {
      void safeUnlisten(this.unlistenFn);
      this.unlistenFn = null;
    }
  }
}

// Initialize the service when the module is imported
let serviceInstance: CrosshairMenuService | null = null;

export function initializeCrosshairMenuService() {
  if (!serviceInstance) {
    serviceInstance = CrosshairMenuService.getInstance();
  }
  return serviceInstance;
}

export function destroyCrosshairMenuService() {
  if (serviceInstance) {
    serviceInstance.destroy();
    serviceInstance = null;
    CrosshairMenuService.instance = null;
  }
}
