import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiService } from '../apiService';

describe('ApiService Error Handling', () => {
  let apiService: ApiService;
  let mockTransport: any;

  beforeEach(() => {
    mockTransport = {
      invoke: vi.fn()
    };
    apiService = new ApiService(mockTransport);
  });

  describe('render_view command failures', () => {
    it('should handle render_view command failure gracefully', async () => {
      // First call to render_view fails, second call to fallback succeeds
      mockTransport.invoke
        .mockRejectedValueOnce(new Error('Backend render_view failed'))
        .mockResolvedValueOnce(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])); // PNG signature

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      const result = await apiService.applyAndRenderViewState(viewState, 'axial');
      
      expect(result).toBeDefined();
      expect(mockTransport.invoke).toHaveBeenCalledTimes(2); // Original + fallback
    });

    it('should handle undefined imageData gracefully', async () => {
      mockTransport.invoke.mockResolvedValue(undefined);

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      await expect(apiService.applyAndRenderViewState(viewState, 'axial')).rejects.toThrow('Invalid or empty image data');
    });

    it('should handle empty imageData gracefully', async () => {
      mockTransport.invoke.mockResolvedValue(new Uint8Array(0));

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      await expect(apiService.applyAndRenderViewState(viewState, 'axial')).rejects.toThrow('Invalid or empty image data');
    });

    it('should handle invalid PNG data gracefully', async () => {
      const invalidPNG = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]); // Not PNG signature
      mockTransport.invoke.mockResolvedValue(invalidPNG);

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      // The service should detect invalid PNG and try to interpret as raw RGBA
      await expect(apiService.applyAndRenderViewState(viewState, 'axial')).rejects.toThrow();
    });

    it('should handle malformed raw RGBA data', async () => {
      const malformedRGBA = new Uint8Array([255, 255, 255, 255]); // Too short for RGBA header
      mockTransport.invoke.mockResolvedValue(malformedRGBA);

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      // Force raw RGBA mode
      apiService.useRawRGBA = true;

      await expect(apiService.applyAndRenderViewState(viewState, 'axial')).rejects.toThrow();
    });

    it('should handle ArrayBuffer response correctly', async () => {
      const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG signature
      const arrayBuffer = data.buffer;
      mockTransport.invoke.mockResolvedValue(arrayBuffer);

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      const result = await apiService.applyAndRenderViewState(viewState, 'axial');
      
      expect(result).toBeDefined();
    });

    it('should handle array response correctly', async () => {
      const data = [137, 80, 78, 71, 13, 10, 26, 10]; // PNG signature as array
      mockTransport.invoke.mockResolvedValue(data);

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      const result = await apiService.applyAndRenderViewState(viewState, 'axial');
      
      expect(result).toBeDefined();
    });
  });

  describe('fallback chain behavior', () => {
    it('should fall back through all rendering methods', async () => {
      // All methods fail until the last one
      mockTransport.invoke
        .mockRejectedValueOnce(new Error('render_view failed'))
        .mockRejectedValueOnce(new Error('raw RGBA failed'))
        .mockResolvedValueOnce(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])); // PNG succeeds

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      const result = await apiService.applyAndRenderViewState(viewState, 'axial');
      
      expect(result).toBeDefined();
      expect(mockTransport.invoke).toHaveBeenCalledTimes(3);
    });

    it('should throw when all rendering methods fail', async () => {
      mockTransport.invoke.mockRejectedValue(new Error('All methods failed'));

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      await expect(apiService.applyAndRenderViewState(viewState, 'axial')).rejects.toThrow('Complete rendering failure');
    });
  });

  describe('format detection edge cases', () => {
    it('should detect raw RGBA mistakenly returned when PNG expected', async () => {
      // Raw RGBA data with valid header
      const width = 100;
      const height = 100;
      const rgbaData = new Uint8Array(8 + width * height * 4);
      const view = new DataView(rgbaData.buffer);
      view.setUint32(0, width, true);
      view.setUint32(4, height, true);
      
      mockTransport.invoke.mockResolvedValue(rgbaData);

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      // Expect PNG format but get RGBA
      apiService.useRawRGBA = false;
      
      const result = await apiService.applyAndRenderViewState(viewState, 'axial');
      
      // Should still handle it gracefully
      expect(result).toBeDefined();
    });

    it('should handle zero dimensions in raw RGBA', async () => {
      const rgbaData = new Uint8Array(8);
      const view = new DataView(rgbaData.buffer);
      view.setUint32(0, 0, true); // zero width
      view.setUint32(4, 100, true);
      
      mockTransport.invoke.mockResolvedValue(rgbaData);

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      apiService.useRawRGBA = true;
      
      await expect(apiService.applyAndRenderViewState(viewState, 'axial')).rejects.toThrow('Invalid dimensions');
    });

    it('should handle excessively large dimensions in raw RGBA', async () => {
      const rgbaData = new Uint8Array(8);
      const view = new DataView(rgbaData.buffer);
      view.setUint32(0, 50000, true); // too large
      view.setUint32(4, 50000, true);
      
      mockTransport.invoke.mockResolvedValue(rgbaData);

      const viewState = { 
        views: {
          axial: { sliceIndex: 50 },
          sagittal: { sliceIndex: 50 },
          coronal: { sliceIndex: 50 }
        },
        crosshair: { worldMm: [0, 0, 0] },
        layers: [],
        dimensions: { width: 100, height: 100 }
      };
      
      apiService.useRawRGBA = true;
      
      await expect(apiService.applyAndRenderViewState(viewState, 'axial')).rejects.toThrow('Suspicious dimensions');
    });
  });
});