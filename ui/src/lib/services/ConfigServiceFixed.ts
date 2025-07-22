/**
 * ConfigService - Configuration management without circular dependencies
 * Removed eventBus dependency to break circular dependency cycle
 */

import type { ValidationService } from '$lib/validation/ValidationService';

export interface ConfigServiceConfig {
	validator: ValidationService;
}

export interface ConfigValue {
	[key: string]: any;
}

export class ConfigService {
	private config: Map<string, ConfigValue> = new Map();
	private validator: ValidationService;

	constructor({ validator }: ConfigServiceConfig) {
		this.validator = validator;
		this.loadDefaultConfig();
	}

	/**
	 * Get a configuration value
	 */
	async get<T = any>(key: string, defaultValue?: T): Promise<T> {
		const parts = key.split('.');
		let current: any = this.config.get(parts[0]);

		for (let i = 1; i < parts.length && current; i++) {
			current = current[parts[i]];
		}

		return current !== undefined ? current : defaultValue;
	}

	/**
	 * Set a configuration value
	 */
	async set(key: string, value: any): Promise<void> {
		const parts = key.split('.');

		if (parts.length === 1) {
			this.config.set(key, value);
		} else {
			// Handle nested keys
			let current = this.config.get(parts[0]) || {};
			this.config.set(parts[0], current);

			let ref = current;
			for (let i = 1; i < parts.length - 1; i++) {
				if (!ref[parts[i]]) {
					ref[parts[i]] = {};
				}
				ref = ref[parts[i]];
			}

			ref[parts[parts.length - 1]] = value;
		}
	}

	/**
	 * Get all configuration
	 */
	getAll(): Record<string, ConfigValue> {
		const result: Record<string, ConfigValue> = {};
		for (const [key, value] of this.config) {
			result[key] = value;
		}
		return result;
	}

	/**
	 * Clear all configuration
	 */
	clear(): void {
		this.config.clear();
		this.loadDefaultConfig();
	}

	/**
	 * Load default configuration
	 */
	private loadDefaultConfig(): void {
		// Default configuration values
		this.config.set('app', {
			name: 'Brainflow',
			version: '2.0.0',
			debug: import.meta.env.DEV
		});

		this.config.set('gpu', {
			preferredBackend: 'webgpu',
			fallbackToWebGL: true,
			maxTextureSize: 4096
		});

		this.config.set('rendering', {
			defaultColormap: 'grayscale',
			defaultOpacity: 1.0,
			enableAntialiasing: true
		});

		this.config.set('ui', {
			theme: 'dark',
			showStatusBar: true,
			showToolbar: true
		});

		this.config.set('monitoring', {
			enabled: false,
			sampleRate: 1.0
		});

		this.config.set('resilient', {
			enableOfflineMode: true,
			enableCaching: true,
			maxCacheSize: 10
		});
	}
}

/**
 * Factory function to create ConfigService
 */
export function createConfigService(config: ConfigServiceConfig): ConfigService {
	return new ConfigService(config);
}
