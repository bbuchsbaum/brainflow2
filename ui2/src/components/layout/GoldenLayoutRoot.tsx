/**
 * GoldenLayoutRoot Component
 * Single root GoldenLayout instance that manages all workspaces as tabs
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  GoldenLayout,
  LayoutConfig,
  ComponentContainer,
  Stack,
  ComponentItem,
  type ComponentItemConfig,
  type ContentItem,
} from 'golden-layout';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useAppModeStore } from '@/stores/appModeStore';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import { debounce } from 'lodash';
import type { WorkspaceType } from '@/types/workspace';
import { CrosshairProvider } from '@/contexts/CrosshairContext';
import { getLayoutService } from '@/services/layoutService';

// Import workspace components
import { OrthogonalViewContainer } from '@/components/views/OrthogonalViewContainer';
import { OrthogonalPanelsWorkspace } from '@/components/views/OrthogonalPanelsWorkspace';
import { MosaicViewPromise } from '@/components/views/MosaicViewPromise';
import { SurfaceViewPanel } from '@/components/views/SurfaceViewPanel';
import { SetStudioWorkspace } from '@/components/studio/SetStudioWorkspace';
import { ComparisonWorkspace } from '@/components/views/ComparisonWorkspace';
import { BidsExplorerWorkspace } from '@/components/bids/BidsExplorerWorkspace';
import { StudioDesignPanel } from '@/components/studio/StudioDesignPanel';
import { StudioInspectorPanel } from '@/components/studio/StudioInspectorPanel';

// Import side panel components
import { FileBrowserPanel } from '@/components/panels/FileBrowserPanel';
import { VolumeLayerPanel } from '@/components/panels/VolumeLayerPanel';
import { SurfaceLayerPanel } from '@/components/panels/SurfaceLayerPanel';
import { PlotPanel } from '@/components/panels/PlotPanel';
import { ClusterPanel } from '@/components/panels/ClusterPanel';
import { AtlasPanel } from '@/components/panels/AtlasPanel';

// GoldenLayout styles are imported in index.css to ensure proper cascade order

const isStateRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getComponentState = (item: ComponentItem | ComponentContainer | null | undefined): Record<string, unknown> => {
  const rawState = item instanceof ComponentContainer ? item.initialState : item?.container.initialState;
  return isStateRecord(rawState) ? rawState : {};
};

const getCenterWorkspaceStack = (layout: GoldenLayout): Stack | null => {
  const root = layout.rootItem;
  if (!root || root.type !== 'row') {
    return null;
  }

  const centerStack = root.contentItems[1];
  return centerStack?.type === 'stack' ? (centerStack as Stack) : null;
};

const getLeftSidebarStack = (layout: GoldenLayout): Stack | null => {
  const root = layout.rootItem;
  if (!root || root.type !== 'row') {
    return null;
  }

  const leftColumn = root.contentItems[0];
  if (!leftColumn || leftColumn.type !== 'column') {
    return null;
  }

  const leftStack = leftColumn.contentItems[0];
  return leftStack?.type === 'stack' ? (leftStack as Stack) : null;
};

const getRightSidebarStack = (layout: GoldenLayout): Stack | null => {
  const root = layout.rootItem;
  if (!root || root.type !== 'row') {
    return null;
  }

  const rightColumn = root.contentItems[2];
  if (!rightColumn || rightColumn.type !== 'column') {
    return null;
  }

  const rightStack = rightColumn.contentItems[0];
  return rightStack?.type === 'stack' ? (rightStack as Stack) : null;
};

const findComponentItemByType = (stack: Stack | null, componentType: string): ComponentItem | null => {
  if (!stack) {
    return null;
  }

  const match = stack.contentItems.find(
    (item) => item.type === 'component' && (item as ComponentItem).componentType === componentType
  );
  return match?.type === 'component' ? (match as ComponentItem) : null;
};

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
    return <div className="h-full flex items-center justify-center text-muted-foreground">Workspace not found</div>;
  }

  // Render appropriate component based on workspace type
  switch (workspaceType) {
    case 'orthogonal-locked':
      return <OrthogonalViewContainer />;
    case 'orthogonal-flexible':
      return <OrthogonalPanelsWorkspace />;
    case 'mosaic':
      return <MosaicViewPromise workspaceId={workspaceId} />;
    case 'comparison':
      return <ComparisonWorkspace workspaceId={workspaceId} />;
    case 'set-studio':
      return <SetStudioWorkspace />;
    case 'bids-explorer':
      return <BidsExplorerWorkspace workspaceId={workspaceId} />;
    default:
      return <div className="h-full flex items-center justify-center text-muted-foreground">Unknown workspace type: {workspaceType}</div>;
  }
};

export function GoldenLayoutRoot() {
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<GoldenLayout | null>(null);
  const reactRootsRef = useRef<Map<string, ReactDOM.Root>>(new Map());
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const addedWorkspacesRef = useRef<Set<string>>(new Set());
  const pendingWorkspaceAddsRef = useRef<Set<string>>(new Set());
  
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const appMode = useAppModeStore(state => state.mode);
  const store = useWorkspaceStore();

  // Helper to add a workspace tab
  const addWorkspaceTab = useCallback((workspaceId: string, workspaceType: WorkspaceType, title: string) => {
    if (!layoutRef.current) return;
    
    // Skip if already added
    if (addedWorkspacesRef.current.has(workspaceId) || pendingWorkspaceAddsRef.current.has(workspaceId)) {
      console.log(`[GoldenLayoutRoot] Workspace ${workspaceId} already added, skipping`);
      return;
    }

    try {
      // Find the center stack in the layout
      const stack = getCenterWorkspaceStack(layoutRef.current);
      if (!stack) {
        console.error('[GoldenLayoutRoot] Center stack not found');
        return;
      }

      const newItemConfig: ComponentItemConfig = {
        type: 'component' as const,
        componentType: 'Workspace',
        title,
        componentState: {
          workspaceId,
          workspaceType
        }
      };
      
      pendingWorkspaceAddsRef.current.add(workspaceId);

      requestAnimationFrame(() => {
        try {
          if (!layoutRef.current) {
            pendingWorkspaceAddsRef.current.delete(workspaceId);
            return;
          }

          const liveStack = getCenterWorkspaceStack(layoutRef.current);
          if (!liveStack) {
            pendingWorkspaceAddsRef.current.delete(workspaceId);
            console.error('[GoldenLayoutRoot] Center stack not found during deferred workspace add');
            return;
          }

          console.log('[GoldenLayoutRoot] Creating new item with config:', newItemConfig);

          try {
            liveStack.addItem(newItemConfig);
          } catch {
            const componentItem = layoutRef.current.newItem(newItemConfig);
            liveStack.addChild(componentItem, undefined, true);
          }

          pendingWorkspaceAddsRef.current.delete(workspaceId);
          addedWorkspacesRef.current.add(workspaceId);
          console.log(`[GoldenLayoutRoot] Added workspace tab: ${workspaceId} (${title})`);

          // If nothing has marked an active panel yet, treat this workspace as active.
          const activePanelStore = useActivePanelStore.getState();
          if (!activePanelStore.componentType) {
            activePanelStore.setActivePanel('Workspace', { workspaceId, workspaceType });
          }
        } catch (error) {
          pendingWorkspaceAddsRef.current.delete(workspaceId);
          console.error('[GoldenLayoutRoot] Failed to add workspace tab:', error);
        }
      });
    } catch (error) {
      pendingWorkspaceAddsRef.current.delete(workspaceId);
      console.error('[GoldenLayoutRoot] Failed to add workspace tab:', error);
    }
  }, []);

  // Helper to remove a workspace tab
  const removeWorkspaceTab = useCallback((workspaceId: string) => {
    if (!layoutRef.current) return;

    const stack = getCenterWorkspaceStack(layoutRef.current);
    if (!stack) return;

    const item = stack.contentItems.find(item => {
      if (item.type === 'component') {
        const componentItem = item as ComponentItem;
        const state = getComponentState(componentItem);
        return state.workspaceId === workspaceId;
      }
      return false;
    });

    if (item) {
      item.remove();
      addedWorkspacesRef.current.delete(workspaceId);
      pendingWorkspaceAddsRef.current.delete(workspaceId);
      console.log(`[GoldenLayoutRoot] Removed workspace tab: ${workspaceId}`);
    }
  }, []);

  // Initialize GoldenLayout
  useEffect(() => {
    if (!containerRef.current || layoutRef.current) return;

    console.log('[GoldenLayoutRoot] Initializing GoldenLayout');

    const goldenLayout = new GoldenLayout(containerRef.current);
    layoutRef.current = goldenLayout;
    
    // Set the layout reference in the layout service for external access
    getLayoutService().setLayoutRef(goldenLayout);

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
          <CrosshairProvider>
            <WorkspaceComponent 
              workspaceId={workspaceId} 
              workspaceType={workspaceType}
            />
          </CrosshairProvider>
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
        
        // Skip StrictMode for AtlasPanel and VolumeLayerPanel to prevent double-mounting race conditions
        const shouldUseStrictMode = name !== 'AtlasPanel' && name !== 'VolumeLayerPanel' && name !== 'LayerPanel';
        
        const componentElement = (
          <Component {...(state || {})} />
        );
        
        root.render(
          shouldUseStrictMode ? (
            <React.StrictMode>
              {componentElement}
            </React.StrictMode>
          ) : componentElement
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
    registerSidePanelComponent('StudioDesignPanel', StudioDesignPanel);
    registerSidePanelComponent('LayerPanel', VolumeLayerPanel);  // Keep old name for compatibility
    registerSidePanelComponent('SurfacePanel', SurfaceLayerPanel);  // Surface management panel
    registerSidePanelComponent('PlotPanel', PlotPanel);
    registerSidePanelComponent('ClusterPanel', ClusterPanel);
    registerSidePanelComponent('AtlasPanel', AtlasPanel);
    registerSidePanelComponent('StudioInspectorPanel', StudioInspectorPanel);
    
    // Register surface view component
    goldenLayout.registerComponent('surfaceView', (container: ComponentContainer, state: any) => {
      console.log('[GoldenLayoutRoot] SurfaceView component created, state:', state);
      
      const { surfaceHandle, path, surfaceViewId } = state || {};
      
      if (!surfaceHandle) {
        console.error('[GoldenLayoutRoot] Invalid surface configuration:', state);
        container.element.innerHTML = '<div class="error">Invalid surface configuration</div>';
        return;
      }

      // Create a div for React to render into
      const rootElement = document.createElement('div');
      rootElement.style.height = '100%';
      rootElement.style.width = '100%';
      container.element.appendChild(rootElement);

      // Create React root and render the surface view
      const root = ReactDOM.createRoot(rootElement);
      
      root.render(
        <React.StrictMode>
          <SurfaceViewPanel 
            surfaceHandle={surfaceHandle}
            path={path}
            surfaceViewId={surfaceViewId}
          />
        </React.StrictMode>
      );

      // Cleanup on destroy
      container.on('destroy', () => {
        setTimeout(() => {
          root.unmount();
        }, 0);
      });
    });

    // Listen for active tab changes (track both workspace + active panel)
    goldenLayout.on('activeContentItemChanged', (item) => {
      const activePanelStore = useActivePanelStore.getState();

      if (item && item.type === 'component') {
        const componentItem = item as ComponentItem;
        const state = getComponentState(componentItem);

        const componentType =
          (componentItem as any).componentType ||
          (componentItem as any).config?.componentType ||
          componentItem.container.componentType ||
          null;

        activePanelStore.setActivePanel(componentType, state || null);

        const workspaceId = typeof state.workspaceId === 'string' ? state.workspaceId : null;
        if (workspaceId && workspaceId !== store.activeWorkspaceId) {
          console.log(`[GoldenLayoutRoot] Active workspace changed to: ${workspaceId}`);
          store.activateWorkspace(workspaceId);
        }
      } else {
        activePanelStore.clearActivePanel();
      }
    });

    // Initial layout configuration with side panels
    const config: LayoutConfig = {
      root: {
        type: 'row',
        content: [
          {
            type: 'column',
            width: 17.25,
            content: [{
              type: 'stack',
              content: [
                {
                  type: 'component',
                  componentType: 'FileBrowser',
                  title: 'Files',
                  componentState: {}
                },
                {
                  type: 'component',
                  componentType: 'StudioDesignPanel',
                  title: 'Subjects',
                  componentState: {}
                }
              ]
            }]
          },
          {
            type: 'stack',  // Center stack for workspace tabs
            width: 59.75,
            content: []      // Workspaces will be added here
          },
          {
            type: 'column',
            width: 23,
            content: [
              {
                type: 'stack',
                content: [
                  {
                    type: 'component',
                    componentType: 'LayerPanel',
                    title: 'Volumes',
                    componentState: {}
                  },
                  {
                    type: 'component',
                    componentType: 'AtlasPanel',
                    title: 'Atlases',
                    componentState: {}
                  },
                  {
                    type: 'component',
                    componentType: 'SurfacePanel',
                    title: 'Surfaces',
                    componentState: {}
                  },
                  {
                    type: 'component',
                    componentType: 'StudioInspectorPanel',
                    title: 'Details',
                    componentState: {}
                  }
                ]
              }
            ]
          }
        ]
      }
    };
    
    goldenLayout.loadLayout(config);
    
    // Add panel event listener for menu-triggered panel additions
    const handlePanelAdd = (event: Event) => {
      const customEvent = event as CustomEvent<{ panelType?: string }>;
      const panelType = customEvent.detail?.panelType;
      if (!panelType) {
        return;
      }
      console.log(`[GoldenLayoutRoot] Adding panel: ${panelType}`);
      
      try {
        // Find the right column to add to (right column is at index 2 in the row)
        const root = goldenLayout.rootItem;
        if (!root || root.type !== 'row') {
          console.error('[GoldenLayoutRoot] Root is not a row');
          return;
        }
        
        const rightColumn = root.contentItems[2]; // Right column (third item in row)
        if (!rightColumn || rightColumn.type !== 'column') {
          console.error('[GoldenLayoutRoot] Could not find right column');
          return;
        }

        // Plots are now hosted in the right-sidebar tab shell (VolumeLayerPanel).
        // Keep menu commands non-fatal but avoid re-introducing a duplicate GL plot pane.
        if (panelType === 'PlotPanel') {
          console.info('[GoldenLayoutRoot] PlotPanel add ignored; use sidebar Plots tab.');
          return;
        }
        
        const panelConfig = {
          type: 'component' as const,
          componentType: panelType,
          title: getPanelTitle(panelType),
          componentState: {}
        };
        
        // Determine where to add the panel based on its type
        const newItem = goldenLayout.newItem(panelConfig);
        
        if (panelType === 'LayerPanel' || panelType === 'SurfacePanel' || panelType === 'AtlasPanel') {
          // Add to the tabbed stack (first item in right column)
          const tabbedStack = rightColumn.contentItems[0];
          if (tabbedStack && tabbedStack.type === 'stack') {
            tabbedStack.addChild(newItem);
            console.log(`[GoldenLayoutRoot] Panel ${panelType} added to tabbed stack`);
          } else {
            console.error('[GoldenLayoutRoot] Could not find tabbed stack for VolumePanel/AtlasPanel');
            rightColumn.addChild(newItem); // Fallback: add to column
          }
        } else {
          // Add other panels directly to the column
          rightColumn.addChild(newItem);
          console.log(`[GoldenLayoutRoot] Panel ${panelType} added to column`);
        }
      } catch (error) {
        console.error(`[GoldenLayoutRoot] Failed to add panel ${panelType}:`, error);
      }
    };
    
    // Helper function to get panel titles
        const getPanelTitle = (panelType: string): string => {
          switch (panelType) {
            case 'FileBrowser': return 'Files';
            case 'LayerPanel': return 'Volumes';  // Updated to match new naming
            case 'SurfacePanel': return 'Surfaces';
            case 'AtlasPanel': return 'Atlases';
            case 'PlotPanel': return 'Plots';
            case 'ClusterPanel': return 'Clusters';
            default: return panelType;
          }
        };
    
    window.addEventListener('golden-layout-add-panel', handlePanelAdd as EventListener);
    
    // Mark layout as ready after a small delay
    setTimeout(() => {
      setIsLayoutReady(true);
    }, 50);

    return () => {
      // Remove panel event listener
      window.removeEventListener('golden-layout-add-panel', handlePanelAdd as EventListener);
      
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

  useEffect(() => {
    if (!layoutRef.current || !isLayoutReady) {
      return;
    }

    const leftStack = getLeftSidebarStack(layoutRef.current);
    const rightStack = getRightSidebarStack(layoutRef.current);
    const leftTarget =
      appMode === 'studio'
        ? findComponentItemByType(leftStack, 'StudioDesignPanel')
        : findComponentItemByType(leftStack, 'FileBrowser');
    const rightTarget =
      appMode === 'studio'
        ? findComponentItemByType(rightStack, 'StudioInspectorPanel')
        : findComponentItemByType(rightStack, 'LayerPanel');

    if (leftStack && leftTarget) {
      leftStack.setActiveComponentItem(leftTarget, true);
    }
    if (rightStack && rightTarget) {
      rightStack.setActiveComponentItem(rightTarget, true);
    }
  }, [appMode, isLayoutReady]);

  useEffect(() => {
    if (!layoutRef.current || !isLayoutReady || !activeWorkspaceId) {
      return;
    }

    const stack = getCenterWorkspaceStack(layoutRef.current);
    if (!stack) {
      return;
    }

    const target = stack.contentItems.find((item) => {
      if (item.type !== 'component') {
        return false;
      }
      const componentItem = item as ComponentItem;
      const state = getComponentState(componentItem);
      return state.workspaceId === activeWorkspaceId;
    });

    if (target && target.type === 'component') {
      try {
        stack.setActiveComponentItem(target as ComponentItem, true);
      } catch (error) {
        console.warn('[GoldenLayoutRoot] Failed to focus active workspace tab:', error);
      }
    }
  }, [activeWorkspaceId, isLayoutReady]);

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
      if (layoutRef.current && containerRef.current) {
        console.log('[GoldenLayoutRoot] Updating layout size after resize');
        layoutRef.current.updateSize(
          containerRef.current.offsetWidth,
          containerRef.current.offsetHeight
        );
      }
    }, 100);

    window.addEventListener('resize', handleResize);
    
    // Also listen for container resize using ResizeObserver
    const resizeObserver = new ResizeObserver(debounce(() => {
      if (layoutRef.current && containerRef.current) {
        console.log('[GoldenLayoutRoot] Container resized, updating layout');
        layoutRef.current.updateSize(
          containerRef.current.offsetWidth,
          containerRef.current.offsetHeight
        );
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
        unlisten = await safeListen<{ action: string; payload: any }>('menu-action', async (event) => {
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
      if (unlisten) void safeUnlisten(unlisten);
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
