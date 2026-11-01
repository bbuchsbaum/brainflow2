/**
 * Which slice views the user has zoomed or panned, per workspace (QA
 * features 2026-10-31 §1). A zoomed view keeps its plane through slice steps,
 * layer changes and resizes; Fit clears the mark and refits it. The plane
 * itself lives in the view state; this only says "the user framed it".
 */
import { create } from 'zustand';
import type { ViewType } from '@/types/coordinates';

type ZoomedViews = Partial<Record<ViewType, true>>;

interface ViewZoomState {
  zoomed: Record<string, ZoomedViews>;
  markZoomed: (workspaceKey: string, viewType: ViewType) => void;
  clearZoomed: (workspaceKey: string, viewTypes?: readonly ViewType[]) => void;
}

export const useViewZoomStore = create<ViewZoomState>()((set) => ({
  zoomed: {},
  markZoomed: (workspaceKey, viewType) =>
    set((state) =>
      state.zoomed[workspaceKey]?.[viewType]
        ? state
        : {
            zoomed: {
              ...state.zoomed,
              [workspaceKey]: { ...state.zoomed[workspaceKey], [viewType]: true },
            },
          },
    ),
  clearZoomed: (workspaceKey, viewTypes) =>
    set((state) => {
      const current = state.zoomed[workspaceKey];
      if (!current) return state;
      if (!viewTypes) {
        const rest = { ...state.zoomed };
        delete rest[workspaceKey];
        return { zoomed: rest };
      }
      if (!viewTypes.some((viewType) => current[viewType])) return state;
      const next = { ...current };
      for (const viewType of viewTypes) delete next[viewType];
      return { zoomed: { ...state.zoomed, [workspaceKey]: next } };
    }),
}));

/** The zoomed views of a workspace (empty when none). */
export function zoomedViews(workspaceKey: string): ReadonlySet<ViewType> {
  const marks = useViewZoomStore.getState().zoomed[workspaceKey];
  return new Set(Object.keys(marks ?? {}) as ViewType[]);
}

export function isViewZoomed(workspaceKey: string, viewType: ViewType): boolean {
  return useViewZoomStore.getState().zoomed[workspaceKey]?.[viewType] === true;
}
