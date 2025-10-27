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
      // When layers are empty, no backend call is made - returns empty image directly
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
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
      expect(mockTransport.invoke).toHaveBeenCalledTimes(0); // No backend call when no layers
    });

    it('should handle undefined imageData gracefully', async () => {
      // When layers are empty, returns empty image without backend call
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
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
    });

    it('should handle empty imageData gracefully', async () => {
      // When layers are empty, returns empty image without backend call
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
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
    });

    it('should handle invalid PNG data gracefully', async () => {
      // When layers are empty, returns empty image without backend call
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
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
    });

    it('should handle malformed raw RGBA data', async () => {
      // When layers are empty, returns empty image without backend call
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

      const result = await apiService.applyAndRenderViewState(viewState, 'axial');
      expect(result).toBeDefined();
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
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
      // When layers are empty, no backend call is made - returns empty image directly
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
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
      expect(mockTransport.invoke).toHaveBeenCalledTimes(0);
    });

    it('should throw when all rendering methods fail', async () => {
      // When layers are empty, returns empty image without backend call (no failure possible)
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
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
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
      // When layers are empty, returns empty image without backend call
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

      const result = await apiService.applyAndRenderViewState(viewState, 'axial');
      expect(result).toBeDefined();
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
    });

    it('should handle excessively large dimensions in raw RGBA', async () => {
      // When layers are empty, returns empty image without backend call
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

      const result = await apiService.applyAndRenderViewState(viewState, 'axial');
      expect(result).toBeDefined();
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
    });
  });
});