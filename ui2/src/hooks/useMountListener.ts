/**
 * Hook to listen for mount directory events from Tauri
 */

import { useEffect } from 'react';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { getFileLoadingService } from '@/services/FileLoadingService';
import type { MountSource } from '@/types/filesystem';

interface MountEvent {
  path: string;
  displayName?: string;
  mountSource?: MountSource;
}

interface OpenFileEvent {
  path: string;
}

export function useMountListener() {
  useEffect(() => {
    console.log('Setting up mount listener...');
    
    let mountUnlisten: (() => void) | null = null;
    let openFileUnlisten: (() => void) | null = null;
    
    // Listen for mount-directory-event and open-file-event from Tauri
    const setupListeners = async () => {
      try {
        mountUnlisten = await safeListen<MountEvent>('mount-directory-event', async (event) => {
          console.log('Mount event received:', event.payload);
          
          // Get the store instance
          const storeInstance = useFileBrowserStore;
          console.log('Store instance check:', {
            storeInstance,
            isWindowStore: window.__fileBrowserStore === storeInstance,
            windowStore: window.__fileBrowserStore
          });
          
          // Mount the directory in the file browser
          const fileBrowserStore = useFileBrowserStore.getState();
          console.log('Store state before mount:', {
            entriesLength: fileBrowserStore.entries.length,
            entries: fileBrowserStore.entries.map(e => ({ path: e.path, name: e.name }))
          });
          
          const hasMountMetadata =
            typeof event.payload.displayName === 'string' ||
            typeof event.payload.mountSource === 'object';

          if (hasMountMetadata) {
            await fileBrowserStore.mountDirectory(event.payload.path, {
              displayName: event.payload.displayName,
              mountSource: event.payload.mountSource,
            });
          } else {
            await fileBrowserStore.mountDirectory(event.payload.path);
          }
          
          // Debug: Check the state after loading - get fresh state
          const freshState = useFileBrowserStore.getState();
          console.log('Directory loaded, current state:', {
            entries: freshState.entries,
            entriesLength: freshState.entries.length,
            rootPath: freshState.rootPath,
            currentPath: freshState.currentPath,
            loading: freshState.loading,
            error: freshState.error
          });
        });

        openFileUnlisten = await safeListen<OpenFileEvent>('open-file-event', async (event) => {
          const path = event.payload.path;
          console.log('Open file event received:', path);
          if (!path || !path.trim()) {
            return;
          }
          await getFileLoadingService().loadFile(path, 'file-dialog');
        });
      } catch (error) {
        console.error('Failed to setup filesystem listeners:', error);
      }
    };
    
    setupListeners();

    // Cleanup listener on unmount
    return () => {
      void (async () => {
        try {
          if (mountUnlisten) {
            await safeUnlisten(mountUnlisten);
          }
          if (openFileUnlisten) {
            await safeUnlisten(openFileUnlisten);
          }
        } catch (error) {
          console.error('Failed to teardown filesystem listeners:', error);
        }
      })();
    };
  }, []);
}
