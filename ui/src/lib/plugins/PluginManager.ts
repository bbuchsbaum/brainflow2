/**
 * Core Plugin Manager
 * Manages the complete lifecycle of plugins including loading, activation, deactivation, and cleanup
 */

import type { EventBus } from '$lib/events/EventBus';
import type {
	PluginInstance,
	PluginManifest,
	PluginState,
	PluginManagerConfig,
	PluginLoader,
	PluginValidator,
	PluginContext,
	PluginResources,
	PluginPerformanceStats,
	PluginError,
	PluginErrorCode,
	ResourceRequirements
} from './types';
import { PluginError as PluginErrorClass } from './types';
import { PluginRegistry } from './PluginRegistry';
import { PluginMessageBus } from './PluginMessageBus';
import { PluginResourceManager } from './PluginResourceManager';
import { PluginPerformanceMonitor } from './PluginPerformanceMonitor';
import { PluginAPIProvider } from './PluginAPI';

export class PluginManager {
	private instances = new Map<string, PluginInstance>();
	private registry: PluginRegistry;
	private messageBus: PluginMessageBus;
	private resourceManager: PluginResourceManager;
	private performanceMonitor: PluginPerformanceMonitor;
	private apiProvider: PluginAPIProvider;
	private loader: PluginLoader;
	private validator: PluginValidator;
	private eventBus: EventBus;
	private config: PluginManagerConfig;
	private isShuttingDown = false;

	constructor(
		eventBus: EventBus,
		config: PluginManagerConfig,
		loader: PluginLoader,
		validator: PluginValidator
	) {
		this.eventBus = eventBus;
		this.config = config;
		this.loader = loader;
		this.validator = validator;

		// Initialize subsystems
		this.registry = new PluginRegistry();
		this.messageBus = new PluginMessageBus(eventBus);
		this.resourceManager = new PluginResourceManager(config.defaultResourceLimits);
		this.performanceMonitor = new PluginPerformanceMonitor(
			config.circuitBreakerThreshold,
			eventBus
		);
		this.apiProvider = new PluginAPIProvider(eventBus, this.messageBus, this.resourceManager);
	}

	/**
	 * Initialize the plugin manager
	 */
	async initialize(): Promise<void> {
		// Setup performance monitoring
		this.performanceMonitor.onCircuitBreakerTrip((pluginId) => {
			this.handleCircuitBreakerTrip(pluginId);
		});

		// Setup cleanup on shutdown
		if (typeof window !== 'undefined') {
			window.addEventListener('beforeunload', () => {
				this.shutdown();
			});
		}

		// Discover and register available plugins
		await this.discoverPlugins();
	}

	/**
	 * Load a plugin from its manifest
	 */
	async loadPlugin(manifest: PluginManifest): Promise<PluginInstance> {
		const pluginId = manifest.id;

		// Check if already loaded
		if (this.instances.has(pluginId)) {
			throw new PluginErrorClass(
				`Plugin ${pluginId} is already loaded`,
				pluginId,
				PluginErrorCode.LOAD_FAILED
			);
		}

		// Validate manifest
		const validation = this.validator.validateManifest(manifest);
		if (!validation.valid) {
			throw new PluginErrorClass(
				`Plugin validation failed: ${validation.errors.join(', ')}`,
				pluginId,
				PluginErrorCode.VALIDATION_FAILED,
				validation
			);
		}

		// Check dependencies
		const depValidation = this.validator.validateDependencies(
			manifest,
			Array.from(this.instances.values())
		);
		if (!depValidation.valid) {
			throw new PluginErrorClass(
				`Plugin dependencies not met: ${depValidation.errors.join(', ')}`,
				pluginId,
				PluginErrorCode.DEPENDENCY_MISSING,
				depValidation
			);
		}

		// Create plugin instance
		const instance: PluginInstance = {
			id: pluginId,
			manifest,
			state: PluginState.LOADING,
			resources: this.createEmptyResources(),
			performance: this.createEmptyPerformanceStats(),
			createdAt: new Date()
		};

		this.instances.set(pluginId, instance);
		this.emitLifecycleEvent('plugin.loading', { pluginId });

		try {
			// Load the plugin module
			const startTime = performance.now();
			const module = await this.loader.load(manifest);
			const loadTime = performance.now() - startTime;

			// Update instance
			instance.module = module;
			instance.state = PluginState.LOADED;
			instance.performance!.loadTime = loadTime;

			this.emitLifecycleEvent('plugin.loaded', { pluginId, manifest });
			return instance;
		} catch (error) {
			instance.state = PluginState.ERROR;
			instance.performance!.lastError = error as Error;
			this.emitLifecycleEvent('plugin.error', { pluginId, error: error as Error });

			throw new PluginErrorClass(
				`Failed to load plugin ${pluginId}: ${(error as Error).message}`,
				pluginId,
				PluginErrorCode.LOAD_FAILED,
				error
			);
		}
	}

	/**
	 * Activate a loaded plugin
	 */
	async activatePlugin(pluginId: string): Promise<void> {
		const instance = this.instances.get(pluginId);
		if (!instance) {
			throw new PluginErrorClass(
				`Plugin ${pluginId} not found`,
				pluginId,
				PluginErrorCode.LOAD_FAILED
			);
		}

		if (instance.state !== PluginState.LOADED) {
			throw new PluginErrorClass(
				`Plugin ${pluginId} is not in loaded state (current: ${instance.state})`,
				pluginId,
				PluginErrorCode.INIT_FAILED
			);
		}

		// Check circuit breaker
		if (this.performanceMonitor.isCircuitOpen(pluginId)) {
			throw new PluginErrorClass(
				`Plugin ${pluginId} circuit breaker is open`,
				pluginId,
				PluginErrorCode.CIRCUIT_BREAKER_OPEN
			);
		}

		instance.state = PluginState.INITIALIZING;
		this.emitLifecycleEvent('plugin.initializing', { pluginId });

		try {
			const startTime = performance.now();

			// Create plugin context
			const context = await this.createPluginContext(instance);
			instance.context = context;

			// Initialize the plugin
			if (instance.module.initialize) {
				await this.executeWithTimeout(
					() => instance.module.initialize(context),
					instance.manifest.resources?.maxExecutionTimeMs || 5000
				);
			}

			const initTime = performance.now() - startTime;
			instance.performance!.initTime = initTime;
			instance.state = PluginState.ACTIVE;
			instance.lastActivated = new Date();

			this.performanceMonitor.recordExecution(pluginId, initTime);
			this.emitLifecycleEvent('plugin.activated', { pluginId });
		} catch (error) {
			instance.state = PluginState.ERROR;
			instance.performance!.lastError = error as Error;
			instance.performance!.errorCount++;

			this.performanceMonitor.recordError(pluginId);
			this.emitLifecycleEvent('plugin.error', { pluginId, error: error as Error });

			throw new PluginErrorClass(
				`Failed to activate plugin ${pluginId}: ${(error as Error).message}`,
				pluginId,
				PluginErrorCode.INIT_FAILED,
				error
			);
		}
	}

	/**
	 * Deactivate an active plugin
	 */
	async deactivatePlugin(pluginId: string): Promise<void> {
		const instance = this.instances.get(pluginId);
		if (!instance || instance.state !== PluginState.ACTIVE) {
			return; // Already deactivated or not found
		}

		instance.state = PluginState.DEACTIVATING;

		try {
			// Call plugin cleanup if available
			if (instance.module.cleanup) {
				await this.executeWithTimeout(
					() => instance.module.cleanup(),
					3000 // Short timeout for cleanup
				);
			}

			// Cleanup resources
			await this.cleanupPluginResources(instance);

			instance.state = PluginState.LOADED;
			this.emitLifecycleEvent('plugin.deactivated', { pluginId });
		} catch (error) {
			instance.state = PluginState.ERROR;
			instance.performance!.lastError = error as Error;
			this.emitLifecycleEvent('plugin.error', { pluginId, error: error as Error });
		}
	}

	/**
	 * Unload a plugin completely
	 */
	async unloadPlugin(pluginId: string): Promise<void> {
		const instance = this.instances.get(pluginId);
		if (!instance) {
			return; // Already unloaded
		}

		// Deactivate first if active
		if (instance.state === PluginState.ACTIVE) {
			await this.deactivatePlugin(pluginId);
		}

		try {
			// Unload from loader
			await this.loader.unload(pluginId);

			// Remove from instances
			this.instances.delete(pluginId);

			this.emitLifecycleEvent('plugin.unloaded', { pluginId });
		} catch (error) {
			console.error(`Error unloading plugin ${pluginId}:`, error);
		}
	}

	/**
	 * Get plugin instance
	 */
	getPlugin(pluginId: string): PluginInstance | null {
		return this.instances.get(pluginId) || null;
	}

	/**
	 * Get all plugins
	 */
	getAllPlugins(): PluginInstance[] {
		return Array.from(this.instances.values());
	}

	/**
	 * Get plugins by type
	 */
	getPluginsByType(type: string): PluginInstance[] {
		return Array.from(this.instances.values()).filter(
			(instance) => instance.manifest.type === type
		);
	}

	/**
	 * Get active plugins
	 */
	getActivePlugins(): PluginInstance[] {
		return Array.from(this.instances.values()).filter(
			(instance) => instance.state === PluginState.ACTIVE
		);
	}

	/**
	 * Reload a plugin (for hot reloading)
	 */
	async reloadPlugin(pluginId: string): Promise<void> {
		if (!this.config.enableHotReload) {
			throw new Error('Hot reloading is disabled');
		}

		const instance = this.instances.get(pluginId);
		if (!instance) {
			throw new Error(`Plugin ${pluginId} not found`);
		}

		const wasActive = instance.state === PluginState.ACTIVE;

		// Deactivate and unload
		await this.deactivatePlugin(pluginId);
		await this.unloadPlugin(pluginId);

		try {
			// Reload the module
			const newModule = await this.loader.reload(pluginId);

			// Load again
			await this.loadPlugin(instance.manifest);

			// Reactivate if it was active
			if (wasActive) {
				await this.activatePlugin(pluginId);
			}
		} catch (error) {
			console.error(`Failed to reload plugin ${pluginId}:`, error);
			throw error;
		}
	}

	/**
	 * Shutdown the plugin manager
	 */
	async shutdown(): Promise<void> {
		if (this.isShuttingDown) {
			return;
		}

		this.isShuttingDown = true;

		// Deactivate all plugins
		const deactivatePromises = this.getActivePlugins().map((instance) =>
			this.deactivatePlugin(instance.id).catch((error) =>
				console.error(`Error deactivating plugin ${instance.id}:`, error)
			)
		);

		await Promise.all(deactivatePromises);

		// Unload all plugins
		const unloadPromises = Array.from(this.instances.keys()).map((pluginId) =>
			this.unloadPlugin(pluginId).catch((error) =>
				console.error(`Error unloading plugin ${pluginId}:`, error)
			)
		);

		await Promise.all(unloadPromises);

		// Cleanup subsystems
		this.messageBus.shutdown();
		this.resourceManager.shutdown();
		this.performanceMonitor.shutdown();
	}

	/**
	 * Get plugin registry
	 */
	getRegistry(): PluginRegistry {
		return this.registry;
	}

	/**
	 * Get plugin message bus
	 */
	getMessageBus(): PluginMessageBus {
		return this.messageBus;
	}

	/**
	 * Get performance monitor
	 */
	getPerformanceMonitor(): PluginPerformanceMonitor {
		return this.performanceMonitor;
	}

	// Private methods

	private async discoverPlugins(): Promise<void> {
		// Implementation would scan plugin directory and register manifests
		// This would be environment-specific (Node.js vs browser)
		console.log('Plugin discovery not implemented yet');
	}

	private async createPluginContext(instance: PluginInstance): Promise<PluginContext> {
		const api = await this.apiProvider.createAPIForPlugin(instance);

		return {
			pluginId: instance.id,
			api,
			messageBus: this.messageBus.createPluginInterface(instance.id),
			resources: this.resourceManager.createPluginInterface(instance.id),
			logger: this.createPluginLogger(instance.id),
			config: this.createPluginConfig(instance.id)
		};
	}

	private createPluginLogger(pluginId: string) {
		return {
			debug: (message: string, data?: any) =>
				console.debug(`[Plugin:${pluginId}] ${message}`, data),
			info: (message: string, data?: any) => console.info(`[Plugin:${pluginId}] ${message}`, data),
			warn: (message: string, data?: any) => console.warn(`[Plugin:${pluginId}] ${message}`, data),
			error: (message: string, error?: Error, data?: any) =>
				console.error(`[Plugin:${pluginId}] ${message}`, error, data)
		};
	}

	private createPluginConfig(pluginId: string) {
		const configMap = new Map<string, any>();

		return {
			get: <T>(key: string, defaultValue?: T): T => {
				return configMap.get(key) ?? defaultValue;
			},
			set: <T>(key: string, value: T): void => {
				configMap.set(key, value);
			},
			has: (key: string): boolean => {
				return configMap.has(key);
			},
			delete: (key: string): void => {
				configMap.delete(key);
			}
		};
	}

	private createEmptyResources(): PluginResources {
		return {
			memoryBlocks: [],
			openChannels: [],
			eventSubscriptions: [],
			uiElements: [],
			timers: []
		};
	}

	private createEmptyPerformanceStats(): PluginPerformanceStats {
		return {
			loadTime: 0,
			initTime: 0,
			avgExecutionTime: 0,
			totalExecutions: 0,
			errorCount: 0,
			memoryLeaks: 0
		};
	}

	private async cleanupPluginResources(instance: PluginInstance): Promise<void> {
		const resources = instance.resources!;

		// Cleanup memory blocks
		for (const block of resources.memoryBlocks) {
			this.resourceManager.releaseMemory(block);
		}

		// Cleanup channels
		for (const channel of resources.openChannels) {
			this.messageBus.unsubscribeAll(instance.id, channel);
		}

		// Cleanup event subscriptions
		for (const subscription of resources.eventSubscriptions) {
			// Remove event listeners
		}

		// Cleanup timers
		for (const timerId of resources.timers) {
			clearTimeout(timerId);
		}

		// Reset resources
		instance.resources = this.createEmptyResources();
	}

	private async executeWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Operation timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			operation()
				.then((result) => {
					clearTimeout(timeout);
					resolve(result);
				})
				.catch((error) => {
					clearTimeout(timeout);
					reject(error);
				});
		});
	}

	private handleCircuitBreakerTrip(pluginId: string): void {
		console.warn(`Circuit breaker tripped for plugin ${pluginId}, deactivating`);
		this.deactivatePlugin(pluginId).catch((error) =>
			console.error(`Error deactivating plugin after circuit breaker trip:`, error)
		);
	}

	private emitLifecycleEvent(eventName: string, payload: any): void {
		this.eventBus.emit(eventName as any, payload);
	}
}

/**
 * Factory function to create a PluginManager instance
 */
export function createPluginManager(
	eventBus: EventBus,
	config: PluginManagerConfig,
	loader: PluginLoader,
	validator: PluginValidator
): PluginManager {
	return new PluginManager(eventBus, config, loader, validator);
}
