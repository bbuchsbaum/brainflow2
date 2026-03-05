/**
 * Surface View Canvas
 * Wrapper around neurosurface library for Three.js surface rendering
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LoadedSurface } from '@/stores/surfaceStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { getEventBus } from '@/events/EventBus';
import { getViewExportService } from '@/services/ViewExportService';
import { useActiveRenderable } from '@/hooks/useActiveRenderable';
import { useViewContextMenu } from '@/hooks/useViewContextMenu';

// Import neurosurface components
import {
  NeuroSurfaceViewer,
  SurfaceGeometry,
  MultiLayerNeuroSurface,
  DataLayer,
  RGBALayer,
  VolumeProjectionLayer,
  LaplacianSmoothing,
  THREE,
} from 'neurosurface';

interface SurfaceViewCanvasProps {
  surface: LoadedSurface;
  renderSurfaces?: LoadedSurface[];
  width: number;
  height: number;
}

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
  surfaces?: Map<string, any>;
  animationId?: number;
}

interface OriginalGeometry {
  vertices: Float32Array;
  faces: Uint32Array;
}

function layerSignature(layer: LoadedSurface['layers'] extends Map<string, infer T> ? T : never): string {
  const range = layer.range || [0, 0];
  const threshold = layer.threshold || [0, 0];
  const visible = layer.visible === false ? '0' : '1';
  const rgba = layer.rgba ? '1' : '0';
  const paletteKind = layer.atlasPaletteKind ?? '';
  const paletteSeed = layer.atlasPaletteSeed ?? '';
  const maxLabel = layer.atlasMaxLabel ?? '';
  const valuesLen = layer.values?.length ?? 0;
  const indicesLen = layer.indices?.length ?? 0;

  return `${layer.id}:${layer.colormap}:${range[0]}:${range[1]}:${threshold[0]}:${threshold[1]}:${layer.opacity}:${visible}:${rgba}:${paletteKind}:${paletteSeed}:${maxLabel}:${valuesLen}:${indicesLen}`;
}

function buildSurfacesRenderKey(surfaces: LoadedSurface[]): string {
  return surfaces
    .map((surface) => {
      const verticesLen = surface.geometry.vertices?.length ?? 0;
      const facesLen = surface.geometry.faces?.length ?? 0;
      const hemisphere = surface.geometry.hemisphere ?? '';
      const surfaceType = surface.geometry.surfaceType ?? '';
      const layers = Array.from(surface.layers.values())
        .map((layer) => layerSignature(layer))
        .sort()
        .join('|');
      return `${surface.handle}:${verticesLen}:${facesLen}:${hemisphere}:${surfaceType}:${layers}`;
    })
    .sort()
    .join('||');
}

function removeRenderedSurface(viewer: NeuroSurfaceViewerInstance, handle: string, rendered: any): void {
  try {
    viewer.removeSurface(handle);
    return;
  } catch {
    // Fallback for older viewer builds
  }

  try {
    const mesh = rendered?.mesh;
    if (mesh) {
      viewer.scene?.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }
  } catch {
    // no-op
  }

  try {
    viewer.surfaces?.delete(handle);
  } catch {
    // no-op
  }
}

export const SurfaceViewCanvas: React.FC<SurfaceViewCanvasProps> = ({
  surface,
  renderSurfaces,
  width,
  height,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<NeuroSurfaceViewerInstance | null>(null);
  const renderedSurfacesRef = useRef<Map<string, any>>(new Map());
  const originalGeometryRef = useRef<Map<string, OriginalGeometry>>(new Map());
  const [isInitialized, setIsInitialized] = useState(false);
  const hasCenteredCamera = useRef(false);
  const lastSmoothingValue = useRef<number>(0);

  // Mark this surface render context as active on interaction.
  const markActive = useActiveRenderable(`surfaceview:${surface.handle}`.toLowerCase());
  const handleContextMenu = useViewContextMenu(`surfaceview:${surface.handle}`.toLowerCase());

  const { viewpoint, showControls, renderSettings } = useSurfaceStore();

  const surfacesToRender = useMemo(() => {
    const candidateSurfaces = renderSurfaces ?? [surface];
    const unique = new Map<string, LoadedSurface>();
    for (const item of candidateSurfaces) {
      if (!unique.has(item.handle)) {
        unique.set(item.handle, item);
      }
    }
    return Array.from(unique.values());
  }, [renderSurfaces, surface]);

  const renderHandlesKey = useMemo(
    () => surfacesToRender.map((item) => item.handle).sort().join('|'),
    [surfacesToRender]
  );

  const surfacesRenderKey = useMemo(
    () => buildSurfacesRenderKey(surfacesToRender),
    [surfacesToRender]
  );

  // Register an exporter for this surface view so "export active view" works.
  useEffect(() => {
    if (!isInitialized || !viewerRef.current?.renderer?.domElement) return;

    const exportService = getViewExportService();
    const key = `surfaceview:${surface.handle}`.toLowerCase();

    const exporter = async ({ format }: { format: 'png' | 'jpg'; transparentBackground: boolean }) => {
      const viewer = viewerRef.current;
      const canvas = viewer?.renderer?.domElement as HTMLCanvasElement | undefined;
      if (!canvas) {
        throw new Error('Surface canvas not ready for export');
      }

      if (viewer?.render) {
        viewer.render();
      }

      const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to encode surface image'))),
          mime,
          format === 'jpg' ? 0.92 : undefined
        );
      });

      const buffer = await blob.arrayBuffer();
      return new Uint8Array(buffer);
    };

    exportService.registerExporter(key, exporter);
    return () => exportService.unregisterExporter(key);
  }, [surface.handle, isInitialized]);

  // Cleanup viewer only on component unmount.
  useEffect(() => {
    return () => {
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
      renderedSurfacesRef.current.clear();
      originalGeometryRef.current.clear();
    };
  }, []);

  // Initialize viewer once.
  useEffect(() => {
    if (!containerRef.current || isInitialized || viewerRef.current) return;

    const initializeWhenReady = () => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const actualWidth = rect.width || width;
      const actualHeight = rect.height || height;

      if (actualWidth <= 0 || actualHeight <= 0) {
        requestAnimationFrame(initializeWhenReady);
        return;
      }

      const buildViewer = (useShaders: boolean) => {
        return new NeuroSurfaceViewer(
          containerRef.current!,
          actualWidth,
          actualHeight,
          {
            showControls,
            ambientLightIntensity: renderSettings.ambientLightIntensity,
            directionalLightIntensity: renderSettings.directionalLightIntensity,
            useShaders,
            controlType: 'trackball',
          },
          viewpoint
        ) as NeuroSurfaceViewerInstance;
      };

      try {
        let viewer = buildViewer(false);

        if ((viewer as any).initializationFailed) {
          console.warn('[SurfaceViewCanvas] Viewer init failed (plain); retrying with shaders enabled');
          viewer.dispose();
          viewer = buildViewer(true);
        }

        if ((viewer as any).initializationFailed) {
          throw new Error('Surface viewer failed to initialize (both plain and SSAO paths)');
        }

        viewerRef.current = viewer;
        setIsInitialized(true);

        if (viewer.renderer?.domElement && containerRef.current) {
          const canvas = viewer.renderer.domElement;
          canvas.style.position = 'absolute';
          canvas.style.top = '0';
          canvas.style.left = '0';
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          viewer.renderer.setClearColor('#000000', 1);
        }

        if (viewer.startRenderLoop) {
          viewer.startRenderLoop();
        }

        viewer.requestRender();
      } catch (error) {
        console.error('Failed to initialize surface viewer:', error);
      }
    };

    initializeWhenReady();
  }, [isInitialized, renderSettings.ambientLightIntensity, renderSettings.directionalLightIntensity, showControls, viewpoint, width, height]);

  // Update viewer size when dimensions change.
  useEffect(() => {
    if (viewerRef.current && width > 0 && height > 0) {
      const camera = viewerRef.current.camera;
      const prevPosition = camera ? camera.position.clone() : null;
      const prevRotation = camera ? camera.rotation.clone() : null;
      const prevZoom = camera && camera.zoom ? camera.zoom : 1;

      viewerRef.current.resize(width, height);

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

  // Reset camera centering when render group changes.
  useEffect(() => {
    hasCenteredCamera.current = false;
    lastSmoothingValue.current = 0;
  }, [renderHandlesKey]);

  // Rebuild all rendered surfaces when geometry/layers change.
  useEffect(() => {
    if (!isInitialized || !viewerRef.current) return;

    const viewer = viewerRef.current;
    const readySurfaces = surfacesToRender.filter(
      (item) =>
        item.geometry.vertices &&
        item.geometry.faces &&
        item.geometry.vertices.length > 0 &&
        item.geometry.faces.length > 0
    );

    try {
      renderedSurfacesRef.current.forEach((rendered, handle) => {
        removeRenderedSurface(viewer, handle, rendered);
      });
      renderedSurfacesRef.current.clear();
      originalGeometryRef.current.clear();

      if (readySurfaces.length === 0) {
        viewer.requestRender();
        return;
      }

      const useGPUCompositing = renderSettings.useGPUProjection;

      for (const item of readySurfaces) {
        originalGeometryRef.current.set(item.handle, {
          vertices: new Float32Array(item.geometry.vertices),
          faces: new Uint32Array(item.geometry.faces),
        });

        const geometry = new SurfaceGeometry(
          item.geometry.vertices,
          item.geometry.faces,
          item.geometry.hemisphere || 'both',
          undefined
        );

        const neuroSurface = new MultiLayerNeuroSurface(geometry, {
          baseColor: parseInt((renderSettings.surfaceColor || '#CCCCCC').replace('#', ''), 16),
          useGPUCompositing,
        });

        if (item.layers.size > 0) {
          item.layers.forEach((layer) => {
            if (layer.visible === false) {
              return;
            }

            const colorMap = layer.colormap || 'viridis';

            if (layer.rgba) {
              const rgbaLayer = new RGBALayer(layer.id, layer.rgba, {
                opacity: layer.opacity ?? 1,
              });
              neuroSurface.addLayer(rgbaLayer);
              return;
            }

            const canUseGPU =
              useGPUCompositing &&
              layer.volumeData &&
              layer.volumeDims &&
              layer.volumeDims.length === 3;

            let layerInstance: any;

            if (canUseGPU) {
              const volumeData = new Float32Array(layer.volumeData!);
              layerInstance = new VolumeProjectionLayer(layer.id, volumeData, layer.volumeDims!, {
                affineMatrix: layer.affineMatrix,
                colormap: colorMap,
                range: layer.range,
                threshold: layer.threshold,
                opacity: layer.opacity ?? 1,
              });
            } else {
              layerInstance = new DataLayer(
                layer.id,
                layer.values,
                layer.indices ?? null,
                colorMap,
                {
                  range: layer.range,
                  threshold: layer.threshold,
                  opacity: layer.opacity ?? 1,
                }
              );
            }

            neuroSurface.addLayer(layerInstance);
          });
        }

        viewer.addSurface(neuroSurface, item.handle);
        renderedSurfacesRef.current.set(item.handle, neuroSurface);

        console.log('[SurfaceViewCanvas] Surface added:', {
          handle: item.handle,
          vertexCount: item.geometry.vertices.length / 3,
          faceCount: item.geometry.faces.length / 3,
          layerCount: item.layers.size,
          meshExists: !!neuroSurface.mesh,
        });
      }

      if (viewer.centerCamera && !hasCenteredCamera.current) {
        const controls = viewer.controls;
        const wasAutoRotating = controls && controls.autoRotate ? controls.autoRotate : false;

        viewer.centerCamera();

        if (controls && controls.autoRotate !== undefined) {
          controls.autoRotate = wasAutoRotating;
        }

        viewer.requestRender();
        hasCenteredCamera.current = true;

        requestAnimationFrame(() => {
          if (viewerRef.current && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const camera = viewerRef.current.camera;
              const position = camera ? camera.position.clone() : null;

              viewerRef.current.resize(rect.width, rect.height);

              if (camera && position) {
                camera.position.copy(position);
                camera.updateProjectionMatrix();
              }

              viewerRef.current.requestRender();
            }
          }
        });
      } else {
        viewer.requestRender();
      }
    } catch (error) {
      console.error('Failed to load surface geometry:', error);
    }
  }, [isInitialized, surfacesRenderKey, renderSettings.surfaceColor, renderSettings.useGPUProjection]);

  // Update viewpoint.
  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.setViewpoint(viewpoint);
    }
  }, [viewpoint]);

  // Listen for overlay application events.
  useEffect(() => {
    const handles = new Set(surfacesToRender.map((item) => item.handle));
    const handleOverlayApplied = (payload: any) => {
      const detail = payload?.detail ?? payload;
      if (!detail?.surfaceId || !handles.has(detail.surfaceId)) return;

      console.log('[SurfaceViewCanvas] Overlay applied event received:', detail);

      if (viewerRef.current) {
        viewerRef.current.requestRender();
      }
    };

    const eventBus = getEventBus();
    const unsubscribe = eventBus.on('surface.overlayApplied', handleOverlayApplied);

    return () => {
      unsubscribe();
    };
  }, [renderHandlesKey]);

  // Apply smoothing when smoothing value changes.
  useEffect(() => {
    if (!viewerRef.current || renderedSurfacesRef.current.size === 0) return;

    const smoothingValue = renderSettings.smoothing;
    if (Math.abs(smoothingValue - lastSmoothingValue.current) < 0.01) return;

    renderedSurfacesRef.current.forEach((renderedSurface, handle) => {
      const original = originalGeometryRef.current.get(handle);
      if (!original) return;

      const mesh = renderedSurface?.mesh;
      if (!mesh || !mesh.geometry) return;
      const threeGeometry = mesh.geometry;
      const positionAttribute = threeGeometry.getAttribute('position');
      if (!positionAttribute) return;

      if (smoothingValue === 0) {
        positionAttribute.array.set(original.vertices);
        positionAttribute.needsUpdate = true;
        threeGeometry.computeVertexNormals();
        threeGeometry.computeBoundingBox();
        threeGeometry.computeBoundingSphere();
        return;
      }

      positionAttribute.array.set(original.vertices);
      positionAttribute.needsUpdate = true;

      const iterations = Math.ceil(smoothingValue * 5);
      const lambda = 0.3 + smoothingValue * 0.4;
      const method = smoothingValue > 0.5 ? 'taubin' : 'laplacian';

      try {
        LaplacianSmoothing.smoothGeometry(
          threeGeometry,
          iterations,
          lambda,
          method,
          true,
          -0.53
        );
      } catch (error) {
        console.error('Failed to apply smoothing:', error);
      }
    });

    lastSmoothingValue.current = smoothingValue;
    viewerRef.current.requestRender();
  }, [renderSettings.smoothing, surfacesRenderKey]);

  // Apply render settings to all rendered surfaces.
  useEffect(() => {
    if (!viewerRef.current || renderedSurfacesRef.current.size === 0) return;

    renderedSurfacesRef.current.forEach((renderedSurface) => {
      if (renderedSurface.updateConfig) {
        renderedSurface.updateConfig({
          alpha: renderSettings.opacity,
          flatShading: renderSettings.flatShading,
          shininess: renderSettings.shininess,
          specularColor: renderSettings.specularColor,
          emissive: renderSettings.emissiveColor,
          emissiveIntensity: renderSettings.emissiveIntensity,
        });
      }

      const mesh = renderedSurface.mesh;
      if (mesh && mesh.material) {
        const material = mesh.material as any;

        if (material.wireframe !== undefined) {
          material.wireframe = renderSettings.wireframe;
        }

        if (material.flatShading !== undefined) {
          material.flatShading = renderSettings.flatShading;
        }

        if (material.color && material.color.set) {
          material.color.set(renderSettings.surfaceColor);
        }

        if (mesh.geometry && mesh.geometry.computeVertexNormals) {
          mesh.geometry.computeVertexNormals();
        }

        material.needsUpdate = true;
      }
    });

    if (viewerRef.current.scene) {
      const scene = viewerRef.current.scene;

      scene.traverse((child: any) => {
        if (child.isAmbientLight) {
          child.intensity = renderSettings.ambientLightIntensity;
        } else if (child.isDirectionalLight) {
          if (child.userData?.role !== 'fill') {
            child.intensity = renderSettings.directionalLightIntensity;
            if (renderSettings.lightPosition) {
              child.position.set(...renderSettings.lightPosition);
            }
          }
        }
      });

      let fillLight = scene.getObjectByName('fillLight');
      if (!fillLight && renderSettings.fillLightIntensity && renderSettings.fillLightIntensity > 0) {
        fillLight = new THREE.DirectionalLight(0xffffff, renderSettings.fillLightIntensity);
        fillLight.name = 'fillLight';
        fillLight.userData.role = 'fill';
        fillLight.position.set(-100, -100, -50);
        scene.add(fillLight);
      } else if (fillLight) {
        fillLight.intensity = renderSettings.fillLightIntensity || 0;
      }
    }

    viewerRef.current.requestRender();
  }, [renderSettings, surfacesRenderKey]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      onPointerDown={markActive}
      onMouseEnter={markActive}
      onContextMenu={handleContextMenu}
      style={{
        width: '100%',
        height: '100%',
        minWidth: `${width}px`,
        minHeight: `${height}px`,
        position: 'relative',
        display: 'block',
        overflow: 'hidden',
      }}
    />
  );
};
