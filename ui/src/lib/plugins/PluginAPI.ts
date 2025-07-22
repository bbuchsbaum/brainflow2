/**
 * Plugin API Provider
 * Provides secure, permission-based access to core APIs for plugins
 */

import type { CoreApi } from '@brainflow/api';
import type { EventBus } from '$lib/events/EventBus';
import type {
	PluginAPI,
	PluginInstance,
	PluginPermission,
	PluginStorage,
	PluginUIAPI,
	PanelConfig,
	PanelHandle,
	NotificationConfig,
	MenuConfig
} from './types';
import type { PluginMessageBus } from './PluginMessageBus';
import type { PluginResourceManager } from './PluginResourceManager';
import { getService } from '$lib/di/Container';

export class PluginAPIProvider {
	private eventBus: EventBus;
	private messageBus: PluginMessageBus;
	private resourceManager: PluginResourceManager;
	private storageInstances = new Map<string, PluginStorageImpl>();
	private uiInstances = new Map<string, PluginUIImpl>();

	constructor(
		eventBus: EventBus,
		messageBus: PluginMessageBus,
		resourceManager: PluginResourceManager
	) {
		this.eventBus = eventBus;
		this.messageBus = messageBus;
		this.resourceManager = resourceManager;
	}

	/**
	 * Create a secure API interface for a plugin
	 */
	async createAPIForPlugin(instance: PluginInstance): Promise<PluginAPI> {
		const pluginId = instance.id;
		const permissions = instance.manifest.permissions || [];

		// Create filtered core API
		const coreApi = await this.createFilteredCoreAPI(permissions);

		// Create or get storage instance
		let storage = this.storageInstances.get(pluginId);
		if (!storage) {
			storage = new PluginStorageImpl(pluginId);
			this.storageInstances.set(pluginId, storage);
		}

		// Create or get UI instance
		let ui = this.uiInstances.get(pluginId);
		if (!ui) {
			ui = new PluginUIImpl(pluginId, this.eventBus);
			this.uiInstances.set(pluginId, ui);
		}

		return {
			core: coreApi,
			getService: this.createServiceAccessor(pluginId, permissions),
			emitEvent: this.createEventEmitter(pluginId, permissions),
			subscribeEvent: this.createEventSubscriber(pluginId, permissions),
			storage,
			ui
		};
	}

	/**
	 * Cleanup API resources for a plugin
	 */
	cleanupPlugin(pluginId: string): void {
		// Cleanup storage
		const storage = this.storageInstances.get(pluginId);
		if (storage) {
			storage.cleanup();
			this.storageInstances.delete(pluginId);
		}

		// Cleanup UI
		const ui = this.uiInstances.get(pluginId);
		if (ui) {
			ui.cleanup();
			this.uiInstances.delete(pluginId);
		}
	}

	// Private methods

	private async createFilteredCoreAPI(permissions: PluginPermission[]): Promise<Partial<CoreApi>> {
		const apiPermissions = permissions.filter((p) => p.type === 'api');

		if (apiPermissions.length === 0) {
			return {}; // No API access
		}

		// Get the core API
		const coreApi = await getService<CoreApi>('api');
		if (!coreApi) {
			return {};
		}

		const filteredAPI: Partial<CoreApi> = {};

		// Check each permission and expose corresponding API methods
		for (const permission of apiPermissions) {
			switch (permission.scope) {
				case 'filesystem':
					if (permission.level === 'read' || permission.level === 'execute') {
						// Expose read-only filesystem operations
						// Note: We would wrap these with additional security checks
					}
					break;

				case 'gpu':
					if (permission.level === 'read' || permission.level === 'execute') {
						// Expose GPU resource access (read-only)
						filteredAPI.supports_webgpu = coreApi.supports_webgpu;
					}
					break;

				case 'volumes':
					if (permission.level === 'read') {
						// Expose volume reading operations
						filteredAPI.load_file = this.wrapWithSecurity(coreApi.load_file, permission);
						filteredAPI.world_to_voxel = coreApi.world_to_voxel;
						filteredAPI.get_timeseries_matrix = coreApi.get_timeseries_matrix;
					}
					break;

				case 'rendering':
					if (permission.level === 'read' || permission.level === 'execute') {
						// Expose rendering operations
						filteredAPI.render_frame = coreApi.render_frame;
						filteredAPI.set_crosshair = coreApi.set_crosshair;
						filteredAPI.set_view_plane = coreApi.set_view_plane;
					}
					break;
			}
		}

		return filteredAPI;
	}

	private createServiceAccessor(
		pluginId: string,
		permissions: PluginPermission[]
	): (serviceName: string) => Promise<any | null> {
		return async (serviceName: string) => {
			// Check if plugin has permission to access this service
			const hasPermission = permissions.some(
				(p) => p.type === 'api' && (p.scope === serviceName || p.scope === '*')
			);

			if (!hasPermission) {
				console.warn(
					`Plugin ${pluginId} attempted to access service ${serviceName} without permission`
				);
				return null;
			}

			try {
				return await getService(serviceName);
			} catch (error) {
				console.error(`Error accessing service ${serviceName} for plugin ${pluginId}:`, error);
				return null;
			}
		};
	}

	private createEventEmitter(
		pluginId: string,
		permissions: PluginPermission[]
	): (eventName: string, payload: any) => Promise<void> {
		return async (eventName: string, payload: any) => {
			// Check permissions
			const hasPermission = permissions.some(
				(p) =>
					p.type === 'api' && p.scope === 'events' && (p.level === 'write' || p.level === 'execute')
			);

			if (!hasPermission) {
				throw new Error(`Plugin ${pluginId} does not have permission to emit events`);
			}

			// Validate event name (plugins can only emit plugin.* events)
			if (!eventName.startsWith('plugin.')) {
				throw new Error(`Plugin ${pluginId} can only emit events starting with 'plugin.'`);
			}

			// Add plugin context to payload
			const contextualPayload = {
				...payload,
				__pluginId: pluginId,
				__timestamp: new Date().toISOString()
			};

			this.eventBus.emit(eventName as any, contextualPayload);
		};
	}

	private createEventSubscriber(
		pluginId: string,
		permissions: PluginPermission[]
	): (eventName: string, handler: (payload: any) => void) => () => void {
		return (eventName: string, handler: (payload: any) => void) => {
			// Check permissions
			const hasPermission = permissions.some(
				(p) =>
					p.type === 'api' && p.scope === 'events' && (p.level === 'read' || p.level === 'execute')
			);

			if (!hasPermission) {
				throw new Error(`Plugin ${pluginId} does not have permission to subscribe to events`);
			}

			return this.eventBus.on(eventName as any, handler);
		};
	}

	private wrapWithSecurity<T extends (...args: any[]) => any>(
		fn: T,
		permission: PluginPermission
	): T {
		return ((...args: any[]) => {
			// Add security checks here based on permission level
			// For example, validate file paths for filesystem access
			if (permission.scope === 'filesystem') {
				const path = args[0];
				if (typeof path === 'string' && this.isPathAllowed(path)) {
					return fn(...args);
				} else {
					throw new Error('Access to this path is not allowed');
				}
			}

			return fn(...args);
		}) as T;
	}

	private isPathAllowed(path: string): boolean {
		// Implement path security checks
		// - No access to system directories
		// - No access to parent directories
		// - Only specific file types allowed

		const forbiddenPaths = [
			'/etc',
			'/usr',
			'/bin',
			'/sbin',
			'/System',
			'C:\\Windows',
			'C:\\Program Files'
		];

		const normalizedPath = path.toLowerCase();

		for (const forbidden of forbiddenPaths) {
			if (normalizedPath.startsWith(forbidden.toLowerCase())) {
				return false;
			}
		}

		// Check for directory traversal
		if (path.includes('..') || path.includes('~')) {
			return false;
		}

		return true;
	}
}

/**
 * Plugin storage implementation
 */
class PluginStorageImpl implements PluginStorage {
	private storage = new Map<string, any>();
	private pluginId: string;

	constructor(pluginId: string) {
		this.pluginId = pluginId;
		this.loadFromPersistentStorage();
	}

	async get<T>(key: string): Promise<T | null> {
		return this.storage.get(key) || null;
	}

	async set<T>(key: string, value: T): Promise<void> {
		this.storage.set(key, value);
		await this.saveToPersistentStorage();
	}

	async delete(key: string): Promise<void> {
		this.storage.delete(key);
		await this.saveToPersistentStorage();
	}

	async clear(): Promise<void> {
		this.storage.clear();
		await this.saveToPersistentStorage();
	}

	async keys(): Promise<string[]> {
		return Array.from(this.storage.keys());
	}

	cleanup(): void {
		this.storage.clear();
	}

	private loadFromPersistentStorage(): void {
		try {
			const stored = localStorage.getItem(`plugin-storage-${this.pluginId}`);
			if (stored) {
				const data = JSON.parse(stored);
				this.storage = new Map(Object.entries(data));
			}
		} catch (error) {
			console.error(`Error loading storage for plugin ${this.pluginId}:`, error);
		}
	}

	private async saveToPersistentStorage(): Promise<void> {
		try {
			const data = Object.fromEntries(this.storage);
			localStorage.setItem(`plugin-storage-${this.pluginId}`, JSON.stringify(data));
		} catch (error) {
			console.error(`Error saving storage for plugin ${this.pluginId}:`, error);
		}
	}
}

/**
 * Plugin UI API implementation
 */
class PluginUIImpl implements PluginUIAPI {
	private pluginId: string;
	private eventBus: EventBus;
	private registeredComponents = new Set<string>();
	private createdPanels = new Set<string>();

	constructor(pluginId: string, eventBus: EventBus) {
		this.pluginId = pluginId;
		this.eventBus = eventBus;
	}

	registerComponent(name: string, component: any): void {
		const componentName = `plugin-${this.pluginId}-${name}`;

		// Register with the global component registry
		this.eventBus.emit('ui.component.register' as any, {
			name: componentName,
			component,
			pluginId: this.pluginId
		});

		this.registeredComponents.add(componentName);
	}

	async createPanel(config: PanelConfig): Promise<PanelHandle> {
		const panelId = `plugin-panel-${this.pluginId}-${Date.now()}`;

		// Create panel through the UI system
		this.eventBus.emit('ui.panel.create' as any, {
			id: panelId,
			pluginId: this.pluginId,
			config
		});

		this.createdPanels.add(panelId);

		return new PluginPanelHandle(panelId, this.eventBus);
	}

	showNotification(notification: NotificationConfig): void {
		this.eventBus.emit('notification.show' as any, {
			...notification,
			source: `Plugin: ${this.pluginId}`
		});
	}

	addMenuItem(menu: MenuConfig): void {
		this.eventBus.emit('ui.menu.add' as any, {
			...menu,
			pluginId: this.pluginId
		});
	}

	cleanup(): void {
		// Cleanup registered components
		for (const componentName of this.registeredComponents) {
			this.eventBus.emit('ui.component.unregister' as any, {
				name: componentName,
				pluginId: this.pluginId
			});
		}

		// Cleanup created panels
		for (const panelId of this.createdPanels) {
			this.eventBus.emit('ui.panel.destroy' as any, {
				id: panelId,
				pluginId: this.pluginId
			});
		}

		this.registeredComponents.clear();
		this.createdPanels.clear();
	}
}

/**
 * Plugin panel handle implementation
 */
class PluginPanelHandle implements PanelHandle {
	constructor(
		public readonly id: string,
		private eventBus: EventBus
	) {}

	show(): void {
		this.eventBus.emit('ui.panel.show' as any, { id: this.id });
	}

	hide(): void {
		this.eventBus.emit('ui.panel.hide' as any, { id: this.id });
	}

	close(): void {
		this.eventBus.emit('ui.panel.close' as any, { id: this.id });
	}

	resize(size: { width?: number; height?: number }): void {
		this.eventBus.emit('ui.panel.resize' as any, { id: this.id, size });
	}
}
