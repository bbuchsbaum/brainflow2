/**
 * Plugin System Entry Point
 * Main exports and initialization for the Brainflow plugin system
 */

// Core plugin system exports
export { PluginManager, createPluginManager } from './PluginManager';
export { PluginMessageBus } from './PluginMessageBus';
export { PluginResourceManager, MemoryPool } from './PluginResourceManager';
export { PluginPerformanceMonitor } from './PluginPerformanceMonitor';
export { PluginAPIProvider } from './PluginAPI';
export { PluginRegistry } from './PluginRegistry';
export { PluginLoader, PluginValidator } from './PluginLoader';

// Types
export type * from './types';

// Plugin system factory
import type { EventBus } from '$lib/events/EventBus';
import type { PluginManagerConfig } from './types';
import { PluginManager } from './PluginManager';
import { PluginLoader, PluginValidator } from './PluginLoader';

/**
 * Create a complete plugin system instance
 */
export function createPluginSystem(
	eventBus: EventBus,
	config?: Partial<PluginManagerConfig>
): PluginManager {
	const defaultConfig: PluginManagerConfig = {
		pluginsDirectory: './plugins',
		enableHotReload: process.env.NODE_ENV === 'development',
		enablePerformanceMonitoring: true,
		defaultResourceLimits: {
			maxMemoryMB: 128,
			maxExecutionTimeMs: 30000,
			requiresGPU: false,
			requiresNetwork: false
		},
		circuitBreakerThreshold: 5,
		maxConcurrentLoads: 3
	};

	const finalConfig = { ...defaultConfig, ...config };

	// Create loader and validator
	const loader = new PluginLoader(finalConfig.enableHotReload);
	const validator = new PluginValidator();

	// Create plugin manager
	return new PluginManager(eventBus, finalConfig, loader, validator);
}

/**
 * Default plugin configuration for different environments
 */
export const PLUGIN_CONFIGS = {
	development: {
		enableHotReload: true,
		enablePerformanceMonitoring: true,
		circuitBreakerThreshold: 10, // More lenient in dev
		defaultResourceLimits: {
			maxMemoryMB: 256, // More memory in dev
			maxExecutionTimeMs: 60000, // Longer timeout in dev
			requiresGPU: false,
			requiresNetwork: false
		}
	},
	production: {
		enableHotReload: false,
		enablePerformanceMonitoring: true,
		circuitBreakerThreshold: 3, // Stricter in production
		defaultResourceLimits: {
			maxMemoryMB: 128,
			maxExecutionTimeMs: 15000, // Shorter timeout in production
			requiresGPU: false,
			requiresNetwork: false
		}
	},
	testing: {
		enableHotReload: false,
		enablePerformanceMonitoring: false, // Disable monitoring in tests
		circuitBreakerThreshold: 1,
		defaultResourceLimits: {
			maxMemoryMB: 64, // Less memory in tests
			maxExecutionTimeMs: 5000, // Short timeout in tests
			requiresGPU: false,
			requiresNetwork: false
		}
	}
} as const;

/**
 * Get plugin configuration for current environment
 */
export function getPluginConfigForEnvironment(): Partial<PluginManagerConfig> {
	const env = process.env.NODE_ENV;

	switch (env) {
		case 'development':
			return PLUGIN_CONFIGS.development;
		case 'production':
			return PLUGIN_CONFIGS.production;
		case 'test':
			return PLUGIN_CONFIGS.testing;
		default:
			return PLUGIN_CONFIGS.development;
	}
}

/**
 * Plugin system utilities
 */
export const PluginUtils = {
	/**
	 * Validate plugin manifest JSON
	 */
	validateManifestJSON(manifestJson: string): { valid: boolean; manifest?: any; error?: string } {
		try {
			const manifest = JSON.parse(manifestJson);
			const validator = new PluginValidator();
			const result = validator.validateManifest(manifest);

			return {
				valid: result.valid,
				manifest: result.valid ? manifest : undefined,
				error: result.valid ? undefined : result.errors.join(', ')
			};
		} catch (error) {
			return {
				valid: false,
				error: `Invalid JSON: ${(error as Error).message}`
			};
		}
	},

	/**
	 * Create a basic plugin manifest
	 */
	createBasicManifest(
		id: string,
		name: string,
		type: string,
		entrypoint: string,
		handles: string[]
	) {
		return {
			id,
			name,
			version: '1.0.0',
			compatibleCore: '^0.1.0',
			type,
			apiVersion: '0.1.1',
			entrypoint,
			handles,
			description: `${name} plugin for Brainflow`,
			author: 'Unknown'
		};
	},

	/**
	 * Generate plugin ID from name
	 */
	generatePluginId(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, '') // Remove invalid characters
			.replace(/\s+/g, '-') // Replace spaces with hyphens
			.replace(/-+/g, '-') // Replace multiple hyphens with single
			.replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
	}
};

/**
 * Plugin development helpers
 */
export const PluginDevHelpers = {
	/**
	 * Create a mock plugin context for testing
	 */
	createMockPluginContext(pluginId: string): any {
		return {
			pluginId,
			api: {
				core: {},
				getService: async () => null,
				emitEvent: async () => {},
				subscribeEvent: () => () => {},
				storage: {
					get: async () => null,
					set: async () => {},
					delete: async () => {},
					clear: async () => {},
					keys: async () => []
				},
				ui: {
					registerComponent: () => {},
					createPanel: async () => ({
						id: 'mock-panel',
						show: () => {},
						hide: () => {},
						close: () => {},
						resize: () => {}
					}),
					showNotification: () => {},
					addMenuItem: () => {}
				}
			},
			messageBus: {
				publish: async () => {},
				subscribe: () => () => {},
				createPrivateChannel: () => ({
					send: async () => {},
					onReceive: () => () => {}
				}),
				getPublicChannels: () => []
			},
			resources: {
				allocateMemory: () => null,
				releaseMemory: () => {},
				getMemoryUsage: () => ({ allocated: 0, used: 0, limit: 1000000 }),
				setExecutionTimeout: () => {},
				checkResourceLimits: () => ({ memoryOk: true, executionTimeOk: true, withinLimits: true })
			},
			logger: {
				debug: console.debug,
				info: console.info,
				warn: console.warn,
				error: console.error
			},
			config: {
				get: () => undefined,
				set: () => {},
				has: () => false,
				delete: () => {}
			}
		};
	},

	/**
	 * Create a test plugin manifest
	 */
	createTestManifest(overrides: Partial<any> = {}): any {
		return {
			id: 'test-plugin',
			name: 'Test Plugin',
			version: '1.0.0',
			compatibleCore: '^0.1.0',
			type: 'visualization',
			apiVersion: '0.1.1',
			entrypoint: 'dist/index.js',
			handles: ['test-data'],
			description: 'A test plugin for development',
			author: 'Test Author',
			permissions: [
				{
					type: 'api',
					scope: 'events',
					level: 'read'
				}
			],
			resources: {
				maxMemoryMB: 64,
				maxExecutionTimeMs: 5000,
				requiresGPU: false,
				requiresNetwork: false
			},
			...overrides
		};
	}
};

/**
 * Common plugin interfaces for specific types
 */
export const PluginInterfaces = {
	/**
	 * Standard loader plugin interface
	 */
	LoaderPlugin: {
		requiredMethods: ['canHandle', 'load'],
		optionalMethods: ['initialize', 'cleanup', 'getMetadata']
	},

	/**
	 * Standard visualization plugin interface
	 */
	VisualizationPlugin: {
		requiredMethods: ['render', 'getSupportedDataTypes'],
		optionalMethods: ['initialize', 'cleanup', 'resize', 'dispose', 'getOptions', 'setOptions']
	},

	/**
	 * Standard analysis plugin interface
	 */
	AnalysisPlugin: {
		requiredMethods: ['process', 'getInputTypes', 'getOutputTypes'],
		optionalMethods: ['initialize', 'cleanup', 'validate', 'getProgress']
	},

	/**
	 * Standard UI plugin interface
	 */
	UIPlugin: {
		requiredMethods: ['createComponent'],
		optionalMethods: ['initialize', 'cleanup', 'getComponentTypes']
	},

	/**
	 * Standard workflow plugin interface
	 */
	WorkflowPlugin: {
		requiredMethods: ['execute', 'getSteps'],
		optionalMethods: ['initialize', 'cleanup', 'validate', 'getProgress', 'pause', 'resume']
	},

	/**
	 * Standard integration plugin interface
	 */
	IntegrationPlugin: {
		requiredMethods: ['connect', 'disconnect'],
		optionalMethods: ['initialize', 'cleanup', 'isConnected', 'getStatus']
	}
};
