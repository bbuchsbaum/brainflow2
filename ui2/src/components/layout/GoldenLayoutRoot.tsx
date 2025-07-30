/**
 * GoldenLayoutRoot Component
 * Single root GoldenLayout instance that manages all workspaces as tabs
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { GoldenLayout, LayoutConfig, ComponentContainer, Stack, ComponentItem } from 'golden-layout';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { listen } from '@tauri-apps/api/event';
import { debounce } from 'lodash';
import type { WorkspaceType } from '@/types/workspace';

// Import workspace components
import { OrthogonalViewContainer } from '@/components/views/OrthogonalViewContainer';
import { FlexibleOrthogonalView } from '@/components/views/FlexibleOrthogonalView';
import { MosaicViewPromise } from '@/components/views/MosaicViewPromise';
import { LightboxView } from '@/components/views/LightboxView';
import { ROIStatsWorkspace } from '@/components/analysis/ROIStatsWorkspace';
import { CoordinateConverterWorkspace } from '@/components/tools/CoordinateConverterWorkspace';

// Import side panel components
import { FileBrowserPanel } from '@/components/panels/FileBrowserPanel';
import { LayerPanel } from '@/components/panels/LayerPanel';

// Import GoldenLayout styles
import 'golden-layout/dist/css/goldenlayout-base.css';
import 'golden-layout/dist/css/themes/goldenlayout-dark-theme.css';

// Workspace component wrapper for GoldenLayout
interface WorkspaceComponentProps {
  workspaceId: string;
  workspaceType: WorkspaceType;
}

const WorkspaceComponent: React.FC<WorkspaceComponentProps> = ({ workspaceId, workspaceType }) => {
  const workspace = useWorkspaceStore(state => 
    state.workspaces.get(workspaceId)
  );

  if (!workspace) {
    return <div className="h-full flex items-center justify-center text-gray-500">Workspace not found</div>;
  }

  // Render appropriate component based on workspace type
  switch (workspaceType) {
    case 'orthogonal-locked':
      return <OrthogonalViewContainer />;
    case 'orthogonal-flexible':
      return <FlexibleOrthogonalView workspaceId={workspaceId} />;
    case 'mosaic':
      return <MosaicViewPromise />;
    case 'lightbox':
      return <LightboxView workspaceId={workspaceId} />;
    case 'roi-stats':
      return <ROIStatsWorkspace workspaceId={workspaceId} />;
    case 'coordinate-converter':
      return <CoordinateConverterWorkspace workspaceId={workspaceId} />;
    default:
      return <div className="h-full flex items-center justify-center text-gray-500">Unknown workspace type: {workspaceType}</div>;
  }
};

export function GoldenLayoutRoot() {
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<GoldenLayout | null>(null);
  const reactRootsRef = useRef<Map<string, ReactDOM.Root>>(new Map());
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const addedWorkspacesRef = useRef<Set<string>>(new Set());
  
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const store = useWorkspaceStore();

  // Helper to add a workspace tab
  const addWorkspaceTab = useCallback((workspaceId: string, workspaceType: WorkspaceType, title: string) => {
    if (!layoutRef.current) return;
    
    // Skip if already added
    if (addedWorkspacesRef.current.has(workspaceId)) {
      console.log(`[GoldenLayoutRoot] Workspace ${workspaceId} already added, skipping`);
      return;
    }

    try {
      // Find the center stack in the layout
      const root = layoutRef.current.rootItem;
      if (!root || root.type !== 'row') {
        console.error('[GoldenLayoutRoot] Root is not a row');
        return;
      }

      // The center stack should be the second item (index 1) in the row
      const centerStack = root.contentItems[1];
      if (!centerStack || centerStack.type !== 'stack') {
        console.error('[GoldenLayoutRoot] Center stack not found');
        return;
      }

      // Add the workspace to the center stack
      const stack = centerStack as Stack;
      const newItemConfig = {
        type: 'component' as const,
        componentType: 'Workspace',
        title,
        componentState: {
          workspaceId,
          workspaceType
        }
      };
      
      console.log('[GoldenLayoutRoot] Creating new item with config:', newItemConfig);
      const componentItem = layoutRef.current.newItem(newItemConfig);

      stack.addChild(componentItem);
      addedWorkspacesRef.current.add(workspaceId);
      console.log(`[GoldenLayoutRoot] Added workspace tab: ${workspaceId} (${title})`);
    } catch (error) {
      console.error('[GoldenLayoutRoot] Failed to add workspace tab:', error);
    }
  }, []);

  // Helper to remove a workspace tab
  const removeWorkspaceTab = useCallback((workspaceId: string) => {
    if (!layoutRef.current) return;

    const root = layoutRef.current.rootItem;
    if (!root || root.type !== 'stack') return;

    const stack = root as Stack;
    const item = stack.contentItems.find(item => {
      if (item.type === 'component') {
        const componentItem = item as ComponentItem;
        const state = componentItem.container.initialState || componentItem.container.componentState || {};
        return state.workspaceId === workspaceId;
      }
      return false;
    });

    if (item) {
      item.remove();
      addedWorkspacesRef.current.delete(workspaceId);
      console.log(`[GoldenLayoutRoot] Removed workspace tab: ${workspaceId}`);
    }
  }, []);

  // Initialize GoldenLayout
  useEffect(() => {
    if (!containerRef.current || layoutRef.current) return;

    console.log('[GoldenLayoutRoot] Initializing GoldenLayout');

    const goldenLayout = new GoldenLayout(containerRef.current);
    layoutRef.current = goldenLayout;

    // Register the unified workspace component
    goldenLayout.registerComponent('Workspace', (container: ComponentContainer, state: any) => {
      console.log('[GoldenLayoutRoot] Workspace component created, state:', state);
      
      // In GoldenLayout v2, state is passed as second parameter
      const { workspaceId, workspaceType } = state || {};
      
      if (!workspaceId || !workspaceType) {
        console.error('[GoldenLayoutRoot] Invalid workspace configuration:', state);
        container.element.innerHTML = '<div class="error">Invalid workspace configuration</div>';
        return;
      }

      // Create a div for React to render into
      const rootElement = document.createElement('div');
      rootElement.style.height = '100%';
      rootElement.style.width = '100%';
      container.element.appendChild(rootElement);

      // Create React root and render the workspace
      const root = ReactDOM.createRoot(rootElement);
      reactRootsRef.current.set(workspaceId, root);
      
      root.render(
        <React.StrictMode>
          <WorkspaceComponent 
            workspaceId={workspaceId} 
            workspaceType={workspaceType}
          />
        </React.StrictMode>
      );

      // Cleanup on destroy
      container.on('destroy', () => {
        const root = reactRootsRef.current.get(workspaceId);
        if (root) {
          // Mark for cleanup but don't unmount immediately
          // The main cleanup will handle this after GoldenLayout is done
          reactRootsRef.current.delete(workspaceId);
          
          // Unmount after current execution to avoid React warning
          setTimeout(() => {
            root.unmount();
          }, 0);
        }
      });
    });

    // Register side panel components
    const registerSidePanelComponent = (name: string, Component: React.FC<any>) => {
      goldenLayout.registerComponent(name, (container: ComponentContainer, state: any) => {
        const rootElement = document.createElement('div');
        rootElement.style.height = '100%';
        rootElement.style.width = '100%';
        container.element.appendChild(rootElement);

        const root = ReactDOM.createRoot(rootElement);
        root.render(
          <React.StrictMode>
            <Component {...(state || {})} />
          </React.StrictMode>
        );

        container.on('destroy', () => {
          // Defer unmount to avoid React warning
          setTimeout(() => {
            root.unmount();
          }, 0);
        });
      });
    };

    registerSidePanelComponent('FileBrowser', FileBrowserPanel);
    registerSidePanelComponent('LayerPanel', LayerPanel);

    // Listen for active tab changes
    goldenLayout.on('activeContentItemChanged', (item) => {
      if (item && item.type === 'component') {
        const componentItem = item as ComponentItem;
        // In v2, state might be accessed via initialComponentState
        const state = componentItem.container.initialState || componentItem.container.componentState || {};
        const workspaceId = state.workspaceId;
        if (workspaceId && workspaceId !== store.activeWorkspaceId) {
          console.log(`[GoldenLayoutRoot] Active workspace changed to: ${workspaceId}`);
          store.activateWorkspace(workspaceId);
        }
      }
    });

    // Initial layout configuration with side panels
    const config: LayoutConfig = {
      root: {
        type: 'row',
        content: [
          {
            type: 'column',
            width: 15,
            content: [{
              type: 'component',
              componentType: 'FileBrowser',
              title: 'Files',
              componentState: {}
            }]
          },
          {
            type: 'stack',  // Center stack for workspace tabs
            width: 65,
            content: []      // Workspaces will be added here
          },
          {
            type: 'column',
            width: 20,
            content: [{
              type: 'component',
              componentType: 'LayerPanel',
              title: 'Layers',
              componentState: {}
            }]
          }
        ]
      }
    };
    
    goldenLayout.loadLayout(config);
    
    // Mark layout as ready after a small delay
    setTimeout(() => {
      setIsLayoutReady(true);
    }, 50);

    return () => {
      // First destroy GoldenLayout which will trigger component destroy events
      if (layoutRef.current) {
        layoutRef.current.destroy();
        layoutRef.current = null;
      }
      
      // Then cleanup any remaining React roots after a microtask
      // This ensures GoldenLayout has finished its cleanup
      Promise.resolve().then(() => {
        reactRootsRef.current.forEach(root => root.unmount());
        reactRootsRef.current.clear();
      });
    };
  }, []); // Only run once on mount

  // Create default workspace after GoldenLayout is ready
  useEffect(() => {
    if (!isLayoutReady || !layoutRef.current) return;
    
    // Only run once when layout becomes ready
    const workspaceArray = Array.from(workspaces.values());
    if (workspaceArray.length === 0) {
      // Create a default FlexibleView workspace if none exist
      console.log('[GoldenLayoutRoot] No workspaces found, creating default FlexibleView');
      store.createWorkspace('orthogonal-flexible').catch(error => {
        console.error('[GoldenLayoutRoot] Failed to create initial workspace:', error);
      });
    }
    // Don't add existing workspaces here - the subscription will handle it
  }, [isLayoutReady, store]); // Only depend on layout ready and store

  // Listen for workspace changes from Zustand
  useEffect(() => {
    // Only start listening after layout is ready
    if (!isLayoutReady) return;
    
    const unsubscribe = useWorkspaceStore.subscribe((state, prevState) => {
      // Check for added workspaces
      state.workspaces.forEach((workspace, id) => {
        if (!prevState.workspaces.has(id)) {
          addWorkspaceTab(id, workspace.type, workspace.title);
        }
      });

      // Check for removed workspaces
      prevState.workspaces.forEach((_, id) => {
        if (!state.workspaces.has(id)) {
          removeWorkspaceTab(id);
        }
      });
    });

    return unsubscribe;
  }, [isLayoutReady, addWorkspaceTab, removeWorkspaceTab]);

  // Handle window resize
  useEffect(() => {
    if (!layoutRef.current) return;

    const handleResize = debounce(() => {
      if (layoutRef.current) {
        console.log('[GoldenLayoutRoot] Updating layout size after resize');
        layoutRef.current.updateSize();
      }
    }, 100);

    window.addEventListener('resize', handleResize);
    
    // Also listen for container resize using ResizeObserver
    const resizeObserver = new ResizeObserver(debounce((entries) => {
      if (layoutRef.current) {
        console.log('[GoldenLayoutRoot] Container resized, updating layout');
        layoutRef.current.updateSize();
      }
    }, 100));
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      handleResize.cancel();
      resizeObserver.disconnect();
    };
  }, [isLayoutReady]);

  // Listen for Tauri menu events
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      try {
        unlisten = await listen<{ action: string; payload: any }>('menu-action', async (event) => {
          console.log('[GoldenLayoutRoot] Menu action received:', event.payload);
          
          switch (event.payload.action) {
            case 'new-workspace':
              if (event.payload.payload?.type) {
                await store.createWorkspace(
                  event.payload.payload.type,
                  event.payload.payload.config
                );
              }
              break;
              
            case 'close-workspace':
              if (store.activeWorkspaceId) {
                store.closeWorkspace(store.activeWorkspaceId);
              }
              break;
              
            case 'switch-workspace':
              if (event.payload.payload?.workspaceId) {
                store.activateWorkspace(event.payload.payload.workspaceId);
              }
              break;
          }
        });
      } catch (error) {
        console.error('[GoldenLayoutRoot] Failed to setup menu listener:', error);
      }
    };

    setupListener();

    return () => {
      unlisten?.();
    };
  }, [store]);

  return (
    <div 
      ref={containerRef} 
      className="h-full w-full"
      style={{ minHeight: '400px', minWidth: '600px' }}
    />
  );
}