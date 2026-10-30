/**
 * Service to handle crosshair-related menu events from Tauri
 * Uses viewStateStore to toggle crosshair visibility
 */

import { safeEmit, safeListen, safeUnlisten } from '@/utils/eventUtils';
import { useViewStateStore } from '@/stores/viewStateStore';

export class CrosshairMenuService {
  static instance: CrosshairMenuService | null = null;
  private unlistenFn: (() => void) | null = null;
  private unsubscribeVisibility: (() => void) | null = null;
  private destroyed = false;

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
    this.syncMenuCheck();

    // Listen for crosshair menu events from Tauri
    const unlisten = await safeListen('crosshair-action', (event) => {
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
    // Destroyed while the listener was being registered (StrictMode's
    // mount/unmount/mount): drop it, or the remount adds a second listener
    // and every menu toggle flips the crosshair twice (a no-op).
    if (this.destroyed) {
      void safeUnlisten(unlisten);
      return;
    }
    this.unlistenFn = unlisten;
    
    console.log('[CrosshairMenuService] Initialized and listening for menu events');
  }

  private toggleCrosshair() {
    // Get the current crosshair visibility from viewStateStore
    const viewState = useViewStateStore.getState();
    const currentVisible = viewState.viewState.crosshair.visible;
    viewState.setCrosshairVisible(!currentVisible);
    console.log(`[CrosshairMenuService] Toggled crosshair visibility to: ${!currentVisible}`);
  }

  /**
   * Report crosshair visibility to the native View › Show Crosshair check item
   * (src-tauri main.rs) now and on every change, whatever changed it.
   */
  private syncMenuCheck() {
    let last = useViewStateStore.getState().viewState.crosshair.visible;
    void safeEmit('crosshair-visibility-changed', { visible: last });
    this.unsubscribeVisibility = useViewStateStore.subscribe((state) => {
      const visible = state.viewState.crosshair.visible;
      if (visible === last) return;
      last = visible;
      void safeEmit('crosshair-visibility-changed', { visible });
    });
  }

  private openSettings() {
    console.log('[CrosshairMenuService] Opening crosshair settings dialog');
    
    // Emit event to open the settings dialog
    // The App component will listen for this and render the dialog
    window.dispatchEvent(new CustomEvent('open-crosshair-settings'));
  }

  destroy() {
    this.destroyed = true;
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
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
