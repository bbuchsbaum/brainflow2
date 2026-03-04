/**
 * useSurfaceTemplateMenuListener - listens for surface template menu actions from Tauri
 * and loads the selected surface template (e.g., fsaverage white matter) into a new
 * SurfaceViewPanel.
 */

import { useEffect } from 'react';
import { safeListen } from '@/utils/eventUtils';
import { getSurfaceLoadingService } from '@/services/SurfaceLoadingService';
import { getEventBus } from '@/events/EventBus';

interface SurfaceTemplateMenuPayload {
  space: string;        // 'fsaverage', 'fsaverage5', 'fsaverage6'
  geometry_type: string; // 'white', 'pial', 'inflated', 'sphere'
  hemisphere: string;   // 'left', 'right'
}

interface SurfaceTemplateMenuEvent {
  action: 'load-surface-template';
  payload: SurfaceTemplateMenuPayload;
}

let surfaceTemplateListenerInitialized = false;
let surfaceTemplateUnlisten: (() => void) | null = null;

export function useSurfaceTemplateMenuListener() {
  useEffect(() => {
    if (surfaceTemplateListenerInitialized) {
      console.log('[useSurfaceTemplateMenuListener] Listener already initialized, skipping');
      return;
    }

    console.log('[useSurfaceTemplateMenuListener] Setting up surface template menu listener...');

    surfaceTemplateListenerInitialized = true;

    const setupListener = async () => {
      try {
        surfaceTemplateUnlisten = await safeListen<SurfaceTemplateMenuEvent>(
          'surface-template-menu-action',
          async (event) => {
            console.log('[useSurfaceTemplateMenuListener] Surface template menu action received:', event.payload);

            if (event.payload.action !== 'load-surface-template') {
              console.warn('[useSurfaceTemplateMenuListener] Unknown action:', event.payload.action);
              return;
            }

            const payload = event.payload.payload;
            if (!payload?.space || !payload?.geometry_type || !payload?.hemisphere) {
              console.warn('[useSurfaceTemplateMenuListener] Missing required fields in payload:', payload);
              return;
            }

            const eventBus = getEventBus();

            try {
              const surfaceLoadingService = getSurfaceLoadingService();

              // Construct the template request
              const request = {
                space: payload.space,
                geometry_type: payload.geometry_type,
                hemisphere: payload.hemisphere,
              };

              // Generate display name for notifications
              const displayName = `${payload.space} ${payload.geometry_type} (${payload.hemisphere})`;

              // Notify user that loading is starting
              eventBus.emit('ui.notification', {
                type: 'info',
                message: `Loading surface template: ${displayName}...`,
              });

              // Load the surface template
              const handle = await surfaceLoadingService.loadSurfaceTemplate(request);

              if (handle) {
                eventBus.emit('ui.notification', {
                  type: 'success',
                  message: `Loaded surface template: ${displayName}`,
                });
              } else {
                eventBus.emit('ui.notification', {
                  type: 'error',
                  message: `Failed to load surface template: ${displayName}`,
                });
              }
            } catch (error) {
              console.error('[useSurfaceTemplateMenuListener] Failed to load surface template:', error);
              eventBus.emit('ui.notification', {
                type: 'error',
                message:
                  error instanceof Error
                    ? `Failed to load surface template: ${error.message}`
                    : 'Failed to load surface template.',
              });
            }
          }
        );

        console.log('[useSurfaceTemplateMenuListener] Surface template menu listener setup complete');
      } catch (error) {
        console.error('[useSurfaceTemplateMenuListener] Failed to setup listener:', error);
      }
    };

    setupListener();

    return () => {
      // Do not tear down the singleton listener here; it is shared
      // across StrictMode mounts. Individual component unmounts should
      // not remove the global surface-template-menu-action listener.
    };
  }, []);
}
