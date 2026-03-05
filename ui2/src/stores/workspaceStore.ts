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
  'lightbox': 0,
  'roi-stats': 0,
  'coordinate-converter': 0
};

// Clear workspaces on startup for clean slate
if (typeof window !== 'undefined') {
  localStorage.removeItem('brainflow2-workspace');
}

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
        
        // Initialize panel states for flexible orthogonal view
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
        
        set(state => {
          // Deactivate current workspace
          if (state.activeWorkspaceId) {
            const current = state.workspaces.get(state.activeWorkspaceId);
            if (current) current.isActive = false;
          }
          
          // Add new workspace with isActive set to true
          const newWorkspace = { ...workspace, isActive: true };
          state.workspaces.set(id, newWorkspace);
          state.activeWorkspaceId = id;
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
        set(state => {
          const workspace = state.workspaces.get(id);
          if (!workspace) {
            console.warn(`[WorkspaceStore] Cannot activate non-existent workspace: ${id}`);
            return;
          }
          
          // Deactivate current
          if (state.activeWorkspaceId) {
            const current = state.workspaces.get(state.activeWorkspaceId);
            if (current) current.isActive = false;
          }
          
          // Activate new
          workspace.isActive = true;
          state.activeWorkspaceId = id;
          
          console.log(`[WorkspaceStore] Activated workspace: ${id}`);
        });
      },
      
      closeWorkspace: (id) => {
        set(state => {
          const workspace = state.workspaces.get(id);
          if (!workspace) return;
          
          state.workspaces.delete(id);
          
          // If closing active workspace, activate another
          if (state.activeWorkspaceId === id) {
            const remaining = Array.from(state.workspaces.values());
            if (remaining.length > 0) {
              const next = remaining[remaining.length - 1];
              next.isActive = true;
              state.activeWorkspaceId = next.id;
            } else {
              state.activeWorkspaceId = null;
            }
          }
          
          console.log(`[WorkspaceStore] Closed workspace: ${id}`);
        });
      },
      
      updateWorkspaceLayout: (id, layoutConfig) => {
        set(state => {
          const workspace = state.workspaces.get(id);
          if (workspace) {
            workspace.layoutConfig = layoutConfig;
            console.log(`[WorkspaceStore] Updated layout for workspace: ${id}`);
          }
        });
      },
      
      updatePanelState: (workspaceId, panelId, updates) => {
        set(state => {
          const workspace = state.workspaces.get(workspaceId);
          if (!workspace) return;
          
          const panelState = workspace.panelStates.get(panelId);
          if (panelState) {
            Object.assign(panelState, updates);
          } else {
            workspace.panelStates.set(panelId, {
              id: panelId,
              type: 'unknown',
              isVisible: true,
              ...updates
            });
          }
          
          console.log(`[WorkspaceStore] Updated panel state: ${panelId} in workspace ${workspaceId}`);
        });
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
          'orthogonal-flexible': 'Flexible View',
          'mosaic': 'Mosaic View',
          'lightbox': 'Lightbox View',
          'roi-stats': 'ROI Statistics',
          'coordinate-converter': 'Coordinate Converter'
        };
        
        const count = workspaceCounter[type];
        return count === 1 ? baseNames[type] : `${baseNames[type]} ${count}`;
      }
    })),
    {
      name: 'brainflow2-workspace',
      // Custom serialization for Map
      storage: {
        getItem: (name) => {
          try {
            const str = localStorage.getItem(name);
            if (!str) return null;
            
            const data = JSON.parse(str);
            
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
            const data = { ...value };
            if (data.state.workspaces instanceof Map) {
              // Create a deep copy to avoid modifying frozen objects
              const workspacesArray = Array.from(data.state.workspaces.entries()).map(([id, workspace]) => {
                const workspaceCopy = { ...workspace };
                if (workspace.panelStates instanceof Map) {
                  workspaceCopy.panelStates = Array.from(workspace.panelStates.entries());
                }
                return [id, workspaceCopy];
              });
              data.state.workspaces = workspacesArray;
            }
            localStorage.setItem(name, JSON.stringify(data));
          } catch (error) {
            console.error('[WorkspaceStore] Failed to save to storage:', error);
          }
        },
        removeItem: (name) => localStorage.removeItem(name)
      }
    }
  )
);
