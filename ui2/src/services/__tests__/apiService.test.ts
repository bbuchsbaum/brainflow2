/**
 * API Service Integration Tests
 * Tests the high-level API service with mock transport
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApiService } from '../apiService';
import { MockTransport } from '../transport';
import { createMockViewState } from '../../test-setup';
import { clearRenderDiagnostics, getRenderDiagnostics } from '../render/RenderDiagnostics';

describe('ApiService', () => {
  let apiService: ApiService;
  let mockTransport: MockTransport;

  beforeEach(() => {
    mockTransport = new MockTransport();
    mockTransport.clearCallLog();
    clearRenderDiagnostics();
    apiService = new ApiService(mockTransport);
    apiService.setRawRGBA(true);
  });

  describe('applyAndRenderViewState', () => {
    it('should render view state using new render_view API by default', async () => {
      const viewState = createMockViewState();
      viewState.timepoint = 7;
      // Add a test layer so we actually call the backend
      viewState.layers = [{
        id: 'test-layer',
        volumeId: 'test-volume',
        visible: true,
        opacity: 1.0,
        colormap: 'gray',
        intensity: [0, 1000] as [number, number],
        threshold: [0, 1000] as [number, number],
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
      
      const result = await apiService.applyAndRenderViewState(viewState, 'axial');
      
      expect(result).toBeDefined();
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
      
      const calls = mockTransport.getCallLog();
      const renderViewCall = calls.find(c => c.cmd === 'render_view');
      expect(renderViewCall).toBeDefined();
      expect(calls).toHaveLength(1);
      expect(renderViewCall.args.stateJson).toBeDefined();
      expect(renderViewCall.args.format).toBe('rgba'); // Should default to rgba
      expect(JSON.parse(renderViewCall.args.stateJson).timepoint).toBe(7);
      expect(calls.some(c => c.cmd.startsWith('apply_and_render_view_state'))).toBe(false);
      expect(
        getRenderDiagnostics().find((entry) => entry.stage === 'api.render_view')?.detail
      ).toMatchObject({
        format: 'rgba',
        ok: true
      });
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
        colormap: 'gray',
        intensity: [0, 1000] as [number, number],
        threshold: [0, 1000] as [number, number],
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
      const args = calls[0].args;
      const serializedState = JSON.parse(args.stateJson);
      expect(serializedState.crosshair.world_mm).toEqual([10, 20, 30]);
    });

    it('should use render_view for single-view rendering', async () => {
      const viewState = createMockViewState();
      // Add a test layer so we actually call the backend
      viewState.layers = [{
        id: 'test-layer',
        volumeId: 'test-volume',
        visible: true,
        opacity: 1.0,
        colormap: 'gray',
        intensity: [0, 1000] as [number, number],
        threshold: [0, 1000] as [number, number],
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
      
      const result = await apiService.applyAndRenderViewState(viewState, 'axial');
      
      expect(result).toBeDefined();
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
      
      const calls = mockTransport.getCallLog();
      const renderViewCall = calls.find(c => c.cmd === 'render_view');
      expect(renderViewCall).toBeDefined();
      expect(calls).toHaveLength(1);
      expect(renderViewCall.args.stateJson).toBeDefined();
      expect(renderViewCall.args.format).toBe('rgba'); // Should default to rgba
    });

    it('should render multiple views via render_views and emit diagnostics', async () => {
      const viewState = createMockViewState();
      viewState.timepoint = 11;
      viewState.layers = [{
        id: 'test-layer',
        volumeId: 'test-volume',
        visible: true,
        opacity: 1.0,
        colormap: 'gray',
        intensity: [0, 1000] as [number, number],
        threshold: [0, 1000] as [number, number],
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

      const result = await apiService.renderViewStateMulti(viewState, ['axial', 'sagittal']);

      expect(result.axial).toBeTruthy();
      expect(result.sagittal).toBeTruthy();

      const calls = mockTransport.getCallLog();
      const renderViewsCall = calls.find(c => c.cmd === 'render_views');
      expect(renderViewsCall).toBeDefined();
      expect(JSON.parse(renderViewsCall!.args.stateJson).timepoint).toBe(11);
      expect(
        getRenderDiagnostics().find((entry) => entry.stage === 'api.render_views')?.detail
      ).toMatchObject({
        format: 'rgba',
        viewCount: 2,
        layerCount: 1
      });
    });

    it('should submit view state without readback and emit diagnostics', async () => {
      const viewState = createMockViewState();
      viewState.timepoint = 13;
      viewState.layers = [{
        id: 'test-layer',
        volumeId: 'test-volume',
        visible: true,
        opacity: 1.0,
        colormap: 'gray',
        intensity: [0, 1000] as [number, number],
        threshold: [0, 1000] as [number, number],
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

      const diagnostics = await apiService.submitViewState(viewState, 'axial', 320, 200);

      expect(diagnostics.requested_view).toBe('axial');
      expect(diagnostics.output_dimensions).toEqual([320, 200]);
      expect(diagnostics.output_bytes).toBe(0);
      expect(diagnostics.visible_layer_count).toBe(1);
      expect(diagnostics.frame.readback_mode).toBe('skip');

      const calls = mockTransport.getCallLog();
      const submitViewCall = calls.find(c => c.cmd === 'submit_view');
      expect(submitViewCall).toBeDefined();
      const serializedState = JSON.parse(submitViewCall!.args.stateJson);
      expect(serializedState.timepoint).toBe(13);
      expect(serializedState.requestedView).toMatchObject({
        type: 'axial',
        width: 320,
        height: 200
      });
      expect(
        getRenderDiagnostics().find((entry) => entry.stage === 'api.submit_view')?.detail
      ).toMatchObject({
        format: 'rgba',
        viewType: 'axial',
        width: 320,
        height: 200,
        layerCount: 1,
        ok: true,
        readbackMode: 'skip'
      });
    });

    it('should not auto-fallback to legacy commands when render_view fails', async () => {
      mockTransport.setMockResponse('render_view', () => {
        throw new Error('render_view failed');
      });

      const viewState = createMockViewState();
      viewState.layers = [{
        id: 'test-layer',
        volumeId: 'test-volume',
        visible: true,
        opacity: 1.0,
        colormap: 'gray',
        intensity: [0, 1000] as [number, number],
        threshold: [0, 1000] as [number, number],
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

      const result = await apiService.applyAndRenderViewState(viewState, 'axial');

      expect(result).toBeNull();

      const calls = mockTransport.getCallLog();
      expect(calls).toHaveLength(1);
      expect(calls[0].cmd).toBe('render_view');
      expect(calls.some(c => c.cmd.startsWith('apply_and_render_view_state'))).toBe(false);
      expect(
        getRenderDiagnostics().find((entry) => entry.stage === 'api.render_view')?.detail
      ).toMatchObject({
        format: 'rgba',
        ok: false
      });
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

  describe('time navigation', () => {
    it('should set volume timepoint', async () => {
      await apiService.setVolumeTimepoint('vol-123', 7);

      const calls = mockTransport.getCallLog();
      expect(calls[0].cmd).toBe('set_volume_timepoint');
      expect(calls[0].args).toEqual({ volumeId: 'vol-123', timepoint: 7 });
    });

    it('should get volume timepoint', async () => {
      mockTransport.setMockResponse('get_volume_timepoint', 5);
      const timepoint = await apiService.getVolumeTimepoint('vol-456');

      expect(timepoint).toBe(5);
      const calls = mockTransport.getCallLog();
      expect(calls[0].cmd).toBe('get_volume_timepoint');
      expect(calls[0].args).toEqual({ volumeId: 'vol-456' });
    });
  });

  describe('atlas metrics', () => {
    it('should normalize atlas stats response', async () => {
      const stats = await apiService.getAtlasStats();

      expect(stats).toMatchObject({
        totalLayers: 16,
        usedLayers: 4,
        freeLayers: 12,
        highWatermark: 4,
        fullEvents: 0,
        is3D: false
      });

      const calls = mockTransport.getCallLog();
      expect(calls[0].cmd).toBe('get_atlas_stats');
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
        colormap: 'gray',
        intensity: [0, 1000] as [number, number],
        threshold: [0, 1000] as [number, number],
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
