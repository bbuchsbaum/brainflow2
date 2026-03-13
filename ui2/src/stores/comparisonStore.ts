/**
 * Comparison Store
 * Manages state for multi-panel comparison workspace
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { enableMapSet } from 'immer';
import type { ComparisonPanelConfig, ComparisonLayout } from '@/types/comparison';

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
}

interface ComparisonActions {
  /** Initialize comparison workspace with one panel per layer */
  initFromLayers: (workspaceId: string, layerIds: string[], layerLabels?: Map<string, string>) => void;

  /** Initialize comparison from existing layers + a new volume */
  initFromCurrentAndNewLayer: (workspaceId: string, existingLayerIds: string[], newLayerId: string, newLabel?: string) => void;

  /** Add a panel with specified layers */
  addPanel: (workspaceId: string, layerIds: string[], label?: string) => void;

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

  /** Clear a workspace's comparison config */
  clearWorkspace: (workspaceId: string) => void;
}

export const useComparisonStore = create<ComparisonState & ComparisonActions>()(
  subscribeWithSelector(
    immer((set, get) => ({
      panels: new Map(),
      layouts: new Map(),
      globalViewTypes: new Map(),

      initFromLayers: (workspaceId, layerIds, layerLabels) => {
        set(state => {
          const panels: ComparisonPanelConfig[] = layerIds.map((id, i) => ({
            id: nextPanelId(),
            label: layerLabels?.get(id) ?? `Panel ${i + 1}`,
            visibleLayerIds: new Set([id]),
            viewType: 'axial' as const,
          }));
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
          state.panels.set(workspaceId, panels);
          state.layouts.set(workspaceId, 'row');
          state.globalViewTypes.set(workspaceId, 'axial');
        });
      },

      addPanel: (workspaceId, layerIds, label) => {
        set(state => {
          const existing = state.panels.get(workspaceId) ?? [];
          existing.push({
            id: nextPanelId(),
            label: label ?? `Panel ${existing.length + 1}`,
            visibleLayerIds: new Set(layerIds),
            viewType: state.globalViewTypes.get(workspaceId) ?? 'axial',
          });
          state.panels.set(workspaceId, existing);
        });
      },

      removePanel: (workspaceId, panelId) => {
        set(state => {
          const existing = state.panels.get(workspaceId);
          if (!existing) return;
          const idx = existing.findIndex(p => p.id === panelId);
          if (idx >= 0) existing.splice(idx, 1);
        });
      },

      addLayerToPanel: (workspaceId, panelId, layerId) => {
        set(state => {
          const panels = state.panels.get(workspaceId);
          if (!panels) return;
          const panel = panels.find(p => p.id === panelId);
          if (panel) panel.visibleLayerIds.add(layerId);
        });
      },

      removeLayerFromPanel: (workspaceId, panelId, layerId) => {
        set(state => {
          const panels = state.panels.get(workspaceId);
          if (!panels) return;
          const panel = panels.find(p => p.id === panelId);
          if (panel) panel.visibleLayerIds.delete(layerId);
        });
      },

      setPanelViewType: (workspaceId, panelId, viewType) => {
        set(state => {
          const panels = state.panels.get(workspaceId);
          if (!panels) return;
          const panel = panels.find(p => p.id === panelId);
          if (panel) panel.viewType = viewType;
        });
      },

      setGlobalViewType: (workspaceId, viewType) => {
        set(state => {
          state.globalViewTypes.set(workspaceId, viewType);
          const panels = state.panels.get(workspaceId);
          if (panels) {
            for (const panel of panels) {
              panel.viewType = viewType;
            }
          }
        });
      },

      setLayout: (workspaceId, layout) => {
        set(state => {
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

      clearWorkspace: (workspaceId) => {
        set(state => {
          state.panels.delete(workspaceId);
          state.layouts.delete(workspaceId);
          state.globalViewTypes.delete(workspaceId);
        });
      },
    }))
  )
);
