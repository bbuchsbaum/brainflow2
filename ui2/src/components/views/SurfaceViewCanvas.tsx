/**
 * Surface View Canvas
 * Wrapper around neurosurface library for Three.js surface rendering
 */

import React, { useEffect, useRef, useState } from 'react';
import type { LoadedSurface } from '@/stores/surfaceStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { getEventBus } from '@/events/EventBus';

// Import neurosurface components
// @ts-ignore - neurosurface doesn't have types in node_modules yet
import { 
  NeuroSurfaceViewer, 
  SurfaceGeometry,
  NeuroSurface,
  ColorMappedNeuroSurface,
  MultiLayerNeuroSurface,
  DataLayer,
  LaplacianSmoothing,
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
  const originalGeometryRef = useRef<{ vertices: Float32Array; faces: Uint32Array } | null>(null);
  const lastSmoothingValue = useRef<number>(0);
  
  const { viewpoint, showControls, renderSettings } = useSurfaceStore();
  
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
    
    // Skip if already initialized
    if (isInitialized) return;
    
    // Prevent double initialization if viewer already exists
    if (viewerRef.current) {
      return;
    }
    
    // Wait for container to have dimensions
    const initializeWhenReady = () => {
      if (!containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      const actualWidth = rect.width || width;
      const actualHeight = rect.height || height;
      
      // Need valid dimensions to initialize
      if (actualWidth <= 0 || actualHeight <= 0) {
        // Try again in next frame
        requestAnimationFrame(initializeWhenReady);
        return;
      }
      
      try {
        // Create the viewer with actual dimensions
        const viewer = new NeuroSurfaceViewer(
          containerRef.current,
          actualWidth,
          actualHeight,
          {
            showControls: showControls,
            ambientLightIntensity: renderSettings.ambientLightIntensity,
            directionalLightIntensity: renderSettings.directionalLightIntensity,
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
        
        // Force initial render
        viewer.requestRender();
      } catch (error) {
        console.error('Failed to initialize surface viewer:', error);
      }
    };
    
    // Start initialization process
    initializeWhenReady();
  }, []); // Only run once on mount
  
  // Update viewer size when dimensions change
  useEffect(() => {
    if (viewerRef.current && width > 0 && height > 0) {
      // Store camera position/rotation before resize
      const camera = viewerRef.current.camera;
      const prevPosition = camera ? camera.position.clone() : null;
      const prevRotation = camera ? camera.rotation.clone() : null;
      const prevZoom = camera && camera.zoom ? camera.zoom : 1;
      
      // Resize the viewport
      viewerRef.current.resize(width, height);
      
      // Restore camera state after resize
      if (camera && prevPosition && prevRotation) {
        camera.position.copy(prevPosition);
        camera.rotation.copy(prevRotation);
        if (camera.zoom !== undefined) {
          camera.zoom = prevZoom;
          camera.updateProjectionMatrix();
        }
      }
      
      viewerRef.current.requestRender();
    }
  }, [width, height]);
  
  // Reset camera centering flag and geometry cache when surface changes
  useEffect(() => {
    hasCenteredCamera.current = false;
    originalGeometryRef.current = null;
    lastSmoothingValue.current = 0;
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
          if (surfaceRef.current.type === 'basic') {
            // Remove basic mesh from scene
            const mesh = surfaceRef.current.mesh;
            if (mesh) {
              viewerRef.current.scene.remove(mesh);
              // Clean up geometry and material
              if (mesh.geometry) mesh.geometry.dispose();
              if (mesh.material) mesh.material.dispose();
            }
            // Remove from surfaces map if it exists
            if (viewerRef.current.surfaces) {
              viewerRef.current.surfaces.delete(surface.handle);
            }
          } else {
            // Remove NeuroSurface using the viewer's method
            viewerRef.current.removeSurface(surface.handle);
          }
        } catch (e) {
          // Surface might not exist, that's ok
        }
        surfaceRef.current = null;
      }
      
      // Store original geometry for smoothing reset
      if (!originalGeometryRef.current) {
        originalGeometryRef.current = {
          vertices: new Float32Array(surface.geometry.vertices),
          faces: new Uint32Array(surface.geometry.faces)
        };
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
        // Create basic Three.js mesh without data layers
        // This provides immediate visual feedback with proper lighting
        const threeGeometry = new THREE.BufferGeometry();
        threeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(surface.geometry.vertices, 3));
        threeGeometry.setIndex(new THREE.Uint32BufferAttribute(surface.geometry.faces, 1));
        threeGeometry.computeVertexNormals();
        threeGeometry.computeBoundingBox();
        threeGeometry.computeBoundingSphere();
        
        // Use MeshPhongMaterial for proper lighting support
        const material = new THREE.MeshPhongMaterial({
          color: new THREE.Color(renderSettings.surfaceColor || '#CCCCCC'), // Light gray default
          shininess: renderSettings.shininess,
          specular: new THREE.Color(renderSettings.specularColor),
          emissive: new THREE.Color(renderSettings.emissiveColor),
          emissiveIntensity: renderSettings.emissiveIntensity,
          transparent: renderSettings.opacity < 1,
          opacity: renderSettings.opacity,
          flatShading: renderSettings.flatShading,
          wireframe: renderSettings.wireframe,
          side: THREE.DoubleSide, // Render both sides
        });
        
        const mesh = new THREE.Mesh(threeGeometry, material);
        
        // Store as a basic mesh (not a NeuroSurface)
        surfaceRef.current = { 
          mesh: mesh,
          type: 'basic',
          geometry: geometry // Keep reference to SurfaceGeometry for potential upgrade
        };
        
        // Add directly to scene instead of using NeuroSurface wrapper
        viewerRef.current.scene.add(mesh);
        
        // Still track it with a handle for removal later
        viewerRef.current.surfaces = viewerRef.current.surfaces || new Map();
        viewerRef.current.surfaces.set(surface.handle, mesh);
        
        // Don't need to create a NeuroSurface - just use the mesh directly
        neuroSurface = null; // Signal that we're using basic mesh mode
      }
      
      // Add surface to viewer (only if we created a NeuroSurface)
      if (neuroSurface) {
        viewerRef.current.addSurface(neuroSurface, surface.handle);
        surfaceRef.current = neuroSurface;
      }
      // Note: Basic mesh was already added to scene above
      
      
      // Center camera on the surface only on first load
      if (viewerRef.current.centerCamera && !hasCenteredCamera.current) {
        // Store controls state before centering
        const controls = viewerRef.current.controls;
        const wasAutoRotating = controls && controls.autoRotate ? controls.autoRotate : false;
        
        // Center the camera on the surface geometry
        viewerRef.current.centerCamera();
        
        // Restore controls state
        if (controls && controls.autoRotate !== undefined) {
          controls.autoRotate = wasAutoRotating;
        }
        
        viewerRef.current.requestRender();
        hasCenteredCamera.current = true;
        
        // Trigger a resize after geometry load to ensure proper aspect ratio
        // This helps with the "only appears after resize" issue
        requestAnimationFrame(() => {
          if (viewerRef.current && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0) {
              // Store camera state before resize
              const camera = viewerRef.current.camera;
              const position = camera ? camera.position.clone() : null;
              
              viewerRef.current.resize(rect.width, rect.height);
              
              // Keep camera position after resize
              if (camera && position) {
                camera.position.copy(position);
                camera.updateProjectionMatrix();
              }
              
              viewerRef.current.requestRender();
            }
          }
        });
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
    
    // If we have a basic mesh and now have layers, upgrade to MultiLayerNeuroSurface
    if (surfaceRef.current.type === 'basic' && surface.layers.size > 0) {
      // We need to recreate the surface as a MultiLayerNeuroSurface
      // This will be handled by the main geometry loading effect
      // Just trigger a re-render here
      if (viewerRef.current) {
        viewerRef.current.requestRender();
      }
      return;
    }
    
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
  
  // Listen for overlay application events
  useEffect(() => {
    const handleOverlayApplied = (event: any) => {
      // Check if this event is for our surface
      if (event.detail?.surfaceId === surface.handle) {
        console.log('[SurfaceViewCanvas] Overlay applied event received:', event.detail);
        
        // Force a re-render to show the new overlay
        if (viewerRef.current) {
          viewerRef.current.requestRender();
        }
      }
    };
    
    // Subscribe to overlay events
    const eventBus = getEventBus();
    const unsubscribe = eventBus.on('surface.overlayApplied' as any, handleOverlayApplied);

    return () => {
      unsubscribe();
    };
  }, [surface.handle]);
  
  // Apply smoothing when smoothing value changes
  useEffect(() => {
    if (!surfaceRef.current || !viewerRef.current || !originalGeometryRef.current) return;
    
    const smoothingValue = renderSettings.smoothing;
    
    // Skip if smoothing hasn't changed significantly (avoid excessive updates)
    if (Math.abs(smoothingValue - lastSmoothingValue.current) < 0.01) return;
    
    // Get the Three.js geometry based on surface type
    let threeGeometry;
    if (surfaceRef.current.type === 'basic') {
      // Basic mesh - geometry is directly on the mesh
      const mesh = surfaceRef.current.mesh;
      if (!mesh || !mesh.geometry) return;
      threeGeometry = mesh.geometry;
    } else {
      // NeuroSurface - geometry is on the nested mesh
      const mesh = surfaceRef.current.mesh;
      if (!mesh || !mesh.geometry) return;
      threeGeometry = mesh.geometry;
    }
    
    // Apply smoothing based on value
    if (smoothingValue === 0) {
      // Reset to original geometry
      const positionAttribute = threeGeometry.getAttribute('position');
      if (positionAttribute) {
        positionAttribute.array.set(originalGeometryRef.current.vertices);
        positionAttribute.needsUpdate = true;
        threeGeometry.computeVertexNormals();
        threeGeometry.computeBoundingBox();
        threeGeometry.computeBoundingSphere();
      }
    } else {
      // First reset to original before applying smoothing
      const positionAttribute = threeGeometry.getAttribute('position');
      if (positionAttribute) {
        positionAttribute.array.set(originalGeometryRef.current.vertices);
        positionAttribute.needsUpdate = true;
      }
      
      // Apply Laplacian smoothing
      const iterations = Math.ceil(smoothingValue * 5); // 1-5 iterations
      const lambda = 0.3 + (smoothingValue * 0.4); // 0.3-0.7 lambda
      const method = smoothingValue > 0.5 ? 'taubin' : 'laplacian';
      
      try {
        LaplacianSmoothing.smoothGeometry(
          threeGeometry,
          iterations,
          lambda,
          method,
          true, // preserve boundaries
          -0.53 // mu for Taubin
        );
      } catch (error) {
        console.error('Failed to apply smoothing:', error);
      }
    }
    
    lastSmoothingValue.current = smoothingValue;
    
    // Trigger re-render
    viewerRef.current.requestRender();
  }, [renderSettings.smoothing]);
  
  // Apply render settings to surface material
  useEffect(() => {
    if (!surfaceRef.current || !viewerRef.current) return;
    
    // Check if we're using a basic mesh or NeuroSurface
    if (surfaceRef.current.type === 'basic') {
      // Direct Three.js mesh - update material properties
      const mesh = surfaceRef.current.mesh;
      if (mesh && mesh.material) {
        const material = mesh.material;
        
        // Update all material properties
        material.color.set(renderSettings.surfaceColor || '#CCCCCC');
        material.shininess = renderSettings.shininess;
        material.specular.set(renderSettings.specularColor);
        material.emissive.set(renderSettings.emissiveColor);
        material.emissiveIntensity = renderSettings.emissiveIntensity;
        material.opacity = renderSettings.opacity;
        material.transparent = renderSettings.opacity < 1;
        material.flatShading = renderSettings.flatShading;
        material.wireframe = renderSettings.wireframe;
        material.needsUpdate = true;
      }
    } else if (surfaceRef.current.updateConfig) {
      // NeuroSurface - use updateConfig method
      surfaceRef.current.updateConfig({
        alpha: renderSettings.opacity,
        flatShading: renderSettings.flatShading,
        shininess: renderSettings.shininess,
        specularColor: renderSettings.specularColor,
        emissive: renderSettings.emissiveColor,
        emissiveIntensity: renderSettings.emissiveIntensity,
      });
      
      // Access the Three.js mesh for additional properties
      const mesh = surfaceRef.current.mesh;
      if (mesh && mesh.material) {
        const material = mesh.material;
        
        // Wireframe
        if (material.wireframe !== undefined) {
          material.wireframe = renderSettings.wireframe;
        }
        
        // Base color (if not using colormap)
        if (material.color && material.color.set) {
          material.color.set(renderSettings.surfaceColor);
        }
        
        material.needsUpdate = true;
      }
    }
    
    // Update scene lighting
    if (viewerRef.current.scene) {
      // Update existing lights or add new ones
      const scene = viewerRef.current.scene;
      
      // Find and update ambient light
      scene.traverse((child: any) => {
        if (child.isAmbientLight) {
          child.intensity = renderSettings.ambientLightIntensity;
        } else if (child.isDirectionalLight) {
          // Update main directional light (first one found)
          if (child.userData?.role !== 'fill') {
            child.intensity = renderSettings.directionalLightIntensity;
            if (renderSettings.lightPosition) {
              child.position.set(...renderSettings.lightPosition);
            }
          }
        }
      });
      
      // Add or update fill light
      let fillLight = scene.getObjectByName('fillLight');
      if (!fillLight && renderSettings.fillLightIntensity && renderSettings.fillLightIntensity > 0) {
        // Create fill light if it doesn't exist
        fillLight = new THREE.DirectionalLight(0xffffff, renderSettings.fillLightIntensity);
        fillLight.name = 'fillLight';
        fillLight.userData.role = 'fill';
        fillLight.position.set(-100, -100, -50); // Opposite direction from main light
        scene.add(fillLight);
      } else if (fillLight) {
        // Update existing fill light
        fillLight.intensity = renderSettings.fillLightIntensity || 0;
      }
    }
    
    // Trigger re-render
    viewerRef.current.requestRender();
  }, [renderSettings]);
  
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