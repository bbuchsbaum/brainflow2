import { describe, it, expect, vi, beforeEach } from 'vitest';
import { coreApi } from './api';
import type { LayerSpec } from './api';
import * as tauriCore from '@tauri-apps/api/core';

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

describe('Core API', () => {
	const mockInvoke = vi.mocked(tauriCore.invoke);

	beforeEach(() => {
		mockInvoke.mockClear();
	});

	describe('load_file', () => {
		it('should call invoke with correct parameters', async () => {
			const mockResult = {
				id: 'volume-123',
				name: 'test.nii',
				dims: [256, 256, 128],
				dtype: 'float32'
			};
			mockInvoke.mockResolvedValueOnce(mockResult);

			const result = await coreApi.load_file('/path/to/file.nii');

			expect(mockInvoke).toHaveBeenCalledWith('plugin:api-bridge|load_file', {
				path: '/path/to/file.nii'
			});
			expect(result).toEqual(mockResult);
		});

		it('should handle errors', async () => {
			const mockError = new Error('File not found');
			mockInvoke.mockRejectedValueOnce(mockError);

			await expect(coreApi.load_file('/invalid/path')).rejects.toThrow('File not found');
		});
	});

	describe('world_to_voxel', () => {
		it('should return voxel coordinates when valid', async () => {
			const mockResult = [128, 64, 32];
			mockInvoke.mockResolvedValueOnce(mockResult);

			const result = await coreApi.world_to_voxel('volume-123', [10.5, 20.3, 30.1]);

			expect(mockInvoke).toHaveBeenCalledWith('plugin:api-bridge|world_to_voxel', {
				volumeId: 'volume-123',
				worldCoord: [10.5, 20.3, 30.1]
			});
			expect(result).toEqual(mockResult);
		});

		it('should return null when coordinates are out of bounds', async () => {
			mockInvoke.mockResolvedValueOnce(null);

			const result = await coreApi.world_to_voxel('volume-123', [1000, 2000, 3000]);

			expect(result).toBeNull();
		});
	});

	describe('request_layer_gpu_resources', () => {
		it('should request GPU resources for volume layer', async () => {
			const layerSpec: LayerSpec = {
				Volume: {
					id: 'layer-1',
					source_resource_id: 'volume-123',
					colormap: 'grayscale',
					slice_axis: null,
					slice_index: null
				}
			};
			
			const mockResult = {
				layer_id: 'layer-1',
				world_to_voxel: new Array(16).fill(0),
				dim: [256, 256, 128],
				pad_slices: 1,
				tex_format: 'R16Float' as const
			};
			mockInvoke.mockResolvedValueOnce(mockResult);

			const result = await coreApi.request_layer_gpu_resources(layerSpec);

			expect(mockInvoke).toHaveBeenCalledWith('plugin:api-bridge|request_layer_gpu_resources', {
				layerSpec: layerSpec
			});
			expect(result).toEqual(mockResult);
		});
	});

	describe('set_crosshair', () => {
		it('should set crosshair position', async () => {
			mockInvoke.mockResolvedValueOnce(undefined);

			await coreApi.set_crosshair([100, 150, 75]);

			expect(mockInvoke).toHaveBeenCalledWith('plugin:api-bridge|set_crosshair', {
				worldCoords: [100, 150, 75]
			});
		});
	});

	describe('set_frame_params', () => {
		it('should set frame parameters', async () => {
			mockInvoke.mockResolvedValueOnce(undefined);

			const origin: [number, number, number, number] = [0, 0, 0, 1];
			const uBasis: [number, number, number, number] = [1, 0, 0, 0];
			const vBasis: [number, number, number, number] = [0, 1, 0, 0];

			await coreApi.set_frame_params(origin, uBasis, vBasis);

			expect(mockInvoke).toHaveBeenCalledWith('plugin:api-bridge|set_frame_params', {
				origin: origin,
				uBasis: uBasis,
				vBasis: vBasis
			});
		});
	});

	describe('fs_list_directory', () => {
		it('should list directory contents', async () => {
			const mockResult = {
				nodes: [
					{ id: '/test/file1.nii', name: 'file1.nii', parent_idx: null, icon_id: 1, is_dir: false },
					{ id: '/test/subdir', name: 'subdir', parent_idx: null, icon_id: 2, is_dir: true }
				]
			};
			mockInvoke.mockResolvedValueOnce(mockResult);

			const result = await coreApi.fs_list_directory('/test');

			expect(mockInvoke).toHaveBeenCalledWith('plugin:api-bridge|fs_list_directory', {
				dir: '/test'
			});
			expect(result).toEqual(mockResult);
		});
	});

	describe('supports_webgpu', () => {
		it('should check WebGPU support', async () => {
			mockInvoke.mockResolvedValueOnce(true);

			const result = await coreApi.supports_webgpu();

			expect(mockInvoke).toHaveBeenCalledWith('plugin:api-bridge|supports_webgpu');
			expect(result).toBe(true);
		});

		it('should return false on error', async () => {
			mockInvoke.mockRejectedValueOnce(new Error('WebGPU check failed'));

			const result = await coreApi.supports_webgpu();

			expect(result).toBe(false);
		});
	});
});