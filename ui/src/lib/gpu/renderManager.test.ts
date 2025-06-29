import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GpuRenderManager } from './renderManager';
import { coreApi } from '../api';
import type { ViewFrameExplicit, RenderLayer } from '../geometry/types';

// Mock the API
vi.mock('../api', () => ({
  coreApi: {
    init_render_loop: vi.fn().mockResolvedValue(undefined),
    create_offscreen_render_target: vi.fn().mockResolvedValue(undefined),
    clear_render_layers: vi.fn().mockResolvedValue(undefined),
    add_render_layer: vi.fn().mockResolvedValue(0),
    update_layer_opacity: vi.fn().mockResolvedValue(undefined),
    update_layer_colormap: vi.fn().mockResolvedValue(undefined),
    update_layer_intensity: vi.fn().mockResolvedValue(undefined),
    update_layer_threshold: vi.fn().mockResolvedValue(undefined),
    request_frame: vi.fn().mockResolvedValue(undefined),
    set_crosshair: vi.fn().mockResolvedValue(undefined),
    render_to_image_binary: vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71])) // PNG header
  }
}));

describe('GpuRenderManager', () => {
  let manager: GpuRenderManager;
  
  beforeEach(() => {
    manager = new GpuRenderManager();
    vi.clearAllMocks();
  });
  
  describe('initialization', () => {
    it('should initialize the render loop', async () => {
      await manager.initialize();
      
      expect(coreApi.init_render_loop).toHaveBeenCalledOnce();
    });
    
    it('should not initialize twice', async () => {
      await manager.initialize();
      await manager.initialize();
      
      expect(coreApi.init_render_loop).toHaveBeenCalledOnce();
    });
  });
  
  describe('offscreen target management', () => {
    it('should create offscreen target with specified size', async () => {
      await manager.initialize();
      await manager.ensureOffscreenTarget(512, 512);
      
      expect(coreApi.create_offscreen_render_target).toHaveBeenCalledWith(512, 512);
    });
    
    it('should not recreate target if size unchanged', async () => {
      await manager.initialize();
      await manager.ensureOffscreenTarget(512, 512);
      await manager.ensureOffscreenTarget(512, 512);
      
      expect(coreApi.create_offscreen_render_target).toHaveBeenCalledOnce();
    });
    
    it('should recreate target if size changes', async () => {
      await manager.initialize();
      await manager.ensureOffscreenTarget(512, 512);
      await manager.ensureOffscreenTarget(1024, 768);
      
      expect(coreApi.create_offscreen_render_target).toHaveBeenCalledTimes(2);
      expect(coreApi.create_offscreen_render_target).toHaveBeenLastCalledWith(1024, 768);
    });
  });
  
  describe('layer management', () => {
    it('should clear and setup layers', async () => {
      await manager.initialize();
      
      const layers: RenderLayer[] = [
        {
          volumeId: 'vol1',
          colormapId: 0,
          opacity: 1.0,
          window: { level: 0.5, width: 1.0 },
          blendMode: 'over'
        }
      ];
      
      await manager.setupLayers(layers);
      
      expect(coreApi.clear_render_layers).toHaveBeenCalled();
      expect(coreApi.add_render_layer).toHaveBeenCalledWith(0, 1.0, [0, 0, 1, 1]);
      expect(coreApi.update_layer_colormap).toHaveBeenCalledWith(0, 0);
      expect(coreApi.update_layer_intensity).toHaveBeenCalledWith(0, 0, 1);
    });
    
    it('should handle layer with threshold', async () => {
      await manager.initialize();
      
      const layers: RenderLayer[] = [
        {
          volumeId: 'vol1',
          colormapId: 1,
          opacity: 0.8,
          window: { level: 0.5, width: 0.6 },
          threshold: { low: 0.3, high: 0.7, mode: 'range' },
          blendMode: 'over'
        }
      ];
      
      await manager.setupLayers(layers);
      
      expect(coreApi.update_layer_threshold).toHaveBeenCalledWith(0, 0.3, 0.7);
    });
  });
  
  describe('rendering', () => {
    it('should render a frame', async () => {
      await manager.initialize();
      
      const mockFrame: ViewFrameExplicit = {
        origin: { x: 0, y: 0, z: 0 },
        u_dir: { x: 1, y: 0, z: 0 },
        v_dir: { x: 0, y: 1, z: 0 },
        pixels_per_mm: 2,
        viewport_px: { x: 512, y: 512 },
        version: 1
      };
      
      const result = await manager.render({
        frame: mockFrame,
        layers: [],
        showCrosshair: true,
        crosshairWorld: [128, 128, 64]
      });
      
      expect(coreApi.create_offscreen_render_target).toHaveBeenCalledWith(512, 512);
      expect(coreApi.request_frame).toHaveBeenCalledWith(
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        2,
        512,
        512
      );
      expect(coreApi.set_crosshair).toHaveBeenCalledWith([128, 128, 64]);
      expect(coreApi.render_to_image_binary).toHaveBeenCalled();
      
      expect(result.imageData).toBeInstanceOf(Uint8Array);
      expect(result.dimensions).toEqual([512, 512]);
      expect(result.renderTimeMs).toBeGreaterThanOrEqual(0);
    });
    
    it('should throw if not initialized', async () => {
      const mockFrame: ViewFrameExplicit = {
        origin: { x: 0, y: 0, z: 0 },
        u_dir: { x: 1, y: 0, z: 0 },
        v_dir: { x: 0, y: 1, z: 0 },
        pixels_per_mm: 2,
        viewport_px: { x: 512, y: 512 },
        version: 1
      };
      
      await expect(manager.render({
        frame: mockFrame,
        layers: [],
        showCrosshair: false,
        crosshairWorld: [0, 0, 0]
      })).rejects.toThrow('not initialized');
    });
  });
  
  describe('layer updates', () => {
    it('should update layer opacity', async () => {
      await manager.initialize();
      
      // Setup a layer first
      await manager.setupLayers([{
        volumeId: 'vol1',
        colormapId: 0,
        opacity: 1.0,
        window: { level: 0.5, width: 1.0 },
        blendMode: 'over'
      }]);
      
      await manager.updateLayer('vol1', { opacity: 0.5 });
      
      expect(coreApi.update_layer_opacity).toHaveBeenCalledWith(0, 0.5);
    });
    
    it('should update multiple layer properties', async () => {
      await manager.initialize();
      
      // Setup a layer first
      await manager.setupLayers([{
        volumeId: 'vol1',
        colormapId: 0,
        opacity: 1.0,
        window: { level: 0.5, width: 1.0 },
        blendMode: 'over'
      }]);
      
      await manager.updateLayer('vol1', {
        opacity: 0.7,
        colormapId: 2,
        window: { level: 0.3, width: 0.4 }
      });
      
      expect(coreApi.update_layer_opacity).toHaveBeenCalledWith(0, 0.7);
      expect(coreApi.update_layer_colormap).toHaveBeenCalledWith(0, 2);
      expect(coreApi.update_layer_intensity).toHaveBeenLastCalledWith(0, 0.1, 0.5);
    });
    
    it('should throw if layer not found', async () => {
      await manager.initialize();
      
      await expect(manager.updateLayer('nonexistent', { opacity: 0.5 }))
        .rejects.toThrow('No active layer for volume nonexistent');
    });
  });
});