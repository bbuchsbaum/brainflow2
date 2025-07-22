/**
 * LayerPersistenceService - Manages saving and loading layer configurations
 * 
 * This service handles persistence of layer state to enable:
 * - Saving layer configurations to local storage
 * - Restoring layer state on page reload
 * - Exporting/importing layer configurations
 */
import type { EventBus } from '$lib/events/EventBus';
import type { ValidationService } from '$lib/validation/ValidationService';
import type { NotificationService } from '$lib/services/NotificationService';
import type { LayerService } from '$lib/services/LayerService';
import { layerStore, type LayerEntry } from '$lib/stores/layerStore';
import type { LayerSpec } from '@brainflow/api';

export interface LayerPersistenceConfig {
	eventBus: EventBus;
	validationService: ValidationService;
	notificationService: NotificationService;
	layerService: LayerService;
}

export interface SavedLayerConfig {
	id: string;
	spec: LayerSpec;
	visible: boolean;
	opacity: number;
	colormap: string;
	windowLevel: {
		window: number;
		level: number;
	};
	threshold?: {
		low: number;
		high: number;
		enabled: boolean;
	};
}

export interface LayerConfigurationSnapshot {
	version: string;
	timestamp: number;
	layers: SavedLayerConfig[];
	activeLayerId: string | null;
}

const STORAGE_KEY = 'brainflow-layer-config';
const CURRENT_VERSION = '1.0.0';

export class LayerPersistenceService {
	private autoSaveCleanup: (() => void) | null = null;

	constructor(private config: LayerPersistenceConfig) {}

	/**
	 * Save current layer configuration to local storage
	 */
	async saveConfiguration(name?: string): Promise<void> {
		try {
			const state = layerStore.get();
			const snapshot: LayerConfigurationSnapshot = {
				version: CURRENT_VERSION,
				timestamp: Date.now(),
				layers: state.layers.map(layer => this.extractSaveableConfig(layer)),
				activeLayerId: state.activeLayerId
			};

			const key = name ? `${STORAGE_KEY}-${name}` : STORAGE_KEY;
			localStorage.setItem(key, JSON.stringify(snapshot));

			this.config.eventBus.emit('layer.configuration.saved', { name });
			this.config.notificationService.success(
				`Layer configuration saved${name ? ` as "${name}"` : ''}`
			);
		} catch (error) {
			console.error('[LayerPersistenceService] Failed to save configuration:', error);
			this.config.notificationService.error('Failed to save layer configuration');
			throw error;
		}
	}

	/**
	 * Load layer configuration from local storage
	 */
	async loadConfiguration(name?: string): Promise<void> {
		try {
			const key = name ? `${STORAGE_KEY}-${name}` : STORAGE_KEY;
			const stored = localStorage.getItem(key);
			
			if (!stored) {
				throw new Error(`No saved configuration found${name ? ` with name "${name}"` : ''}`);
			}

			const snapshot: LayerConfigurationSnapshot = JSON.parse(stored);
			
			// Validate version compatibility
			if (snapshot.version !== CURRENT_VERSION) {
				console.warn(`[LayerPersistenceService] Version mismatch: ${snapshot.version} vs ${CURRENT_VERSION}`);
			}

			// Clear existing layers
			const currentLayers = layerStore.get().layers;
			for (const layer of currentLayers) {
				await this.config.layerService.removeLayer(layer.id);
			}

			// Restore layers
			for (const savedLayer of snapshot.layers) {
				try {
					// Add layer with original spec
					const layerId = await this.config.layerService.addLayer(savedLayer.spec);
					
					// Restore layer properties
					await this.config.layerService.updateLayerVisibility(layerId, savedLayer.visible);
					await this.config.layerService.updateLayerOpacity(layerId, savedLayer.opacity);
					await this.config.layerService.updateLayerColormap(layerId, savedLayer.colormap);
					
					if (savedLayer.windowLevel) {
						await this.config.layerService.updateLayerWindowLevel(
							layerId,
							savedLayer.windowLevel.window,
							savedLayer.windowLevel.level
						);
					}
					
					if (savedLayer.threshold) {
						await this.config.layerService.updateLayerThreshold(
							layerId,
							savedLayer.threshold.low,
							savedLayer.threshold.high,
							savedLayer.threshold.enabled
						);
					}
				} catch (error) {
					console.error(`[LayerPersistenceService] Failed to restore layer ${savedLayer.id}:`, error);
					this.config.notificationService.warning(`Failed to restore layer: ${savedLayer.id}`);
				}
			}

			// Restore active layer
			if (snapshot.activeLayerId) {
				const restoredLayers = layerStore.get().layers;
				const activeLayer = restoredLayers.find(l => 
					l.spec && 'Volume' in l.spec && l.spec.Volume.id === snapshot.activeLayerId
				);
				if (activeLayer) {
					layerStore.setActiveLayer(activeLayer.id);
				}
			}

			this.config.eventBus.emit('layer.configuration.loaded', { name, snapshot });
			this.config.notificationService.success(
				`Layer configuration loaded${name ? ` from "${name}"` : ''}`
			);
		} catch (error) {
			console.error('[LayerPersistenceService] Failed to load configuration:', error);
			this.config.notificationService.error('Failed to load layer configuration');
			throw error;
		}
	}

	/**
	 * Export layer configuration to JSON file
	 */
	async exportConfiguration(): Promise<void> {
		try {
			const state = layerStore.get();
			const snapshot: LayerConfigurationSnapshot = {
				version: CURRENT_VERSION,
				timestamp: Date.now(),
				layers: state.layers.map(layer => this.extractSaveableConfig(layer)),
				activeLayerId: state.activeLayerId
			};

			const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `brainflow-layers-${new Date().toISOString().split('T')[0]}.json`;
			a.click();
			URL.revokeObjectURL(url);

			this.config.eventBus.emit('layer.configuration.exported', {});
			this.config.notificationService.success('Layer configuration exported');
		} catch (error) {
			console.error('[LayerPersistenceService] Failed to export configuration:', error);
			this.config.notificationService.error('Failed to export layer configuration');
			throw error;
		}
	}

	/**
	 * Import layer configuration from JSON file
	 */
	async importConfiguration(file: File): Promise<void> {
		try {
			const text = await file.text();
			const snapshot: LayerConfigurationSnapshot = JSON.parse(text);
			
			// Validate the imported data
			if (!snapshot.version || !snapshot.layers || !Array.isArray(snapshot.layers)) {
				throw new Error('Invalid layer configuration file');
			}

			// Save to localStorage with imported name
			const importName = file.name.replace(/\.json$/, '');
			localStorage.setItem(`${STORAGE_KEY}-${importName}`, text);

			// Load the configuration
			await this.loadConfiguration(importName);

			this.config.eventBus.emit('layer.configuration.imported', { name: importName });
		} catch (error) {
			console.error('[LayerPersistenceService] Failed to import configuration:', error);
			this.config.notificationService.error('Failed to import layer configuration');
			throw error;
		}
	}

	/**
	 * List saved configurations
	 */
	listSavedConfigurations(): string[] {
		const configs: string[] = [];
		const prefix = `${STORAGE_KEY}-`;
		
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key && key.startsWith(prefix)) {
				configs.push(key.substring(prefix.length));
			}
		}
		
		// Check if default configuration exists
		if (localStorage.getItem(STORAGE_KEY)) {
			configs.unshift('default');
		}
		
		return configs;
	}

	/**
	 * Delete a saved configuration
	 */
	deleteConfiguration(name?: string): void {
		const key = name ? `${STORAGE_KEY}-${name}` : STORAGE_KEY;
		localStorage.removeItem(key);
		
		this.config.eventBus.emit('layer.configuration.deleted', { name });
		this.config.notificationService.info(
			`Layer configuration deleted${name ? `: "${name}"` : ''}`
		);
	}

	/**
	 * Extract saveable configuration from a layer entry
	 */
	private extractSaveableConfig(layer: LayerEntry): SavedLayerConfig {
		return {
			id: layer.spec && 'Volume' in layer.spec ? layer.spec.Volume.id : layer.id,
			spec: layer.spec,
			visible: layer.visible,
			opacity: layer.opacity,
			colormap: layer.colormap,
			windowLevel: layer.windowLevel,
			threshold: layer.threshold
		};
	}

	/**
	 * Enable auto-save on layer changes
	 */
	enableAutoSave(intervalMs: number = 30000): () => void {
		let saveTimeout: NodeJS.Timeout | null = null;
		
		// Save on layer changes with debounce
		const handleLayerChange = () => {
			if (saveTimeout) {
				clearTimeout(saveTimeout);
			}
			saveTimeout = setTimeout(() => {
				this.saveConfiguration().catch(error => {
					console.error('[LayerPersistenceService] Auto-save failed:', error);
				});
			}, 2000); // 2 second debounce
		};

		const unsubscribes = [
			this.config.eventBus.on('layer.added', handleLayerChange),
			this.config.eventBus.on('layer.removed', handleLayerChange),
			this.config.eventBus.on('layer.opacity.changed', handleLayerChange),
			this.config.eventBus.on('layer.colormap.changed', handleLayerChange),
			this.config.eventBus.on('layer.visibility.changed', handleLayerChange),
			this.config.eventBus.on('layer.windowlevel.changed', handleLayerChange),
			this.config.eventBus.on('layer.threshold.changed', handleLayerChange)
		];

		// Periodic save
		const intervalId = setInterval(() => {
			this.saveConfiguration().catch(error => {
				console.error('[LayerPersistenceService] Periodic auto-save failed:', error);
			});
		}, intervalMs);

		// Store cleanup function
		this.autoSaveCleanup = () => {
			if (saveTimeout) {
				clearTimeout(saveTimeout);
			}
			clearInterval(intervalId);
			unsubscribes.forEach(unsubscribe => unsubscribe());
		};

		// Return cleanup function
		return this.autoSaveCleanup;
	}

	/**
	 * Dispose of the service
	 */
	dispose(): void {
		// Clean up auto-save if enabled
		if (this.autoSaveCleanup) {
			this.autoSaveCleanup();
			this.autoSaveCleanup = null;
		}
	}
}