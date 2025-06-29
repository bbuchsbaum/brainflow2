/**
 * VolumeService Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VolumeService } from '../VolumeService';
import {
  createMockEventBus,
  createMockValidationService,
  createMockApi,
  createMockGpuResourceManager,
  testData,
  assertEventEmitted,
  waitForEvent
} from '$lib/testing/serviceTestUtils';

describe('VolumeService', () => {
  let volumeService: VolumeService;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let validator: ReturnType<typeof createMockValidationService>;
  let api: ReturnType<typeof createMockApi>;
  let gpuManager: ReturnType<typeof createMockGpuResourceManager>;

  beforeEach(() => {
    eventBus = createMockEventBus();
    validator = createMockValidationService();
    api = createMockApi();
    gpuManager = createMockGpuResourceManager();

    volumeService = new VolumeService({
      eventBus,
      validator,
      api,
      gpuManager
    });
  });

  describe('loadVolume', () => {
    it('should load a volume successfully', async () => {
      const path = '/test/volume.nii';
      const name = 'Test Volume';

      const result = await volumeService.loadVolume(path, name);

      // Check API was called
      expect(api.load_file).toHaveBeenCalledWith(path);

      // Check result
      expect(result).toMatchObject({
        Volume: {
          id: 'test-volume-id',
          shape: [256, 256, 128]
        }
      });

      // Check events were emitted
      assertEventEmitted(eventBus, 'volume.loading', { path });
      assertEventEmitted(eventBus, 'volume.loaded', {
        volumeId: 'test-volume-id',
        metadata: expect.objectContaining({
          id: 'test-volume-id',
          path,
          name
        })
      });

      // Check metadata was stored
      const metadata = volumeService.getVolumeMetadata('test-volume-id');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe(name);
    });

    it('should handle load errors', async () => {
      const path = '/test/invalid.nii';
      const error = new Error('File not found');
      api.load_file.mockRejectedValueOnce(error);

      await expect(volumeService.loadVolume(path)).rejects.toThrow('File not found');

      assertEventEmitted(eventBus, 'volume.load.failed', {
        path,
        error
      });
    });

    it('should validate file path', async () => {
      validator.validateSpy.mockImplementationOnce(() => {
        throw new Error('Invalid path');
      });

      await expect(volumeService.loadVolume('../invalid/path')).rejects.toThrow('Invalid path');
    });
  });

  describe('unloadVolume', () => {
    beforeEach(async () => {
      // Load a volume first
      await volumeService.loadVolume('/test/volume.nii');
    });

    it('should unload a volume', async () => {
      await volumeService.unloadVolume('test-volume-id');

      // Check GPU resources were released
      expect(gpuManager.releaseResourcesForVolume).toHaveBeenCalledWith('test-volume-id');

      // Check event was emitted
      assertEventEmitted(eventBus, 'volume.unloaded', { volumeId: 'test-volume-id' });

      // Check metadata was removed
      expect(volumeService.getVolumeMetadata('test-volume-id')).toBeUndefined();
    });

    it('should handle unload errors', async () => {
      const error = new Error('GPU error');
      gpuManager.releaseResourcesForVolume.mockRejectedValueOnce(error);

      await expect(volumeService.unloadVolume('test-volume-id')).rejects.toThrow('GPU error');

      assertEventEmitted(eventBus, 'volume.unload.failed', {
        volumeId: 'test-volume-id',
        error
      });
    });
  });

  describe('coordinate transformations', () => {
    beforeEach(async () => {
      await volumeService.loadVolume('/test/volume.nii');
    });

    it('should transform world to voxel coordinates', async () => {
      const worldCoord: [number, number, number] = [10, 20, 30];
      const expectedVoxel: [number, number, number] = [10, 20, 30];
      api.world_to_voxel.mockResolvedValueOnce(expectedVoxel);

      const result = await volumeService.worldToVoxel('test-volume-id', worldCoord);

      expect(api.world_to_voxel).toHaveBeenCalledWith('test-volume-id', worldCoord);
      expect(result).toEqual(expectedVoxel);
    });

    it('should transform voxel to world coordinates', async () => {
      const voxelCoord: [number, number, number] = [10, 20, 30];
      const expectedWorld: [number, number, number] = [10, 20, 30];
      api.voxel_to_world.mockResolvedValueOnce(expectedWorld);

      const result = await volumeService.voxelToWorld('test-volume-id', voxelCoord);

      expect(api.voxel_to_world).toHaveBeenCalledWith('test-volume-id', voxelCoord);
      expect(result).toEqual(expectedWorld);
    });

    it('should handle transformation errors', async () => {
      const error = new Error('Invalid coordinates');
      api.world_to_voxel.mockRejectedValueOnce(error);

      await expect(
        volumeService.worldToVoxel('test-volume-id', [0, 0, 0])
      ).rejects.toThrow('Invalid coordinates');

      assertEventEmitted(eventBus, 'volume.transform.failed');
    });
  });

  describe('slicing', () => {
    beforeEach(async () => {
      await volumeService.loadVolume('/test/volume.nii');
    });

    it('should get a slice from cache if available', async () => {
      const sliceData = { data: new Float32Array(256 * 256), width: 256, height: 256 };
      api.get_slice.mockResolvedValueOnce(sliceData);

      // First call - should hit API
      const result1 = await volumeService.getSlice('test-volume-id', 'axial', 64);
      expect(api.get_slice).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(sliceData);

      // Second call - should hit cache
      const result2 = await volumeService.getSlice('test-volume-id', 'axial', 64);
      expect(api.get_slice).toHaveBeenCalledTimes(1); // Not called again
      expect(result2).toEqual(sliceData);
    });

    it('should validate slice index bounds', async () => {
      await expect(
        volumeService.getSlice('test-volume-id', 'axial', 999)
      ).rejects.toThrow('out of bounds');

      await expect(
        volumeService.getSlice('test-volume-id', 'axial', -1)
      ).rejects.toThrow('out of bounds');
    });

    it('should handle slice errors', async () => {
      const error = new Error('Slice error');
      api.get_slice.mockRejectedValueOnce(error);

      await expect(
        volumeService.getSlice('test-volume-id', 'axial', 64)
      ).rejects.toThrow('Slice error');

      assertEventEmitted(eventBus, 'volume.slice.failed', {
        volumeId: 'test-volume-id',
        axis: 'axial',
        index: 64,
        error
      });
    });
  });

  describe('sampling', () => {
    beforeEach(async () => {
      await volumeService.loadVolume('/test/volume.nii');
    });

    it('should sample world coordinates', async () => {
      const coord: [number, number, number] = [10, 20, 30];
      const expectedValue = 42.5;
      api.sample_world_coordinate.mockResolvedValueOnce(expectedValue);

      const result = await volumeService.sampleWorldCoordinate('test-volume-id', coord);

      expect(api.sample_world_coordinate).toHaveBeenCalledWith('test-volume-id', coord);
      expect(result).toBe(expectedValue);
    });

    it('should handle sampling errors', async () => {
      const error = new Error('Sampling error');
      api.sample_world_coordinate.mockRejectedValueOnce(error);

      await expect(
        volumeService.sampleWorldCoordinate('test-volume-id', [0, 0, 0])
      ).rejects.toThrow('Sampling error');

      assertEventEmitted(eventBus, 'volume.sample.failed');
    });
  });

  describe('metadata management', () => {
    it('should track all loaded volumes', async () => {
      await volumeService.loadVolume('/test/volume1.nii', 'Volume 1');
      await volumeService.loadVolume('/test/volume2.nii', 'Volume 2');

      const allVolumes = volumeService.getAllVolumes();
      expect(allVolumes).toHaveLength(2);
      expect(allVolumes[0].name).toBe('Volume 1');
      expect(allVolumes[1].name).toBe('Volume 2');
    });

    it('should extract filename when name not provided', async () => {
      await volumeService.loadVolume('/path/to/test_volume.nii');

      const metadata = volumeService.getVolumeMetadata('test-volume-id');
      expect(metadata?.name).toBe('test_volume');
    });
  });

  describe('event handling', () => {
    it('should clear caches when volume is unloaded', async () => {
      await volumeService.loadVolume('/test/volume.nii');
      
      // Cache some data
      await volumeService.getSlice('test-volume-id', 'axial', 64);
      
      // Emit unload event
      eventBus.emit('volume.unload', { volumeId: 'test-volume-id' });
      
      // Check metadata was cleared
      expect(volumeService.getVolumeMetadata('test-volume-id')).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should dispose properly', async () => {
      await volumeService.loadVolume('/test/volume.nii');
      
      volumeService.dispose();
      
      expect(volumeService.getAllVolumes()).toHaveLength(0);
    });
  });
});