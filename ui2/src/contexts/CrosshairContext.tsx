/**
 * CrosshairContext
 * 
 * Unified state management for crosshair settings across the application.
 * Provides crosshair appearance settings and persistence.
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useViewStateStore } from '@/stores/viewStateStore';

// Color presets for medical imaging
export const MEDICAL_COLOR_PRESETS = [
  { name: 'Green (Default)', value: '#00ff00' },
  { name: 'Red', value: '#ff0000' },
  { name: 'Yellow', value: '#ffff00' },
  { name: 'Cyan', value: '#00ffff' },
  { name: 'Magenta', value: '#ff00ff' },
  { name: 'White', value: '#ffffff' },
  { name: 'Orange', value: '#ff8800' },
  { name: 'Blue', value: '#0088ff' }
] as const;

export interface ColorPreset {
  name: string;
  value: string;
}

export interface CrosshairSettings {
  // Basic visibility
  visible: boolean;
  
  // Active crosshair appearance
  activeColor: string;
  activeThickness: number;
  activeStyle: 'solid' | 'dashed' | 'dotted';
  
  // Mirror crosshair settings
  showMirror: boolean;
  mirrorColor: string;
  mirrorOpacity: number;
  mirrorThickness: number;
  mirrorStyle: 'solid' | 'dashed' | 'dotted';
  
  // Smart features
  autoContrast: boolean;
  snapToVoxel: boolean;
  showCoordinates: boolean;
  coordinateFormat: 'mm' | 'voxel' | 'both';
  
  // Per-view overrides (optional)
  viewOverrides?: {
    axial?: Partial<CrosshairViewSettings>;
    sagittal?: Partial<CrosshairViewSettings>;
    coronal?: Partial<CrosshairViewSettings>;
  };
}

interface CrosshairViewSettings {
  visible: boolean;
  color: string;
  thickness: number;
  style: 'solid' | 'dashed' | 'dotted';
}

const DEFAULT_SETTINGS: CrosshairSettings = {
  visible: true,
  
  // Active crosshair
  activeColor: '#00ff00',
  activeThickness: 1,
  activeStyle: 'dashed',
  
  // Mirror crosshair
  showMirror: true,
  mirrorColor: '#808080',
  mirrorOpacity: 0.3,
  mirrorThickness: 1,
  mirrorStyle: 'dashed',
  
  // Smart features
  autoContrast: false,
  snapToVoxel: true,
  showCoordinates: true,
  coordinateFormat: 'mm',
  
  // No per-view overrides by default
  viewOverrides: undefined
};

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
  const [settings, setSettings] = useState<CrosshairSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const setViewCrosshairVisible = useViewStateStore(state => state.setCrosshairVisible);
  
  // Load settings from Tauri on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // TODO: Implement Tauri persistence
        // For now, just use default settings
        setViewCrosshairVisible(DEFAULT_SETTINGS.visible);
        
        // Try to load from localStorage as temporary solution
        const stored = localStorage.getItem('crosshair-settings');
        if (stored) {
          const parsed = JSON.parse(stored) as CrosshairSettings;
          setSettings(parsed);
          setViewCrosshairVisible(parsed.visible);
        }
      } catch (error) {
        console.warn('Failed to load crosshair settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadSettings();
  }, [setViewCrosshairVisible]);
  
  // Save settings when they change
  useEffect(() => {
    if (!isLoading) {
      const saveSettings = async () => {
        try {
          // TODO: Implement Tauri persistence
          // For now, use localStorage
          localStorage.setItem('crosshair-settings', JSON.stringify(settings));
        } catch (error) {
          console.error('Failed to save crosshair settings:', error);
        }
      };
      
      // Debounce saves
      const timer = setTimeout(saveSettings, 500);
      return () => clearTimeout(timer);
    }
  }, [settings, isLoading]);
  
  const updateSettings = (updates: Partial<CrosshairSettings>) => {
    setSettings(prev => {
      const newSettings = { ...prev, ...updates };
      
      // Sync visibility with view state if it changed
      if (updates.visible !== undefined) {
        setViewCrosshairVisible(updates.visible);
      }
      
      return newSettings;
    });
  };
  
  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    setViewCrosshairVisible(DEFAULT_SETTINGS.visible);
  };
  
  const toggleVisibility = () => {
    updateSettings({ visible: !settings.visible });
  };
  
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
export function useViewCrosshairSettings(viewType?: 'axial' | 'sagittal' | 'coronal') {
  const { settings } = useCrosshairSettings();
  
  if (!viewType) {
    return settings;
  }
  
  // Apply view-specific overrides if they exist
  const overrides = settings.viewOverrides?.[viewType];
  if (overrides) {
    return {
      ...settings,
      visible: overrides.visible ?? settings.visible,
      activeColor: overrides.color ?? settings.activeColor,
      activeThickness: overrides.thickness ?? settings.activeThickness,
      activeStyle: overrides.style ?? settings.activeStyle
    };
  }
  
  return settings;
}