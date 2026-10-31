/**
 * The user's module choices (Settings › Modules and Settings › Top bar),
 * persisted as `brainflow-modules`.
 *
 * - `enabled` holds explicit switches only. A module the user never switched
 *   follows its stage default (experimental off, preview and stable on), so a
 *   promotion reaches users who kept the default.
 * - `pinned` lists the tools shown as buttons in the top bar.
 * - `startup` is "restore last session" (the default, qa-design-decisions
 *   2026-10-30 §1) or a fixed list of tab types opened at launch.
 * - `appliedProposals` remembers which manifest defaults (`pin:<tool>`,
 *   `startup:<tool>`) were applied once, so a module never re-pins itself
 *   after the user removed it.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type StartupMode = 'restore' | 'fixed';

/** The view type a fixed startup list begins with (same as a new view). */
export const DEFAULT_STARTUP_TABS: readonly string[] = ['orthogonal-flexible'];

export interface ModuleSettingsData {
  enabled: Record<string, boolean>;
  pinned: string[];
  startup: { mode: StartupMode; tabs: string[] };
  appliedProposals: string[];
}

export interface ModuleSettingsState extends ModuleSettingsData {
  setModuleEnabled: (moduleId: string, enabled: boolean) => void;
  setToolPinned: (toolType: string, pinned: boolean) => void;
  setStartupMode: (mode: StartupMode) => void;
  setStartupTab: (type: string, included: boolean, order: readonly string[]) => void;
  /** Apply manifest proposals that were never applied before. */
  applyProposals: (proposals: { pinned: readonly string[]; openAtStartup: readonly string[] }) => void;
}

export const MODULE_SETTINGS_KEY = 'brainflow-modules';
export const MODULE_SETTINGS_VERSION = 1;

function defaults(): ModuleSettingsData {
  return {
    enabled: {},
    pinned: [],
    startup: { mode: 'restore', tabs: [...DEFAULT_STARTUP_TABS] },
    appliedProposals: [],
  };
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string'))] : [];

/** Coerce any persisted payload into a valid settings shape. Exported for tests. */
export function sanitizeModuleSettings(raw: unknown): ModuleSettingsData {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<Record<keyof ModuleSettingsData, unknown>>;
  const enabled: Record<string, boolean> = {};
  if (value.enabled && typeof value.enabled === 'object' && !Array.isArray(value.enabled)) {
    for (const [id, on] of Object.entries(value.enabled as Record<string, unknown>)) {
      if (typeof on === 'boolean') enabled[id] = on;
    }
  }
  const startup = (value.startup ?? {}) as { mode?: unknown; tabs?: unknown };
  return {
    enabled,
    pinned: stringList(value.pinned),
    startup: {
      mode: startup.mode === 'fixed' ? 'fixed' : 'restore',
      tabs: Array.isArray(startup.tabs) ? stringList(startup.tabs) : base.startup.tabs,
    },
    appliedProposals: stringList(value.appliedProposals),
  };
}

/**
 * Persist migration. Version 1 is the first shape; anything else (including
 * a payload from a newer build) is sanitized rather than trusted.
 */
export function migrateModuleSettings(persisted: unknown, version: number): ModuleSettingsData {
  void version;
  return sanitizeModuleSettings(persisted);
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export const useModuleSettingsStore = create<ModuleSettingsState>()(
  persist(
    (set, get) => ({
      ...defaults(),

      setModuleEnabled: (moduleId, enabled) => {
        if (get().enabled[moduleId] === enabled) return;
        set({ enabled: { ...get().enabled, [moduleId]: enabled } });
      },

      setToolPinned: (toolType, pinned) => {
        const current = get().pinned;
        if (current.includes(toolType) === pinned) return;
        set({ pinned: pinned ? [...current, toolType] : current.filter((t) => t !== toolType) });
      },

      setStartupMode: (mode) => {
        if (get().startup.mode === mode) return;
        set({ startup: { ...get().startup, mode } });
      },

      setStartupTab: (type, included, order) => {
        const current = get().startup.tabs;
        if (current.includes(type) === included) return;
        const next = included ? [...current, type] : current.filter((t) => t !== type);
        // Keep the configured order of the candidates (views first, then tools).
        const rank = (t: string) => {
          const i = order.indexOf(t);
          return i === -1 ? order.length : i;
        };
        next.sort((a, b) => rank(a) - rank(b));
        if (sameList(next, current)) return;
        set({ startup: { ...get().startup, tabs: next } });
      },

      applyProposals: ({ pinned, openAtStartup }) => {
        const state = get();
        const applied = new Set(state.appliedProposals);
        const nextPinned = [...state.pinned];
        const nextTabs = [...state.startup.tabs];
        let changed = false;
        for (const tool of pinned) {
          const key = `pin:${tool}`;
          if (applied.has(key)) continue;
          applied.add(key);
          changed = true;
          if (!nextPinned.includes(tool)) nextPinned.push(tool);
        }
        for (const tool of openAtStartup) {
          const key = `startup:${tool}`;
          if (applied.has(key)) continue;
          applied.add(key);
          changed = true;
          if (!nextTabs.includes(tool)) nextTabs.push(tool);
        }
        if (!changed) return;
        set({
          pinned: nextPinned,
          startup: { ...state.startup, tabs: nextTabs },
          appliedProposals: [...applied],
        });
      },
    }),
    {
      name: MODULE_SETTINGS_KEY,
      version: MODULE_SETTINGS_VERSION,
      migrate: migrateModuleSettings,
      partialize: (state): ModuleSettingsData => ({
        enabled: state.enabled,
        pinned: state.pinned,
        startup: state.startup,
        appliedProposals: state.appliedProposals,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizeModuleSettings(persisted) }),
    },
  ),
);
