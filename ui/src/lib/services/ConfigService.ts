/**
 * ConfigService - Service layer for application configuration
 * Manages user preferences, application settings, and plugin configuration
 */

import type { EventBus } from '$lib/events/EventBus';
import type { ValidationService } from '$lib/validation/ValidationService';
import { z } from 'zod';

// Configuration schemas
export const ThemeSchema = z.enum(['light', 'dark', 'auto']);
export const QualitySchema = z.enum(['low', 'medium', 'high', 'ultra']);
export const InterpolationSchema = z.enum(['nearest', 'linear', 'cubic']);

export const AppSettingsSchema = z.object({
  theme: ThemeSchema,
  language: z.string().default('en'),
  autoSave: z.boolean().default(true),
  autoSaveInterval: z.number().min(30).max(600).default(300), // seconds
  recentFilesLimit: z.number().min(5).max(50).default(10),
  defaultWorkspace: z.string().optional(),
  telemetry: z.boolean().default(false),
  developerMode: z.boolean().default(false)
});

export const RenderSettingsSchema = z.object({
  quality: QualitySchema,
  interpolation: InterpolationSchema,
  antialiasing: z.boolean().default(true),
  vsync: z.boolean().default(true),
  maxTextureSize: z.number().min(512).max(8192).default(2048),
  gpuMemoryLimit: z.number().min(256).max(16384).default(2048), // MB
  enableShaderCache: z.boolean().default(true),
  preferWebGPU: z.boolean().default(true)
});

export const ViewerSettingsSchema = z.object({
  crosshairVisible: z.boolean().default(true),
  crosshairColor: z.string().regex(/^#[0-9A-F]{6}$/i).default('#FF0000'),
  crosshairThickness: z.number().min(1).max(5).default(2),
  gridVisible: z.boolean().default(false),
  gridSpacing: z.number().min(1).max(100).default(10),
  showAnnotations: z.boolean().default(true),
  showOrientation: z.boolean().default(true),
  defaultColormap: z.string().default('grayscale'),
  defaultWindowLevel: z.object({
    window: z.number().default(255),
    level: z.number().default(127.5)
  }),
  mouseWheelBehavior: z.enum(['zoom', 'slice', 'windowLevel']).default('slice'),
  dragBehavior: z.enum(['pan', 'windowLevel', 'rotate']).default('pan')
});

export const KeybindingsSchema = z.record(z.string(), z.string());

export const PluginConfigSchema = z.record(z.string(), z.any());

export const ConfigSchema = z.object({
  version: z.string().default('1.0.0'),
  app: AppSettingsSchema,
  render: RenderSettingsSchema,
  viewer: ViewerSettingsSchema,
  keybindings: KeybindingsSchema,
  plugins: PluginConfigSchema,
  workspace: z.record(z.string(), z.any()).optional()
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type RenderSettings = z.infer<typeof RenderSettingsSchema>;
export type ViewerSettings = z.infer<typeof ViewerSettingsSchema>;
export type Keybindings = z.infer<typeof KeybindingsSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export interface ConfigServiceConfig {
  eventBus: EventBus;
  validator: ValidationService;
  storage?: Storage; // localStorage or alternative
}

export class ConfigService {
  private config: ConfigServiceConfig;
  private settings: Config;
  private storageKey = 'brainflow.config';
  private saveTimeout: number | null = null;

  constructor(config: ConfigServiceConfig) {
    this.config = config;
    this.settings = this.loadConfig();
    this.setupEventHandlers();
    this.applySettings();
  }

  private setupEventHandlers() {
    // Listen for system theme changes
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', (e) => {
        if (this.settings.app.theme === 'auto') {
          this.applyTheme();
        }
      });
    }
  }

  /**
   * Load configuration from storage
   */
  private loadConfig(): Config {
    try {
      const storage = this.config.storage || localStorage;
      const stored = storage.getItem(this.storageKey);
      
      if (stored) {
        const parsed = JSON.parse(stored);
        const validated = ConfigSchema.parse(parsed);
        return validated;
      }
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error);
    }
    
    // Return default config
    return ConfigSchema.parse({});
  }

  /**
   * Save configuration to storage
   */
  private saveConfig(immediate = false) {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    
    const save = () => {
      try {
        const storage = this.config.storage || localStorage;
        storage.setItem(this.storageKey, JSON.stringify(this.settings));
        this.config.eventBus.emit('config.saved', { timestamp: Date.now() });
      } catch (error) {
        console.error('Failed to save config:', error);
        this.config.eventBus.emit('config.save.failed', { error });
      }
    };
    
    if (immediate) {
      save();
    } else {
      // Debounce saves
      this.saveTimeout = window.setTimeout(save, 1000);
    }
  }

  /**
   * Apply current settings to the application
   */
  private applySettings() {
    this.applyTheme();
    this.applyRenderQuality();
    // Apply other settings as needed
  }

  private applyTheme() {
    const theme = this.getEffectiveTheme();
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
    this.config.eventBus.emit('config.theme.changed', { theme });
  }

  private applyRenderQuality() {
    this.config.eventBus.emit('config.render.changed', {
      quality: this.settings.render.quality,
      settings: this.settings.render
    });
  }

  private getEffectiveTheme(): 'light' | 'dark' {
    if (this.settings.app.theme === 'auto') {
      return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
    }
    return this.settings.app.theme;
  }

  /**
   ===============================================
   Public API
   ===============================================
   */

  /**
   * Get all configuration
   */
  getConfig(): Readonly<Config> {
    return this.settings;
  }

  /**
   * Get app settings
   */
  getAppSettings(): Readonly<AppSettings> {
    return this.settings.app;
  }

  /**
   * Update app settings
   */
  updateAppSettings(updates: Partial<AppSettings>) {
    try {
      const newSettings = AppSettingsSchema.parse({
        ...this.settings.app,
        ...updates
      });
      
      const oldSettings = this.settings.app;
      this.settings.app = newSettings;
      
      // Apply theme change immediately
      if (oldSettings.theme !== newSettings.theme) {
        this.applyTheme();
      }
      
      this.config.eventBus.emit('config.app.updated', {
        old: oldSettings,
        new: newSettings
      });
      
      this.saveConfig();
    } catch (error) {
      this.config.eventBus.emit('config.validation.failed', { error });
      throw error;
    }
  }

  /**
   * Get render settings
   */
  getRenderSettings(): Readonly<RenderSettings> {
    return this.settings.render;
  }

  /**
   * Update render settings
   */
  updateRenderSettings(updates: Partial<RenderSettings>) {
    try {
      const newSettings = RenderSettingsSchema.parse({
        ...this.settings.render,
        ...updates
      });
      
      const oldSettings = this.settings.render;
      this.settings.render = newSettings;
      
      this.applyRenderQuality();
      
      this.config.eventBus.emit('config.render.updated', {
        old: oldSettings,
        new: newSettings
      });
      
      this.saveConfig();
    } catch (error) {
      this.config.eventBus.emit('config.validation.failed', { error });
      throw error;
    }
  }

  /**
   * Get viewer settings
   */
  getViewerSettings(): Readonly<ViewerSettings> {
    return this.settings.viewer;
  }

  /**
   * Update viewer settings
   */
  updateViewerSettings(updates: Partial<ViewerSettings>) {
    try {
      const newSettings = ViewerSettingsSchema.parse({
        ...this.settings.viewer,
        ...updates
      });
      
      const oldSettings = this.settings.viewer;
      this.settings.viewer = newSettings;
      
      this.config.eventBus.emit('config.viewer.updated', {
        old: oldSettings,
        new: newSettings
      });
      
      this.saveConfig();
    } catch (error) {
      this.config.eventBus.emit('config.validation.failed', { error });
      throw error;
    }
  }

  /**
   * Get keybindings
   */
  getKeybindings(): Readonly<Keybindings> {
    return this.settings.keybindings;
  }

  /**
   * Update keybindings
   */
  updateKeybinding(action: string, key: string) {
    this.settings.keybindings[action] = key;
    
    this.config.eventBus.emit('config.keybinding.updated', {
      action,
      key
    });
    
    this.saveConfig();
  }

  /**
   * Reset keybindings to defaults
   */
  resetKeybindings() {
    this.settings.keybindings = this.getDefaultKeybindings();
    
    this.config.eventBus.emit('config.keybindings.reset', {});
    this.saveConfig();
  }

  /**
   * Get plugin configuration
   */
  getPluginConfig(pluginId: string): any {
    return this.settings.plugins[pluginId];
  }

  /**
   * Update plugin configuration
   */
  updatePluginConfig(pluginId: string, config: any) {
    this.settings.plugins[pluginId] = config;
    
    this.config.eventBus.emit('config.plugin.updated', {
      pluginId,
      config
    });
    
    this.saveConfig();
  }

  /**
   * Get workspace configuration
   */
  getWorkspaceConfig(): any {
    return this.settings.workspace || {};
  }

  /**
   * Update workspace configuration
   */
  updateWorkspaceConfig(config: any) {
    this.settings.workspace = config;
    
    this.config.eventBus.emit('config.workspace.updated', { config });
    this.saveConfig();
  }

  /**
   * Reset all settings to defaults
   */
  resetToDefaults() {
    this.settings = ConfigSchema.parse({});
    this.applySettings();
    
    this.config.eventBus.emit('config.reset', {});
    this.saveConfig(true);
  }

  /**
   * Export configuration
   */
  exportConfig(): string {
    return JSON.stringify(this.settings, null, 2);
  }

  /**
   * Import configuration
   */
  importConfig(configJson: string) {
    try {
      const parsed = JSON.parse(configJson);
      const validated = ConfigSchema.parse(parsed);
      
      this.settings = validated;
      this.applySettings();
      
      this.config.eventBus.emit('config.imported', {});
      this.saveConfig(true);
    } catch (error) {
      this.config.eventBus.emit('config.import.failed', { error });
      throw error;
    }
  }

  /**
   * Get default keybindings
   */
  private getDefaultKeybindings(): Keybindings {
    return {
      'file.open': 'Ctrl+O',
      'file.save': 'Ctrl+S',
      'file.close': 'Ctrl+W',
      'edit.undo': 'Ctrl+Z',
      'edit.redo': 'Ctrl+Shift+Z',
      'view.zoomIn': 'Ctrl+Plus',
      'view.zoomOut': 'Ctrl+Minus',
      'view.resetZoom': 'Ctrl+0',
      'view.toggleCrosshair': 'C',
      'view.toggleGrid': 'G',
      'navigation.nextSlice': 'Down',
      'navigation.previousSlice': 'Up',
      'navigation.firstSlice': 'Home',
      'navigation.lastSlice': 'End'
    };
  }

  /**
   * Dispose of the service
   */
  dispose() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveConfig(true); // Save immediately on dispose
    }
  }
}

// Factory function for dependency injection
export function createConfigService(config: ConfigServiceConfig): ConfigService {
  return new ConfigService(config);
}