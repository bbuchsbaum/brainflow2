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

const DEFAULT_SETTINGS: HoverSettings = {
  enabled: true,
  enabledProviders: ['coords', 'intensity', 'atlas'],
  showInTooltip: true,
  showInStatusBar: true,
  throttleMs: 40,
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
      version: 1,
    }
  )
);

// Selectors for performance (avoid re-renders when unrelated state changes)
export const selectHoverEnabled = (state: HoverSettingsState) => state.enabled;
export const selectEnabledProviders = (state: HoverSettingsState) => state.enabledProviders;
export const selectShowInTooltip = (state: HoverSettingsState) => state.showInTooltip;
export const selectShowInStatusBar = (state: HoverSettingsState) => state.showInStatusBar;
export const selectThrottleMs = (state: HoverSettingsState) => state.throttleMs;
