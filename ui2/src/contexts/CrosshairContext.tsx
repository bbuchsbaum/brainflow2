/**
 * CrosshairContext
 * 
 * Thin wrapper around crosshairSettingsStore for backward compatibility.
 * New code should use the Zustand store directly.
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { useCrosshairSettingsStore, MEDICAL_COLOR_PRESETS, type CrosshairSettings, type ColorPreset } from '@/stores/crosshairSettingsStore';

interface CrosshairContextValue {
  settings: CrosshairSettings;
  updateSettings: (updates: Partial<CrosshairSettings>) => void;
  resetSettings: () => void;
  toggleVisibility: () => void;
  colorPresets: readonly ColorPreset[];
  isLoading: boolean;
}

const CrosshairContext = createContext<CrosshairContextValue | undefined>(undefined);

export function CrosshairProvider({ children }: { children: ReactNode }) {
  // Use the Zustand store for all state and actions
  const settings = useCrosshairSettingsStore(state => state.settings);
  const isLoading = useCrosshairSettingsStore(state => state.isLoading);
  const updateSettings = useCrosshairSettingsStore(state => state.updateSettings);
  const resetSettings = useCrosshairSettingsStore(state => state.resetSettings);
  const toggleVisibility = useCrosshairSettingsStore(state => state.toggleVisibility);
  
  const value: CrosshairContextValue = {
    settings,
    updateSettings,
    resetSettings,
    toggleVisibility,
    colorPresets: MEDICAL_COLOR_PRESETS,
    isLoading
  };
  
  return (
    <CrosshairContext.Provider value={value}>
      {children}
    </CrosshairContext.Provider>
  );
}

export function useCrosshairSettings() {
  const context = useContext(CrosshairContext);
  if (!context) {
    throw new Error('useCrosshairSettings must be used within CrosshairProvider');
  }
  return context;
}

// Helper hook for getting effective settings for a specific view
// This is now deprecated - use useCrosshairSettingsStore directly
export function useViewCrosshairSettings(viewType?: 'axial' | 'sagittal' | 'coronal') {
  const getViewSettings = useCrosshairSettingsStore(state => state.getViewSettings);
  
  // Debug: Track when hook updates
  React.useEffect(() => {
    const settings = getViewSettings(viewType);
    console.log('[useViewCrosshairSettings] Hook updated for', viewType, 'with settings:', settings);
  }, [viewType, getViewSettings]);
  
  return getViewSettings(viewType);
}

// Re-export types for backward compatibility
export { MEDICAL_COLOR_PRESETS } from '@/stores/crosshairSettingsStore';
export type { CrosshairSettings, ColorPreset } from '@/stores/crosshairSettingsStore';