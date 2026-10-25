/**
 * Crosshair Settings Store
 * 
 * Global store for crosshair appearance settings using Zustand.
 * This ensures settings work across GoldenLayout's isolated React roots.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// Colour presets. Curated to survive tissue and stay clear of both the shell
// accent (amber) and the overlay colormap primaries (pure red / hot ramps).
// The custom picker still allows any colour.
export const MEDICAL_COLOR_PRESETS = [
  { name: 'Green (default)', value: '#5fe0a0' },
  { name: 'Cyan', value: '#4fd1e8' },
  { name: 'Blue', value: '#60a5fa' },
  { name: 'Magenta', value: '#e879f9' },
  { name: 'Orange', value: '#ff7a1a' },
  { name: 'Yellow', value: '#facc15' },
  { name: 'Bright green', value: '#00ff00' },
  { name: 'White', value: '#ffffff' }
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
  /**
   * Keep a small radius around the crosshair point clear of the line so the
   * cursor voxel stays visible. Stroke styling only. Optional so payloads
   * persisted before it existed stay valid; missing means on.
   */
  centerGap?: boolean;
  
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

/** Default crosshair colour; mirrors the `--bf-crosshair` token in theme.css. */
export const DEFAULT_CROSSHAIR_COLOR = '#5fe0a0';

/** Default active-crosshair core width in canvas pixels. */
export const DEFAULT_CROSSHAIR_THICKNESS = 2;

export const DEFAULT_SETTINGS: CrosshairSettings = {
  visible: true,

  // Active crosshair — dashed green line, 2px core over a 1px-a-side dark
  // halo, so the colour (not the halo) dominates over bright tissue. It is
  // deliberately not the shell accent: the crosshair must not read as chrome.
  activeColor: DEFAULT_CROSSHAIR_COLOR,
  activeThickness: DEFAULT_CROSSHAIR_THICKNESS,
  activeStyle: 'dashed',
  centerGap: true,

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

/**
 * Persisted-settings schema version. Version 2 introduced the green default;
 * version 3 the 2px default core. Anything persisted before 2 carries no
 * version.
 */
export const CROSSHAIR_SETTINGS_VERSION = 3;
const VERSION_KEY = '_version';

/** Colours that were shipped as the default before version 2. */
const LEGACY_DEFAULT_COLORS = new Set(['#e0a63f', '#e07830']);

/** Active thickness that was shipped as the default before version 3. */
const LEGACY_DEFAULT_THICKNESS = 1;

/**
 * Migrate persisted crosshair settings. Conservative: only an unversioned
 * (pre-v2) payload whose active colour is exactly a former default is moved to
 * the new default colour, and only a pre-v3 payload whose active thickness is
 * exactly the former 1px default is moved to the new 2px default. Anything
 * else is left as-is, so a user who later picks Amber or 1px explicitly keeps it.
 */
export function migrateCrosshairSettings(raw: unknown): CrosshairSettings {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const { [VERSION_KEY]: version, ...rest } = record;
  const settings = { ...DEFAULT_SETTINGS, ...(rest as Partial<CrosshairSettings>) };
  const versionNumber = typeof version === 'number' ? version : 0;
  const isLegacy = versionNumber < 2;
  if (versionNumber < 3 && settings.activeThickness === LEGACY_DEFAULT_THICKNESS) {
    settings.activeThickness = DEFAULT_CROSSHAIR_THICKNESS;
  }
  if (
    isLegacy &&
    typeof settings.activeColor === 'string' &&
    LEGACY_DEFAULT_COLORS.has(settings.activeColor.toLowerCase())
  ) {
    settings.activeColor = DEFAULT_CROSSHAIR_COLOR;
  }
  return settings;
}

function persistSettings(settings: CrosshairSettings) {
  localStorage.setItem(
    'crosshair-settings',
    JSON.stringify({ ...settings, [VERSION_KEY]: CROSSHAIR_SETTINGS_VERSION })
  );
}

/**
 * Mirror crosshair visibility into the view-state store on a later tick.
 * A dynamic import avoids the circular static import (and the CommonJS
 * `require`, which is not defined in the browser's ES module runtime).
 */
function syncViewStateVisibility(visible: boolean) {
  void import('@/stores/viewStateStore')
    .then(({ useViewStateStore }) => {
      useViewStateStore.getState().setCrosshairVisible(visible);
    })
    .catch(() => {
      /* view state not available (e.g. isolated tests) */
    });
}

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
            persistSettings(newSettings);
          } catch (error) {
            console.error('Failed to save crosshair settings:', error);
          }
          
          // Also update ViewStateStore if visibility changed, but defer to next tick
          if (updates.visible !== undefined) {
            syncViewStateVisibility(updates.visible);
          }
          
          return { settings: newSettings };
        });
      },
      
      resetSettings: () => {
        set({ settings: { ...DEFAULT_SETTINGS } });
        
        // Update ViewStateStore (defer to next tick)
        syncViewStateVisibility(DEFAULT_SETTINGS.visible);
        
        // Save to localStorage
        try {
          persistSettings(DEFAULT_SETTINGS);
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
          // Persistence via localStorage (works in Tauri WebView across restarts)
          const stored = localStorage.getItem('crosshair-settings');
          if (stored) {
            const parsed = migrateCrosshairSettings(JSON.parse(stored));
            set({ settings: parsed, isLoading: false });
            // Re-persist so the payload is versioned and migration runs once.
            try {
              persistSettings(parsed);
            } catch {
              /* storage unavailable; in-memory settings still apply */
            }
            
            // Sync with ViewStateStore (defer to next tick)
            syncViewStateVisibility(parsed.visible);
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
          // Persistence via localStorage (works in Tauri WebView across restarts)
          persistSettings(settings);
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
