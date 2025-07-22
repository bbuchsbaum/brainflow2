/**
 * Plugin Registry
 * Manages plugin discovery, registration, and metadata
 */

import type {
	PluginRegistry as IPluginRegistry,
	PluginManifest,
	PluginType,
	PluginSearchCriteria,
	ValidationResult
} from './types';

export class PluginRegistry implements IPluginRegistry {
	private plugins = new Map<string, PluginManifest>();
	private typeIndex = new Map<PluginType, Set<string>>();
	private handlesIndex = new Map<string, Set<string>>();
	private authorIndex = new Map<string, Set<string>>();
	private versionIndex = new Map<string, Set<string>>();

	/**
	 * Register a plugin manifest
	 */
	async register(manifest: PluginManifest): Promise<void> {
		const pluginId = manifest.id;

		// Validate manifest before registration
		const validation = this.validateManifest(manifest);
		if (!validation.valid) {
			throw new Error(`Invalid plugin manifest: ${validation.errors.join(', ')}`);
		}

		// Check for duplicate ID
		if (this.plugins.has(pluginId)) {
			throw new Error(`Plugin with ID '${pluginId}' is already registered`);
		}

		// Store the manifest
		this.plugins.set(pluginId, manifest);

		// Update indexes
		this.updateIndexes(manifest);

		console.log(`Registered plugin: ${pluginId} v${manifest.version}`);
	}

	/**
	 * Unregister a plugin
	 */
	async unregister(pluginId: string): Promise<void> {
		const manifest = this.plugins.get(pluginId);
		if (!manifest) {
			return; // Already unregistered
		}

		// Remove from main registry
		this.plugins.delete(pluginId);

		// Remove from indexes
		this.removeFromIndexes(manifest);

		console.log(`Unregistered plugin: ${pluginId}`);
	}

	/**
	 * Find plugins matching criteria
	 */
	find(criteria: PluginSearchCriteria): PluginManifest[] {
		let candidates = new Set<string>();
		let isFirstFilter = true;

		// Filter by type
		if (criteria.type) {
			const typeMatches = this.typeIndex.get(criteria.type) || new Set();
			if (isFirstFilter) {
				candidates = new Set(typeMatches);
				isFirstFilter = false;
			} else {
				candidates = this.intersect(candidates, typeMatches);
			}
		}

		// Filter by handles
		if (criteria.handles) {
			const handlesMatches = this.handlesIndex.get(criteria.handles) || new Set();
			if (isFirstFilter) {
				candidates = new Set(handlesMatches);
				isFirstFilter = false;
			} else {
				candidates = this.intersect(candidates, handlesMatches);
			}
		}

		// Filter by author
		if (criteria.author) {
			const authorMatches = this.authorIndex.get(criteria.author) || new Set();
			if (isFirstFilter) {
				candidates = new Set(authorMatches);
				isFirstFilter = false;
			} else {
				candidates = this.intersect(candidates, authorMatches);
			}
		}

		// Filter by version
		if (criteria.version) {
			const versionMatches = this.versionIndex.get(criteria.version) || new Set();
			if (isFirstFilter) {
				candidates = new Set(versionMatches);
				isFirstFilter = false;
			} else {
				candidates = this.intersect(candidates, versionMatches);
			}
		}

		// If no filters were applied, return all plugins
		if (isFirstFilter) {
			candidates = new Set(this.plugins.keys());
		}

		// Convert to manifests and apply additional filters
		let results = Array.from(candidates)
			.map((id) => this.plugins.get(id)!)
			.filter(Boolean);

		// Filter by tags (if specified)
		if (criteria.tags && criteria.tags.length > 0) {
			results = results.filter((manifest) => {
				const manifestTags = (manifest as any).tags || [];
				return criteria.tags!.some((tag) => manifestTags.includes(tag));
			});
		}

		return results;
	}

	/**
	 * Get all registered plugins
	 */
	getAll(): PluginManifest[] {
		return Array.from(this.plugins.values());
	}

	/**
	 * Get plugin by ID
	 */
	getById(pluginId: string): PluginManifest | null {
		return this.plugins.get(pluginId) || null;
	}

	/**
	 * Get plugins by type
	 */
	getByType(type: PluginType): PluginManifest[] {
		const pluginIds = this.typeIndex.get(type) || new Set();
		return Array.from(pluginIds)
			.map((id) => this.plugins.get(id)!)
			.filter(Boolean);
	}

	/**
	 * Get plugins that handle a specific file type or data type
	 */
	getByHandles(pattern: string): PluginManifest[] {
		const results: PluginManifest[] = [];

		for (const manifest of this.plugins.values()) {
			if (this.manifestHandlesPattern(manifest, pattern)) {
				results.push(manifest);
			}
		}

		return results;
	}

	/**
	 * Get plugin statistics
	 */
	getStats(): {
		total: number;
		byType: Record<string, number>;
		byAuthor: Record<string, number>;
	} {
		const stats = {
			total: this.plugins.size,
			byType: {} as Record<string, number>,
			byAuthor: {} as Record<string, number>
		};

		for (const manifest of this.plugins.values()) {
			// Count by type
			stats.byType[manifest.type] = (stats.byType[manifest.type] || 0) + 1;

			// Count by author
			const author = manifest.author || 'Unknown';
			stats.byAuthor[author] = (stats.byAuthor[author] || 0) + 1;
		}

		return stats;
	}

	/**
	 * Check for plugin conflicts
	 */
	checkConflicts(manifest: PluginManifest): string[] {
		const conflicts: string[] = [];

		// Check for ID conflicts
		if (this.plugins.has(manifest.id)) {
			conflicts.push(`Plugin ID '${manifest.id}' already exists`);
		}

		// Check for conflicting handles in the same type
		const sameTypePlugins = this.getByType(manifest.type);
		for (const existing of sameTypePlugins) {
			const overlappingHandles = manifest.handles.filter((handle) =>
				existing.handles.includes(handle)
			);

			if (overlappingHandles.length > 0) {
				conflicts.push(`Plugin '${existing.id}' already handles: ${overlappingHandles.join(', ')}`);
			}
		}

		return conflicts;
	}

	/**
	 * Validate a plugin manifest
	 */
	private validateManifest(manifest: PluginManifest): ValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];

		// Required fields
		if (!manifest.id) errors.push('Missing required field: id');
		if (!manifest.name) errors.push('Missing required field: name');
		if (!manifest.version) errors.push('Missing required field: version');
		if (!manifest.type) errors.push('Missing required field: type');
		if (!manifest.entrypoint) errors.push('Missing required field: entrypoint');
		if (!manifest.handles || manifest.handles.length === 0) {
			errors.push('Missing required field: handles');
		}

		// Validate ID format
		if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) {
			errors.push('Plugin ID must be lowercase alphanumeric with hyphens only');
		}

		// Validate version format (basic semver check)
		if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
			errors.push('Version must follow semantic versioning (e.g., 1.0.0)');
		}

		// Validate type
		const validTypes: PluginType[] = [
			'loader',
			'visualization',
			'analysis',
			'ui',
			'workflow',
			'integration'
		];
		if (manifest.type && !validTypes.includes(manifest.type)) {
			errors.push(`Invalid plugin type: ${manifest.type}`);
		}

		// Validate entrypoint
		if (manifest.entrypoint && !manifest.entrypoint.endsWith('.js')) {
			warnings.push('Entrypoint should be a JavaScript file (.js)');
		}

		// Validate handles based on type
		if (manifest.type === 'loader') {
			for (const handle of manifest.handles) {
				if (!handle.startsWith('.') && !handle.includes('/')) {
					warnings.push(`Loader handle '${handle}' should be a file extension or MIME type`);
				}
			}
		}

		// Check for reasonable resource requirements
		if (manifest.resources) {
			if (manifest.resources.maxMemoryMB > 512) {
				warnings.push('Memory requirement exceeds 512MB, consider optimizing');
			}
			if (manifest.resources.maxExecutionTimeMs > 60000) {
				warnings.push('Execution time exceeds 60 seconds, consider optimizing');
			}
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings
		};
	}

	/**
	 * Check if a manifest handles a specific pattern
	 */
	private manifestHandlesPattern(manifest: PluginManifest, pattern: string): boolean {
		for (const handle of manifest.handles) {
			if (this.patternMatches(handle, pattern)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Check if a pattern matches a handle
	 */
	private patternMatches(handle: string, pattern: string): boolean {
		// Exact match
		if (handle === pattern) {
			return true;
		}

		// Wildcard matching for file extensions
		if (handle.includes('*') || pattern.includes('*')) {
			const handleRegex = new RegExp('^' + handle.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$');
			return handleRegex.test(pattern);
		}

		// Case-insensitive partial matching
		return handle.toLowerCase().includes(pattern.toLowerCase());
	}

	/**
	 * Update search indexes when registering a plugin
	 */
	private updateIndexes(manifest: PluginManifest): void {
		const pluginId = manifest.id;

		// Type index
		let typeSet = this.typeIndex.get(manifest.type);
		if (!typeSet) {
			typeSet = new Set();
			this.typeIndex.set(manifest.type, typeSet);
		}
		typeSet.add(pluginId);

		// Handles index
		for (const handle of manifest.handles) {
			let handlesSet = this.handlesIndex.get(handle);
			if (!handlesSet) {
				handlesSet = new Set();
				this.handlesIndex.set(handle, handlesSet);
			}
			handlesSet.add(pluginId);
		}

		// Author index
		if (manifest.author) {
			let authorSet = this.authorIndex.get(manifest.author);
			if (!authorSet) {
				authorSet = new Set();
				this.authorIndex.set(manifest.author, authorSet);
			}
			authorSet.add(pluginId);
		}

		// Version index
		let versionSet = this.versionIndex.get(manifest.version);
		if (!versionSet) {
			versionSet = new Set();
			this.versionIndex.set(manifest.version, versionSet);
		}
		versionSet.add(pluginId);
	}

	/**
	 * Remove from search indexes when unregistering a plugin
	 */
	private removeFromIndexes(manifest: PluginManifest): void {
		const pluginId = manifest.id;

		// Type index
		const typeSet = this.typeIndex.get(manifest.type);
		if (typeSet) {
			typeSet.delete(pluginId);
			if (typeSet.size === 0) {
				this.typeIndex.delete(manifest.type);
			}
		}

		// Handles index
		for (const handle of manifest.handles) {
			const handlesSet = this.handlesIndex.get(handle);
			if (handlesSet) {
				handlesSet.delete(pluginId);
				if (handlesSet.size === 0) {
					this.handlesIndex.delete(handle);
				}
			}
		}

		// Author index
		if (manifest.author) {
			const authorSet = this.authorIndex.get(manifest.author);
			if (authorSet) {
				authorSet.delete(pluginId);
				if (authorSet.size === 0) {
					this.authorIndex.delete(manifest.author);
				}
			}
		}

		// Version index
		const versionSet = this.versionIndex.get(manifest.version);
		if (versionSet) {
			versionSet.delete(pluginId);
			if (versionSet.size === 0) {
				this.versionIndex.delete(manifest.version);
			}
		}
	}

	/**
	 * Set intersection utility
	 */
	private intersect<T>(setA: Set<T>, setB: Set<T>): Set<T> {
		const result = new Set<T>();
		for (const item of setA) {
			if (setB.has(item)) {
				result.add(item);
			}
		}
		return result;
	}
}
