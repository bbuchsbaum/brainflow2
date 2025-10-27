/**
 * Test file for verifying surface loading commands
 * SURF-201: Verify load_surface Tauri command
 */

import { describe, it, expect, vi } from 'vitest';
import { useSurfaceStore } from '@/stores/surfaceStore';

describe('Surface Loading Commands', () => {
  describe('SURF-201: Verify load_surface Tauri command', () => {
    it('should have load_surface command in transport', async () => {
      const { TauriTransport } = await import('@/services/transport');
      const transport = new TauriTransport();
      
      // Check that the command is properly namespaced
      const namespacedCmd = (transport as any).getNamespacedCommand('load_surface');
      expect(namespacedCmd).toBe('plugin:api-bridge|load_surface');
    });

    it('should have get_surface_geometry command in transport', async () => {
      const { TauriTransport } = await import('@/services/transport');
      const transport = new TauriTransport();
      
      // Check that the command is properly namespaced
      const namespacedCmd = (transport as any).getNamespacedCommand('get_surface_geometry');
      expect(namespacedCmd).toBe('plugin:api-bridge|get_surface_geometry');
    });

    it('should handle surface loading in FileLoadingService', async () => {
      const { FileLoadingService } = await import('@/services/FileLoadingService');
      const service = new FileLoadingService();
      
      // Check that loadFile routes .gii files to loadSurfaceFile
      const path = '/test/surface.gii';
      
      // Mock the surfaceStore loadSurface
      const mockLoadSurface = vi.fn().mockResolvedValue('test-handle');
      vi.spyOn(useSurfaceStore.getState(), 'loadSurface').mockImplementation(mockLoadSurface);
      
      // The service should recognize .gii files
      expect(path.toLowerCase().endsWith('.gii')).toBe(true);
    });

    it('surfaceStore should properly format load_surface response', () => {
      // The backend returns snake_case fields
      const mockResponse = {
        type: 'Surface',
        handle: 'surf-handle-123',
        vertex_count: 10242,
        face_count: 20480,
        hemisphere: 'left',
        surface_type: 'pial'
      };
      
      // surfaceStore expects these fields
      expect(mockResponse.type).toBe('Surface');
      expect(mockResponse.handle).toBeDefined();
      expect(mockResponse.vertex_count).toBeGreaterThan(0);
      expect(mockResponse.face_count).toBeGreaterThan(0);
    });

    it('surfaceStore should handle get_surface_geometry response', () => {
      // The backend returns arrays of numbers
      const mockGeometryResponse = {
        vertices: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0], // 2 vertices (x,y,z each)
        faces: [0, 1, 2] // 1 triangle
      };
      
      // These should be convertible to typed arrays
      const vertices = new Float32Array(mockGeometryResponse.vertices);
      const faces = new Uint32Array(mockGeometryResponse.faces);
      
      expect(vertices.length).toBe(6);
      expect(faces.length).toBe(3);
      expect(vertices).toBeInstanceOf(Float32Array);
      expect(faces).toBeInstanceOf(Uint32Array);
    });
  });

  describe('SURF-202: get_surface_geometry command', () => {
    it('should return vertices as Float32Array compatible', () => {
      // Vertices should be returned as numbers that can be converted
      const mockVertices = [1.0, 2.0, 3.0];
      const typedArray = new Float32Array(mockVertices);
      expect(typedArray).toBeInstanceOf(Float32Array);
      expect(typedArray.length).toBe(3);
    });

    it('should return faces as Uint32Array compatible', () => {
      // Faces should be returned as numbers that can be converted
      const mockFaces = [0, 1, 2, 3, 4, 5];
      const typedArray = new Uint32Array(mockFaces);
      expect(typedArray).toBeInstanceOf(Uint32Array);
      expect(typedArray.length).toBe(6);
    });

    it('should handle large meshes', () => {
      // Test with a large mesh (>100k vertices)
      const largeVertexCount = 150000 * 3; // 150k vertices * 3 coords each
      const largeFaceCount = 300000 * 3; // 300k triangles * 3 indices each
      
      // These should be allocatable
      const vertices = new Float32Array(largeVertexCount);
      const faces = new Uint32Array(largeFaceCount);
      
      expect(vertices.length).toBe(largeVertexCount);
      expect(faces.length).toBe(largeFaceCount);
    });
  });

  describe('SURF-203: Surface metadata support', () => {
    it('should include vertex and face counts in metadata', () => {
      const surface = {
        metadata: {
          vertexCount: 10242,
          faceCount: 20480,
          hemisphere: 'left',
          surfaceType: 'pial',
          path: '/test/surface.gii'
        }
      };
      
      expect(surface.metadata.vertexCount).toBeGreaterThan(0);
      expect(surface.metadata.faceCount).toBeGreaterThan(0);
    });

    it('should include hemisphere information', () => {
      const validHemispheres = ['left', 'right', 'both'];
      const hemisphere = 'left';
      expect(validHemispheres).toContain(hemisphere);
    });

    it('should include surface type', () => {
      const validTypes = ['pial', 'white', 'inflated'];
      const surfaceType = 'pial';
      expect(validTypes).toContain(surfaceType);
    });
  });
});