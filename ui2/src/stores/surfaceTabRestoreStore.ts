/**
 * The surface tabs to bring back on relaunch, as placeholders
 * (qa-features-2026-10-31 §9, QA 2026-10-30 F15).
 *
 * Surface tabs live only in the GoldenLayout tree and are keyed by backend
 * surface handles, which do not survive a relaunch, and nothing is loaded at
 * launch. So each surface tab is remembered by what it showed: its title and
 * the sources of its surfaces (a file, or a TemplateFlow template). On
 * relaunch each one comes back as a placeholder tab with a Reload button.
 *
 * Written by GoldenLayoutRoot from the live layout (`stateChanged`); read once
 * at startup.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SurfaceTabSource =
  | { kind: 'file'; path: string }
  | {
      kind: 'template';
      /** `templateflow://<space>_<geometry>_<hemisphere>`, as the surface was keyed. */
      path: string;
      space: string;
      geometryType: string;
      hemisphere: string;
    };

export interface SavedSurfaceTab {
  /** The tab's surface view id (per-view settings are keyed by it). */
  surfaceViewId: string;
  title: string;
  sources: SurfaceTabSource[];
}

interface SurfaceTabRestoreState {
  tabs: SavedSurfaceTab[];
  /**
   * The centre strip's tab order (`ws:<workspaceId>` / `sv:<surfaceViewId>`),
   * so relaunch puts view, tool and surface tabs back where they were.
   */
  order: string[];
  setTabs: (tabs: SavedSurfaceTab[]) => void;
  setOrder: (order: string[]) => void;
}

export const useSurfaceTabRestoreStore = create<SurfaceTabRestoreState>()(
  persist(
    (set, get) => ({
      tabs: [],
      order: [],
      setTabs: (tabs) => {
        // Called on every layout change: write only a real difference.
        if (JSON.stringify(get().tabs) === JSON.stringify(tabs)) return;
        set({ tabs });
      },
      setOrder: (order) => {
        const current = get().order;
        if (current.length === order.length && current.every((key, i) => key === order[i])) return;
        set({ order });
      },
    }),
    {
      name: 'brainflow2-surface-tabs',
      version: 1,
      partialize: (state) => ({ tabs: state.tabs, order: state.order }),
    },
  ),
);
