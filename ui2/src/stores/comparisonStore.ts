/**
 * Comparison Store
 * Manages state for multi-panel comparison workspace
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { enableMapSet } from 'immer';
import type {
  ComparisonPanelConfig,
  ComparisonLayout,
  CompareLinkMode,
  LayerRenderOverride,
  PanelOverrideField,
} from '@/types/comparison';
import type { ViewPlane } from '@/types/coordinates';

enableMapSet();

let panelCounter = 0;
function nextPanelId(): string {
  return `compare-panel-${panelCounter++}`;
}

interface ComparisonState {
  /** All panels in the comparison workspace, keyed by workspace ID */
  panels: Map<string, ComparisonPanelConfig[]>;
  /** Layout mode per workspace */
  layouts: Map<string, ComparisonLayout>;
  /** Global orientation per workspace */
  globalViewTypes: Map<string, 'axial' | 'sagittal' | 'coronal'>;
  /** Resolved per-panel views used for rendering/crosshair projection */
  panelViewPlanes: Map<string, ViewPlane>;
  /** "Link" per workspace (P3.9). Absent = "all" (today's behaviour). */
  linkModes: Map<string, CompareLinkMode>;
  /** The panel Inspector edits go to while unlinked, per workspace. */
  activePanelIds: Map<string, string>;
  /** Unlinked edit scope: the active panel only, or every panel ("Both"). */
  editScopes: Map<string, 'panel' | 'all'>;
}

interface ComparisonActions {
  replaceLayer: (oldId: string, newId: string) => void;
  /** Initialize comparison workspace with one panel per layer */
  initFromLayers: (workspaceId: string, layerIds: string[], layerLabels?: Map<string, string>) => void;

  /** Initialize comparison from existing layers + a new volume */
  initFromCurrentAndNewLayer: (workspaceId: string, existingLayerIds: string[], newLayerId: string, newLabel?: string) => void;

  /** Add a panel with specified layers */
  addPanel: (workspaceId: string, layerIds: string[], label?: string) => void;

  /** Ensure one panel exists for each listed layer, preserving existing panels */
  ensurePanelsForLayers: (workspaceId: string, layerIds: string[], layerLabels?: Map<string, string>) => void;

  /** Remove a panel */
  removePanel: (workspaceId: string, panelId: string) => void;

  /** Add a layer to an existing panel */
  addLayerToPanel: (workspaceId: string, panelId: string, layerId: string) => void;

  /** Remove a layer from a panel */
  removeLayerFromPanel: (workspaceId: string, panelId: string, layerId: string) => void;

  /** Set the view type for a single panel */
  setPanelViewType: (workspaceId: string, panelId: string, viewType: 'axial' | 'sagittal' | 'coronal') => void;

  /** Set the global view type for all panels in a workspace */
  setGlobalViewType: (workspaceId: string, viewType: 'axial' | 'sagittal' | 'coronal') => void;

  /** Set the layout mode */
  setLayout: (workspaceId: string, layout: ComparisonLayout) => void;

  /** Get panels for a workspace */
  getPanels: (workspaceId: string) => ComparisonPanelConfig[];

  /** Get the layout mode for a workspace */
  getLayout: (workspaceId: string) => ComparisonLayout;

  /** Get the global view type for a workspace */
  getGlobalViewType: (workspaceId: string) => 'axial' | 'sagittal' | 'coronal';

  /** Persist the resolved view plane for a panel */
  setPanelViewPlane: (panelId: string, viewPlane: ViewPlane | null) => void;

  /** Read the resolved view plane for a panel */
  getPanelViewPlane: (panelId: string) => ViewPlane | undefined;

  /** Which display properties the panels share (window, threshold, colormap). */
  setLinkMode: (workspaceId: string, mode: CompareLinkMode) => void;

  /** Make a panel the target of unlinked Inspector edits. */
  setActivePanel: (workspaceId: string, panelId: string) => void;

  /** Unlinked edit scope: the active panel, or all panels. */
  setEditScope: (workspaceId: string, scope: 'panel' | 'all') => void;

  /** Set one display override of a layer in one panel. */
  setPanelOverride: <K extends PanelOverrideField>(
    workspaceId: string,
    panelId: string,
    layerId: string,
    field: K,
    value: LayerRenderOverride[K],
  ) => void;

  /** Drop a layer's override (one field, or all) in one panel, or in every panel when panelId is null. */
  clearPanelOverride: (
    workspaceId: string,
    panelId: string | null,
    layerId: string,
    field?: PanelOverrideField,
  ) => void;

  /** Clear a workspace's comparison config */
  clearWorkspace: (workspaceId: string) => void;
}

export const useComparisonStore = create<ComparisonState & ComparisonActions>()(
  subscribeWithSelector(
    immer((set, get) => ({
      replaceLayer: (oldId, newId) => {
        set((state) => {
          for (const panels of state.panels.values()) {
            for (const panel of panels) {
              if (panel.visibleLayerIds.delete(oldId)) panel.visibleLayerIds.add(newId);
            }
          }
        });
      },
      panels: new Map(),
      layouts: new Map(),
      globalViewTypes: new Map(),
      panelViewPlanes: new Map(),
      linkModes: new Map(),
      activePanelIds: new Map(),
      editScopes: new Map(),

      setLinkMode: (workspaceId, mode) => {
        set((state) => {
          if ((state.linkModes.get(workspaceId) ?? 'all') === mode) return;
          state.linkModes.set(workspaceId, mode);
          const panels = state.panels.get(workspaceId) ?? [];
          if (mode !== 'all' && !state.activePanelIds.has(workspaceId) && panels[0]) {
            state.activePanelIds.set(workspaceId, panels[0].id);
          }
        });
      },

      setActivePanel: (workspaceId, panelId) => {
        set((state) => {
          if (state.activePanelIds.get(workspaceId) === panelId) return;
          state.activePanelIds.set(workspaceId, panelId);
        });
      },

      setEditScope: (workspaceId, scope) => {
        set((state) => {
          if ((state.editScopes.get(workspaceId) ?? 'panel') === scope) return;
          state.editScopes.set(workspaceId, scope);
        });
      },

      setPanelOverride: (workspaceId, panelId, layerId, field, value) => {
        set((state) => {
          const panels = state.panels.get(workspaceId);
          if (!panels) return;
          state.panels.set(
            workspaceId,
            panels.map((panel) => {
              if (panel.id !== panelId) return panel;
              const overrides = { ...(panel.renderOverrides ?? {}) };
              overrides[layerId] = { ...(overrides[layerId] ?? {}), [field]: value };
              return { ...panel, renderOverrides: overrides };
            })
          );
        });
      },

      clearPanelOverride: (workspaceId, panelId, layerId, field) => {
        set((state) => {
          const panels = state.panels.get(workspaceId);
          if (!panels) return;
          let changed = false;
          const next = panels.map((panel) => {
            if (panelId !== null && panel.id !== panelId) return panel;
            const current = panel.renderOverrides?.[layerId];
            if (!current || (field && current[field] === undefined)) return panel;
            const overrides = { ...(panel.renderOverrides ?? {}) };
            if (field) {
              const rest = { ...current };
              delete rest[field];
              if (Object.keys(rest).length > 0) overrides[layerId] = rest;
              else delete overrides[layerId];
            } else {
              delete overrides[layerId];
            }
            changed = true;
            return { ...panel, renderOverrides: overrides };
          });
          if (changed) state.panels.set(workspaceId, next);
        });
      },

      initFromLayers: (workspaceId, layerIds, layerLabels) => {
        set(state => {
          const panels: ComparisonPanelConfig[] = layerIds.map((id, i) => ({
            id: nextPanelId(),
            label: layerLabels?.get(id) ?? `Panel ${i + 1}`,
            visibleLayerIds: new Set([id]),
            viewType: 'axial' as const,
          }));
          const existing = state.panels.get(workspaceId) ?? [];
          existing.forEach((panel) => state.panelViewPlanes.delete(panel.id));
          state.panels.set(workspaceId, panels);
          state.layouts.set(workspaceId, 'row');
          state.globalViewTypes.set(workspaceId, 'axial');
        });
      },

      initFromCurrentAndNewLayer: (workspaceId, existingLayerIds, newLayerId, newLabel) => {
        set(state => {
          const panels: ComparisonPanelConfig[] = [
            {
              id: nextPanelId(),
              label: 'Current',
              visibleLayerIds: new Set(existingLayerIds),
              viewType: 'axial' as const,
            },
            {
              id: nextPanelId(),
              label: newLabel ?? 'New',
              visibleLayerIds: new Set([newLayerId]),
              viewType: 'axial' as const,
            },
          ];
          const existing = state.panels.get(workspaceId) ?? [];
          existing.forEach((panel) => state.panelViewPlanes.delete(panel.id));
          state.panels.set(workspaceId, panels);
          state.layouts.set(workspaceId, 'row');
          state.globalViewTypes.set(workspaceId, 'axial');
        });
      },

      addPanel: (workspaceId, layerIds, label) => {
        set(state => {
          const existing = state.panels.get(workspaceId) ?? [];
          const nextPanels = [
            ...existing,
            {
              id: nextPanelId(),
              label: label ?? `Panel ${existing.length + 1}`,
              visibleLayerIds: new Set(layerIds),
              viewType: state.globalViewTypes.get(workspaceId) ?? 'axial',
            },
          ];
          state.panels.set(workspaceId, nextPanels);
        });
      },

      ensurePanelsForLayers: (workspaceId, layerIds, layerLabels) => {
        set(state => {
          const existing = state.panels.get(workspaceId) ?? [];
          const existingLayerIds = new Set(
            existing.flatMap((panel) => Array.from(panel.visibleLayerIds))
          );
          const nextPanels = [...existing];

          layerIds.forEach((layerId) => {
            if (!layerId || existingLayerIds.has(layerId)) {
              return;
            }
            nextPanels.push({
              id: nextPanelId(),
              label: layerLabels?.get(layerId) ?? `Panel ${nextPanels.length + 1}`,
              visibleLayerIds: new Set([layerId]),
              viewType: state.globalViewTypes.get(workspaceId) ?? 'axial',
            });
            existingLayerIds.add(layerId);
          });

          state.panels.set(workspaceId, nextPanels);
        });
      },

      removePanel: (workspaceId, panelId) => {
        set(state => {
          const existing = state.panels.get(workspaceId);
          if (!existing) return;
          state.panelViewPlanes.delete(panelId);
          state.panels.set(
            workspaceId,
            existing.filter((panel) => panel.id !== panelId)
          );
        });
      },

      addLayerToPanel: (workspaceId, panelId, layerId) => {
        set(state => {
          const panels = state.panels.get(workspaceId);
          if (!panels) return;
          state.panelViewPlanes.delete(panelId);
          state.panels.set(
            workspaceId,
            panels.map((panel) =>
              panel.id === panelId
                ? { ...panel, visibleLayerIds: new Set([...panel.visibleLayerIds, layerId]) }
                : panel
            )
          );
        });
      },

      removeLayerFromPanel: (workspaceId, panelId, layerId) => {
        set(state => {
          const panels = state.panels.get(workspaceId);
          if (!panels) return;
          state.panelViewPlanes.delete(panelId);
          state.panels.set(
            workspaceId,
            panels.map((panel) => {
              if (panel.id !== panelId) {
                return panel;
              }
              const nextLayerIds = new Set(panel.visibleLayerIds);
              nextLayerIds.delete(layerId);
              return { ...panel, visibleLayerIds: nextLayerIds };
            })
          );
        });
      },

      setPanelViewType: (workspaceId, panelId, viewType) => {
        set(state => {
          const panels = state.panels.get(workspaceId);
          if (!panels) return;
          state.panelViewPlanes.delete(panelId);
          state.panels.set(
            workspaceId,
            panels.map((panel) =>
              panel.id === panelId ? { ...panel, viewType } : panel
            )
          );
        });
      },

      setGlobalViewType: (workspaceId, viewType) => {
        set(state => {
          state.globalViewTypes.set(workspaceId, viewType);
          const panels = state.panels.get(workspaceId);
          if (panels) {
            panels.forEach((panel) => state.panelViewPlanes.delete(panel.id));
            state.panels.set(
              workspaceId,
              panels.map((panel) => ({ ...panel, viewType }))
            );
          }
        });
      },

      setLayout: (workspaceId, layout) => {
        set(state => {
          const panels = state.panels.get(workspaceId) ?? [];
          panels.forEach((panel) => state.panelViewPlanes.delete(panel.id));
          state.layouts.set(workspaceId, layout);
        });
      },

      getPanels: (workspaceId) => {
        return get().panels.get(workspaceId) ?? [];
      },

      getLayout: (workspaceId) => {
        return get().layouts.get(workspaceId) ?? 'row';
      },

      getGlobalViewType: (workspaceId) => {
        return get().globalViewTypes.get(workspaceId) ?? 'axial';
      },

      setPanelViewPlane: (panelId, viewPlane) => {
        set((state) => {
          if (viewPlane) {
            state.panelViewPlanes.set(panelId, viewPlane);
            return;
          }
          state.panelViewPlanes.delete(panelId);
        });
      },

      getPanelViewPlane: (panelId) => {
        return get().panelViewPlanes.get(panelId);
      },

      clearWorkspace: (workspaceId) => {
        set(state => {
          const panels = state.panels.get(workspaceId) ?? [];
          panels.forEach((panel) => state.panelViewPlanes.delete(panel.id));
          state.panels.delete(workspaceId);
          state.layouts.delete(workspaceId);
          state.globalViewTypes.delete(workspaceId);
          state.linkModes.delete(workspaceId);
          state.activePanelIds.delete(workspaceId);
          state.editScopes.delete(workspaceId);
        });
      },
    }))
  )
);
