/**
 * Config Schema - Standalone config validation for bootstrap
 * This file has no dependencies and can be imported at application startup
 */
import { z } from 'zod';

// Theme and quality enums
export const ThemeSchema = z.enum(['light', 'dark', 'auto']);
export const QualitySchema = z.enum(['low', 'medium', 'high', 'ultra']);
export const InterpolationSchema = z.enum(['nearest', 'linear', 'cubic']);

// App settings schema
export const AppSettingsSchema = z.object({
	theme: ThemeSchema.default('auto'),
	language: z.string().default('en'),
	autoSave: z.boolean().default(true),
	autoSaveInterval: z.number().min(30).max(600).default(300), // seconds
	recentFilesLimit: z.number().min(5).max(50).default(10),
	defaultWorkspace: z.string().optional(),
	telemetry: z.boolean().default(false),
	developerMode: z.boolean().default(false)
});

// Render settings schema
export const RenderSettingsSchema = z.object({
	quality: QualitySchema.default('medium'),
	interpolation: InterpolationSchema.default('linear'),
	antialiasing: z.boolean().default(true),
	vsync: z.boolean().default(true),
	maxTextureSize: z.number().min(512).max(8192).default(2048),
	gpuMemoryLimit: z.number().min(256).max(16384).default(2048), // MB
	enableShaderCache: z.boolean().default(true),
	preferWebGPU: z.boolean().default(true)
});

// Viewer settings schema
export const ViewerSettingsSchema = z.object({
	crosshairVisible: z.boolean().default(true),
	crosshairColor: z
		.string()
		.regex(/^#[0-9A-F]{6}$/i)
		.default('#FF0000'),
	crosshairThickness: z.number().min(1).max(5).default(2),
	gridVisible: z.boolean().default(false),
	gridSpacing: z.number().min(1).max(100).default(10),
	showAnnotations: z.boolean().default(true),
	showOrientation: z.boolean().default(true),
	defaultColormap: z.string().default('grayscale'),
	defaultWindowLevel: z
		.object({
			window: z.number().default(255),
			level: z.number().default(127.5)
		})
		.default({ window: 255, level: 127.5 }),
	mouseWheelBehavior: z.enum(['zoom', 'slice', 'windowLevel']).default('slice'),
	dragBehavior: z.enum(['pan', 'windowLevel', 'rotate']).default('pan')
});

// Keybindings and plugin schemas
export const KeybindingsSchema = z.record(z.string(), z.string()).default({
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
});

export const PluginConfigSchema = z.record(z.string(), z.any()).default({});

// Main config schema
export const ConfigSchema = z.object({
	version: z.string().default('1.0.0'),
	app: AppSettingsSchema.default({}),
	render: RenderSettingsSchema.default({}),
	viewer: ViewerSettingsSchema.default({}),
	keybindings: KeybindingsSchema.default({}),
	plugins: PluginConfigSchema.default({}),
	workspace: z.record(z.string(), z.any()).optional()
});

// Type exports
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type RenderSettings = z.infer<typeof RenderSettingsSchema>;
export type ViewerSettings = z.infer<typeof ViewerSettingsSchema>;
export type Keybindings = z.infer<typeof KeybindingsSchema>;
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Validate and normalize config with defaults
 * This function is used at bootstrap time before services are initialized
 */
export function validateConfig(rawConfig: unknown): Config {
	try {
		if (!rawConfig || typeof rawConfig !== 'object') {
			// No config provided - use defaults
			return ConfigSchema.parse({});
		}

		// Parse and validate config with defaults applied
		return ConfigSchema.parse(rawConfig);
	} catch (error) {
		console.warn('Invalid config provided, using defaults:', error);
		// Fall back to defaults if validation fails
		return ConfigSchema.parse({});
	}
}

/**
 * Load config from localStorage and validate
 */
export function loadAndValidateConfig(storageKey = 'brainflow.config'): Config {
	try {
		const stored = localStorage.getItem(storageKey);
		if (stored) {
			const parsed = JSON.parse(stored);
			return validateConfig(parsed);
		}
	} catch (error) {
		console.warn('Failed to load config from storage, using defaults:', error);
	}

	// Return default config - pass empty object to get schema defaults
	return validateConfig({});
}
