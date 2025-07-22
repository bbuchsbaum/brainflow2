import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GpuRenderManager } from './renderManager';
import { coreApi } from '$lib/api';

// Mock coreApi
vi.mock('$lib/api', () => ({
	coreApi: {
		init_render_loop: vi.fn(),
		setup_render_layers: vi.fn(),
		render_synchronized_view: vi.fn(),
		extract_slice: vi.fn()
	}
}));

describe('Multi-Volume Rendering Tests', () => {
	let renderManager: GpuRenderManager;

	beforeEach(() => {
		renderManager = new GpuRenderManager();
		vi.clearAllMocks();
	});

	describe('Layer Setup and Management', () => {
		it('should correctly setup single layer', async () => {
			const layers = [{
				volumeId: 'volume1',
				opacity: 1.0,
				colormapId: 0,
				window: { level: 0.5, width: 1.0 },
				atlasIndex: 0
			}];

			await renderManager.setupLayers(layers);

			expect(coreApi.setup_render_layers).toHaveBeenCalledWith([{
				volume_id: 'volume1',
				opacity: 1.0,
				colormap_id: 0,
				window_level: 0.5,
				window_width: 1.0,
				threshold_enabled: false,
				threshold_min: 0,
				threshold_max: 1,
				atlas_index: 0
			}]);
		});

		it('should correctly setup multiple layers with different properties', async () => {
			const layers = [
				{
					volumeId: 'brain-t1',
					opacity: 1.0,
					colormapId: 0, // grayscale
					window: { level: 0.5, width: 1.0 },
					atlasIndex: 0
				},
				{
					volumeId: 'brain-mask',
					opacity: 0.5,
					colormapId: 1, // hot
					window: { level: 0.5, width: 1.0 },
					atlasIndex: 1
				},
				{
					volumeId: 'activation',
					opacity: 0.7,
					colormapId: 2, // viridis
					window: { level: 0.3, width: 0.6 },
					threshold: { min: 0.2, max: 0.8, enabled: true },
					atlasIndex: 2
				}
			];

			await renderManager.setupLayers(layers);

			const expectedCall = [
				{
					volume_id: 'brain-t1',
					opacity: 1.0,
					colormap_id: 0,
					window_level: 0.5,
					window_width: 1.0,
					threshold_enabled: false,
					threshold_min: 0,
					threshold_max: 1,
					atlas_index: 0
				},
				{
					volume_id: 'brain-mask',
					opacity: 0.5,
					colormap_id: 1,
					window_level: 0.5,
					window_width: 1.0,
					threshold_enabled: false,
					threshold_min: 0,
					threshold_max: 1,
					atlas_index: 1
				},
				{
					volume_id: 'activation',
					opacity: 0.7,
					colormap_id: 2,
					window_level: 0.3,
					window_width: 0.6,
					threshold_enabled: true,
					threshold_min: 0.2,
					threshold_max: 0.8,
					atlas_index: 2
				}
			];

			expect(coreApi.setup_render_layers).toHaveBeenCalledWith(expectedCall);
		});

		it('should handle empty layer array', async () => {
			await renderManager.setupLayers([]);
			expect(coreApi.setup_render_layers).toHaveBeenCalledWith([]);
		});

		it('should track current layers internally', async () => {
			const layers = [
				{
					volumeId: 'volume1',
					opacity: 0.8,
					colormapId: 3,
					window: { level: 0.4, width: 0.9 },
					atlasIndex: 0
				}
			];

			await renderManager.setupLayers(layers);
			const currentLayers = renderManager.getCurrentLayers();
			
			expect(currentLayers).toEqual(layers);
			expect(currentLayers).toHaveLength(1);
			expect(currentLayers[0].volumeId).toBe('volume1');
			expect(currentLayers[0].opacity).toBe(0.8);
		});
	});

	describe('Layer Updates', () => {
		it('should update layer opacity', async () => {
			// Initial setup
			const layers = [{
				volumeId: 'volume1',
				opacity: 1.0,
				colormapId: 0,
				window: { level: 0.5, width: 1.0 },
				atlasIndex: 0
			}];

			await renderManager.setupLayers(layers);
			expect(coreApi.setup_render_layers).toHaveBeenCalledTimes(1);

			// Update opacity
			layers[0].opacity = 0.5;
			await renderManager.setupLayers(layers);
			
			expect(coreApi.setup_render_layers).toHaveBeenCalledTimes(2);
			const lastCall = vi.mocked(coreApi.setup_render_layers).mock.lastCall?.[0];
			expect(lastCall?.[0].opacity).toBe(0.5);
		});

		it('should update layer colormap', async () => {
			const layers = [{
				volumeId: 'volume1',
				opacity: 1.0,
				colormapId: 0,
				window: { level: 0.5, width: 1.0 },
				atlasIndex: 0
			}];

			await renderManager.setupLayers(layers);
			
			// Change colormap
			layers[0].colormapId = 5; // turbo
			await renderManager.setupLayers(layers);
			
			const lastCall = vi.mocked(coreApi.setup_render_layers).mock.lastCall?.[0];
			expect(lastCall?.[0].colormap_id).toBe(5);
		});

		it('should handle adding and removing layers', async () => {
			// Start with one layer
			let layers = [{
				volumeId: 'volume1',
				opacity: 1.0,
				colormapId: 0,
				window: { level: 0.5, width: 1.0 },
				atlasIndex: 0
			}];

			await renderManager.setupLayers(layers);
			expect(renderManager.getCurrentLayers()).toHaveLength(1);

			// Add second layer
			layers.push({
				volumeId: 'volume2',
				opacity: 0.6,
				colormapId: 1,
				window: { level: 0.5, width: 1.0 },
				atlasIndex: 1
			});

			await renderManager.setupLayers(layers);
			expect(renderManager.getCurrentLayers()).toHaveLength(2);

			// Remove first layer
			layers = layers.slice(1);
			await renderManager.setupLayers(layers);
			expect(renderManager.getCurrentLayers()).toHaveLength(1);
			expect(renderManager.getCurrentLayers()[0].volumeId).toBe('volume2');
		});
	});

	describe('Rendering with Multiple Layers', () => {
		beforeEach(async () => {
			await renderManager.initialize();
		});

		it('should render synchronized view with all layers', async () => {
			// Setup multiple layers
			const layers = [
				{
					volumeId: 'base',
					opacity: 1.0,
					colormapId: 0,
					window: { level: 0.5, width: 1.0 },
					atlasIndex: 0
				},
				{
					volumeId: 'overlay',
					opacity: 0.5,
					colormapId: 1,
					window: { level: 0.5, width: 1.0 },
					atlasIndex: 1
				}
			];

			await renderManager.setupLayers(layers);

			// Mock render response
			vi.mocked(coreApi.render_synchronized_view).mockResolvedValue({
				image_data: new Uint8Array(512 * 512 * 4),
				width: 512,
				height: 512,
				transform: {
					scale: [1, 1],
					translate: [0, 0]
				}
			});

			// Render each view type
			for (const viewType of [0, 1, 2] as const) {
				const result = await renderManager.renderSynchronizedView(
					512, 512,
					[50, 50, 50],
					viewType,
					1024, 768
				);

				expect(result).toBeDefined();
				expect(result.width).toBe(512);
				expect(result.height).toBe(512);
			}

			expect(coreApi.render_synchronized_view).toHaveBeenCalledTimes(3);
		});

		it('should maintain layer order during rendering', async () => {
			const layers = [
				{ volumeId: 'layer1', opacity: 1.0, colormapId: 0, window: { level: 0.5, width: 1.0 }, atlasIndex: 0 },
				{ volumeId: 'layer2', opacity: 0.7, colormapId: 1, window: { level: 0.5, width: 1.0 }, atlasIndex: 1 },
				{ volumeId: 'layer3', opacity: 0.5, colormapId: 2, window: { level: 0.5, width: 1.0 }, atlasIndex: 2 }
			];

			await renderManager.setupLayers(layers);

			const setupCall = vi.mocked(coreApi.setup_render_layers).mock.lastCall?.[0];
			expect(setupCall?.map(l => l.volume_id)).toEqual(['layer1', 'layer2', 'layer3']);
		});
	});

	describe('Error Handling', () => {
		it('should handle API errors gracefully', async () => {
			vi.mocked(coreApi.setup_render_layers).mockRejectedValue(new Error('GPU error'));

			const layers = [{
				volumeId: 'volume1',
				opacity: 1.0,
				colormapId: 0,
				window: { level: 0.5, width: 1.0 },
				atlasIndex: 0
			}];

			await expect(renderManager.setupLayers(layers)).rejects.toThrow('GPU error');
		});

		it('should handle invalid layer data', async () => {
			const invalidLayers = [
				{
					volumeId: '',  // Invalid empty ID
					opacity: 1.5,  // Invalid opacity > 1
					colormapId: -1, // Invalid colormap
					window: { level: 0.5, width: 1.0 },
					atlasIndex: 0
				}
			];

			// The render manager should still pass this to the API
			// Validation should happen at the service layer
			await renderManager.setupLayers(invalidLayers as any);
			
			expect(coreApi.setup_render_layers).toHaveBeenCalledWith([{
				volume_id: '',
				opacity: 1.5,
				colormap_id: -1,
				window_level: 0.5,
				window_width: 1.0,
				threshold_enabled: false,
				threshold_min: 0,
				threshold_max: 1,
				atlas_index: 0
			}]);
		});
	});
});