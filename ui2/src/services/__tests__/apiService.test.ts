/**
 * API Service Integration Tests
 * Tests the high-level API service with mock transport
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApiService } from '../apiService';
import { MockTransport } from '../transport';
import { createMockViewState } from '../../test-setup';

describe('ApiService', () => {
  let apiService: ApiService;
  let mockTransport: MockTransport;

  beforeEach(() => {
    mockTransport = new MockTransport();
    mockTransport.clearCallLog();
    apiService = new ApiService(mockTransport);
  });

  describe('applyAndRenderViewState', () => {
    it('should render view state using new render_view API by default', async () => {
      const viewState = createMockViewState();
      // Add a test layer so we actually call the backend
      viewState.layers = [{
        id: 'test-layer',
        volumeId: 'test-volume',
        visible: true,
        opacity: 1.0,
        render: {
          colormapId: 0,
          intensityMin: 0,
          intensityMax: 1000,
          blendMode: 0,
          thresholdLow: 0,
          thresholdHigh: 1000,
          thresholdMode: 0
        }
      }];
      
      const result = await apiService.applyAndRenderViewState(viewState);
      
      expect(result).toBeDefined();
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
      
      const calls = mockTransport.getCallLog();
      // The API may make multiple calls due to fallback logic
      const renderViewCall = calls.find(c => c.cmd === 'render_view');
      expect(renderViewCall).toBeDefined();
      expect(renderViewCall.args.stateJson).toBeDefined();
      expect(renderViewCall.args.format).toBe('rgba'); // Should default to rgba
    });

    it('should serialize view state correctly', async () => {
      const viewState = createMockViewState();
      viewState.crosshair.world_mm = [10, 20, 30];
      // Add a test layer so we actually call the backend
      viewState.layers = [{
        id: 'test-layer',
        volumeId: 'test-volume',
        visible: true,
        opacity: 1.0,
        render: {
          colormapId: 0,
          intensityMin: 0,
          intensityMax: 1000,
          blendMode: 0,
          thresholdLow: 0,
          thresholdHigh: 1000,
          thresholdMode: 0
        }
      }];
      
      await apiService.applyAndRenderViewState(viewState);
      
      const calls = mockTransport.getCallLog();
      // This test might use render_view (stateJson) or legacy API (viewStateJson)
      const args = calls[0].args;
      const serializedState = JSON.parse(args.stateJson || args.viewStateJson);
      expect(serializedState.crosshair.world_mm).toEqual([10, 20, 30]);
    });

    it('should use new render_view API when enabled', async () => {
      // Enable the new API
      apiService.setUseNewRenderAPI(true);
      
      const viewState = createMockViewState();
      // Add a test layer so we actually call the backend
      viewState.layers = [{
        id: 'test-layer',
        volumeId: 'test-volume',
        visible: true,
        opacity: 1.0,
        render: {
          colormapId: 0,
          intensityMin: 0,
          intensityMax: 1000,
          blendMode: 0,
          thresholdLow: 0,
          thresholdHigh: 1000,
          thresholdMode: 0
        }
      }];
      
      const result = await apiService.applyAndRenderViewState(viewState);
      
      expect(result).toBeDefined();
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
      
      const calls = mockTransport.getCallLog();
      // The API may make multiple calls due to fallback logic
      const renderViewCall = calls.find(c => c.cmd === 'render_view');
      expect(renderViewCall).toBeDefined();
      expect(renderViewCall.args.stateJson).toBeDefined();
      expect(renderViewCall.args.format).toBe('rgba'); // Should default to rgba
    });
  });

  describe('loadFile', () => {
    it('should load volume file and return handle', async () => {
      const result = await apiService.loadFile('/test/brain.nii.gz');
      
      expect(result).toMatchObject({
        id: expect.stringMatching(/^mock-volume-/),
        name: 'brain.nii.gz',
        dims: [182, 218, 182],
        voxel_size: [1.0, 1.0, 1.0],
        affine: expect.any(Array),
      });
      
      const calls = mockTransport.getCallLog();
      expect(calls[0].cmd).toBe('load_file');
      expect(calls[0].args.path).toBe('/test/brain.nii.gz');
    });
  });

  describe('listDirectory', () => {
    it('should list directory contents', async () => {
      const result = await apiService.listDirectory('/test/data');
      
      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        id: '/test/data/data',
        name: 'data',
        isDir: true,
      });
      
      const calls = mockTransport.getCallLog();
      expect(calls[0].cmd).toBe('fs_list_directory');
      expect(calls[0].args.path).toBe('/test/data');
    });

    it('should respect maxDepth parameter', async () => {
      await apiService.listDirectory('/test/data', 3);
      
      const calls = mockTransport.getCallLog();
      expect(calls[0].args.maxDepth).toBe(3);
    });
  });

  describe('sampleWorldCoordinate', () => {
    it('should sample value at world coordinate', async () => {
      const worldCoord: [number, number, number] = [10, 20, 30];
      
      const result = await apiService.sampleWorldCoordinate(worldCoord);
      
      expect(result).toMatchObject({
        value: expect.any(Number),
        coordinate: worldCoord,
      });
      
      const calls = mockTransport.getCallLog();
      expect(calls[0].cmd).toBe('sample_world_coordinate');
      expect(calls[0].args.worldCoord).toEqual(worldCoord);
    });
  });

  describe('render loop operations', () => {
    it('should initialize render loop', async () => {
      await apiService.initRenderLoop(512, 512);
      
      const calls = mockTransport.getCallLog();
      expect(calls[0].cmd).toBe('init_render_loop');
      expect(calls[0].args).toEqual({ width: 512, height: 512 });
    });

    it('should resize canvas', async () => {
      await apiService.resizeCanvas(1024, 768);
      
      const calls = mockTransport.getCallLog();
      expect(calls[0].cmd).toBe('resize_canvas');
      expect(calls[0].args).toEqual({ width: 1024, height: 768 });
    });
  });

  describe('layer management', () => {
    it('should add render layer', async () => {
      await apiService.addRenderLayer('layer1', 'volume1');
      
      const calls = mockTransport.getCallLog();
      expect(calls[0].cmd).toBe('add_render_layer');
      expect(calls[0].args).toEqual({ layerId: 'layer1', volumeId: 'volume1' });
    });

    it('should remove render layer', async () => {
      await apiService.removeRenderLayer('layer1');
      
      const calls = mockTransport.getCallLog();
      expect(calls[0].cmd).toBe('remove_render_layer');
      expect(calls[0].args).toEqual({ layerId: 'layer1' });
    });

    it('should patch layer properties', async () => {
      const patch = { opacity: 0.5, colormap: 'viridis' };
      await apiService.patchLayer('layer1', patch);
      
      const calls = mockTransport.getCallLog();
      expect(calls[0].cmd).toBe('patch_layer');
      expect(calls[0].args).toEqual({ layerId: 'layer1', patch });
    });
  });

  describe('error handling', () => {
    it('should handle transport errors gracefully', async () => {
      // Mock transport to throw error
      mockTransport.setMockResponse('load_file', () => {
        throw new Error('File not found');
      });

      await expect(apiService.loadFile('/nonexistent.nii.gz'))
        .rejects.toThrow('File not found');
    });
  });

  describe('performance and coalescing', () => {
    it('should handle rapid successive calls', async () => {
      const viewState = createMockViewState();
      // Add a test layer so we actually call the backend
      viewState.layers = [{
        id: 'test-layer',
        volumeId: 'test-volume',
        visible: true,
        opacity: 1.0,
        render: {
          colormapId: 0,
          intensityMin: 0,
          intensityMax: 1000,
          blendMode: 0,
          thresholdLow: 0,
          thresholdHigh: 1000,
          thresholdMode: 0
        }
      }];
      
      // Fire off multiple rapid calls
      const promises = Array.from({ length: 10 }, () => 
        apiService.applyAndRenderViewState(viewState)
      );
      
      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      
      // All calls should have succeeded
      results.forEach(result => {
        expect(result.width).toBe(256);
        expect(result.height).toBe(256);
      });
    });
  });
});