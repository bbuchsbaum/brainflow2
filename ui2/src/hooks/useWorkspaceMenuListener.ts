/**
 * Hook to listen for workspace menu events from Tauri
 */

import { useEffect } from 'react';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { WorkspaceType } from '@/types/workspace';

interface WorkspaceActionEvent {
  action: 'new-workspace' | 'close-workspace' | 'switch-workspace';
  payload: {
    type?: WorkspaceType;
    workspaceId?: string;
  };
}

export function useWorkspaceMenuListener() {
  useEffect(() => {
    console.log('[useWorkspaceMenuListener] Setting up workspace menu listener...');
    
    let unlisten: (() => void) | null = null;
    
    // Listen for workspace-action events from Tauri
    const setupListener = async () => {
      try {
        unlisten = await safeListen<WorkspaceActionEvent>('workspace-action', async (event) => {
          console.log('[useWorkspaceMenuListener] Workspace action received:', event.payload);
          
          const workspaceStore = useWorkspaceStore.getState();
          
          switch (event.payload.action) {
            case 'new-workspace':
              if (event.payload.payload.type) {
                console.log(`[useWorkspaceMenuListener] Creating workspace: ${event.payload.payload.type}`);
                try {
                  const workspaceId = await workspaceStore.createWorkspace(event.payload.payload.type);
                  console.log(`[useWorkspaceMenuListener] Workspace created with ID: ${workspaceId}`);
                } catch (error) {
                  console.error('[useWorkspaceMenuListener] Failed to create workspace:', error);
                }
              }
              break;
              
            case 'switch-workspace':
              if (event.payload.payload.workspaceId) {
                console.log(`[useWorkspaceMenuListener] Switching to workspace: ${event.payload.payload.workspaceId}`);
                workspaceStore.activateWorkspace(event.payload.payload.workspaceId);
              }
              break;
              
            case 'close-workspace':
              if (event.payload.payload.workspaceId) {
                console.log(`[useWorkspaceMenuListener] Closing workspace: ${event.payload.payload.workspaceId}`);
                workspaceStore.closeWorkspace(event.payload.payload.workspaceId);
              }
              break;
              
            default:
              console.warn('[useWorkspaceMenuListener] Unknown action:', event.payload.action);
          }
        });
        
        console.log('[useWorkspaceMenuListener] Listener setup complete');
      } catch (error) {
        console.error('[useWorkspaceMenuListener] Failed to setup listener:', error);
      }
    };
    
    setupListener();

    // Cleanup listener on unmount
    return () => {
      if (unlisten) void safeUnlisten(unlisten);
    };
  }, []);
}
