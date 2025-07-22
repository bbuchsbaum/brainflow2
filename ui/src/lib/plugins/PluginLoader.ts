/**
 * Plugin Loader
 * Handles dynamic loading and unloading of plugin modules
 */

import type { PluginLoader as IPluginLoader, PluginManifest, ValidationResult } from './types';

export class PluginLoader implements IPluginLoader {
	private loadedModules = new Map<string, any>();
	private moduleCache = new Map<string, any>();
	private enableHotReload: boolean;

	constructor(enableHotReload = false) {
		this.enableHotReload = enableHotReload;
	}

	/**
	 * Check if this loader can handle the given manifest
	 */
	canLoad(manifest: PluginManifest): boolean {
		// Check if entrypoint is a valid JavaScript file
		if (!manifest.entrypoint || !manifest.entrypoint.endsWith('.js')) {
			return false;
		}

		// Check if manifest has required fields
		return !!(manifest.id && manifest.name && manifest.version && manifest.type);
	}

	/**
	 * Load a plugin module
	 */
	async load(manifest: PluginManifest): Promise<any> {
		const pluginId = manifest.id;

		if (this.loadedModules.has(pluginId)) {
			throw new Error(`Plugin ${pluginId} is already loaded`);
		}

		try {
			// Construct the module path
			const modulePath = this.resolveModulePath(manifest);

			// Load the module
			const module = await this.loadModule(modulePath, pluginId);

			// Validate the loaded module
			this.validateModule(module, manifest);

			// Store the loaded module
			this.loadedModules.set(pluginId, module);

			return module;
		} catch (error) {
			console.error(`Failed to load plugin ${pluginId}:`, error);
			throw error;
		}
	}

	/**
	 * Unload a plugin module
	 */
	async unload(pluginId: string): Promise<void> {
		const module = this.loadedModules.get(pluginId);
		if (!module) {
			return; // Already unloaded
		}

		try {
			// Call module cleanup if available
			if (module.cleanup && typeof module.cleanup === 'function') {
				await module.cleanup();
			}

			// Remove from loaded modules
			this.loadedModules.delete(pluginId);

			// Clear from cache if hot reload is disabled
			if (!this.enableHotReload) {
				this.moduleCache.delete(pluginId);
			}
		} catch (error) {
			console.error(`Error during plugin unload for ${pluginId}:`, error);
			throw error;
		}
	}

	/**
	 * Reload a plugin module (for hot reloading)
	 */
	async reload(pluginId: string): Promise<any> {
		if (!this.enableHotReload) {
			throw new Error('Hot reloading is disabled');
		}

		// Get the current module to access its manifest
		const currentModule = this.loadedModules.get(pluginId);
		if (!currentModule || !currentModule.__manifest) {
			throw new Error(`Cannot reload plugin ${pluginId}: no loaded module found`);
		}

		const manifest = currentModule.__manifest;

		try {
			// Unload the current module
			await this.unload(pluginId);

			// Clear from cache to force reload
			this.moduleCache.delete(pluginId);

			// Load the fresh module
			return await this.load(manifest);
		} catch (error) {
			console.error(`Failed to reload plugin ${pluginId}:`, error);
			throw error;
		}
	}

	/**
	 * Get list of loaded plugin IDs
	 */
	getLoadedPlugins(): string[] {
		return Array.from(this.loadedModules.keys());
	}

	/**
	 * Check if a plugin is loaded
	 */
	isLoaded(pluginId: string): boolean {
		return this.loadedModules.has(pluginId);
	}

	/**
	 * Get loaded module for a plugin
	 */
	getModule(pluginId: string): any | null {
		return this.loadedModules.get(pluginId) || null;
	}

	// Private methods

	private resolveModulePath(manifest: PluginManifest): string {
		// In a real implementation, this would resolve plugin paths
		// For now, we'll assume plugins are in a plugins directory
		return `/plugins/${manifest.id}/${manifest.entrypoint}`;
	}

	private async loadModule(modulePath: string, pluginId: string): Promise<any> {
		// Check cache first
		if (this.moduleCache.has(pluginId)) {
			return this.moduleCache.get(pluginId);
		}

		let module: any;

		if (typeof window !== 'undefined') {
			// Browser environment - use dynamic import
			module = await this.loadModuleBrowser(modulePath);
		} else {
			// Node.js environment
			module = await this.loadModuleNode(modulePath);
		}

		// Cache the module
		this.moduleCache.set(pluginId, module);

		return module;
	}

	private async loadModuleBrowser(modulePath: string): Promise<any> {
		try {
			// Dynamic import in browser
			const module = await import(modulePath);
			return module.default || module;
		} catch (error) {
			// If dynamic import fails, try loading as script
			return this.loadModuleAsScript(modulePath);
		}
	}

	private async loadModuleAsScript(modulePath: string): Promise<any> {
		return new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.type = 'module';
			script.src = modulePath;

			script.onload = () => {
				// In a real implementation, we'd need a way to get the module exports
				// This is a simplified version
				const module = (window as any).__pluginExports || {};
				delete (window as any).__pluginExports;
				resolve(module);
			};

			script.onerror = (error) => {
				reject(new Error(`Failed to load script: ${modulePath}`));
			};

			document.head.appendChild(script);
		});
	}

	private async loadModuleNode(modulePath: string): Promise<any> {
		// Node.js environment
		try {
			// Clear require cache for hot reloading
			if (this.enableHotReload && require.cache[modulePath]) {
				delete require.cache[modulePath];
			}

			const module = require(modulePath);
			return module.default || module;
		} catch (error) {
			throw new Error(`Failed to require module: ${modulePath}`);
		}
	}

	private validateModule(module: any, manifest: PluginManifest): void {
		if (!module) {
			throw new Error('Module is null or undefined');
		}

		// Check for required exports based on plugin type
		switch (manifest.type) {
			case 'loader':
				this.validateLoaderModule(module, manifest);
				break;
			case 'visualization':
				this.validateVisualizationModule(module, manifest);
				break;
			case 'analysis':
				this.validateAnalysisModule(module, manifest);
				break;
			case 'ui':
				this.validateUIModule(module, manifest);
				break;
			case 'workflow':
				this.validateWorkflowModule(module, manifest);
				break;
			case 'integration':
				this.validateIntegrationModule(module, manifest);
				break;
			default:
				throw new Error(`Unknown plugin type: ${manifest.type}`);
		}

		// Store manifest reference in module for hot reloading
		module.__manifest = manifest;
	}

	private validateLoaderModule(module: any, manifest: PluginManifest): void {
		if (typeof module.load !== 'function') {
			throw new Error('Loader plugin must export a "load" function');
		}

		if (typeof module.canHandle !== 'function') {
			throw new Error('Loader plugin must export a "canHandle" function');
		}
	}

	private validateVisualizationModule(module: any, manifest: PluginManifest): void {
		if (typeof module.render !== 'function') {
			throw new Error('Visualization plugin must export a "render" function');
		}

		if (typeof module.getSupportedDataTypes !== 'function') {
			throw new Error('Visualization plugin must export a "getSupportedDataTypes" function');
		}
	}

	private validateAnalysisModule(module: any, manifest: PluginManifest): void {
		if (typeof module.process !== 'function') {
			throw new Error('Analysis plugin must export a "process" function');
		}

		if (typeof module.getInputTypes !== 'function') {
			throw new Error('Analysis plugin must export a "getInputTypes" function');
		}

		if (typeof module.getOutputTypes !== 'function') {
			throw new Error('Analysis plugin must export a "getOutputTypes" function');
		}
	}

	private validateUIModule(module: any, manifest: PluginManifest): void {
		if (typeof module.createComponent !== 'function') {
			throw new Error('UI plugin must export a "createComponent" function');
		}
	}

	private validateWorkflowModule(module: any, manifest: PluginManifest): void {
		if (typeof module.execute !== 'function') {
			throw new Error('Workflow plugin must export an "execute" function');
		}

		if (typeof module.getSteps !== 'function') {
			throw new Error('Workflow plugin must export a "getSteps" function');
		}
	}

	private validateIntegrationModule(module: any, manifest: PluginManifest): void {
		if (typeof module.connect !== 'function') {
			throw new Error('Integration plugin must export a "connect" function');
		}

		if (typeof module.disconnect !== 'function') {
			throw new Error('Integration plugin must export a "disconnect" function');
		}
	}
}

/**
 * Plugin Validator
 * Validates plugin manifests and dependencies
 */
export class PluginValidator {
	/**
	 * Validate a plugin manifest
	 */
	validateManifest(manifest: PluginManifest): ValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];

		// Required fields validation
		if (!manifest.id) {
			errors.push('Missing required field: id');
		} else if (!/^[a-z0-9-]+$/.test(manifest.id)) {
			errors.push('Plugin ID must be lowercase alphanumeric with hyphens only');
		}

		if (!manifest.name) {
			errors.push('Missing required field: name');
		}

		if (!manifest.version) {
			errors.push('Missing required field: version');
		} else if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
			errors.push('Version must follow semantic versioning (e.g., 1.0.0)');
		}

		if (!manifest.type) {
			errors.push('Missing required field: type');
		} else {
			const validTypes = ['loader', 'visualization', 'analysis', 'ui', 'workflow', 'integration'];
			if (!validTypes.includes(manifest.type)) {
				errors.push(`Invalid plugin type: ${manifest.type}`);
			}
		}

		if (!manifest.entrypoint) {
			errors.push('Missing required field: entrypoint');
		} else if (!manifest.entrypoint.endsWith('.js')) {
			warnings.push('Entrypoint should be a JavaScript file (.js)');
		}

		if (!manifest.handles || manifest.handles.length === 0) {
			errors.push('Missing required field: handles');
		}

		if (!manifest.apiVersion) {
			errors.push('Missing required field: apiVersion');
		}

		if (!manifest.compatibleCore) {
			errors.push('Missing required field: compatibleCore');
		}

		// Permissions validation
		if (manifest.permissions) {
			for (const permission of manifest.permissions) {
				if (!permission.type || !permission.scope || !permission.level) {
					errors.push('Invalid permission: missing type, scope, or level');
				}

				const validTypes = ['api', 'filesystem', 'network', 'gpu', 'storage'];
				if (!validTypes.includes(permission.type)) {
					errors.push(`Invalid permission type: ${permission.type}`);
				}

				const validLevels = ['read', 'write', 'execute'];
				if (!validLevels.includes(permission.level)) {
					errors.push(`Invalid permission level: ${permission.level}`);
				}
			}
		}

		// Resource requirements validation
		if (manifest.resources) {
			if (manifest.resources.maxMemoryMB && manifest.resources.maxMemoryMB > 1024) {
				warnings.push('Memory requirement exceeds 1GB, consider optimizing');
			}

			if (manifest.resources.maxExecutionTimeMs && manifest.resources.maxExecutionTimeMs > 120000) {
				warnings.push('Execution time exceeds 2 minutes, consider optimizing');
			}
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings
		};
	}

	/**
	 * Validate plugin permissions
	 */
	validatePermissions(manifest: PluginManifest): ValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];

		if (!manifest.permissions || manifest.permissions.length === 0) {
			warnings.push('No permissions specified - plugin will have limited access');
			return { valid: true, errors, warnings };
		}

		// Check for overly broad permissions
		const hasWildcardScope = manifest.permissions.some((p) => p.scope === '*');
		if (hasWildcardScope) {
			warnings.push('Wildcard scope (*) grants broad access - consider more specific permissions');
		}

		// Check for unnecessary write permissions
		const hasWritePermissions = manifest.permissions.some((p) => p.level === 'write');
		if (hasWritePermissions && manifest.type === 'visualization') {
			warnings.push('Visualization plugins typically do not need write permissions');
		}

		// Check for filesystem access
		const hasFilesystemAccess = manifest.permissions.some((p) => p.type === 'filesystem');
		if (hasFilesystemAccess) {
			warnings.push('Filesystem access requires user trust - ensure plugin is from trusted source');
		}

		// Check for network access
		const hasNetworkAccess = manifest.permissions.some((p) => p.type === 'network');
		if (hasNetworkAccess) {
			warnings.push('Network access can pose security risks - verify plugin behavior');
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings
		};
	}

	/**
	 * Validate plugin dependencies
	 */
	validateDependencies(
		manifest: PluginManifest,
		availablePlugins: Array<{ id: string; manifest: PluginManifest }>
	): ValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];

		if (!manifest.dependencies || manifest.dependencies.length === 0) {
			return { valid: true, errors, warnings };
		}

		for (const dependency of manifest.dependencies) {
			const dependentPlugin = availablePlugins.find((p) => p.id === dependency.pluginId);

			if (!dependentPlugin) {
				if (dependency.optional) {
					warnings.push(`Optional dependency not found: ${dependency.pluginId}`);
				} else {
					errors.push(`Required dependency not found: ${dependency.pluginId}`);
				}
				continue;
			}

			// Check version compatibility
			const dependentVersion = dependentPlugin.manifest.version;
			if (!this.isVersionCompatible(dependentVersion, dependency.version)) {
				if (dependency.optional) {
					warnings.push(
						`Optional dependency version mismatch: ${dependency.pluginId} requires ${dependency.version}, found ${dependentVersion}`
					);
				} else {
					errors.push(
						`Required dependency version mismatch: ${dependency.pluginId} requires ${dependency.version}, found ${dependentVersion}`
					);
				}
			}

			// Check for circular dependencies
			if (this.hasCircularDependency(manifest, dependentPlugin.manifest, availablePlugins)) {
				errors.push(`Circular dependency detected with ${dependency.pluginId}`);
			}
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings
		};
	}

	/**
	 * Validate resource requirements
	 */
	validateResources(requirements: ResourceRequirements): ValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];

		// Check memory requirements
		if (requirements.maxMemoryMB <= 0) {
			errors.push('Memory requirement must be positive');
		} else if (requirements.maxMemoryMB > 2048) {
			errors.push('Memory requirement exceeds 2GB limit');
		} else if (requirements.maxMemoryMB > 512) {
			warnings.push('High memory requirement may affect performance');
		}

		// Check execution time
		if (requirements.maxExecutionTimeMs <= 0) {
			errors.push('Execution time must be positive');
		} else if (requirements.maxExecutionTimeMs > 300000) {
			errors.push('Execution time exceeds 5 minute limit');
		} else if (requirements.maxExecutionTimeMs > 30000) {
			warnings.push('Long execution time may block the UI');
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings
		};
	}

	// Private helper methods

	private isVersionCompatible(available: string, required: string): boolean {
		// Simple version check - in production, use a proper semver library
		const parseVersion = (v: string) => v.split('.').map(Number);
		const availVer = parseVersion(available);
		const reqVer = parseVersion(required);

		// Check major version compatibility
		return (
			availVer[0] === reqVer[0] &&
			(availVer[1] > reqVer[1] || (availVer[1] === reqVer[1] && availVer[2] >= reqVer[2]))
		);
	}

	private hasCircularDependency(
		manifest: PluginManifest,
		dependentManifest: PluginManifest,
		availablePlugins: Array<{ id: string; manifest: PluginManifest }>,
		visited = new Set<string>()
	): boolean {
		if (visited.has(dependentManifest.id)) {
			return dependentManifest.id === manifest.id;
		}

		visited.add(dependentManifest.id);

		if (!dependentManifest.dependencies) {
			return false;
		}

		for (const dep of dependentManifest.dependencies) {
			const depPlugin = availablePlugins.find((p) => p.id === dep.pluginId);
			if (
				depPlugin &&
				this.hasCircularDependency(manifest, depPlugin.manifest, availablePlugins, visited)
			) {
				return true;
			}
		}

		visited.delete(dependentManifest.id);
		return false;
	}
}
