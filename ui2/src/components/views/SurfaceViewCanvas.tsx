/**
 * Surface View Canvas
 * Wrapper around neurosurface library for Three.js surface rendering
 */

import React, { useEffect, useRef, useState } from 'react';
import type { LoadedSurface } from '@/stores/surfaceStore';
import { useSurfaceStore } from '@/stores/surfaceStore';

// Import neurosurface components
// @ts-ignore - neurosurface doesn't have types in node_modules yet
import { 
  NeuroSurfaceViewer, 
  SurfaceGeometry,
  NeuroSurface,
  ColorMappedNeuroSurface,
  MultiLayerNeuroSurface,
  DataLayer,
  THREE,
} from 'neurosurface';

// @ts-ignore
import { ColorMap } from 'neurosurface';

interface SurfaceViewCanvasProps {
  surface: LoadedSurface;
  width: number;
  height: number;
}

// Type definitions for neurosurface library (until proper types are available)
interface NeuroSurfaceViewerInstance {
  dispose: () => void;
  resize: (width: number, height: number) => void;
  render: () => void;
  requestRender: () => void;
  centerCamera: () => void;
  addSurface: (surface: any, handle: string) => void;
  removeSurface: (handle: string) => void;
  setViewpoint: (viewpoint: string) => void;
  startRenderLoop: () => void;
  scene: any;
  camera: any;
  renderer: any;
  controls: any;
  animationId?: number;
}

export const SurfaceViewCanvas: React.FC<SurfaceViewCanvasProps> = ({
  surface,
  width,
  height,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<NeuroSurfaceViewerInstance | null>(null);
  const surfaceRef = useRef<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const hasCenteredCamera = useRef(false);
  
  const { viewpoint, showControls, ambientLight } = useSurfaceStore();
  
  // IMPORTANT: Cleanup viewer only on component unmount, not on re-renders.
  // This prevents losing the Three.js viewer instance when GoldenLayout
  // causes component remounting during panel resize/dock operations.
  useEffect(() => {
    return () => {
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
    };
  }, []); // Empty dependency array = only run on unmount
  
  // Initialize viewer
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Skip if already initialized or dimensions are not ready
    if (isInitialized || width <= 0 || height <= 0) return;
    
    // Prevent double initialization if viewer already exists
    if (viewerRef.current) {
      return;
    }
    
    try {
      // Get actual container dimensions (important for proper aspect ratio)
      const rect = containerRef.current.getBoundingClientRect();
      const actualWidth = rect.width || width;
      const actualHeight = rect.height || height;
      
      // Create the viewer with actual dimensions
      const viewer = new NeuroSurfaceViewer(
        containerRef.current,
        actualWidth,
        actualHeight,
        {
          showControls: showControls,
          ambientLightColor: ambientLight,
          directionalLightIntensity: 1.0,
          useShaders: true,
          controlType: 'trackball',
        },
        viewpoint
      );
      
      viewerRef.current = viewer as NeuroSurfaceViewerInstance;
      setIsInitialized(true);
      
      // Start the render loop
      if (viewer.startRenderLoop) {
        viewer.startRenderLoop();
      }
    } catch (error) {
      console.error('Failed to initialize surface viewer:', error);
    }
  }, [width, height]); // React to dimension changes instead of containerRef
  
  // Update viewer size when dimensions change
  useEffect(() => {
    if (viewerRef.current && width > 0 && height > 0) {
      // Just resize the viewport, don't reset camera orientation
      viewerRef.current.resize(width, height);
      viewerRef.current.requestRender();
    }
  }, [width, height]);
  
  // Reset camera centering flag when surface changes
  useEffect(() => {
    hasCenteredCamera.current = false;
  }, [surface.handle]);
  
  // Load surface geometry when viewer and data are ready
  useEffect(() => {
    // Wait for both viewer to be initialized AND vertices to be loaded
    if (!isInitialized || !viewerRef.current || !surface.geometry.vertices || !surface.geometry.faces || 
        surface.geometry.vertices.length === 0 || surface.geometry.faces.length === 0) {
      return;
    }
    
    try {
      
      // Remove existing surface if any
      if (surfaceRef.current) {
        try {
          viewerRef.current.removeSurface(surface.handle);
        } catch (e) {
          // Surface might not exist, that's ok
        }
        surfaceRef.current = null;
      }
      
      // Create surface geometry
      // SurfaceGeometry accepts typed arrays directly
      const geometry = new SurfaceGeometry(
        surface.geometry.vertices,
        surface.geometry.faces,
        surface.geometry.hemisphere || 'both',
        undefined
      );
      
      let neuroSurface;
      
      // Check if we have data layers
      if (surface.layers.size > 0) {
        // Create multi-layer surface
        neuroSurface = new MultiLayerNeuroSurface(geometry, {
          baseColor: 0xcccccc,
        });
        
        // Add data layers
        surface.layers.forEach((layer) => {
          const dataLayer = new DataLayer(
            layer.id,
            layer.values,
            {
              colorMap: layer.colormap,
              range: layer.range,
              threshold: layer.threshold,
              opacity: layer.opacity,
            }
          );
          neuroSurface.addLayer(dataLayer);
        });
      } else {
        // Create simple surface without data layers
        // Create a basic colored surface with varying data for visibility
        const numVertices = surface.geometry.vertices.length / 3;
        const varyingData = new Float32Array(numVertices);
        
        // Create a gradient of values for better visibility
        for (let i = 0; i < numVertices; i++) {
          varyingData[i] = i / (numVertices - 1); // Gradient from 0 to 1
        }
        
        neuroSurface = new ColorMappedNeuroSurface(
          geometry,
          null, // Will use default identity mapping automatically
          varyingData, // Varying data for visibility
          'viridis', // More colorful colormap for better visibility
          {
            alpha: 1.0,
            flatShading: true, // Flat shading to see faces clearly
            irange: [0, 1], // Data range
          }
        );
        // No need to call createMesh() - constructor already does this
      }
      
      // Add surface to viewer
      viewerRef.current.addSurface(neuroSurface, surface.handle);
      surfaceRef.current = neuroSurface;
      
      
      // Center camera on the surface only on first load
      if (viewerRef.current.centerCamera && !hasCenteredCamera.current) {
        viewerRef.current.centerCamera();
        viewerRef.current.requestRender();
        hasCenteredCamera.current = true;
        
        // Trigger a resize after geometry load to ensure proper aspect ratio
        // This was a legitimate fix for the "only appears after resize" issue
        setTimeout(() => {
          if (viewerRef.current) {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0) {
              viewerRef.current.resize(rect.width, rect.height);
              viewerRef.current.requestRender();
            }
          }
        }, 100);
      }
      
    } catch (error) {
      console.error('Failed to load surface geometry:', error);
    }
  }, [surface.geometry.vertices, surface.geometry.faces, surface.layers, isInitialized]); // Added isInitialized to dependencies
  
  // Update viewpoint
  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.setViewpoint(viewpoint);
    }
  }, [viewpoint]);
  
  // Update layers
  useEffect(() => {
    if (!surfaceRef.current || !surface.layers.size) return;
    
    // If we have a multi-layer surface, update layers
    if (surfaceRef.current instanceof MultiLayerNeuroSurface) {
      // Clear existing layers
      surfaceRef.current.clearLayers();
      
      // Add updated layers
      surface.layers.forEach((layer) => {
        const dataLayer = new DataLayer(
          layer.id,
          layer.values,
          {
            colorMap: layer.colormap,
            range: layer.range,
            threshold: layer.threshold,
            opacity: layer.opacity,
          }
        );
        surfaceRef.current.addLayer(dataLayer);
      });
      
      // Trigger re-render
      if (viewerRef.current) {
        viewerRef.current.render();
      }
    }
  }, [surface.layers]);
  
  return (
    <div 
      ref={containerRef} 
      className="w-full h-full"
      style={{ 
        width: '100%', 
        height: '100%',
        minWidth: `${width}px`,
        minHeight: `${height}px`,
        position: 'relative',
        display: 'block',
        overflow: 'hidden',
        // backgroundColor: '#2a2a2a', // Optional: set background color
      }}
    />
  );
};