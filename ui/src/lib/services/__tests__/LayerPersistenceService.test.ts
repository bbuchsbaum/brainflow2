import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LayerPersistenceService } from '../LayerPersistenceService';
import type { LayerService } from '../LayerService';
import type { ValidationService } from '$lib/validation/ValidationService';
import type { NotificationService } from '../NotificationService';
import { EventBus } from '$lib/events/EventBus';
import { layerStore, type LayerEntry } from '$lib/stores/layerStore';
import type { LayerSpec } from '@brainflow/api';

// Mock localStorage
const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] || null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		},
		key: (index: number) => {
			const keys = Object.keys(store);
			return keys[index] || null;
		},
		get length() {
			return Object.keys(store).length;
		}
	};
})();

Object.defineProperty(window, 'localStorage', {
	value: localStorageMock,
	writable: true
});

// Mock File API
class MockFile {
	private content: string;
	public name: string;
	public type: string;

	constructor(bits: BlobPart[], name: string, options?: FilePropertyBag) {
		this.content = bits.join('');
		this.name = name;
		this.type = options?.type || '';
	}

	async text(): Promise<string> {
		return this.content;
	}
}

// @ts-ignore
global.File = MockFile;

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

// Mock document.createElement for file download
const mockClick = vi.fn();
let mockAnchor: any;
const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
	if (tagName === 'a') {
		// Create a fresh mock anchor for each call
		mockAnchor = {
			href: '',
			download: '',
			click: mockClick,
			style: {}
		};
		return mockAnchor;
	}
	return originalCreateElement(tagName);
});

describe('LayerPersistenceService', () => {
	let service: LayerPersistenceService;
	let eventBus: EventBus;
	let mockLayerService: LayerService;
	let mockValidationService: ValidationService;
	let mockNotificationService: NotificationService;

	const createMockLayer = (id: string, colormap: string = 'grayscale'): LayerEntry => ({
		id,
		spec: {
			Volume: {
				id: `spec-${id}`,
				source_resource_id: `volume-${id}`,
				colormap,
				slice_axis: null,
				slice_index: null
			}
		},
		visible: true,
		opacity: 1.0,
		colormap,
		windowLevel: { window: 1.0, level: 0.5 },
		threshold: { low: 0.1, high: 0.9, enabled: true },
		isLoadingGpu: false
	});

	beforeEach(() => {
		// Clear localStorage and mocks
		localStorageMock.clear();
		vi.clearAllMocks();

		// Clear layer store
		const currentLayers = layerStore.get().layers;
		for (const layer of currentLayers) {
			layerStore.removeLayer(layer.id);
		}

		// Create mocks
		eventBus = new EventBus();
		
		mockLayerService = {
			addLayer: vi.fn().mockImplementation((spec: LayerSpec) => {
				const layerId = `layer-${Date.now()}`;
				const layer = createMockLayer(layerId);
				layer.spec = spec;
				layerStore.addLayer(layer);
				return Promise.resolve(layerId);
			}),
			removeLayer: vi.fn().mockImplementation((layerId: string) => {
				layerStore.removeLayer(layerId);
				return Promise.resolve();
			}),
			updateLayerVisibility: vi.fn().mockImplementation((layerId: string, visible: boolean) => {
				layerStore.setLayerVisibility(layerId, visible);
				return Promise.resolve();
			}),
			updateLayerOpacity: vi.fn().mockImplementation((layerId: string, opacity: number) => {
				layerStore.setLayerOpacity(layerId, opacity);
				return Promise.resolve();
			}),
			updateLayerColormap: vi.fn().mockImplementation((layerId: string, colormap: string) => {
				layerStore.setLayerColormap(layerId, colormap);
				return Promise.resolve();
			}),
			updateLayerWindowLevel: vi.fn().mockImplementation((layerId: string, window: number, level: number) => {
				layerStore.setLayerWindowLevel(layerId, window, level);
				return Promise.resolve();
			}),
			updateLayerThreshold: vi.fn().mockImplementation(
				(layerId: string, low: number, high: number, enabled: boolean) => {
					layerStore.setLayerThreshold(layerId, { low, high, enabled });
					return Promise.resolve();
				}
			)
		} as any;

		mockValidationService = {} as any;

		mockNotificationService = {
			success: vi.fn(),
			error: vi.fn(),
			warning: vi.fn(),
			info: vi.fn()
		} as any;

		service = new LayerPersistenceService({
			eventBus,
			validationService: mockValidationService,
			notificationService: mockNotificationService,
			layerService: mockLayerService
		});
	});

	afterEach(() => {
		eventBus.clear();
	});

	describe('saveConfiguration', () => {
		it('should save current layer configuration to localStorage', async () => {
			// Add some layers
			const layer1 = createMockLayer('layer1', 'viridis');
			const layer2 = createMockLayer('layer2', 'hot');
			layerStore.addLayer(layer1);
			layerStore.addLayer(layer2);
			layerStore.setActiveLayer('layer1');

			// Save configuration
			await service.saveConfiguration();

			// Check localStorage
			const saved = localStorage.getItem('brainflow-layer-config');
			expect(saved).toBeTruthy();

			const snapshot = JSON.parse(saved!);
			expect(snapshot.version).toBe('1.0.0');
			expect(snapshot.layers).toHaveLength(2);
			expect(snapshot.layers[0].colormap).toBe('viridis');
			expect(snapshot.layers[1].colormap).toBe('hot');
			expect(snapshot.activeLayerId).toBe('layer1');
		});

		it('should save configuration with custom name', async () => {
			const layer = createMockLayer('layer1');
			layerStore.addLayer(layer);

			await service.saveConfiguration('my-config');

			const saved = localStorage.getItem('brainflow-layer-config-my-config');
			expect(saved).toBeTruthy();

			expect(mockNotificationService.success).toHaveBeenCalledWith(
				'Layer configuration saved as "my-config"'
			);
		});

		it('should emit configuration saved event', async () => {
			const layer = createMockLayer('layer1');
			layerStore.addLayer(layer);

			const eventSpy = vi.fn();
			eventBus.on('layer.configuration.saved', eventSpy);

			await service.saveConfiguration('test');

			expect(eventSpy).toHaveBeenCalledWith({ name: 'test' });
		});
	});

	describe('loadConfiguration', () => {
		it('should load configuration from localStorage', async () => {
			// Save a configuration
			const savedConfig = {
				version: '1.0.0',
				timestamp: Date.now(),
				layers: [
					{
						id: 'spec-layer1',
						spec: {
							Volume: {
								id: 'spec-layer1',
								source_resource_id: 'volume1',
								colormap: 'plasma',
								slice_axis: null,
								slice_index: null
							}
						},
						visible: false,
						opacity: 0.7,
						colormap: 'plasma',
						windowLevel: { window: 0.8, level: 0.4 },
						threshold: { low: 0.2, high: 0.8, enabled: false }
					}
				],
				activeLayerId: 'spec-layer1'
			};

			localStorage.setItem('brainflow-layer-config', JSON.stringify(savedConfig));

			// Load configuration
			await service.loadConfiguration();

			// Verify layer was added with correct properties
			expect(mockLayerService.addLayer).toHaveBeenCalledWith(savedConfig.layers[0].spec);
			expect(mockLayerService.updateLayerVisibility).toHaveBeenCalledWith(expect.any(String), false);
			expect(mockLayerService.updateLayerOpacity).toHaveBeenCalledWith(expect.any(String), 0.7);
			expect(mockLayerService.updateLayerColormap).toHaveBeenCalledWith(expect.any(String), 'plasma');
			expect(mockLayerService.updateLayerWindowLevel).toHaveBeenCalledWith(expect.any(String), 0.8, 0.4);
			expect(mockLayerService.updateLayerThreshold).toHaveBeenCalledWith(expect.any(String), 0.2, 0.8, false);
		});

		it('should clear existing layers before loading', async () => {
			// Add existing layers
			const layer1 = createMockLayer('existing1');
			const layer2 = createMockLayer('existing2');
			layerStore.addLayer(layer1);
			layerStore.addLayer(layer2);

			// Save a configuration
			const savedConfig = {
				version: '1.0.0',
				timestamp: Date.now(),
				layers: [{
					id: 'new-layer',
					spec: {
						Volume: {
							id: 'new-layer',
							source_resource_id: 'volume-new',
							colormap: 'grayscale',
							slice_axis: null,
							slice_index: null
						}
					},
					visible: true,
					opacity: 1.0,
					colormap: 'grayscale',
					windowLevel: { window: 1.0, level: 0.5 }
				}],
				activeLayerId: null
			};

			localStorage.setItem('brainflow-layer-config', JSON.stringify(savedConfig));

			// Load configuration
			await service.loadConfiguration();

			// Verify existing layers were removed
			expect(mockLayerService.removeLayer).toHaveBeenCalledWith('existing1');
			expect(mockLayerService.removeLayer).toHaveBeenCalledWith('existing2');
			expect(mockLayerService.removeLayer).toHaveBeenCalledTimes(2);
		});

		it('should handle missing configuration gracefully', async () => {
			await expect(service.loadConfiguration('non-existent')).rejects.toThrow(
				'No saved configuration found with name "non-existent"'
			);

			expect(mockNotificationService.error).toHaveBeenCalledWith(
				'Failed to load layer configuration'
			);
		});

		it('should emit configuration loaded event', async () => {
			const savedConfig = {
				version: '1.0.0',
				timestamp: Date.now(),
				layers: [],
				activeLayerId: null
			};

			localStorage.setItem('brainflow-layer-config', JSON.stringify(savedConfig));

			const eventSpy = vi.fn();
			eventBus.on('layer.configuration.loaded', eventSpy);

			await service.loadConfiguration();

			expect(eventSpy).toHaveBeenCalledWith({
				name: undefined,
				snapshot: savedConfig
			});
		});
	});

	describe('exportConfiguration', () => {
		it('should export configuration to JSON file', async () => {
			const layer = createMockLayer('layer1', 'turbo');
			layerStore.addLayer(layer);

			await service.exportConfiguration();

			// Verify file download was triggered
			expect(URL.createObjectURL).toHaveBeenCalled();
			expect(mockAnchor.download).toMatch(/^brainflow-layers-\d{4}-\d{2}-\d{2}\.json$/);
			expect(mockClick).toHaveBeenCalled();
			expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

			// Verify notification
			expect(mockNotificationService.success).toHaveBeenCalledWith('Layer configuration exported');
		});

		it('should emit configuration exported event', async () => {
			const eventSpy = vi.fn();
			eventBus.on('layer.configuration.exported', eventSpy);

			await service.exportConfiguration();

			expect(eventSpy).toHaveBeenCalledWith({});
		});
	});

	describe('importConfiguration', () => {
		it('should import configuration from JSON file', async () => {
			const configData = {
				version: '1.0.0',
				timestamp: Date.now(),
				layers: [{
					id: 'imported-layer',
					spec: {
						Volume: {
							id: 'imported-layer',
							source_resource_id: 'volume-import',
							colormap: 'inferno',
							slice_axis: null,
							slice_index: null
						}
					},
					visible: true,
					opacity: 0.9,
					colormap: 'inferno',
					windowLevel: { window: 1.0, level: 0.5 }
				}],
				activeLayerId: 'imported-layer'
			};

			const file = new File([JSON.stringify(configData)], 'test-config.json', {
				type: 'application/json'
			});

			await service.importConfiguration(file);

			// Verify configuration was saved
			const saved = localStorage.getItem('brainflow-layer-config-test-config');
			expect(saved).toBeTruthy();
			expect(JSON.parse(saved!)).toEqual(configData);

			// Verify configuration was loaded
			expect(mockLayerService.addLayer).toHaveBeenCalled();
		});

		it('should validate imported configuration', async () => {
			const invalidData = {
				// Missing required fields
				layers: 'not-an-array'
			};

			const file = new File([JSON.stringify(invalidData)], 'invalid.json', {
				type: 'application/json'
			});

			await expect(service.importConfiguration(file)).rejects.toThrow(
				'Invalid layer configuration file'
			);
		});

		it('should emit configuration imported event', async () => {
			const configData = {
				version: '1.0.0',
				timestamp: Date.now(),
				layers: [],
				activeLayerId: null
			};

			const file = new File([JSON.stringify(configData)], 'import-test.json', {
				type: 'application/json'
			});

			const eventSpy = vi.fn();
			eventBus.on('layer.configuration.imported', eventSpy);

			await service.importConfiguration(file);

			expect(eventSpy).toHaveBeenCalledWith({ name: 'import-test' });
		});
	});

	describe('listSavedConfigurations', () => {
		it('should list all saved configurations', () => {
			// Add some configurations
			localStorage.setItem('brainflow-layer-config', 'default-config');
			localStorage.setItem('brainflow-layer-config-preset1', 'preset1-config');
			localStorage.setItem('brainflow-layer-config-preset2', 'preset2-config');
			localStorage.setItem('other-key', 'other-value'); // Should be ignored

			const configs = service.listSavedConfigurations();

			expect(configs).toEqual(['default', 'preset1', 'preset2']);
		});

		it('should return empty array when no configurations exist', () => {
			const configs = service.listSavedConfigurations();
			expect(configs).toEqual([]);
		});
	});

	describe('deleteConfiguration', () => {
		it('should delete configuration from localStorage', () => {
			localStorage.setItem('brainflow-layer-config', 'default-config');
			localStorage.setItem('brainflow-layer-config-custom', 'custom-config');

			service.deleteConfiguration();
			expect(localStorage.getItem('brainflow-layer-config')).toBeNull();

			service.deleteConfiguration('custom');
			expect(localStorage.getItem('brainflow-layer-config-custom')).toBeNull();
		});

		it('should emit configuration deleted event', () => {
			const eventSpy = vi.fn();
			eventBus.on('layer.configuration.deleted', eventSpy);

			service.deleteConfiguration('test');

			expect(eventSpy).toHaveBeenCalledWith({ name: 'test' });
			expect(mockNotificationService.info).toHaveBeenCalledWith(
				'Layer configuration deleted: "test"'
			);
		});
	});

	describe('enableAutoSave', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should auto-save on layer changes with debounce', async () => {
			const cleanup = service.enableAutoSave(10000);

			// Add a layer
			const layer = createMockLayer('layer1');
			layerStore.addLayer(layer);
			eventBus.emit('layer.added', { layerEntry: layer });

			// Verify save not called immediately
			const saved = localStorage.getItem('brainflow-layer-config');
			expect(saved).toBeNull();

			// Advance time past debounce
			await vi.advanceTimersByTimeAsync(2000);

			// Verify save was called
			const savedAfterDebounce = localStorage.getItem('brainflow-layer-config');
			expect(savedAfterDebounce).toBeTruthy();

			cleanup();
		});

		it('should perform periodic saves', async () => {
			const cleanup = service.enableAutoSave(5000); // 5 second interval

			// Add a layer initially
			const layer = createMockLayer('layer1');
			layerStore.addLayer(layer);

			// Advance time to trigger periodic save
			await vi.advanceTimersByTimeAsync(5000);

			const saved = localStorage.getItem('brainflow-layer-config');
			expect(saved).toBeTruthy();

			// Modify layer
			layerStore.setLayerOpacity('layer1', 0.5);

			// Clear to verify next save
			localStorage.removeItem('brainflow-layer-config');

			// Advance time for another periodic save
			await vi.advanceTimersByTimeAsync(5000);

			const savedAgain = localStorage.getItem('brainflow-layer-config');
			expect(savedAgain).toBeTruthy();
			const snapshot = JSON.parse(savedAgain!);
			expect(snapshot.layers[0].opacity).toBe(0.5);

			cleanup();
		});

		it('should cleanup properly when disabled', () => {
			const cleanup = service.enableAutoSave(10000);

			// Verify cleanup stops auto-save
			cleanup();

			// Add a layer after cleanup
			const layer = createMockLayer('layer1');
			layerStore.addLayer(layer);
			eventBus.emit('layer.added', { layerEntry: layer });

			// Advance time
			vi.advanceTimersByTime(15000);

			// Verify no save occurred
			const saved = localStorage.getItem('brainflow-layer-config');
			expect(saved).toBeNull();
		});

		it('should listen to all layer change events', () => {
			const eventSpy = vi.spyOn(eventBus, 'on');
			const cleanup = service.enableAutoSave(10000);

			const expectedEvents = [
				'layer.added',
				'layer.removed',
				'layer.opacity.changed',
				'layer.colormap.changed',
				'layer.visibility.changed',
				'layer.windowlevel.changed',
				'layer.threshold.changed'
			];

			expectedEvents.forEach(event => {
				expect(eventSpy).toHaveBeenCalledWith(event, expect.any(Function));
			});

			// Verify cleanup returns a function
			expect(typeof cleanup).toBe('function');
			cleanup();
		});
	});

	describe('extractSaveableConfig', () => {
		it('should extract all saveable properties from layer', async () => {
			const layer = createMockLayer('test-layer', 'jet');
			layer.threshold = {
				low: 0.3,
				high: 0.7,
				enabled: true
			};

			layerStore.addLayer(layer);

			await service.saveConfiguration();

			const saved = localStorage.getItem('brainflow-layer-config');
			const snapshot = JSON.parse(saved!);
			const savedLayer = snapshot.layers[0];

			expect(savedLayer).toEqual({
				id: 'spec-test-layer',
				spec: layer.spec,
				visible: true,
				opacity: 1.0,
				colormap: 'jet',
				windowLevel: { window: 1.0, level: 0.5 },
				threshold: { low: 0.3, high: 0.7, enabled: true }
			});
		});
	});
});