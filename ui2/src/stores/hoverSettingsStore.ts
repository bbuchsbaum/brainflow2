/**
 * Hover Settings Store
 *
 * Global settings for the hover information display system.
 * Controls which providers are enabled and how hover info is displayed.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface HoverSettings {
  /** Master toggle for all hover info */
  enabled: boolean;

  /** Set of enabled provider IDs */
  enabledProviders: string[];

  /** Show hover info in floating tooltip near cursor */
  showInTooltip: boolean;

  /** Show hover info in status bar at bottom */
  showInStatusBar: boolean;

  /** Throttle interval for mouse move events (ms) */
  throttleMs: number;

  /**
   * Providers this install has already offered (enabled or not). A stored
   * choice for a known provider always wins; only a genuinely new, local
   * provider is switched on by default.
   */
  knownProviders: string[];
}

interface HoverSettingsState extends HoverSettings {
  // Actions
  setEnabled: (enabled: boolean) => void;
  toggleProvider: (providerId: string) => void;
  setProviderEnabled: (providerId: string, enabled: boolean) => void;
  setShowInTooltip: (show: boolean) => void;
  setShowInStatusBar: (show: boolean) => void;
  setThrottleMs: (ms: number) => void;
  isProviderEnabled: (providerId: string) => boolean;
  reset: () => void;
}

/** Local providers, on by default. */
export const DEFAULT_ENABLED_PROVIDERS = ['coords', 'intensity', 'atlas', 'sparkline'] as const;

/**
 * Providers that send data off the machine. Never enabled by default or by a
 * migration: the user opts in (Neurosynth sends the cursor's MNI coordinates
 * to neurosynth.org).
 */
export const NETWORK_PROVIDERS = ['neurosynth'] as const;

const ALL_PROVIDERS: readonly string[] = [...DEFAULT_ENABLED_PROVIDERS, ...NETWORK_PROVIDERS];

/**
 * Stored providers plus defaults the user has never been offered. A
 * provider in `known` keeps the stored choice (on or off); a network
 * provider is never added.
 */
export function mergeEnabledProviders(
  enabledProviders: readonly string[] | undefined,
  knownProviders: readonly string[] | undefined,
): string[] {
  const known = new Set(knownProviders ?? []);
  const added = DEFAULT_ENABLED_PROVIDERS.filter((id) => !known.has(id));
  return Array.from(new Set([...(enabledProviders ?? []), ...added]));
}

const DEFAULT_SETTINGS: HoverSettings = {
  enabled: true,
  enabledProviders: [...DEFAULT_ENABLED_PROVIDERS],
  showInTooltip: true,
  showInStatusBar: true,
  throttleMs: 40,
  knownProviders: [...ALL_PROVIDERS],
};

export const useHoverSettingsStore = create<HoverSettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      setEnabled: (enabled) => set({ enabled }),

      toggleProvider: (providerId) => {
        const current = get().enabledProviders;
        const isEnabled = current.includes(providerId);
        set({
          enabledProviders: isEnabled
            ? current.filter((id) => id !== providerId)
            : [...current, providerId],
        });
      },

      setProviderEnabled: (providerId, enabled) => {
        const current = get().enabledProviders;
        const isCurrentlyEnabled = current.includes(providerId);

        if (enabled && !isCurrentlyEnabled) {
          set({ enabledProviders: [...current, providerId] });
        } else if (!enabled && isCurrentlyEnabled) {
          set({ enabledProviders: current.filter((id) => id !== providerId) });
        }
      },

      setShowInTooltip: (show) => set({ showInTooltip: show }),

      setShowInStatusBar: (show) => set({ showInStatusBar: show }),

      setThrottleMs: (ms) => set({ throttleMs: Math.max(10, Math.min(200, ms)) }),

      isProviderEnabled: (providerId) => {
        const state = get();
        return state.enabled && state.enabledProviders.includes(providerId);
      },

      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'brainflow-hover-settings',
      version: 3,
      migrate: (persistedState, version) => {
        const state = persistedState as Partial<HoverSettings> | undefined;
        if (!state) return DEFAULT_SETTINGS;
        // Before v3 every provider, Neurosynth included, was forced on at
        // each load, so a stored "on" for a network provider was never the
        // user's choice: it starts off (opt-in). Local providers keep their
        // stored setting, and every current provider becomes known.
        const network = new Set<string>(NETWORK_PROVIDERS);
        const enabled =
          version < 3
            ? (state.enabledProviders ?? [...DEFAULT_ENABLED_PROVIDERS]).filter((id) => !network.has(id))
            : (state.enabledProviders ?? [...DEFAULT_ENABLED_PROVIDERS]);
        const known = version < 3 ? [...ALL_PROVIDERS] : (state.knownProviders ?? []);
        return {
          ...DEFAULT_SETTINGS,
          ...state,
          enabledProviders: version < 2 ? mergeEnabledProviders(enabled, []) : enabled,
          knownProviders: known,
        };
      },
      // On every load (no migration): offer genuinely new local providers
      // once, never re-enable one the user turned off.
      merge: (persisted, current) => {
        const state = (persisted ?? {}) as Partial<HoverSettings>;
        const known = state.knownProviders ?? [];
        return {
          ...current,
          ...state,
          enabledProviders: mergeEnabledProviders(state.enabledProviders, known),
          knownProviders: Array.from(new Set([...known, ...ALL_PROVIDERS])),
        };
      },
    }
  )
);

// Selectors for performance (avoid re-renders when unrelated state changes)
export const selectHoverEnabled = (state: HoverSettingsState) => state.enabled;
export const selectEnabledProviders = (state: HoverSettingsState) => state.enabledProviders;
export const selectShowInTooltip = (state: HoverSettingsState) => state.showInTooltip;
export const selectShowInStatusBar = (state: HoverSettingsState) => state.showInStatusBar;
export const selectThrottleMs = (state: HoverSettingsState) => state.throttleMs;
