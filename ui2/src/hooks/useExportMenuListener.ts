/**
 * Hook to listen for export menu events from Tauri.
 */

import { useEffect } from 'react';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import { useExportDialogStore } from '@/stores/exportDialogStore';

interface ExportMenuEvent {
  action: 'export-image';
}

export function useExportMenuListener() {
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      try {
        unlisten = await safeListen<ExportMenuEvent>('export-active-view', async () => {
          useExportDialogStore.getState().open();
        });
      } catch (error) {
        console.error('[useExportMenuListener] Failed to setup export listener:', error);
      }
    };

    setupListener();

    return () => {
      if (unlisten) void safeUnlisten(unlisten);
    };
  }, []);
}
