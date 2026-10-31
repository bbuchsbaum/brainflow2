/**
 * Hook to listen for workspace menu events from Tauri.
 *
 * View › Workspace / View › Layout (src-tauri main.rs) and the `--workspace`
 * startup flag emit `workspace-action`; every request goes through
 * `services/workspaceNavigation.ts`, the same path as the pills and the
 * in-app shortcuts. Requests that would change the tabs are dropped while a
 * modal dialog is open (the accelerators still reach the UI then).
 *
 * It also reports the Integrated feature flag to the native menu, which
 * disables View › Layout › Integrated while the flag is off, and the front
 * tab's layout, which View › Layout checks (QA 2026-10-30 F47).
 */

import { useEffect } from 'react';
import { safeEmit, safeListen, safeUnlisten } from '@/utils/eventUtils';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { useCenterTabStore } from '@/stores/centerTabStore';
import { getLayoutService } from '@/services/layoutService';
import type { WorkspaceType } from '@/types/workspace';
import type { DisplayMode } from '@/types/displayModes';
import {
  currentTabTakesLayout,
  goToWorkspaceType,
  isModalDialogOpen,
  openNewView,
  openTool,
  setCurrentTabLayout,
} from '@/services/workspaceNavigation';

interface WorkspaceActionEvent {
  action:
    | 'new-view'
    | 'set-layout'
    | 'open-tool'
    | 'new-workspace'
    | 'close-workspace'
    | 'close-tab'
    | 'switch-workspace';
  payload?: {
    /** set-layout: a display mode or an exact view type. */
    layout?: DisplayMode | WorkspaceType;
    /** open-tool / new-workspace: the workspace type. */
    type?: WorkspaceType;
    workspaceId?: string;
  };
}

/** The front tab's view type, or null when a tool or surface tab is in front. */
export function currentLayoutForMenu(): WorkspaceType | null {
  if (!currentTabTakesLayout()) return null;
  const { activeWorkspaceId, workspaces } = useWorkspaceStore.getState();
  return (activeWorkspaceId && workspaces.get(activeWorkspaceId)?.type) || null;
}

function reportCurrentLayout(): WorkspaceType | null {
  const layout = currentLayoutForMenu();
  void safeEmit('current-layout-changed', { layout });
  return layout;
}

const NAVIGATION_ACTIONS = new Set<WorkspaceActionEvent['action']>([
  'new-view',
  'close-tab',
  'set-layout',
  'open-tool',
]);

export function useWorkspaceMenuListener() {
  // View › Layout › Integrated follows the feature flag (src-tauri main.rs).
  useEffect(() => {
    let last = useFeatureFlagStore.getState().integratedWorkspaceV1;
    void safeEmit('integrated-layout-availability', { enabled: last });
    return useFeatureFlagStore.subscribe((state) => {
      if (state.integratedWorkspaceV1 === last) return;
      last = state.integratedWorkspaceV1;
      void safeEmit('integrated-layout-availability', { enabled: last });
    });
  }, []);

  // View › Layout checks the front tab's layout (src-tauri main.rs).
  useEffect(() => {
    let last = reportCurrentLayout();
    const onChange = () => {
      if (currentLayoutForMenu() === last) return;
      last = reportCurrentLayout();
    };
    const offWorkspaces = useWorkspaceStore.subscribe(onChange);
    const offCentre = useCenterTabStore.subscribe(onChange);
    return () => {
      offWorkspaces();
      offCentre();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    const setupListener = async () => {
      try {
        const fn = await safeListen<WorkspaceActionEvent>('workspace-action', async (event) => {
          const { action, payload = {} } = event.payload;
          const workspaceStore = useWorkspaceStore.getState();
          if (NAVIGATION_ACTIONS.has(action) && isModalDialogOpen()) return;

          switch (action) {
            case 'new-view':
              try {
                await openNewView();
              } catch (error) {
                console.error('[useWorkspaceMenuListener] Failed to open a new view:', error);
              }
              break;

            case 'set-layout':
              if (payload.layout) setCurrentTabLayout(payload.layout);
              // Always re-report: macOS toggles a clicked check item itself,
              // and an unchanged layout would otherwise leave it toggled.
              reportCurrentLayout();
              break;

            case 'open-tool':
              if (payload.type) {
                try {
                  await openTool(payload.type);
                } catch (error) {
                  console.error('[useWorkspaceMenuListener] Failed to open tool:', error);
                }
              }
              break;

            case 'new-workspace':
              // Startup `--workspace <type>`: a tool opens; a view type sets
              // the current tab's layout (nothing else is created at launch).
              if (payload.type) goToWorkspaceType(payload.type);
              break;

            case 'switch-workspace':
              if (payload.workspaceId) workspaceStore.activateWorkspace(payload.workspaceId);
              break;

            // File › Close Tab (⌘W): the front tab, as its × would (QA
            // 2026-10-31 N1; ⇧⌘W closes the window).
            case 'close-tab':
              getLayoutService().closeFrontTab();
              break;

            case 'close-workspace':
              if (payload.workspaceId) workspaceStore.closeWorkspace(payload.workspaceId);
              break;

            default:
              console.warn('[useWorkspaceMenuListener] Unknown action:', action);
          }
        });
        if (disposed) void safeUnlisten(fn);
        else unlisten = fn;
      } catch (error) {
        console.error('[useWorkspaceMenuListener] Failed to setup listener:', error);
      }
    };

    void setupListener();

    return () => {
      disposed = true;
      if (unlisten) void safeUnlisten(unlisten);
    };
  }, []);
}
