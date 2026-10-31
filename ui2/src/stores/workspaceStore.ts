/**
 * Workspace Store
 * Manages workspace-level view configurations and tab management
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import type { LayoutConfig } from "golden-layout";

// Enable Map and Set support in Immer
enableMapSet();
import type {
  Workspace,
  WorkspaceType,
  WorkspaceConfig,
  PanelState,
} from "@/types/workspace";
import {
  getWorkspacePresetById,
  type WorkspacePresetId,
} from "@/types/workspacePresets";
import { DISPLAY_MODES, type DisplayMode } from "@/types/displayModes";
import { resolveActiveDisplayMode } from "@/components/ui/displayModeSelector.helpers";
import {
  partitionByModuleAvailability,
  pruneLegacyViewSprawl,
  resolveActive,
  restoreWorkspaces,
} from "./workspaceRestorePolicy";
import {
  isKnownWorkspaceType,
  isWorkspaceTypeAvailable,
  workspaceBaseName,
  workspaceTypeModule,
} from "@/services/workspaceTypes";
import { useModuleSettingsStore } from "@/modules/settingsStore";

interface CreateWorkspaceOptions {
  title?: string;
  presetId?: WorkspacePresetId | null;
}

interface WorkspaceStore {
  // State
  workspaces: Map<string, Workspace>;
  activeWorkspaceId: string | null;
  /**
   * Tabs of modules that are switched off, kept so that switching the module
   * back on restores them (docs/plans/module-architecture.md). Persisted.
   */
  parkedWorkspaces: Map<string, Workspace>;

  // Core workspace operations
  createWorkspace: (
    type: WorkspaceType,
    config?: WorkspaceConfig,
    options?: CreateWorkspaceOptions,
  ) => Promise<string>;
  applyWorkspacePreset: (presetId: WorkspacePresetId) => Promise<string>;
  getWorkspaceByPreset: (presetId: WorkspacePresetId) => Workspace | null;
  activateWorkspace: (id: string) => void;
  /**
   * Reconfigure the *active* workspace's display mode in place (pills set the
   * mode of the current view tab; tabs remain the view substrate). No-ops when
   * there is no active workspace, the mode is unmapped, or the active workspace
   * already resolves to that mode (so an `orthogonal-flexible` workspace stays
   * flexible when "Orthogonal" is re-clicked). Does NOT change which tab is
   * active.
   */
  setActiveWorkspaceMode: (mode: DisplayMode) => void;
  /**
   * Set the *active* view workspace to an exact view type in place (e.g.
   * locked grid → separate orthogonal panels). No-ops for tool workspaces,
   * non-view types, or an unchanged type. Does NOT change which tab is active.
   */
  setActiveWorkspaceType: (type: WorkspaceType) => void;
  closeWorkspace: (id: string) => void;
  /** Close a module's tabs and remember them (the module was switched off). */
  parkModuleWorkspaces: (moduleId: string) => void;
  /** Bring back a module's remembered tabs (the module was switched on). */
  unparkModuleWorkspaces: (moduleId: string) => void;
  updateWorkspaceLayout: (id: string, layoutConfig: LayoutConfig) => void;

  // Panel management
  updatePanelState: (
    workspaceId: string,
    panelId: string,
    state: Partial<PanelState>,
  ) => void;
  recoverPanel: (workspaceId: string, panelId: string) => void;

  // State queries
  getActiveWorkspace: () => Workspace | null;
  getWorkspace: (id: string) => Workspace | null;
  getRecoverablePanels: (workspaceId: string) => PanelState[];
  canRecoverPanel: (panelId: string) => boolean;

  // Utility
  generateWorkspaceTitle: (type: WorkspaceType) => string;
}

// Counter for generating unique titles, per workspace type.
const workspaceCounter = new Map<WorkspaceType, number>();

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
 *   v2 → v3: navigation model (qa-design-decisions-2026-10-30 §1). Relaunch
 *            now restores every user tab; v2 payloads still hold the empty
 *            duplicates the old pills/menus auto-created, so the migration
 *            keeps one plain view per layout once, and clears the retired
 *            view presets (Read / Explore / Analyze / Compare).
 *   v3 (additive, no bump): `parkedWorkspaces`, the tabs of modules that are
 *            switched off. Optional; an absent field means none, and older
 *            builds ignore it. Restore parks tabs whose module is off and
 *            unparks those whose module is back on. With Settings › Top bar
 *            › Startup tabs set to a fixed list, the previous session's tabs
 *            are not restored (workspaceNavigation opens the list instead).
 */
const WORKSPACE_PERSIST_VERSION = 3;

type PersistedWorkspaceState = {
  workspaces: Map<string, Workspace>;
  activeWorkspaceId: string | null;
  parkedWorkspaces?: Map<string, Workspace>;
};

/** Persisted `[id, workspace]` pairs → a Map, with each `panelStates` a Map. */
function reviveWorkspaceMap(entries: unknown): Map<string, Workspace> {
  if (!Array.isArray(entries)) return new Map();
  const map = new Map<string, Workspace>(entries as Array<[string, Workspace]>);
  map.forEach((workspace) => {
    if (Array.isArray(workspace.panelStates)) {
      workspace.panelStates = new Map(workspace.panelStates);
    } else if (!(workspace.panelStates instanceof Map)) {
      workspace.panelStates = new Map();
    }
  });
  return map;
}

function serializeWorkspaceMap(map: Map<string, Workspace>) {
  return Array.from(map.entries()).map(([id, workspace]) => [
    id,
    {
      ...workspace,
      panelStates:
        workspace.panelStates instanceof Map
          ? Array.from(workspace.panelStates.entries())
          : [],
    },
  ]);
}

/** Normalise `isActive` flags to the chosen active workspace. */
function withActiveFlags(
  workspaces: Map<string, Workspace>,
  activeWorkspaceId: string | null,
): PersistedWorkspaceState {
  const next = new Map<string, Workspace>();
  workspaces.forEach((workspace, id) => {
    next.set(id, { ...workspace, isActive: id === activeWorkspaceId });
  });
  return { workspaces: next, activeWorkspaceId };
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    immer((set, get) => ({
      workspaces: new Map(),
      activeWorkspaceId: null,
      parkedWorkspaces: new Map(),

      createWorkspace: async (type, config, options) => {
        if (options?.presetId) {
          const presetWorkspace = get().getWorkspaceByPreset(options.presetId);
          if (presetWorkspace) {
            get().activateWorkspace(presetWorkspace.id);
            return presetWorkspace.id;
          }
        }

        // Check if this is a singleton workspace
        const workspaceTypes = await import("@/services/workspaceTypes");
        const metadata = workspaceTypes.getWorkspaceMetadata(type);
        if (!workspaceTypes.isWorkspaceTypeAvailable(type)) {
          // An unknown type, or the tool of a module that is switched off.
          throw new Error(`[WorkspaceStore] Workspace type "${type}" is not available`);
        }

        if (metadata?.singleton) {
          // Check if instance already exists
          const existing = Array.from(get().workspaces.values()).find(
            (w) => w.type === type,
          );
          if (existing) {
            // Just activate the existing instance
            get().activateWorkspace(existing.id);
            return existing.id;
          }
        }

        const timestamp = Date.now();
        const title = options?.title ?? get().generateWorkspaceTitle(type);

        // Import ViewRegistry dynamically to avoid circular dependencies
        const { ViewRegistry } = await import("@/services/ViewRegistry");

        // Create layout config using ViewRegistry
        let layoutConfig: LayoutConfig;
        try {
          layoutConfig = ViewRegistry.createLayout(type, config);
        } catch (error) {
          console.error(
            `[WorkspaceStore] Failed to create layout for ${type}:`,
            error,
          );
          // Fallback to a simple layout
          layoutConfig = {
            root: {
              type: "component",
              componentType: "EmptyView",
              title,
              componentState: {},
            },
          };
        }

        // Create panel states Map
        const panelStates = new Map();

        // Initialize panel states for the orthogonal panels workspace
        if (type === "orthogonal-flexible") {
          panelStates.set("axial", {
            id: "axial",
            type: "FlexibleSlicePanel",
            isVisible: true,
          });
          panelStates.set("sagittal", {
            id: "sagittal",
            type: "FlexibleSlicePanel",
            isVisible: true,
          });
          panelStates.set("coronal", {
            id: "coronal",
            type: "FlexibleSlicePanel",
            isVisible: true,
          });
        }

        // Two views of one layout can be opened in the same millisecond (New
        // view). Pick the id after the last await so concurrent creates cannot
        // collide and the second never overwrites the first.
        let id = `${type}-${timestamp}`;
        for (let n = 2; get().workspaces.has(id); n += 1) {
          id = `${type}-${timestamp}-${n}`;
        }
        const workspace: Workspace = {
          id,
          type,
          title,
          presetId: options?.presetId ?? null,
          timestamp,
          isActive: false,
          layoutConfig,
          panelStates,
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
        return get().createWorkspace(
          preset.workspaceType,
          preset.workspaceConfig,
          {
            title: preset.label,
            presetId,
          },
        );
      },

      getWorkspaceByPreset: (presetId) => {
        return (
          Array.from(get().workspaces.values()).find(
            (workspace) => workspace.presetId === presetId,
          ) ?? null
        );
      },

      activateWorkspace: (id) => {
        const currentState = get();
        const workspace = currentState.workspaces.get(id);
        if (!workspace) {
          console.warn(
            `[WorkspaceStore] Cannot activate non-existent workspace: ${id}`,
          );
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

      setActiveWorkspaceMode: (mode) => {
        const nextType = DISPLAY_MODES[mode]?.defaultWorkspaceType;
        if (!nextType) return; // unmapped display mode (e.g. surface)

        const { activeWorkspaceId, workspaces } = get();
        const workspace = activeWorkspaceId
          ? workspaces.get(activeWorkspaceId)
          : undefined;
        if (!workspace) return;

        // Already in this display mode → no-op. Resolve via display mode (not
        // exact type) so re-clicking "Orthogonal" keeps an orthogonal-flexible
        // workspace flexible instead of snapping it to orthogonal-locked.
        if (resolveActiveDisplayMode(workspace.type) === mode) return;

        get().setActiveWorkspaceType(nextType);
      },

      setActiveWorkspaceType: (nextType) => {
        if (!resolveActiveDisplayMode(nextType)) return; // not a view type

        const currentState = get();
        const id = currentState.activeWorkspaceId;
        if (!id) return;

        const workspace = currentState.workspaces.get(id);
        // Tool tabs have no slice layout; never reconfigure them.
        if (!workspace || !resolveActiveDisplayMode(workspace.type)) return;
        if (workspace.type === nextType) return;

        // A layout change in place drops any preset origin the tab had.
        const nextWorkspaces = new Map(currentState.workspaces);
        nextWorkspaces.set(id, {
          ...workspace,
          type: nextType,
          presetId: null,
        });
        set({ workspaces: nextWorkspaces });

        console.log(
          `[WorkspaceStore] Set active workspace ${id} layout → ${nextType}`,
        );
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

      parkModuleWorkspaces: (moduleId) => {
        const { workspaces, parkedWorkspaces, activeWorkspaceId } = get();
        const moving = Array.from(workspaces.values()).filter(
          (workspace) => workspaceTypeModule(workspace.type) === moduleId,
        );
        if (moving.length === 0) return;

        const nextWorkspaces = new Map(workspaces);
        const nextParked = new Map(parkedWorkspaces);
        for (const workspace of moving) {
          nextWorkspaces.delete(workspace.id);
          nextParked.set(workspace.id, { ...workspace, isActive: false });
        }
        let nextActive = activeWorkspaceId;
        if (nextActive && !nextWorkspaces.has(nextActive)) {
          const remaining = Array.from(nextWorkspaces.values());
          nextActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        }
        const flagged = withActiveFlags(nextWorkspaces, nextActive);
        set({ ...flagged, parkedWorkspaces: nextParked });
        console.log(
          `[WorkspaceStore] Parked ${moving.length} tab(s) of module ${moduleId}`,
        );
      },

      unparkModuleWorkspaces: (moduleId) => {
        const { workspaces, parkedWorkspaces, activeWorkspaceId } = get();
        const moving = Array.from(parkedWorkspaces.values()).filter(
          (workspace) => workspaceTypeModule(workspace.type) === moduleId,
        );
        if (moving.length === 0) return;

        const nextWorkspaces = new Map(workspaces);
        const nextParked = new Map(parkedWorkspaces);
        const openTypes = new Set(Array.from(workspaces.values()).map((w) => w.type));
        for (const workspace of moving) {
          nextParked.delete(workspace.id);
          // Tools are singletons: one opened meanwhile wins.
          if (openTypes.has(workspace.type) || nextWorkspaces.has(workspace.id)) continue;
          openTypes.add(workspace.type);
          nextWorkspaces.set(workspace.id, { ...workspace, isActive: false });
        }
        const nextActive =
          activeWorkspaceId ?? resolveActive(nextWorkspaces, null);
        const flagged = withActiveFlags(nextWorkspaces, nextActive);
        set({ ...flagged, parkedWorkspaces: nextParked });
        console.log(
          `[WorkspaceStore] Restored ${moving.length} tab(s) of module ${moduleId}`,
        );
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
            type: "unknown",
            isVisible: true,
            ...updates,
          });
        }

        const nextWorkspaces = new Map(currentState.workspaces);
        nextWorkspaces.set(workspaceId, {
          ...workspace,
          panelStates: nextPanelStates,
        });
        set({ workspaces: nextWorkspaces });

        console.log(
          `[WorkspaceStore] Updated panel state: ${panelId} in workspace ${workspaceId}`,
        );
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

        return Array.from(workspace.panelStates.values()).filter(
          (panel) => !panel.isVisible,
        );
      },

      canRecoverPanel: (panelId) => {
        const activeWorkspace = get().getActiveWorkspace();
        if (!activeWorkspace) return false;

        const panelState = activeWorkspace.panelStates.get(panelId);
        return panelState ? !panelState.isVisible : false;
      },

      generateWorkspaceTitle: (type) => {
        const count = (workspaceCounter.get(type) ?? 0) + 1;
        workspaceCounter.set(type, count);

        // The pill-reachable view types (orthogonal / mosaic / comparison /
        // integrated) share a neutral "View" base name: the top-bar mode pills
        // now own "what mode", so a tab titled "Mosaic View" under a MOSAIC
        // pill is exactly the duplication we're removing. A neutral tab answers
        // "which view" instead. Non-pill workspaces reached via the Workspace
        // menu keep their descriptive names — they are distinct destinations,
        // not modes.
        const baseName = workspaceBaseName(type);
        return count === 1 ? baseName : `${baseName} ${count}`;
      },
    })),
    {
      name: "brainflow2-workspace",
      version: WORKSPACE_PERSIST_VERSION,
      /**
       * Versioned migrate guard (AC#4). Earlier sessions ran with no version
       * field; if we encounter such a payload, drop the persisted workspaces
       * and start fresh — same effect the legacy startup wipe used to give,
       * but only on a known stale shape rather than every reload.
       */
      migrate: (persistedState: unknown, version: number) => {
        if (version === 2) {
          const state = persistedState as Partial<PersistedWorkspaceState>;
          if (!(state?.workspaces instanceof Map)) {
            return { workspaces: new Map(), activeWorkspaceId: null };
          }
          const pruned = pruneLegacyViewSprawl(
            state.workspaces,
            state.activeWorkspaceId ?? null,
          );
          pruned.workspaces.forEach((workspace, id) => {
            if (resolveActiveDisplayMode(workspace.type) && workspace.presetId) {
              pruned.workspaces.set(id, { ...workspace, presetId: null });
            }
          });
          return withActiveFlags(pruned.workspaces, pruned.activeWorkspaceId);
        }
        // Reset on any other version mismatch. Unversioned payloads are
        // already handled by `storage.getItem` returning null below — this
        // branch only fires for v1 payloads, or newer ones an older build loads.
        if (version !== WORKSPACE_PERSIST_VERSION) {
          return {
            workspaces: new Map(),
            activeWorkspaceId: null,
          };
        }
        return persistedState as PersistedWorkspaceState;
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
            if (typeof data?.version !== "number") return null;

            // Validate and restore workspaces Map
            if (data.state && data.state.workspaces) {
              // Ensure workspaces is an array before converting to Map
              if (Array.isArray(data.state.workspaces)) {
                const saved = reviveWorkspaceMap(data.state.workspaces);
                const savedParked = new Map(
                  [...reviveWorkspaceMap(data.state.parkedWorkspaces)].filter(
                    ([, workspace]) => isKnownWorkspaceType(workspace.type),
                  ),
                );

                // Relaunch restores the user's tabs and tools with their
                // layouts (workspaceRestorePolicy.ts); tabs of modules that
                // are off stay parked.
                const restored = restoreWorkspaces(
                  saved,
                  data.state.activeWorkspaceId ?? null,
                );
                const parts = partitionByModuleAvailability(
                  restored.workspaces,
                  savedParked,
                  isWorkspaceTypeAvailable,
                );
                let shown = parts.workspaces;
                let active = resolveActive(shown, restored.activeWorkspaceId);
                if (useModuleSettingsStore.getState().startup.mode === "fixed") {
                  // A fixed startup list replaces the previous session's tabs.
                  shown = new Map();
                  active = null;
                }
                const flagged = withActiveFlags(shown, active);
                data.state.workspaces = flagged.workspaces;
                data.state.activeWorkspaceId = flagged.activeWorkspaceId;
                data.state.parkedWorkspaces = parts.parked;
              } else {
                // If workspaces is not in expected format, reset to empty Map
                console.warn(
                  "[WorkspaceStore] Invalid workspaces format in storage, resetting",
                );
                data.state.workspaces = new Map();
                data.state.parkedWorkspaces = new Map();
              }
            }

            return data;
          } catch (error) {
            console.error(
              "[WorkspaceStore] Failed to load from storage:",
              error,
            );
            // Return null to use default state
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            const data = value as {
              state: {
                workspaces: Map<string, Workspace>;
                parkedWorkspaces?: Map<string, Workspace>;
              };
            } & Record<string, unknown>;
            const serializableData: Record<string, unknown> = { ...data };
            if (data.state.workspaces instanceof Map) {
              serializableData.state = {
                ...data.state,
                workspaces: serializeWorkspaceMap(data.state.workspaces),
                parkedWorkspaces:
                  data.state.parkedWorkspaces instanceof Map
                    ? serializeWorkspaceMap(data.state.parkedWorkspaces)
                    : [],
              };
            }
            localStorage.setItem(name, JSON.stringify(serializableData));
          } catch (error) {
            console.error("[WorkspaceStore] Failed to save to storage:", error);
          }
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);
