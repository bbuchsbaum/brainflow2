/**
 * Hook to listen for panel menu events from Tauri
 */

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

interface PanelActionEvent {
  action: 'show-panel';
  payload: {
    type: string; // Panel component name
  };
}

export function usePanelMenuListener() {
  useEffect(() => {
    console.log('[usePanelMenuListener] Setting up panel menu listener...');
    
    // Check if Tauri is available
    if (typeof window === 'undefined' || !(window as any).__TAURI__) {
      console.warn('[usePanelMenuListener] Tauri API not available, skipping listener');
      return;
    }
    
    let unlisten: (() => void) | null = null;
    
    // Listen for panel-action events from Tauri
    const setupListener = async () => {
      try {
        unlisten = await listen<PanelActionEvent>('panel-action', async (event) => {
          console.log('[usePanelMenuListener] Panel action received:', event.payload);
          
          switch (event.payload.action) {
            case 'show-panel':
              if (event.payload.payload.type) {
                console.log(`[usePanelMenuListener] Showing panel: ${event.payload.payload.type}`);
                
                // Emit a custom DOM event that GoldenLayoutRoot can listen for
                const panelEvent = new CustomEvent('golden-layout-add-panel', {
                  detail: {
                    panelType: event.payload.payload.type
                  }
                });
                window.dispatchEvent(panelEvent);
                
                console.log(`[usePanelMenuListener] Panel event dispatched for ${event.payload.payload.type}`);
              }
              break;
              
            default:
              console.warn('[usePanelMenuListener] Unknown panel action:', event.payload.action);
          }
        });
        
        console.log('[usePanelMenuListener] Panel listener setup complete');
      } catch (error) {
        console.error('[usePanelMenuListener] Failed to setup panel listener:', error);
      }
    };
    
    setupListener();

    // Cleanup listener on unmount
    return () => {
      if (unlisten) {
        try {
          unlisten();
          console.log('[usePanelMenuListener] Panel listener cleaned up');
        } catch (error) {
          console.warn('[usePanelMenuListener] Error during panel listener cleanup:', error);
        }
      }
    };
  }, []);
}