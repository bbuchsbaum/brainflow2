/**
 * Crosshair Settings Store
 * 
 * Global store for crosshair appearance settings using Zustand.
 * This ensures settings work across GoldenLayout's isolated React roots.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

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

interface CrosshairSettingsStore {
  settings: CrosshairSettings;
  isLoading: boolean;
  
  // Actions
  updateSettings: (updates: Partial<CrosshairSettings>) => void;
  resetSettings: () => void;
  toggleVisibility: () => void;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  
  // Helper to get effective settings for a view
  getViewSettings: (viewType?: 'axial' | 'sagittal' | 'coronal') => CrosshairSettings;
}

export const useCrosshairSettingsStore = create<CrosshairSettingsStore>()(
  devtools(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      isLoading: true,
      
      updateSettings: (updates: Partial<CrosshairSettings>) => {
        console.log('[CrosshairSettingsStore] updateSettings called with:', updates);
        
        set((state) => {
          const newSettings = { ...state.settings, ...updates };
          console.log('[CrosshairSettingsStore] New settings:', newSettings);
          
          // Save to localStorage immediately (will be replaced with Tauri later)
          try {
            localStorage.setItem('crosshair-settings', JSON.stringify(newSettings));
          } catch (error) {
            console.error('Failed to save crosshair settings:', error);
          }
          
          // Also update ViewStateStore if visibility changed
          if (updates.visible !== undefined) {
            const { useViewStateStore } = require('@/stores/viewStateStore');
            useViewStateStore.getState().setCrosshairVisible(updates.visible);
          }
          
          return { settings: newSettings };
        });
      },
      
      resetSettings: () => {
        set({ settings: DEFAULT_SETTINGS });
        
        // Update ViewStateStore
        const { useViewStateStore } = require('@/stores/viewStateStore');
        useViewStateStore.getState().setCrosshairVisible(DEFAULT_SETTINGS.visible);
        
        // Save to localStorage
        try {
          localStorage.setItem('crosshair-settings', JSON.stringify(DEFAULT_SETTINGS));
        } catch (error) {
          console.error('Failed to save crosshair settings:', error);
        }
      },
      
      toggleVisibility: () => {
        const currentVisible = get().settings.visible;
        get().updateSettings({ visible: !currentVisible });
      },
      
      loadSettings: async () => {
        try {
          // TODO: Implement Tauri persistence
          // For now, just use localStorage
          const stored = localStorage.getItem('crosshair-settings');
          if (stored) {
            const parsed = JSON.parse(stored) as CrosshairSettings;
            set({ settings: parsed, isLoading: false });
            
            // Sync with ViewStateStore
            const { useViewStateStore } = require('@/stores/viewStateStore');
            useViewStateStore.getState().setCrosshairVisible(parsed.visible);
          } else {
            set({ isLoading: false });
          }
        } catch (error) {
          console.warn('Failed to load crosshair settings:', error);
          set({ isLoading: false });
        }
      },
      
      saveSettings: async () => {
        const settings = get().settings;
        try {
          // TODO: Implement Tauri persistence
          // For now, use localStorage
          localStorage.setItem('crosshair-settings', JSON.stringify(settings));
        } catch (error) {
          console.error('Failed to save crosshair settings:', error);
        }
      },
      
      getViewSettings: (viewType?: 'axial' | 'sagittal' | 'coronal') => {
        const settings = get().settings;
        
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
    }),
    {
      name: 'crosshair-settings'
    }
  )
);

// Initialize settings on module load
if (typeof window !== 'undefined') {
  useCrosshairSettingsStore.getState().loadSettings();
}