/**
 * Workspace Store
 * Manages workspace-level view configurations and tab management
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { LayoutConfig } from 'golden-layout';

// Enable Map and Set support in Immer
enableMapSet();
import type { 
  Workspace, 
  WorkspaceType, 
  WorkspaceConfig, 
  PanelState
} from '@/types/workspace';
import { getWorkspacePresetById, type WorkspacePresetId } from '@/types/workspacePresets';

interface CreateWorkspaceOptions {
  title?: string;
  presetId?: WorkspacePresetId | null;
}

interface WorkspaceStore {
  // State
  workspaces: Map<string, Workspace>;
  activeWorkspaceId: string | null;
  
  // Core workspace operations
  createWorkspace: (
    type: WorkspaceType,
    config?: WorkspaceConfig,
    options?: CreateWorkspaceOptions
  ) => Promise<string>;
  applyWorkspacePreset: (presetId: WorkspacePresetId) => Promise<string>;
  getWorkspaceByPreset: (presetId: WorkspacePresetId) => Workspace | null;
  activateWorkspace: (id: string) => void;
  closeWorkspace: (id: string) => void;
  updateWorkspaceLayout: (id: string, layoutConfig: LayoutConfig) => void;
  
  // Panel management
  updatePanelState: (workspaceId: string, panelId: string, state: Partial<PanelState>) => void;
  recoverPanel: (workspaceId: string, panelId: string) => void;
  
  // State queries
  getActiveWorkspace: () => Workspace | null;
  getWorkspace: (id: string) => Workspace | null;
  getRecoverablePanels: (workspaceId: string) => PanelState[];
  canRecoverPanel: (panelId: string) => boolean;
  
  // Utility
  generateWorkspaceTitle: (type: WorkspaceType) => string;
}

// Counter for generating unique titles
const workspaceCounter: Record<WorkspaceType, number> = {
  'orthogonal-locked': 0,
  'orthogonal-flexible': 0,
  'mosaic': 0,
  'comparison': 0,
  'integrated': 0,
  'set-studio': 0,
  'bids-explorer': 0,
  'analysis-workbench': 0,
};

/**
 * Persistence version for `brainflow2-workspace`. Bump and add a `migrate`
 * branch below whenever the persisted state shape changes incompatibly.
 *
 * History:
 *   v0 → v1: removed the unconditional `localStorage.removeItem` startup
 *            wipe (mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`). Anything written
 *            by the pre-versioned codebase is treated as untrusted and
 *            reset to defaults; from v1 onwards the persisted shape is
 *            owned by the integrated workspace refactor.
 *   v1 → v2: right-rail unification (mote
 *            `bd-01KQMFC7B2S8SZYRZX62V6R0FZ`). The four legacy panel
 *            componentTypes (LayerPanel / AtlasPanel / SurfacePanel /
 *            StudioInspectorPanel) collapsed into a single `Inspector` tab
 *            backed by `InspectorRouter`. Persisted layoutConfig trees
 *            from v1 still mention the legacy types; rather than rewrite
 *            them in-place we drop persisted workspaces so each workspace
 *            regenerates its layout via `ViewRegistry.createLayout`.
 */
const WORKSPACE_PERSIST_VERSION = 2;

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    immer((set, get) => ({
      workspaces: new Map(),
      activeWorkspaceId: null,
      
      createWorkspace: async (type, config, options) => {
        if (options?.presetId) {
          const presetWorkspace = get().getWorkspaceByPreset(options.presetId);
          if (presetWorkspace) {
            get().activateWorkspace(presetWorkspace.id);
            return presetWorkspace.id;
          }
        }

        // Check if this is a singleton workspace
        const { WORKSPACE_METADATA } = await import('@/types/workspace');
        const metadata = WORKSPACE_METADATA[type];
        
        if (metadata?.singleton) {
          // Check if instance already exists
          const existing = Array.from(get().workspaces.values()).find(w => w.type === type);
          if (existing) {
            // Just activate the existing instance
            get().activateWorkspace(existing.id);
            return existing.id;
          }
        }
        
        const timestamp = Date.now();
        const id = `${type}-${timestamp}`;
        const title = options?.title ?? get().generateWorkspaceTitle(type);
        
        // Import ViewRegistry dynamically to avoid circular dependencies
        const { ViewRegistry } = await import('@/services/ViewRegistry');
        
        // Create layout config using ViewRegistry
        let layoutConfig: LayoutConfig;
        try {
          layoutConfig = ViewRegistry.createLayout(type, config);
        } catch (error) {
          console.error(`[WorkspaceStore] Failed to create layout for ${type}:`, error);
          // Fallback to a simple layout
          layoutConfig = {
            root: {
              type: 'component',
              componentType: 'EmptyView',
              title,
              componentState: {}
            }
          };
        }
        
        // Create panel states Map
        const panelStates = new Map();
        
        // Initialize panel states for the orthogonal panels workspace
        if (type === 'orthogonal-flexible') {
          panelStates.set('axial', {
            id: 'axial',
            type: 'FlexibleSlicePanel',
            isVisible: true
          });
          panelStates.set('sagittal', {
            id: 'sagittal',
            type: 'FlexibleSlicePanel',
            isVisible: true
          });
          panelStates.set('coronal', {
            id: 'coronal',
            type: 'FlexibleSlicePanel',
            isVisible: true
          });
        }
        
        const workspace: Workspace = {
          id,
          type,
          title,
          presetId: options?.presetId ?? null,
          timestamp,
          isActive: false,
          layoutConfig,
          panelStates
        };
        
        const currentState = get();
        const nextWorkspaces = new Map(currentState.workspaces);

        if (currentState.activeWorkspaceId) {
          const current = nextWorkspaces.get(currentState.activeWorkspaceId);
          if (current) {
            nextWorkspaces.set(current.id, { ...current, isActive: false });
          }
        }

        const newWorkspace: Workspace = { ...workspace, isActive: true };
        nextWorkspaces.set(id, newWorkspace);
        set({
          workspaces: nextWorkspaces,
          activeWorkspaceId: id,
        });
        
        console.log(`[WorkspaceStore] Created workspace: ${id} (${title})`);
        return id;
      },

      applyWorkspacePreset: async (presetId) => {
        const preset = getWorkspacePresetById(presetId);
        return get().createWorkspace(preset.workspaceType, preset.workspaceConfig, {
          title: preset.label,
          presetId,
        });
      },

      getWorkspaceByPreset: (presetId) => {
        return (
          Array.from(get().workspaces.values()).find(
            workspace => workspace.presetId === presetId
          ) ?? null
        );
      },
      
      activateWorkspace: (id) => {
        const currentState = get();
        const workspace = currentState.workspaces.get(id);
        if (!workspace) {
          console.warn(`[WorkspaceStore] Cannot activate non-existent workspace: ${id}`);
          return;
        }

        const nextWorkspaces = new Map(currentState.workspaces);
        if (currentState.activeWorkspaceId) {
          const current = nextWorkspaces.get(currentState.activeWorkspaceId);
          if (current) {
            nextWorkspaces.set(current.id, { ...current, isActive: false });
          }
        }
        nextWorkspaces.set(id, { ...workspace, isActive: true });

        set({
          workspaces: nextWorkspaces,
          activeWorkspaceId: id,
        });

        console.log(`[WorkspaceStore] Activated workspace: ${id}`);
      },
      
      closeWorkspace: (id) => {
        const currentState = get();
        if (!currentState.workspaces.has(id)) return;

        const nextWorkspaces = new Map(currentState.workspaces);
        nextWorkspaces.delete(id);

        let nextActiveWorkspaceId = currentState.activeWorkspaceId;
        if (currentState.activeWorkspaceId === id) {
          const remaining = Array.from(nextWorkspaces.values());
          if (remaining.length > 0) {
            const next = remaining[remaining.length - 1];
            nextWorkspaces.set(next.id, { ...next, isActive: true });
            nextActiveWorkspaceId = next.id;
          } else {
            nextActiveWorkspaceId = null;
          }
        }

        set({
          workspaces: nextWorkspaces,
          activeWorkspaceId: nextActiveWorkspaceId,
        });

        console.log(`[WorkspaceStore] Closed workspace: ${id}`);
      },
      
      updateWorkspaceLayout: (id, layoutConfig) => {
        const currentState = get();
        const workspace = currentState.workspaces.get(id);
        if (!workspace) {
          return;
        }

        const nextWorkspaces = new Map(currentState.workspaces);
        nextWorkspaces.set(id, { ...workspace, layoutConfig });
        set({ workspaces: nextWorkspaces });
        console.log(`[WorkspaceStore] Updated layout for workspace: ${id}`);
      },
      
      updatePanelState: (workspaceId, panelId, updates) => {
        const currentState = get();
        const workspace = currentState.workspaces.get(workspaceId);
        if (!workspace) return;

        const nextPanelStates = new Map(workspace.panelStates);
        const panelState = nextPanelStates.get(panelId);
        if (panelState) {
          nextPanelStates.set(panelId, { ...panelState, ...updates });
        } else {
          nextPanelStates.set(panelId, {
            id: panelId,
            type: 'unknown',
            isVisible: true,
            ...updates
          });
        }

        const nextWorkspaces = new Map(currentState.workspaces);
        nextWorkspaces.set(workspaceId, {
          ...workspace,
          panelStates: nextPanelStates,
        });
        set({ workspaces: nextWorkspaces });

        console.log(`[WorkspaceStore] Updated panel state: ${panelId} in workspace ${workspaceId}`);
      },
      
      recoverPanel: (workspaceId, panelId) => {
        const workspace = get().workspaces.get(workspaceId);
        if (!workspace) return;
        
        const panelState = workspace.panelStates.get(panelId);
        if (!panelState || panelState.isVisible) return;
        
        // Mark panel as visible
        get().updatePanelState(workspaceId, panelId, { isVisible: true });
        
        // Note: Actual Golden Layout manipulation will be handled by the component
        console.log(`[WorkspaceStore] Marked panel for recovery: ${panelId}`);
      },
      
      getActiveWorkspace: () => {
        const state = get();
        return state.activeWorkspaceId 
          ? state.workspaces.get(state.activeWorkspaceId) || null 
          : null;
      },
      
      getWorkspace: (id) => {
        return get().workspaces.get(id) || null;
      },
      
      getRecoverablePanels: (workspaceId) => {
        const workspace = get().workspaces.get(workspaceId);
        if (!workspace) return [];
        
        return Array.from(workspace.panelStates.values())
          .filter(panel => !panel.isVisible);
      },
      
      canRecoverPanel: (panelId) => {
        const activeWorkspace = get().getActiveWorkspace();
        if (!activeWorkspace) return false;
        
        const panelState = activeWorkspace.panelStates.get(panelId);
        return panelState ? !panelState.isVisible : false;
      },
      
      generateWorkspaceTitle: (type) => {
        workspaceCounter[type] = (workspaceCounter[type] || 0) + 1;
        
        const baseNames: Record<WorkspaceType, string> = {
          'orthogonal-locked': 'Orthogonal View',
          'orthogonal-flexible': 'Orthogonal Panels',
          'mosaic': 'Mosaic View',
          'comparison': 'Comparison View',
          'integrated': 'Integrated Workspace',
          'set-studio': 'Set Studio',
          'bids-explorer': 'BIDS Explorer',
          'analysis-workbench': 'Analysis Workbench',
        };
        
        const count = workspaceCounter[type];
        return count === 1 ? baseNames[type] : `${baseNames[type]} ${count}`;
      }
    })),
    {
      name: 'brainflow2-workspace',
      version: WORKSPACE_PERSIST_VERSION,
      /**
       * Versioned migrate guard (AC#4). Earlier sessions ran with no version
       * field; if we encounter such a payload, drop the persisted workspaces
       * and start fresh — same effect the legacy startup wipe used to give,
       * but only on a known stale shape rather than every reload.
       */
      migrate: (persistedState: unknown, version: number) => {
        // Reset on any future version mismatch. Unversioned payloads are
        // already handled by `storage.getItem` returning null below — this
        // branch only fires for v2+ payloads when an older codebase loads them.
        if (version !== WORKSPACE_PERSIST_VERSION) {
          return {
            workspaces: new Map(),
            activeWorkspaceId: null,
          };
        }
        return persistedState as { workspaces: Map<string, Workspace>; activeWorkspaceId: string | null };
      },
      // Custom serialization for Map
      storage: {
        getItem: (name) => {
          try {
            const str = localStorage.getItem(name);
            if (!str) return null;

            const data = JSON.parse(str);

            // Mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`: drop pre-versioning
            // payloads at the storage boundary. zustand's `persist` middleware
            // only invokes `migrate` when the persisted version is a number,
            // so unversioned (legacy) blobs would otherwise pass through
            // untouched. Returning null is the documented signal for "use
            // initial state" — same effect the legacy startup wipe gave,
            // but only on stale shapes rather than every reload.
            if (typeof data?.version !== 'number') return null;

            // Validate and restore workspaces Map
            if (data.state && data.state.workspaces) {
              // Ensure workspaces is an array before converting to Map
              if (Array.isArray(data.state.workspaces)) {
                data.state.workspaces = new Map(data.state.workspaces);
                
                // Restore Map for each workspace's panelStates
                data.state.workspaces.forEach((workspace: Workspace) => {
                  if (Array.isArray(workspace.panelStates)) {
                    workspace.panelStates = new Map(workspace.panelStates);
                  } else if (!workspace.panelStates) {
                    workspace.panelStates = new Map();
                  }
                });
              } else {
                // If workspaces is not in expected format, reset to empty Map
                console.warn('[WorkspaceStore] Invalid workspaces format in storage, resetting');
                data.state.workspaces = new Map();
              }
            }
            
            return data;
          } catch (error) {
            console.error('[WorkspaceStore] Failed to load from storage:', error);
            // Return null to use default state
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            const data = value as {
              state: {
                workspaces: Map<string, Workspace>;
              };
            } & Record<string, unknown>;
            const serializableData: Record<string, unknown> = { ...data };
            if (data.state.workspaces instanceof Map) {
              const serializedWorkspaces = Array.from(data.state.workspaces.entries()).map(
                ([id, workspace]) => [
                  id,
                  {
                    ...workspace,
                    panelStates:
                      workspace.panelStates instanceof Map
                        ? Array.from(workspace.panelStates.entries())
                        : [],
                  },
                ]
              );
              serializableData.state = {
                ...data.state,
                workspaces: serializedWorkspaces,
              };
            }
            localStorage.setItem(name, JSON.stringify(serializableData));
          } catch (error) {
            console.error('[WorkspaceStore] Failed to save to storage:', error);
          }
        },
        removeItem: (name) => localStorage.removeItem(name)
      }
    }
  )
);
