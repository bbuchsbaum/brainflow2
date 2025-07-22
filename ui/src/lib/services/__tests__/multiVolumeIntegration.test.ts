import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LayerService } from '../LayerService';
import { VolumeService } from '../VolumeService';
import { GpuResourceService } from '../GpuResourceService';
import { GpuRenderManagerService } from '../GpuRenderManagerService';
import { StoreServiceBridge } from '$lib/integration/StoreServiceBridge';
import { ValidationService } from '$lib/validation/ValidationService';
import { NotificationService } from '../NotificationService';
import { EventBus } from '$lib/events/EventBus';
import { layerStore } from '$lib/stores/layerStore';
import { coreApi } from '$lib/api';
import type { LayerSpec } from '@brainflow/api';

// Mock coreApi
vi.mock('$lib/api', () => ({
	coreApi: {
		init_render_loop: vi.fn(),
		load_file: vi.fn(),
		request_layer_gpu_resources: vi.fn(),
		clear_render_layers: vi.fn(),
		add_render_layer: vi.fn(),
		update_layer_colormap: vi.fn(),
		update_layer_opacity: vi.fn(),
		update_layer_intensity: vi.fn(),
		create_offscreen_render_target: vi.fn(),
		render_to_image_binary: vi.fn()
	}
}));

describe('Multi-Volume Integration Test', () => {
	let layerService: LayerService;
	let volumeService: VolumeService;
	let eventBus: EventBus;
	let storeServiceBridge: StoreServiceBridge;

	beforeEach(async () => {
		// Clear store - remove all layers
		const currentLayers = layerStore.get().layers;
		for (const layer of currentLayers) {
			layerStore.removeLayer(layer.id);
		}

		// Create services
		eventBus = new EventBus();
		const notificationService = new NotificationService({ eventBus });
		const validationService = new ValidationService();
		const gpuRenderManagerService = new GpuRenderManagerService({ eventBus });
		const gpuResourceService = new GpuResourceService({
			eventBus,
			validationService,
			notificationService,
			gpuRenderManagerService
		});

		volumeService = new VolumeService({
			eventBus,
			validationService,
			notificationService
		});

		layerService = new LayerService({
			eventBus,
			validationService,
			notificationService,
			gpuResourceService
		});

		// Create store bridge
		storeServiceBridge = new StoreServiceBridge({ eventBus });
		storeServiceBridge.initialize();

		// Mock GPU initialization
		vi.mocked(coreApi.init_render_loop).mockResolvedValue(undefined);
		await gpuRenderManagerService.initialize();
	});

	afterEach(() => {
		if (storeServiceBridge) {
			storeServiceBridge.cleanup();
		}
		vi.clearAllMocks();
	});

	describe('Multi-Volume Layer Management', () => {
		it('should support adding multiple volume layers', async () => {
			// Mock volume loading
			vi.mocked(coreApi.load_file).mockResolvedValueOnce({
				id: 'volume1',
				handle: 'handle1',
				dims: [64, 64, 64],
				spacing: [1, 1, 1],
				origin: [0, 0, 0],
				direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
				n_channels: 1,
				dtype: 'float32'
			});

			vi.mocked(coreApi.load_file).mockResolvedValueOnce({
				id: 'volume2',
				handle: 'handle2',
				dims: [64, 64, 64],
				spacing: [1, 1, 1],
				origin: [0, 0, 0],
				direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
				n_channels: 1,
				dtype: 'float32'
			});

			// Mock GPU resource allocation
			const mockGpuInfo1 = {
				atlas_index: 0,
				texture_coords: [0, 0, 1, 1],
				dim: [64, 64, 64],
				spacing: [1, 1, 1],
				origin: [0, 0, 0],
				direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
				voxel_to_world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				world_to_voxel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				data_range: { min: 0, max: 255 }
			};

			const mockGpuInfo2 = { ...mockGpuInfo1, atlas_index: 1 };

			vi.mocked(coreApi.request_layer_gpu_resources)
				.mockResolvedValueOnce(mockGpuInfo1)
				.mockResolvedValueOnce(mockGpuInfo2);

			// Mock render layer creation
			vi.mocked(coreApi.add_render_layer)
				.mockResolvedValueOnce(0)
				.mockResolvedValueOnce(1);

			// Load first volume
			const volumeId1 = await volumeService.loadVolume('/test/volume1.nii');
			expect(volumeId1).toBe('volume1');

			// Create first layer
			const layerSpec1: LayerSpec = {
				Volume: {
					id: 'layer1',
					source_resource_id: volumeId1,
					colormap: 'grayscale',
					slice_axis: null,
					slice_index: null
				}
			};

			const layerId1 = await layerService.addLayer(layerSpec1);

			// Verify first layer was added
			let state = layerStore.get();
			expect(state.layers).toHaveLength(1);
			expect(state.layers[0].id).toBe(layerId1);
			expect(state.layers[0].colormap).toBe('grayscale');

			// Load second volume
			const volumeId2 = await volumeService.loadVolume('/test/volume2.nii');
			expect(volumeId2).toBe('volume2');

			// Create second layer with different properties
			const layerSpec2: LayerSpec = {
				Volume: {
					id: 'layer2',
					source_resource_id: volumeId2,
					colormap: 'hot',
					slice_axis: null,
					slice_index: null
				}
			};

			const layerId2 = await layerService.addLayer(layerSpec2);

			// Verify both layers exist
			state = layerStore.get();
			expect(state.layers).toHaveLength(2);
			expect(state.layers[1].id).toBe(layerId2);
			expect(state.layers[1].colormap).toBe('hot');

			// Verify different atlas indices
			expect(state.layers[0].gpu?.atlas_index).toBe(0);
			expect(state.layers[1].gpu?.atlas_index).toBe(1);
		});

		it('should support updating layer properties independently', async () => {
			// Setup two layers (abbreviated setup)
			vi.mocked(coreApi.load_file).mockResolvedValue({
				id: 'volume1',
				handle: 'handle1',
				dims: [64, 64, 64],
				spacing: [1, 1, 1],
				origin: [0, 0, 0],
				direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
				n_channels: 1,
				dtype: 'float32'
			});

			vi.mocked(coreApi.request_layer_gpu_resources).mockResolvedValue({
				atlas_index: 0,
				texture_coords: [0, 0, 1, 1],
				dim: [64, 64, 64],
				spacing: [1, 1, 1],
				origin: [0, 0, 0],
				direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
				voxel_to_world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				world_to_voxel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				data_range: { min: 0, max: 255 }
			});

			vi.mocked(coreApi.add_render_layer).mockResolvedValue(0);

			// Create two layers
			const volumeId = await volumeService.loadVolume('/test/volume.nii');
			
			const layer1Id = await layerService.addLayer({
				Volume: {
					id: 'layer1',
					source_resource_id: volumeId,
					colormap: 'grayscale',
					slice_axis: null,
					slice_index: null
				}
			});

			const layer2Id = await layerService.addLayer({
				Volume: {
					id: 'layer2',
					source_resource_id: volumeId,
					colormap: 'hot',
					slice_axis: null,
					slice_index: null
				}
			});

			// Update opacity of first layer
			await layerService.updateLayerOpacity(layer1Id, 0.5);
			
			let state = layerStore.get();
			expect(state.layers[0].opacity).toBe(0.5);
			expect(state.layers[1].opacity).toBe(1.0); // Second layer unchanged

			// Update colormap of second layer
			await layerService.updateLayerColormap(layer2Id, 'viridis');
			
			state = layerStore.get();
			expect(state.layers[0].colormap).toBe('grayscale'); // First layer unchanged
			expect(state.layers[1].colormap).toBe('viridis');

			// Toggle visibility
			await layerService.toggleLayerVisibility(layer1Id);
			
			state = layerStore.get();
			expect(state.layers[0].visible).toBe(false);
			expect(state.layers[1].visible).toBe(true);
		});

		it('should emit events for multi-layer operations', async () => {
			const events: any[] = [];
			
			// Subscribe to layer events
			eventBus.on('layer.added', (data) => events.push({ type: 'added', data }));
			eventBus.on('layer.opacity.changed', (data) => events.push({ type: 'opacity', data }));
			eventBus.on('layer.colormap.changed', (data) => events.push({ type: 'colormap', data }));

			// Mock setup
			vi.mocked(coreApi.load_file).mockResolvedValue({
				id: 'volume1',
				handle: 'handle1',
				dims: [64, 64, 64],
				spacing: [1, 1, 1],
				origin: [0, 0, 0],
				direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
				n_channels: 1,
				dtype: 'float32'
			});

			vi.mocked(coreApi.request_layer_gpu_resources).mockResolvedValue({
				atlas_index: 0,
				texture_coords: [0, 0, 1, 1],
				dim: [64, 64, 64],
				spacing: [1, 1, 1],
				origin: [0, 0, 0],
				direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
				voxel_to_world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				world_to_voxel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				data_range: { min: 0, max: 255 }
			});

			vi.mocked(coreApi.add_render_layer).mockResolvedValue(0);

			// Add layer
			const volumeId = await volumeService.loadVolume('/test/volume.nii');
			const layerId = await layerService.addLayer({
				Volume: {
					id: 'layer1',
					source_resource_id: volumeId,
					colormap: 'grayscale',
					slice_axis: null,
					slice_index: null
				}
			});

			// Update properties
			await layerService.updateLayerOpacity(layerId, 0.7);
			await layerService.updateLayerColormap(layerId, 'plasma');

			// Verify events
			expect(events).toHaveLength(3);
			expect(events[0].type).toBe('added');
			expect(events[1].type).toBe('opacity');
			expect(events[1].data.opacity).toBe(0.7);
			expect(events[2].type).toBe('colormap');
			expect(events[2].data.colormap).toBe('plasma');
		});

		it('should handle layer removal correctly', async () => {
			// Mock setup for 3 layers
			vi.mocked(coreApi.load_file).mockResolvedValue({
				id: 'volume1',
				handle: 'handle1',
				dims: [64, 64, 64],
				spacing: [1, 1, 1],
				origin: [0, 0, 0],
				direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
				n_channels: 1,
				dtype: 'float32'
			});

			vi.mocked(coreApi.request_layer_gpu_resources).mockResolvedValue({
				atlas_index: 0,
				texture_coords: [0, 0, 1, 1],
				dim: [64, 64, 64],
				spacing: [1, 1, 1],
				origin: [0, 0, 0],
				direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
				voxel_to_world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				world_to_voxel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				data_range: { min: 0, max: 255 }
			});

			vi.mocked(coreApi.add_render_layer).mockResolvedValue(0);

			// Create 3 layers
			const volumeId = await volumeService.loadVolume('/test/volume.nii');
			const layerIds: string[] = [];

			for (let i = 0; i < 3; i++) {
				const layerId = await layerService.addLayer({
					Volume: {
						id: `layer${i}`,
						source_resource_id: volumeId,
						colormap: 'grayscale',
						slice_axis: null,
						slice_index: null
					}
				});
				layerIds.push(layerId);
			}

			expect(layerStore.get().layers).toHaveLength(3);

			// Remove middle layer
			await layerService.removeLayer(layerIds[1]);

			const state = layerStore.get();
			expect(state.layers).toHaveLength(2);
			expect(state.layers.map(l => l.id)).toEqual([layerIds[0], layerIds[2]]);
		});
	});
});