/**
 * Surface View Canvas
 * Wrapper around neurosurface library for Three.js surface rendering
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  LoadedSurface,
  SurfaceDisplaySettings,
  SurfaceLightingSettings,
  SurfaceMaterialSettings,
} from '@/stores/surfaceStore';
import {
  DEFAULT_SURFACE_VIEW_SETTINGS,
  getSurfaceViewSettingsForId,
  useSurfaceStore,
} from '@/stores/surfaceStore';
import { getEventBus } from '@/events/EventBus';
import { getViewExportService } from '@/services/ViewExportService';
import { useActiveRenderable } from '@/hooks/useActiveRenderable';
import { useViewContextMenu } from '@/hooks/useViewContextMenu';
import {
  buildRenderableLayerSpecs,
  isSurfaceGeometryChanged,
  planSurfaceReconciliation,
  type RenderableLayerSpec,
} from './surfaceViewReconciler';
import { buildSurfaceViewContextId } from '@/utils/surfaceViewContext';

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
  surfaceViewId: string;
  surfaceContextHandle?: string;
  onActivateSurface?: () => void;
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

function colorHexToNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return value;
  }
  return Number.parseInt(value.replace('#', ''), 16);
}

function hasRenderableGeometry(surface: LoadedSurface): boolean {
  return Boolean(
    surface.geometry.vertices &&
      surface.geometry.faces &&
      surface.geometry.vertices.length > 0 &&
      surface.geometry.faces.length > 0
  );
}

function buildLayerInstance(spec: RenderableLayerSpec): DataLayer | RGBALayer | VolumeProjectionLayer {
  switch (spec.kind) {
    case 'rgba':
      return new RGBALayer(spec.id, spec.rgba ?? new Float32Array(0), {
        opacity: spec.opacity,
      });
    case 'volume':
      return new VolumeProjectionLayer(
        spec.id,
        new Float32Array(spec.volumeData ?? []),
        spec.volumeDims ?? [1, 1, 1],
        {
          affineMatrix: spec.affineMatrix,
          colormap: spec.colormap || 'viridis',
          range: spec.range,
          threshold: spec.threshold,
          opacity: spec.opacity,
        }
      );
    case 'data':
    default:
      return new DataLayer(
        spec.id,
        spec.values ?? new Float32Array(0),
        spec.indices ?? null,
        spec.colormap || 'viridis',
        {
          range: spec.range,
          threshold: spec.threshold,
          opacity: spec.opacity,
        }
      );
  }
}

function applyLayerUpdate(
  renderedSurface: MultiLayerNeuroSurface,
  spec: RenderableLayerSpec
): void {
  switch (spec.kind) {
    case 'rgba':
      renderedSurface.updateLayer(spec.id, {
        rgbaData: spec.rgba,
        opacity: spec.opacity,
      });
      return;
    case 'volume':
      renderedSurface.updateLayer(spec.id, {
        volumeData: spec.volumeData ? new Float32Array(spec.volumeData) : undefined,
        colormap: spec.colormap,
        range: spec.range,
        threshold: spec.threshold,
        affineMatrix: spec.affineMatrix,
        opacity: spec.opacity,
      });
      return;
    case 'data':
    default:
      renderedSurface.updateLayer(spec.id, {
        data: spec.values,
        indices: spec.indices ?? undefined,
        colorMap: spec.colormap,
        range: spec.range,
        threshold: spec.threshold,
        opacity: spec.opacity,
      });
  }
}

function applySmoothingToRenderedSurface(
  renderedSurface: MultiLayerNeuroSurface,
  original: OriginalGeometry,
  smoothingValue: number
): void {
  const mesh = renderedSurface?.mesh;
  if (!mesh || !mesh.geometry) return;

  const threeGeometry = mesh.geometry;
  const positionAttribute = threeGeometry.getAttribute('position');
  if (!positionAttribute) return;

  positionAttribute.array.set(original.vertices);
  positionAttribute.needsUpdate = true;

  if (smoothingValue === 0) {
    threeGeometry.computeVertexNormals();
    threeGeometry.computeBoundingBox();
    threeGeometry.computeBoundingSphere();
    return;
  }

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
}

function applySurfaceRenderSettings(
  renderedSurface: MultiLayerNeuroSurface,
  displaySettings: SurfaceDisplaySettings,
  materialSettings: SurfaceMaterialSettings
): void {
  if (renderedSurface.updateConfig) {
    renderedSurface.updateConfig({
      alpha: displaySettings.opacity,
      flatShading: displaySettings.flatShading,
      shininess: materialSettings.shininess,
      specularColor: colorHexToNumber(materialSettings.specularColor),
      emissive: colorHexToNumber(materialSettings.emissiveColor),
      emissiveIntensity: materialSettings.emissiveIntensity,
    });
  }

  const mesh = renderedSurface.mesh;
  if (!mesh || !mesh.material) {
    return;
  }

  const material = mesh.material as any;

  if (material.wireframe !== undefined) {
    material.wireframe = displaySettings.wireframe;
  }

  if (material.flatShading !== undefined) {
    material.flatShading = displaySettings.flatShading;
  }

  if (material.color && material.color.set) {
    material.color.set(materialSettings.surfaceColor);
  }

  if (mesh.geometry && mesh.geometry.computeVertexNormals) {
    mesh.geometry.computeVertexNormals();
  }

  material.needsUpdate = true;
}

function applySceneRenderSettings(
  viewer: NeuroSurfaceViewerInstance,
  lightingSettings: SurfaceLightingSettings
): void {
  if (!viewer.scene) {
    return;
  }

  viewer.scene.traverse((child: any) => {
    if (child.isAmbientLight) {
      child.intensity = lightingSettings.ambientLightIntensity;
    } else if (child.isDirectionalLight) {
      if (child.userData?.role !== 'fill') {
        child.intensity = lightingSettings.directionalLightIntensity;
        if (lightingSettings.lightPosition) {
          child.position.set(...lightingSettings.lightPosition);
        }
      }
    }
  });

  let fillLight = viewer.scene.getObjectByName('fillLight');
  if (!fillLight && lightingSettings.fillLightIntensity && lightingSettings.fillLightIntensity > 0) {
    fillLight = new THREE.DirectionalLight(0xffffff, lightingSettings.fillLightIntensity);
    fillLight.name = 'fillLight';
    fillLight.userData.role = 'fill';
    fillLight.position.set(-100, -100, -50);
    viewer.scene.add(fillLight);
  } else if (fillLight) {
    fillLight.intensity = lightingSettings.fillLightIntensity || 0;
  }
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

const SurfaceViewCanvasInner: React.FC<SurfaceViewCanvasProps> = ({
  surface,
  renderSurfaces,
  surfaceViewId,
  surfaceContextHandle,
  onActivateSurface,
  width,
  height,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<NeuroSurfaceViewerInstance | null>(null);
  const renderedSurfacesRef = useRef<Map<string, MultiLayerNeuroSurface>>(new Map());
  const renderedSurfaceInputsRef = useRef<Map<string, LoadedSurface>>(new Map());
  const originalGeometryRef = useRef<Map<string, OriginalGeometry>>(new Map());
  const [isInitialized, setIsInitialized] = useState(false);
  const hasCenteredCamera = useRef(false);
  const lastSmoothingValue = useRef<number>(0);

  // Mark this surface render context as active on interaction.
  const surfaceContextId = useMemo(
    () => buildSurfaceViewContextId(surfaceContextHandle ?? surface.handle, surfaceViewId),
    [surfaceContextHandle, surface.handle, surfaceViewId]
  );
  const markRenderableActive = useActiveRenderable(surfaceContextId);
  const handleContextMenu = useViewContextMenu(surfaceContextId);

  const markActive = useMemo(
    () => () => {
      markRenderableActive();
      onActivateSurface?.();
    },
    [markRenderableActive, onActivateSurface]
  );

  const viewpoint = useSurfaceStore((state) => state.viewpoint);
  const showControls = useSurfaceStore((state) => state.showControls);
  const lightingSettings = useSurfaceStore(
    (state) => getSurfaceViewSettingsForId(state.surfaceViewSettings, surfaceViewId).lightingSettings
  );
  const displaySettings = useSurfaceStore(
    (state) => getSurfaceViewSettingsForId(state.surfaceViewSettings, surfaceViewId).displaySettings
  );
  const materialSettings = useSurfaceStore(
    (state) => getSurfaceViewSettingsForId(state.surfaceViewSettings, surfaceViewId).materialSettings
  );
  const projectionSettings = useSurfaceStore(
    (state) => getSurfaceViewSettingsForId(state.surfaceViewSettings, surfaceViewId).projectionSettings
  );
  const lastUseGPUProjectionRef = useRef(
    projectionSettings?.useGPUProjection ?? DEFAULT_SURFACE_VIEW_SETTINGS.projectionSettings.useGPUProjection
  );

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

  // Register an exporter for this surface view so "export active view" works.
  useEffect(() => {
    if (!isInitialized || !viewerRef.current?.renderer?.domElement) return;

    const exportService = getViewExportService();
    const key = surfaceContextId;

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
  }, [surfaceContextId, isInitialized]);

  // Cleanup viewer only on component unmount.
  useEffect(() => {
    return () => {
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
      renderedSurfacesRef.current.clear();
      renderedSurfaceInputsRef.current.clear();
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
  }, [isInitialized, lightingSettings.ambientLightIntensity, lightingSettings.directionalLightIntensity, showControls, viewpoint, width, height]);

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

  // Reconcile surfaces in place and only rebuild on topology changes.
  useEffect(() => {
    if (!isInitialized || !viewerRef.current) return;

    const viewer = viewerRef.current;
    const readySurfaces = surfacesToRender.filter(hasRenderableGeometry);
    const useGPUCompositing = projectionSettings.useGPUProjection;
    const previousUseGPUProjection = lastUseGPUProjectionRef.current;

    const mountRenderedSurface = (item: LoadedSurface) => {
      const existing = renderedSurfacesRef.current.get(item.handle);
      if (existing) {
        removeRenderedSurface(viewer, item.handle, existing);
      }

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

      const renderedSurface = new MultiLayerNeuroSurface(geometry, {
        baseColor: parseInt((materialSettings.surfaceColor || '#CCCCCC').replace('#', ''), 16),
        useGPUCompositing,
      });

      for (const layerSpec of buildRenderableLayerSpecs(item, useGPUCompositing)) {
        renderedSurface.addLayer(buildLayerInstance(layerSpec));
      }

      applySurfaceRenderSettings(renderedSurface, displaySettings, materialSettings);
      viewer.addSurface(renderedSurface, item.handle);

      renderedSurfacesRef.current.set(item.handle, renderedSurface);
      renderedSurfaceInputsRef.current.set(item.handle, item);

      const original = originalGeometryRef.current.get(item.handle);
      if (original) {
        applySmoothingToRenderedSurface(
          renderedSurface,
          original,
          displaySettings.smoothing
        );
      }
    };

    try {
      let changed = false;
      let structuralChange = false;
      const readyHandles = new Set(readySurfaces.map((item) => item.handle));

      for (const [handle, renderedSurface] of Array.from(
        renderedSurfacesRef.current.entries()
      )) {
        if (readyHandles.has(handle)) {
          continue;
        }

        removeRenderedSurface(viewer, handle, renderedSurface);
        renderedSurfacesRef.current.delete(handle);
        renderedSurfaceInputsRef.current.delete(handle);
        originalGeometryRef.current.delete(handle);
        changed = true;
        structuralChange = true;
      }

      if (readySurfaces.length === 0) {
        lastUseGPUProjectionRef.current = useGPUCompositing;
        viewer.requestRender();
        return;
      }

      for (const item of readySurfaces) {
        const previousInput = renderedSurfaceInputsRef.current.get(item.handle);
        const renderedSurface = renderedSurfacesRef.current.get(item.handle);

        if (
          !previousInput ||
          !renderedSurface ||
          isSurfaceGeometryChanged(previousInput, item)
        ) {
          mountRenderedSurface(item);
          changed = true;
          structuralChange = true;
          continue;
        }

        const plan = planSurfaceReconciliation(previousInput, item, {
          previousUseGPUProjection,
          nextUseGPUProjection: useGPUCompositing,
        });

        if (plan.requiresRebuild) {
          mountRenderedSurface(item);
          changed = true;
          structuralChange = true;
          continue;
        }

        if (plan.compositingModeChanged && renderedSurface.setCompositingMode) {
          renderedSurface.setCompositingMode(useGPUCompositing);
          changed = true;
        }

        for (const layerId of plan.removeLayerIds) {
          renderedSurface.removeLayer(layerId);
          changed = true;
        }

        for (const layerSpec of plan.addLayers) {
          renderedSurface.addLayer(buildLayerInstance(layerSpec));
          changed = true;
        }

        for (const layerSpec of plan.updateLayers) {
          applyLayerUpdate(renderedSurface, layerSpec);
          changed = true;
        }

        if (plan.orderChanged && plan.orderedLayerIds.length > 0) {
          renderedSurface.setLayerOrder(plan.orderedLayerIds);
          changed = true;
        }

        renderedSurfaceInputsRef.current.set(item.handle, item);
      }

      lastUseGPUProjectionRef.current = useGPUCompositing;

      if (structuralChange && viewer.centerCamera && !hasCenteredCamera.current) {
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
      } else if (changed) {
        viewer.requestRender();
      }
    } catch (error) {
      console.error('Failed to load surface geometry:', error);
    }
  }, [isInitialized, surfacesToRender, projectionSettings.useGPUProjection]);

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

    const smoothingValue = displaySettings.smoothing;
    if (Math.abs(smoothingValue - lastSmoothingValue.current) < 0.01) return;

    renderedSurfacesRef.current.forEach((renderedSurface, handle) => {
      const original = originalGeometryRef.current.get(handle);
      if (!original) return;
      applySmoothingToRenderedSurface(renderedSurface, original, smoothingValue);
    });

    lastSmoothingValue.current = smoothingValue;
    viewerRef.current.requestRender();
  }, [displaySettings.smoothing, renderHandlesKey]);

  // Apply surface display/material settings to all rendered surfaces.
  useEffect(() => {
    if (!viewerRef.current || renderedSurfacesRef.current.size === 0) return;

    renderedSurfacesRef.current.forEach((renderedSurface) => {
      applySurfaceRenderSettings(renderedSurface, displaySettings, materialSettings);
    });

    viewerRef.current.requestRender();
  }, [displaySettings, materialSettings, renderHandlesKey]);

  // Apply scene lighting settings.
  useEffect(() => {
    if (!viewerRef.current) return;

    applySceneRenderSettings(viewerRef.current, lightingSettings);
    viewerRef.current.requestRender();
  }, [lightingSettings]);

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

export const SurfaceViewCanvas = React.memo(SurfaceViewCanvasInner);
