/**
 * Simplified Resilience Tests
 * Pragmatic tests for the top 3 failure modes researchers actually encounter.
 * We're not testing every edge case - just the ones that matter in research environments.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VolumeService } from '../VolumeService';
import { LayerService } from '../LayerService';
import { GpuResourceService } from '../GpuResourceService';
import { EventBus } from '$lib/events/EventBus';
import { ValidationService } from '$lib/validation/ValidationService';
import type { Api } from '@brainflow/api';
import { coreApi } from '$lib/api';

// Mock the API
vi.mock('$lib/api', () => ({
	coreApi: {
		load_file: vi.fn(),
		get_slice: vi.fn(),
		request_layer_gpu_resources: vi.fn(),
		sample_world_coordinate: vi.fn()
	}
}));

describe('Top 3 Real-World Failure Modes', () => {
	let volumeService: VolumeService;
	let layerService: LayerService;
	let gpuService: GpuResourceService;
	let eventBus: EventBus;

	beforeEach(() => {
		vi.clearAllMocks();
		eventBus = new EventBus();

		// Create mock dependencies
		const mockValidator = {
			validate: vi.fn((type: string, value: any) => value)
		};

		const mockGpuManager = {
			requestTexture: vi.fn(),
			releaseTexture: vi.fn(),
			releaseResourcesForVolume: vi.fn(),
			getTextureInfo: vi.fn(),
			clearCache: vi.fn()
		};

		const mockConfigService = {
			get: vi.fn((key: string, defaultValue: any) => defaultValue)
		};

		const mockNotificationService = {
			info: vi.fn(),
			error: vi.fn(),
			warning: vi.fn(),
			success: vi.fn()
		};

		// Create services
		volumeService = new VolumeService({
			eventBus,
			validator: mockValidator as any,
			api: coreApi,
			gpuManager: mockGpuManager as any
		});

		// Create mock GPU resource service
		const mockGpuResourceService = {
			requestLayerGpuResources: vi.fn(),
			releaseLayerGpuResources: vi.fn()
		};

		layerService = new LayerService({
			api: coreApi as any,
			eventBus,
			validator: mockValidator as any,
			gpuResourceService: mockGpuResourceService as any
		});

		gpuService = new GpuResourceService({
			eventBus,
			configService: mockConfigService as any,
			notificationService: mockNotificationService as any
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('1. Network/File System Timeouts', () => {
		it('should handle network timeout when loading large files', async () => {
			// This is THE most common issue - loading large fMRI datasets over network shares
			const timeoutError = new Error('ETIMEDOUT: Operation timed out');
			timeoutError.name = 'TimeoutError';

			vi.mocked(coreApi.load_file).mockRejectedValue(timeoutError);

			// Should throw with helpful error message
			await expect(volumeService.loadVolume('/network/large_fmri_dataset.nii')).rejects.toThrow(
				'Operation timed out'
			);
		});

		it('should handle timeout during slice data fetch', async () => {
			// Common when accessing data from slow network storage
			const timeoutError = new Error('Network timeout');
			timeoutError.name = 'TimeoutError';

			// First load succeeds
			vi.mocked(coreApi.load_file).mockResolvedValue({
				Volume: {
					id: 'test-volume',
					shape: [256, 256, 128],
					voxel_size: [1, 1, 1],
					dtype: 'float32',
					origin: [0, 0, 0],
					spacing: [1, 1, 1]
				}
			});

			await volumeService.loadVolume('/data/volume.nii');

			// But slice fetch times out
			vi.mocked(coreApi.get_slice).mockRejectedValue(timeoutError);

			await expect(volumeService.getSlice('test-volume', 'axial', 64)).rejects.toThrow(
				'Network timeout'
			);
		});

		it('should provide actionable error for network issues', async () => {
			// Researchers need to know if it's a network issue vs corrupted file
			const networkError = new Error('ECONNREFUSED: Connection refused to server');
			networkError.name = 'NetworkError';

			vi.mocked(coreApi.load_file).mockRejectedValue(networkError);

			try {
				await volumeService.loadVolume('/remote/data.nii');
				expect.fail('Should have thrown');
			} catch (error: any) {
				expect(error.message).toContain('Connection refused');
				// In a real app, we'd show: "Check network connection to data server"
			}
		});
	});

	describe('2. File Not Found / Permission Issues', () => {
		it('should handle missing files with clear error', async () => {
			// Very common when paths change or data is moved
			const notFoundError = new Error('ENOENT: no such file or directory');
			notFoundError.name = 'FileNotFoundError';

			vi.mocked(coreApi.load_file).mockRejectedValue(notFoundError);

			await expect(volumeService.loadVolume('/old/path/moved_data.nii')).rejects.toThrow(
				'no such file or directory'
			);
		});

		it('should handle permission denied errors', async () => {
			// Common in shared computing environments
			const permissionError = new Error('EACCES: permission denied');
			permissionError.name = 'PermissionError';

			vi.mocked(coreApi.load_file).mockRejectedValue(permissionError);

			await expect(volumeService.loadVolume('/restricted/patient_data.nii')).rejects.toThrow(
				'permission denied'
			);
		});

		it('should handle file moved during analysis', async () => {
			// Can happen when someone reorganizes data while analysis is running
			// Load succeeds initially
			vi.mocked(coreApi.load_file).mockResolvedValue({
				Volume: {
					id: 'test-volume',
					shape: [256, 256, 128],
					voxel_size: [1, 1, 1],
					dtype: 'float32',
					origin: [0, 0, 0],
					spacing: [1, 1, 1]
				}
			});

			await volumeService.loadVolume('/data/temp_location.nii');

			// But later operations fail because file was moved
			const movedError = new Error('ENOENT: File moved or deleted');
			vi.mocked(coreApi.sample_world_coordinate).mockRejectedValue(movedError);

			await expect(volumeService.sampleWorldCoordinate('test-volume', [0, 0, 0])).rejects.toThrow(
				'File moved or deleted'
			);
		});
	});

	describe('3. GPU Context Loss / Resource Exhaustion', () => {
		let mockGpuResourceService: any;

		beforeEach(() => {
			// Get the mock from the layerService config
			mockGpuResourceService = (layerService as any).config.gpuResourceService;
		});

		it('should handle GPU context loss', async () => {
			// Happens when GPU driver crashes or system suspends
			const contextLostError = new Error('WebGPU context lost');
			contextLostError.name = 'GPUContextLostError';

			// Setup layer spec
			const layerSpec = {
				Volume: {
					id: 'layer-1',
					source_resource_id: 'volume-1',
					colormap: 'grayscale' as const
				}
			};

			mockGpuResourceService.requestLayerGpuResources.mockRejectedValue(contextLostError);

			await expect(layerService.requestGpuResources(layerSpec)).rejects.toThrow(
				'WebGPU context lost'
			);

			// In real app: Show "GPU context lost. Please refresh the application."
		});

		it('should handle GPU memory exhaustion', async () => {
			// Common when loading multiple large volumes
			const memoryError = new Error('GPU out of memory');
			memoryError.name = 'GPUOutOfMemoryError';

			const layerSpec = {
				Volume: {
					id: 'layer-huge',
					source_resource_id: 'huge-volume',
					colormap: 'viridis' as const
				}
			};

			mockGpuResourceService.requestLayerGpuResources.mockRejectedValue(memoryError);

			await expect(layerService.requestGpuResources(layerSpec)).rejects.toThrow(
				'GPU out of memory'
			);

			// In real app: "GPU memory full. Try closing other volumes."
		});

		it('should detect WebGPU not supported', async () => {
			// For browsers/systems without WebGPU support
			const notSupportedError = new Error('WebGPU not supported');
			notSupportedError.name = 'GPUNotSupportedError';

			const layerSpec = {
				Volume: {
					id: 'layer-1',
					source_resource_id: 'volume-1',
					colormap: 'grayscale' as const
				}
			};

			mockGpuResourceService.requestLayerGpuResources.mockRejectedValue(notSupportedError);

			await expect(layerService.requestGpuResources(layerSpec)).rejects.toThrow(
				'WebGPU not supported'
			);

			// In real app: "WebGPU required. Use Chrome 113+ or Edge 113+."
		});
	});

	describe('Practical Recovery Strategies', () => {
		it('should suggest retry for timeout errors', async () => {
			// For timeouts, retry often works
			const timeoutError = new Error('Operation timed out');
			timeoutError.name = 'TimeoutError';

			vi.mocked(coreApi.load_file)
				.mockRejectedValueOnce(timeoutError)
				.mockResolvedValueOnce({
					Volume: {
						id: 'test-volume',
						shape: [256, 256, 128],
						voxel_size: [1, 1, 1],
						dtype: 'float32',
						origin: [0, 0, 0],
						spacing: [1, 1, 1]
					}
				});

			// First attempt fails
			await expect(volumeService.loadVolume('/slow/network/data.nii')).rejects.toThrow(
				'Operation timed out'
			);

			// But retry succeeds
			const result = await volumeService.loadVolume('/slow/network/data.nii');
			expect(result.Volume.id).toBe('test-volume');
		});

		it('should not retry permission errors', async () => {
			// No point retrying permission errors - need user action
			const permissionError = new Error('Permission denied');
			permissionError.name = 'PermissionError';

			vi.mocked(coreApi.load_file).mockRejectedValue(permissionError);

			// Should fail immediately without retry
			await expect(volumeService.loadVolume('/restricted/data.nii')).rejects.toThrow(
				'Permission denied'
			);

			// Verify only called once (no retry)
			expect(vi.mocked(coreApi.load_file)).toHaveBeenCalledTimes(1);
		});

		it('should handle graceful degradation for GPU issues', async () => {
			// When GPU fails, we can still show volume info
			vi.mocked(coreApi.load_file).mockResolvedValue({
				Volume: {
					id: 'test-volume',
					shape: [256, 256, 128],
					voxel_size: [1, 1, 1],
					dtype: 'float32',
					origin: [0, 0, 0],
					spacing: [1, 1, 1]
				}
			});

			const volumeHandle = await volumeService.loadVolume('/data/scan.nii');
			expect(volumeHandle.Volume.id).toBe('test-volume');

			// Get the mock GPU resource service
			const mockGpuResourceService = (layerService as any).config.gpuResourceService;

			// GPU request fails
			const gpuError = new Error('GPU context lost');
			mockGpuResourceService.requestLayerGpuResources.mockRejectedValue(gpuError);

			const layerSpec = {
				Volume: {
					id: 'layer-1',
					source_resource_id: 'test-volume',
					colormap: 'grayscale' as const
				}
			};

			// GPU fails but we still have volume metadata
			await expect(layerService.requestGpuResources(layerSpec)).rejects.toThrow('GPU context lost');

			// But we can still query volume info
			const metadata = volumeService.getVolumeMetadata('test-volume');
			expect(metadata).toBeDefined();
			expect(metadata?.dimensions).toEqual([256, 256, 128]);
		});
	});
});
