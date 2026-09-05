/**
 * Hook to listen for mount directory events from Tauri
 */

import { useEffect } from 'react';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { mountRemoteFromStartupSpec, type StartupRemoteMountSpec } from '@/services/RemoteMountService';
import { getEventBus } from '@/events/EventBus';
import { getTransport } from '@/services/transport';
import { formatTauriError } from '@/utils/formatTauriError';
import { areServicesInitialized } from './useServicesInit';
import type { MountSource } from '@/types/filesystem';
import type { DisplayOpenIntent } from '@/types/loadIntent';

interface MountEvent {
  path: string;
  displayName?: string;
  mountSource?: MountSource;
}

interface OpenFileEvent {
  path: string;
  intent?: DisplayOpenIntent;
}

interface RemoteMountEvent {
  spec: StartupRemoteMountSpec;
}

interface RemoteMountRecoveryEvent {
  mount_id: string;
  origin_label: string;
  attempt: number;
  reason: string;
}

function isTauriRuntime(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean((window as any).__TAURI__);
  } catch {
    return false;
  }
}

export function useMountListener() {
  useEffect(() => {
    console.log('Setting up mount listener...');
    
    let mountUnlisten: (() => void) | null = null;
    let openFileUnlisten: (() => void) | null = null;
    let remoteMountUnlisten: (() => void) | null = null;
    let remoteProgressUnlisten: (() => void) | null = null;
    let remoteRecoveryUnlisten: (() => void) | null = null;
    let unsubscribeServicesInitialized: (() => void) | null = null;
    let listenersReady = false;
    let servicesReady = areServicesInitialized();
    let startupActionsFlushed = false;
    let startupActionsFlushInFlight = false;
    let cancelled = false;

    const tryFlushStartupActions = async () => {
      if (
        cancelled ||
        startupActionsFlushed ||
        startupActionsFlushInFlight ||
        !listenersReady ||
        !servicesReady ||
        !isTauriRuntime()
      ) {
        return;
      }

      startupActionsFlushInFlight = true;
      try {
        await getTransport().invoke<number>('flush_startup_actions');
        startupActionsFlushed = true;
      } catch (error) {
        console.error('Failed to flush startup actions:', error);
      } finally {
        startupActionsFlushInFlight = false;
      }
    };
    
    // Listen for startup mount/open events from Tauri
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
          const intent = event.payload.intent ?? 'default';
          console.log('Open file event received:', path);
          if (!path || !path.trim()) {
            return;
          }
          await getFileLoadingService().loadFile(path, 'file-dialog', intent);
        });

        remoteMountUnlisten = await safeListen<RemoteMountEvent>(
          'mount-remote-event',
          async (event) => {
            try {
              await mountRemoteFromStartupSpec(event.payload.spec);
            } catch (error) {
              const message =
                formatTauriError(error) || 'Failed to mount remote folder from startup.';
              console.error('Remote startup mount failed:', error);
              getEventBus().emit('ui.notification', { type: 'error', message });
            }
          }
        );

        remoteRecoveryUnlisten = await safeListen<RemoteMountRecoveryEvent>(
          'remote-mount-recovery',
          async (event) => {
            const payload = event.payload;
            if (!payload) {
              return;
            }

            const attemptLabel = payload.attempt === 1 ? 'retry' : `retry ${payload.attempt}`;
            const shortReason = payload.reason.split('\n')[0]?.trim() || 'transient SFTP error';

            getEventBus().emit('ui.notification', {
              type: 'warning',
              message: `Remote mount recovered (${payload.origin_label}, ${attemptLabel}): ${shortReason}`,
            });
          }
        );

        remoteProgressUnlisten = await safeListen<{ path: string; bytes_downloaded: number; total_bytes?: number }>(
          'remote-file-progress', (event) => {
            const { path, bytes_downloaded, total_bytes } = event.payload;
            useLoadingQueueStore.getState().updateTransferProgress(path, bytes_downloaded, total_bytes);
          });
        if (cancelled) {
          await safeUnlisten(remoteProgressUnlisten);
          return;
        }
        listenersReady = true;
        servicesReady = areServicesInitialized();
        await tryFlushStartupActions();
      } catch (error) {
        console.error('Failed to setup filesystem listeners:', error);
      }
    };

    unsubscribeServicesInitialized = getEventBus().on('services.allInitialized', () => {
      servicesReady = true;
      void tryFlushStartupActions();
    });

    setupListeners();

    // Cleanup listener on unmount
    return () => {
      cancelled = true;
      void (async () => {
        try {
          if (unsubscribeServicesInitialized) {
            unsubscribeServicesInitialized();
          }
          if (mountUnlisten) {
            await safeUnlisten(mountUnlisten);
          }
          if (openFileUnlisten) {
            await safeUnlisten(openFileUnlisten);
          }
          if (remoteMountUnlisten) {
            await safeUnlisten(remoteMountUnlisten);
          }
          if (remoteProgressUnlisten) await safeUnlisten(remoteProgressUnlisten);
          if (remoteRecoveryUnlisten) {
            await safeUnlisten(remoteRecoveryUnlisten);
          }
        } catch (error) {
          console.error('Failed to teardown filesystem listeners:', error);
        }
      })();
    };
  }, []);
}
