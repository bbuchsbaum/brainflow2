/**
 * Hook to listen for mount directory events from Tauri
 */

import { useEffect } from 'react';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';

interface MountEvent {
  path: string;
}

export function useMountListener() {
  useEffect(() => {
    console.log('Setting up mount listener...');
    
    let unlisten: (() => void) | null = null;
    
    // Listen for mount-directory-event from Tauri
    const setupListener = async () => {
      try {
        unlisten = await safeListen<MountEvent>('mount-directory-event', async (event) => {
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
      
      await fileBrowserStore.mountDirectory(event.payload.path);
      
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
      } catch (error) {
        console.error('Failed to setup mount listener:', error);
      }
    };
    
    setupListener();

    // Cleanup listener on unmount
    return () => {
      if (unlisten) void safeUnlisten(unlisten);
    };
  }, []);
}
