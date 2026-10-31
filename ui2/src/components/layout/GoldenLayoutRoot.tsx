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
} from 'golden-layout';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  workspaceTabLabels,
  planTabTitleUpdates,
} from '@/components/ui/displayModeSelector.helpers';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useAppModeStore } from '@/stores/appModeStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import { getEventBus } from '@/events/EventBus';
import { debounce } from 'lodash';
import type { WorkspaceType } from '@/types/workspace';
import { CrosshairProvider } from '@/contexts/CrosshairContext';
import { createDefaultLayoutConfig, getLayoutService } from '@/services/layoutService';
import { PanelErrorBoundary } from '@/components/common/PanelErrorBoundary';
import {
  ensureFocusedStack,
  focusCentreStackAfterLoad,
  installStackFocusTracker,
  markFocusedStack,
} from './glStackFocus';

// Workspace router — owns the workspaceType → component switch (extracted for testability).
import { WorkspaceRouter } from '@/components/layout/WorkspaceRouter';

// Workspace components only used in side panel registrations (everything else
// the workspace switch needs is now imported by WorkspaceRouter).
import { SurfaceViewPanel } from '@/components/views/SurfaceViewPanelLazy';
import { StudioDesignPanel } from '@/components/studio/StudioDesignPanel';

// Import side panel components
import { FileBrowserPanel } from '@/components/panels/FileBrowserPanel';
import { PlotPanel } from '@/components/panels/PlotPanel';
import { ClusterPanelMoved } from '@/components/panels/ClusterPanelMoved';
import { dockTabForPanel, openDockTab } from './openDockTab';
import {
  ProgrammaticTabChange,
  addWorkspaceTabKeepingActive,
  focusWorkspaceTab,
  handleWorkspaceTabDestroyed,
  programmaticTabRemoval,
  shouldSyncStoreFromTab,
} from './workspaceTabSync';
import { useCenterTabStore } from '@/stores/centerTabStore';
import { ensureDefaultView } from '@/services/workspaceNavigation';
// Right-rail Inspector — single tab; mode-aware via InspectorRouter.
import { InspectorRouter } from '@/components/inspector/InspectorRouter';

// GoldenLayout styles are imported in index.css to ensure proper cascade order

const isStateRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getComponentState = (
  item: ComponentItem | ComponentContainer | null | undefined,
): Record<string, unknown> => {
  const rawState =
    item instanceof ComponentContainer ? item.initialState : item?.container.initialState;
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

const findComponentItemByType = (
  stack: Stack | null,
  componentType: string,
): ComponentItem | null => {
  if (!stack) {
    return null;
  }

  const match = stack.contentItems.find(
    (item) => item.type === 'component' && (item as ComponentItem).componentType === componentType,
  );
  return match?.type === 'component' ? (match as ComponentItem) : null;
};

export function GoldenLayoutRoot() {
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<GoldenLayout | null>(null);
  const reactRootsRef = useRef<Map<string, ReactDOM.Root>>(new Map());
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const addedWorkspacesRef = useRef<Set<string>>(new Set());
  const pendingWorkspaceAddsRef = useRef<Set<string>>(new Set());
  // Programmatic tab adds must not move the store's active workspace (see
  // workspaceTabSync.ts): GoldenLayout activates every tab it adds.
  const programmaticTabChangeRef = useRef(new ProgrammaticTabChange());

  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const appMode = useAppModeStore((state) => state.mode);
  const store = useWorkspaceStore();

  // Helper to add a workspace tab
  const addWorkspaceTab = useCallback(
    (workspaceId: string, workspaceType: WorkspaceType, title: string) => {
      if (!layoutRef.current) return;

      // Skip if already added
      if (
        addedWorkspacesRef.current.has(workspaceId) ||
        pendingWorkspaceAddsRef.current.has(workspaceId)
      ) {
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
            workspaceType,
          },
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
              console.error(
                '[GoldenLayoutRoot] Center stack not found during deferred workspace add',
              );
              return;
            }

            console.log('[GoldenLayoutRoot] Creating new item with config:', newItemConfig);

            const layout = layoutRef.current;
            addWorkspaceTabKeepingActive(
              liveStack,
              programmaticTabChangeRef.current,
              () => {
                try {
                  liveStack.addItem(newItemConfig);
                } catch {
                  const componentItem = layout.newItem(newItemConfig);
                  liveStack.addChild(componentItem, undefined, true);
                }
              },
              useWorkspaceStore.getState().activeWorkspaceId,
            );

            pendingWorkspaceAddsRef.current.delete(workspaceId);
            addedWorkspacesRef.current.add(workspaceId);
            console.log(`[GoldenLayoutRoot] Added workspace tab: ${workspaceId} (${title})`);

            // If nothing has marked an active panel yet, treat this workspace as active.
            const activePanelStore = useActivePanelStore.getState();
            if (!activePanelStore.componentType) {
              activePanelStore.setActivePanel('Workspace', {
                workspaceId,
                workspaceType,
              });
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
    },
    [],
  );

  // Helper to remove a workspace tab
  const removeWorkspaceTab = useCallback((workspaceId: string) => {
    if (!layoutRef.current) return;

    const stack = getCenterWorkspaceStack(layoutRef.current);
    if (!stack) return;

    const item = stack.contentItems.find((item) => {
      if (item.type === 'component') {
        const componentItem = item as ComponentItem;
        const state = getComponentState(componentItem);
        return state.workspaceId === workspaceId;
      }
      return false;
    });

    if (item) {
      programmaticTabRemoval.run(() => item.remove());
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
          <PanelErrorBoundary panelName={`Workspace:${workspaceType}`}>
            <CrosshairProvider>
              <WorkspaceRouter workspaceId={workspaceId} workspaceType={workspaceType} />
            </CrosshairProvider>
          </PanelErrorBoundary>
        </React.StrictMode>,
      );

      // Cleanup on destroy
      container.on('destroy', () => {
        // The tab's × closes the workspace too; app-driven removals do not.
        handleWorkspaceTabDestroyed(
          workspaceId,
          programmaticTabRemoval,
          (id) => {
            addedWorkspacesRef.current.delete(id);
            pendingWorkspaceAddsRef.current.delete(id);
          },
          (id) => useWorkspaceStore.getState().closeWorkspace(id),
        );
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

        // Skip StrictMode for legacy panel registrations that mount canvas-rendering
        // subtrees (now aliased to InspectorRouter). InspectorRouter itself is React-only
        // chrome and is safe under StrictMode.
        const shouldUseStrictMode =
          name !== 'AtlasPanel' && name !== 'VolumeLayerPanel' && name !== 'LayerPanel';

        const componentElement = (
          <PanelErrorBoundary panelName={name}>
            <Component {...(state || {})} />
          </PanelErrorBoundary>
        );

        root.render(
          shouldUseStrictMode ? (
            <React.StrictMode>{componentElement}</React.StrictMode>
          ) : (
            componentElement
          ),
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
    registerSidePanelComponent('PlotPanel', PlotPanel);
    // Clusters live in the bottom dock (P3.5). A saved layout that still holds
    // a ClusterPanel tab gets a pointer there instead of a second table.
    registerSidePanelComponent('ClusterPanel', ClusterPanelMoved);
    // Right-rail Inspector — single canonical tab. Legacy componentTypes
    // (LayerPanel / SurfacePanel / AtlasPanel / StudioInspectorPanel) alias
    // to the same InspectorRouter so saved layouts and existing menu / preset
    // wiring continue to resolve. The router internally dispatches the body
    // by workspaceStore.activeWorkspace.type.
    registerSidePanelComponent('Inspector', InspectorRouter);
    registerSidePanelComponent('LayerPanel', InspectorRouter);
    registerSidePanelComponent('SurfacePanel', InspectorRouter);
    registerSidePanelComponent('AtlasPanel', InspectorRouter);
    registerSidePanelComponent('StudioInspectorPanel', InspectorRouter);

    // Register surface view component
    goldenLayout.registerComponent('surfaceView', (container: ComponentContainer, state: any) => {
      console.log('[GoldenLayoutRoot] SurfaceView component created, state:', state);

      const { surfaceHandle, path, surfaceViewId, groupKey } = state || {};

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
          <PanelErrorBoundary panelName="SurfaceView">
            <SurfaceViewPanel
              surfaceHandle={surfaceHandle}
              path={path}
              surfaceViewId={surfaceViewId}
              groupKey={groupKey}
            />
          </PanelErrorBoundary>
        </React.StrictMode>,
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
        // The centre stack's front tab, apart from focus in side stacks and
        // docks (the mode pills ask "is a surface tab in front?").
        if (componentItem.parent === getCenterWorkspaceStack(goldenLayout)) {
          useCenterTabStore.getState().setFrontComponentType(componentType);
        }

        const workspaceId = typeof state.workspaceId === 'string' ? state.workspaceId : null;
        // Read the live store: `store` is this mount effect's first-render
        // snapshot, so comparing against it skipped activations of the tab
        // that was active at launch and left the store on another workspace.
        const workspaceStore = useWorkspaceStore.getState();
        if (
          shouldSyncStoreFromTab(
            workspaceId,
            workspaceStore.activeWorkspaceId,
            programmaticTabChangeRef.current,
          )
        ) {
          console.log(`[GoldenLayoutRoot] Active workspace changed to: ${workspaceId}`);
          workspaceStore.activateWorkspace(workspaceId);
        }
      } else {
        activePanelStore.clearActivePanel();
        const center = getCenterWorkspaceStack(goldenLayout);
        if (center && center.contentItems.length === 0) {
          useCenterTabStore.getState().setFrontComponentType(null);
        }
      }
    });

    // Initial layout configuration with side panels (shared with Reset layout).
    const config: LayoutConfig = createDefaultLayoutConfig();

    // Mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`: GoldenLayout tree save/restore
    // is intentionally NOT wired here. `saveLayout()` returns a resolved
    // config and `loadLayout()` expects an unresolved `LayoutConfig`; the
    // two shapes are not interchangeable, and a naive round-trip throws
    // on the first restored field. The rest of the persistence story
    // (workspace map in `workspaceStore`, dock sizes / log-collapsed flag
    // / plot-maximized flag / integrated-mode preference in
    // `layoutSettingsStore`, plot mode + selectionSource in
    // `plotModeStore`) covers what users notice across reloads. Side-
    // panel column widths and side-panel tab order are not yet preserved;
    // a future mote can swap in the proper `LayoutConfig.fromResolved`
    // (or equivalent) conversion before restoring.
    //
    // Stale state: if a prior session of this codebase wrote a
    // `goldenLayoutState` payload via the broken save path, clear it
    // here so it never feeds back into a load attempt.
    if (useLayoutSettingsStore.getState().goldenLayoutState !== null) {
      useLayoutSettingsStore.getState().setGoldenLayoutState(null);
    }
    goldenLayout.loadLayout(config);

    // Add panel event listener for menu-triggered panel additions
    const handlePanelAdd = (event: Event) => {
      const customEvent = event as CustomEvent<{ panelType?: string }>;
      const panelType = customEvent.detail?.panelType;
      if (!panelType) {
        return;
      }
      // Clusters and plots are bottom-dock tabs (P3.5), never a centre or side pane.
      const dockTab = dockTabForPanel(panelType);
      if (dockTab) {
        openDockTab(dockTab, { focus: true });
        return;
      }
      // Side panels: focus the existing tab, or re-add a closed one to its
      // home stack. Never a duplicate (QA 2026-10-29 §16).
      getLayoutService().showPanel(panelType);
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
        const layout = layoutRef.current;
        programmaticTabRemoval.run(() => layout.destroy());
        layoutRef.current = null;
      }

      // Then cleanup any remaining React roots after a microtask
      // This ensures GoldenLayout has finished its cleanup
      Promise.resolve().then(() => {
        reactRootsRef.current.forEach((root) => root.unmount());
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
    // Right rail now hosts a single Inspector tab; focus it for both modes.
    // Body content (imaging vs studio) is dispatched inside InspectorRouter.
    const rightTarget = findComponentItemByType(rightStack, 'Inspector');

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

    try {
      focusWorkspaceTab(stack, activeWorkspaceId);
    } catch (error) {
      console.warn('[GoldenLayoutRoot] Failed to focus active workspace tab:', error);
    }
  }, [activeWorkspaceId, isLayoutReady]);

  // Focused-stack tracking: only the focused stack's active tab carries the
  // amber edge (HYBRID rule 3, V5 amendment). See glStackFocus.ts.
  useEffect(() => {
    const layout = layoutRef.current;
    const root = containerRef.current;
    if (!layout || !root || !isLayoutReady) return;
    const getDefaultStack = () => getCenterWorkspaceStack(layout)?.element ?? null;
    const cleanup = installStackFocusTracker(root, getDefaultStack);
    const handleStateChanged = () => ensureFocusedStack(root, getDefaultStack);
    layout.on('stateChanged', handleStateChanged);
    // A finished load puts the data in the viewer: mark the centre stack (and
    // release a tree row that only holds focus from a pointer click).
    const handleLoaded = () => focusCentreStackAfterLoad(root, getDefaultStack);
    const bus = getEventBus();
    const offFile = bus.on('file.loaded', handleLoaded);
    const offSurface = bus.on('surface.loaded', handleLoaded);
    return () => {
      cleanup();
      layout.off('stateChanged', handleStateChanged);
      offFile();
      offSurface();
    };
  }, [isLayoutReady]);

  // Switching workspace (top bar, menu, tab click) moves focus to the centre stack.
  useEffect(() => {
    const layout = layoutRef.current;
    const root = containerRef.current;
    if (!layout || !root || !isLayoutReady || !activeWorkspaceId) return;
    markFocusedStack(root, getCenterWorkspaceStack(layout)?.element ?? null);
  }, [activeWorkspaceId, isLayoutReady]);

  // Create default workspace after GoldenLayout is ready. The first check
  // after the layout is ready is the launch: a fixed startup list (Settings ›
  // Top bar) opens then instead of the default view.
  const launchCheckRef = useRef(true);
  useEffect(() => {
    if (!isLayoutReady || !layoutRef.current) return;
    const atLaunch = launchCheckRef.current;
    launchCheckRef.current = false;

    if (workspaces.size === 0) {
      // Cold start, or the user closed the last tab: one default view
      // (orthogonal-flexible). The persisted "integrated mode preference"
      // (mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`) is intentionally NOT used
      // here — it once let a stale pick (a BIDS Explorer) override the
      // default. ensureDefaultView shares its pending create with a startup
      // `--workspace` request, so the two never make two tabs.
      ensureDefaultView({ atLaunch })?.catch((error) => {
        console.error('[GoldenLayoutRoot] Failed to create initial workspace:', error);
      });
    }
    // Don't add existing workspaces here - the subscription will handle it
  }, [isLayoutReady, workspaces]);

  // Reconcile workspaces that already existed before the GoldenLayout
  // subscription was attached. This matters now that workspace persistence
  // survives reloads: the default GoldenLayout skeleton starts with an empty
  // center stack, while the Zustand workspace map may already contain tabs.
  useEffect(() => {
    if (!isLayoutReady || !layoutRef.current) return;

    const stack = getCenterWorkspaceStack(layoutRef.current);
    if (!stack) return;

    const liveWorkspaceIds = new Set<string>();
    stack.contentItems.forEach((item) => {
      if (item.type !== 'component') return;
      const state = getComponentState(item as ComponentItem);
      const workspaceId = typeof state.workspaceId === 'string' ? state.workspaceId : null;
      if (workspaceId) liveWorkspaceIds.add(workspaceId);
    });

    const labels = workspaceTabLabels(workspaces.values());
    workspaces.forEach((workspace, id) => {
      if (liveWorkspaceIds.has(id)) {
        addedWorkspacesRef.current.add(id);
        return;
      }
      addWorkspaceTab(id, workspace.type, labels.get(id) ?? workspace.title);
    });
  }, [isLayoutReady, workspaces, addWorkspaceTab]);

  // Listen for workspace changes from Zustand
  useEffect(() => {
    // Only start listening after layout is ready
    if (!isLayoutReady) return;

    const unsubscribe = useWorkspaceStore.subscribe((state, prevState) => {
      // Check for added workspaces
      const labels = workspaceTabLabels(state.workspaces.values());
      state.workspaces.forEach((workspace, id) => {
        if (!prevState.workspaces.has(id)) {
          addWorkspaceTab(id, workspace.type, labels.get(id) ?? workspace.title);
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

  // Keep each tab's title in sync with its workspace's live mode. The mode pill
  // mutates workspace.type in place; without this the GoldenLayout tab keeps its
  // original label and contradicts the pill (the "Mosaic View under Orthogonal
  // pill" bug). Labels derive from type via workspaceTabLabels (disambiguated),
  // so this also heals stale persisted titles and preset-label overrides on load.
  useEffect(() => {
    if (!isLayoutReady || !layoutRef.current) return;
    const stack = getCenterWorkspaceStack(layoutRef.current);
    if (!stack) return;

    const componentItems = stack.contentItems.filter(
      (item): item is ComponentItem => item.type === 'component',
    );
    const itemViews = componentItems.map((componentItem) => {
      const state = getComponentState(componentItem);
      return {
        componentItem,
        workspaceId: typeof state.workspaceId === 'string' ? state.workspaceId : null,
        title: componentItem.title,
      };
    });

    const updates = planTabTitleUpdates(itemViews, workspaces.values());
    for (const { workspaceId, title } of updates) {
      const target = itemViews.find((v) => v.workspaceId === workspaceId);
      if (!target) continue;
      try {
        target.componentItem.setTitle(title);
      } catch (error) {
        console.warn('[GoldenLayoutRoot] Failed to update workspace tab title:', error);
      }
    }
  }, [workspaces, isLayoutReady]);

  // Handle window resize
  useEffect(() => {
    if (!layoutRef.current) return;

    const handleResize = debounce(() => {
      if (layoutRef.current && containerRef.current) {
        console.log('[GoldenLayoutRoot] Updating layout size after resize');
        layoutRef.current.updateSize(
          containerRef.current.offsetWidth,
          containerRef.current.offsetHeight,
        );
      }
    }, 100);

    window.addEventListener('resize', handleResize);

    // Also listen for container resize using ResizeObserver
    const resizeObserver = new ResizeObserver(
      debounce(() => {
        if (layoutRef.current && containerRef.current) {
          console.log('[GoldenLayoutRoot] Container resized, updating layout');
          layoutRef.current.updateSize(
            containerRef.current.offsetWidth,
            containerRef.current.offsetHeight,
          );
        }
      }, 100),
    );

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
        unlisten = await safeListen<{ action: string; payload: any }>(
          'menu-action',
          async (event) => {
            console.log('[GoldenLayoutRoot] Menu action received:', event.payload);

            switch (event.payload.action) {
              case 'new-workspace':
                if (event.payload.payload?.type) {
                  await store.createWorkspace(
                    event.payload.payload.type,
                    event.payload.payload.config,
                  );
                }
                break;

              case 'close-workspace': {
                const { activeWorkspaceId: closingId, closeWorkspace } =
                  useWorkspaceStore.getState();
                if (closingId) {
                  closeWorkspace(closingId);
                }
                break;
              }

              case 'switch-workspace':
                if (event.payload.payload?.workspaceId) {
                  store.activateWorkspace(event.payload.payload.workspaceId);
                }
                break;
            }
          },
        );
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
