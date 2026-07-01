/**
 * useSurfaceTemplateMenuListener - listens for surface template menu actions from Tauri
 * and loads the selected surface template (e.g., fsaverage white matter).
 */

import { useEffect } from 'react';
import { safeListen } from '@/utils/eventUtils';
import {
  getSurfaceLoadingService,
  type SurfaceTemplateLoadOptions,
} from '@/services/SurfaceLoadingService';
import { getEventBus } from '@/events/EventBus';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { resolveActiveDisplayMode } from '@/components/ui/displayModeSelector.helpers';
import type { WorkspaceType } from '@/types/workspace';

interface SurfaceTemplateMenuPayload {
  space: string; // 'fsaverage', 'fsaverage5', 'fsaverage6'
  geometry_type: string; // 'white', 'pial', 'inflated', 'sphere'
  hemisphere: string; // 'left', 'right', 'both'
}

interface SurfaceTemplateMenuEvent {
  action: 'load-surface-template';
  payload: SurfaceTemplateMenuPayload;
}

let surfaceTemplateListenerInitialized = false;

export function resolveSurfaceTemplateMenuPlacementOptions(
  activeWorkspaceType: WorkspaceType | null | undefined,
): SurfaceTemplateLoadOptions | undefined {
  if (resolveActiveDisplayMode(activeWorkspaceType) !== 'integrated') {
    return undefined;
  }

  return {
    openViewer: false,
    focusSurfacePanel: false,
  };
}

function getSurfaceTemplateMenuPlacementOptions(): SurfaceTemplateLoadOptions | undefined {
  const activeWorkspaceType = useWorkspaceStore.getState().getActiveWorkspace()?.type;
  return resolveSurfaceTemplateMenuPlacementOptions(activeWorkspaceType);
}

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
        await safeListen<SurfaceTemplateMenuEvent>(
          'surface-template-menu-action',
          async (event) => {
            console.log(
              '[useSurfaceTemplateMenuListener] Surface template menu action received:',
              event.payload,
            );

            if (event.payload.action !== 'load-surface-template') {
              console.warn(
                '[useSurfaceTemplateMenuListener] Unknown action:',
                event.payload.action,
              );
              return;
            }

            const payload = event.payload.payload;
            if (!payload?.space || !payload?.geometry_type || !payload?.hemisphere) {
              console.warn(
                '[useSurfaceTemplateMenuListener] Missing required fields in payload:',
                payload,
              );
              return;
            }

            const eventBus = getEventBus();

            try {
              const surfaceLoadingService = getSurfaceLoadingService();
              const placementOptions = getSurfaceTemplateMenuPlacementOptions();

              // Bilateral (default geometry click): load both hemispheres into
              // one scene. Integrated mode consumes the shared surface store in
              // place, while standalone surface views still reuse one scene tab.
              if (payload.hemisphere === 'both') {
                const displayName = `${payload.space} ${payload.geometry_type} (both hemispheres)`;
                eventBus.emit('ui.notification', {
                  type: 'info',
                  message: `Loading surface template: ${displayName}...`,
                });

                const { left, right } = await surfaceLoadingService.loadSurfaceTemplateBilateral({
                  space: payload.space,
                  geometry_type: payload.geometry_type,
                }, placementOptions);
                const loaded = [left, right].filter(Boolean).length;

                if (loaded === 2) {
                  eventBus.emit('ui.notification', {
                    type: 'success',
                    message: `Loaded surface template: ${displayName}`,
                  });
                } else if (loaded === 1) {
                  eventBus.emit('ui.notification', {
                    type: 'warning',
                    message: `Loaded one hemisphere of ${displayName}; the other failed.`,
                  });
                } else {
                  eventBus.emit('ui.notification', {
                    type: 'error',
                    message: `Failed to load surface template: ${displayName}`,
                  });
                }
                return;
              }

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
              const handle = await surfaceLoadingService.loadSurfaceTemplate(
                request,
                placementOptions,
              );

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
              console.error(
                '[useSurfaceTemplateMenuListener] Failed to load surface template:',
                error,
              );
              eventBus.emit('ui.notification', {
                type: 'error',
                message:
                  error instanceof Error
                    ? `Failed to load surface template: ${error.message}`
                    : 'Failed to load surface template.',
              });
            }
          },
        );

        console.log(
          '[useSurfaceTemplateMenuListener] Surface template menu listener setup complete',
        );
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
