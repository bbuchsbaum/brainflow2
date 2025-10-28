/**
 * WorkspaceManager Component
 * Manages workspace-level tabs and renders the active workspace
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import { GoldenLayoutWrapper } from './GoldenLayoutWrapper';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import { initializeViewRegistry } from '@/services/ViewRegistry';
import debounce from 'lodash/debounce';
import type { MenuActionEvent, Workspace } from '@/types/workspace';

export function WorkspaceManager() {
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspace = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;
  const mountedRef = useRef(false);
  
  // Global render logging
  if (typeof window !== 'undefined' && (window as any).__logRender) {
    (window as any).__logRender('WorkspaceManager');
  }
  
  // Render loop detection and bailout
  const renderCount = useRef(0);
  renderCount.current++;
  if (renderCount.current > 50) {
    console.error('[WorkspaceManager] RENDER LOOP DETECTED! Render count:', renderCount.current);
    console.trace('Stack trace:');
    // Bail out to prevent browser crash
    if (renderCount.current > 100) {
      return (
        <div className="h-full flex items-center justify-center text-red-500">
          <div className="text-center">
            <p className="mb-4">Render loop detected in WorkspaceManager</p>
            <p>Please refresh the page</p>
          </div>
        </div>
      );
    }
  }
  
  // Initialize view registry and create default workspace if none exists
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      
      // Initialize the view registry
      initializeViewRegistry();
      
      // Get fresh state to check if we need to create initial workspace
      const state = useWorkspaceStore.getState();
      if (state.workspaces.size === 0) {
        console.log('[WorkspaceManager] Creating initial workspace');
        // Use the function from state directly to avoid dependency issues
        state.createWorkspace('orthogonal-flexible').catch(error => {
          console.error('[WorkspaceManager] Failed to create initial workspace:', error);
        });
      }
    }
  }, []); // Empty dependency array - only run once on mount
  
  // Listen for menu actions from Tauri
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    
    const setupListener = async () => {
      try {
        unlisten = await safeListen<MenuActionEvent>('menu-action', (event) => {
          console.log('[WorkspaceManager] Menu action received:', event.payload);
          
          const store = useWorkspaceStore.getState();
          
          switch (event.payload.action) {
            case 'new-workspace':
              if (event.payload.payload.type) {
                store.createWorkspace(
                  event.payload.payload.type, 
                  event.payload.payload.config
                ).catch(error => {
                  console.error('[WorkspaceManager] Failed to create workspace:', error);
                });
              }
              break;
              
            case 'close-workspace':
              if (store.activeWorkspaceId) {
                store.closeWorkspace(store.activeWorkspaceId);
              }
              break;
              
            case 'recover-panel':
              if (store.activeWorkspaceId && event.payload.payload.panelId) {
                store.recoverPanel(store.activeWorkspaceId, event.payload.payload.panelId);
              }
              break;
              
            case 'switch-workspace':
              if (event.payload.payload.workspaceId) {
                store.activateWorkspace(event.payload.payload.workspaceId);
              }
              break;
          }
        });
      } catch (error) {
        console.error('[WorkspaceManager] Failed to setup menu listener:', error);
      }
    };
    
    setupListener();
    
    return () => { if (unlisten) void safeUnlisten(unlisten); };
  }, []); // Empty dependency array - listeners should be stable
  
  // Update menu state when workspace changes
  // Only depend on activeWorkspaceId to avoid object reference issues
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).__TAURI__ || !activeWorkspaceId) {
      return;
    }
    
    console.log('[WorkspaceManager] Menu state update effect triggered for workspace:', activeWorkspaceId);
    
    const updateMenuState = async () => {
      try {
        const { safeEmit } = await import('@/utils/eventUtils');
        const store = useWorkspaceStore.getState();
        const allWorkspaces = Array.from(store.workspaces.values());
        const currentWorkspace = store.workspaces.get(activeWorkspaceId);
        
        await safeEmit('update-menu-state', {
          activeWorkspaceId: activeWorkspaceId,
          activeWorkspaceType: currentWorkspace?.type || null,
          workspaces: allWorkspaces.map(w => ({
            id: w.id,
            title: w.title,
            type: w.type
          })),
          recoverablePanels: currentWorkspace 
            ? store.getRecoverablePanels(currentWorkspace.id).map(p => ({
                id: p.id,
                title: p.id.charAt(0).toUpperCase() + p.id.slice(1)
              }))
            : []
        });
      } catch (error) {
        console.error('[WorkspaceManager] Failed to update menu state:', error);
      }
    };
    
    updateMenuState();
  }, [activeWorkspaceId]); // Only depend on ID, not the whole object
  
  return (
    <div className="h-full flex flex-col bg-gray-950">
      {/* Workspace tabs */}
      <WorkspaceTabBar />
      
      {/* Active workspace content */}
      <div className="flex-1 min-h-0">
        {activeWorkspace ? (
          <WorkspaceContainer 
            key={activeWorkspace.id} 
            workspace={activeWorkspace} 
          />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              <p className="mb-4">No active workspace</p>
              <button
                onClick={async () => {
                  try {
                    const store = useWorkspaceStore.getState();
                    await store.createWorkspace('orthogonal-flexible');
                  } catch (error) {
                    console.error('[WorkspaceManager] Failed to create workspace:', error);
                  }
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                Create New View
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Container for a single workspace
 * Manages the Golden Layout instance for this workspace
 */
interface WorkspaceContainerProps {
  workspace: Workspace;
}

const WorkspaceContainer = React.memo(function WorkspaceContainer({ workspace }: WorkspaceContainerProps) {
  const updateWorkspaceLayout = useWorkspaceStore(state => state.updateWorkspaceLayout);
  const updatePanelState = useWorkspaceStore(state => state.updatePanelState);
  
  // Render loop detection and bailout
  const renderCount = useRef(0);
  renderCount.current++;
  if (renderCount.current > 50) {
    console.error(`[WorkspaceContainer ${workspace.id}] RENDER LOOP DETECTED! Render count:`, renderCount.current);
    console.trace('Stack trace:');
    // Bail out to prevent browser crash
    if (renderCount.current > 100) {
      return (
        <div className="h-full flex items-center justify-center text-red-500">
          <p>Render loop in WorkspaceContainer</p>
        </div>
      );
    }
  }
  
  // Debounced layout change handler to prevent infinite loops
  // Only saves layout after user stops dragging for 300ms
  const handleLayoutChange = useRef(
    debounce((newConfig) => {
      // Get fresh state to compare
      const currentWorkspace = useWorkspaceStore.getState().workspaces.get(workspace.id);
      const currentConfig = currentWorkspace?.layoutConfig;
      
      // Deep comparison - only update if actually changed
      if (JSON.stringify(currentConfig) !== JSON.stringify(newConfig)) {
        console.log('[WorkspaceContainer] Layout changed, saving to store');
        updateWorkspaceLayout(workspace.id, newConfig);
      } else {
        console.log('[WorkspaceContainer] Layout unchanged, skipping update');
      }
    }, 300, { leading: false, trailing: true })
  ).current;
  
  const handlePanelClose = useCallback((panelId) => {
    updatePanelState(workspace.id, panelId, { isVisible: false });
  }, [workspace.id, updatePanelState]);
  
  const handlePanelOpen = useCallback((panelId) => {
    updatePanelState(workspace.id, panelId, { isVisible: true });
  }, [workspace.id, updatePanelState]);
  
  // Pass the workspace layout config to GoldenLayoutWrapper
  return (
    <div className="h-full">
      <GoldenLayoutWrapper 
        layoutConfig={workspace.layoutConfig}
        onLayoutChange={handleLayoutChange}
        onPanelClose={handlePanelClose}
        onPanelOpen={handlePanelOpen}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return prevProps.workspace.id === nextProps.workspace.id &&
         prevProps.workspace.layoutConfig === nextProps.workspace.layoutConfig;
});
