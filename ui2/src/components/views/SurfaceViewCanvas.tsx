/**
 * Brainflow surface view adapter.
 *
 * Store, event-bus, and export-service wiring stays here; neurosurface lifecycle
 * lives in the reusable surfaceViewer/NeuroSurfaceCanvas component.
 */

import { resolveCursorAnatomy } from './surfaceLink';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { LoadedSurface } from '@/stores/surfaceStore';
import {
  DEFAULT_SURFACE_VIEW_SETTINGS,
  getSurfaceViewSettingsForId,
  getSurfaceViewpointForId,
  useSurfaceStore,
} from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getEventBus } from '@/events/EventBus';
import { getViewExportService } from '@/services/ViewExportService';
import { getSurfaceCurvatureService } from '@/services/SurfaceCurvatureService';
import { useSurfaceCameraStore } from '@/stores/surfaceCameraStore';
import { addLogEntry } from '@/stores/logStore';
import type { CameraBasis } from '@/utils/orientationGizmo';
import { useActiveRenderable } from '@/hooks/useActiveRenderable';
import { useViewContextMenu } from '@/hooks/useViewContextMenu';
import { buildSurfaceViewContextId } from '@/utils/surfaceViewContext';
import {
  NeuroSurfaceCanvas,
  type SurfaceCanvasExporter,
  type SurfaceRenderable,
} from './surfaceViewer';

interface SurfaceViewCanvasProps {
  surface: LoadedSurface;
  renderSurfaces?: LoadedSurface[];
  surfaceViewId: string;
  surfaceContextHandle?: string;
  onActivateSurface?: () => void;
  width: number;
  height: number;
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
  const [renderSignal, setRenderSignal] = useState(0);
  const surfaceContextId = useMemo(
    () => buildSurfaceViewContextId(surfaceContextHandle ?? surface.handle, surfaceViewId),
    [surfaceContextHandle, surface.handle, surfaceViewId],
  );
  const markRenderableActive = useActiveRenderable(surfaceContextId);
  const handleContextMenu = useViewContextMenu(surfaceContextId);

  const markActive = useCallback(() => {
    markRenderableActive();
    onActivateSurface?.();
  }, [markRenderableActive, onActivateSurface]);

  const viewpoint = useSurfaceStore((state) =>
    getSurfaceViewpointForId(state.surfaceViewViewpoints, surfaceViewId),
  );
  // A preset pressed again in THIS tab refits it; the global counter still
  // refits every view.
  const viewpointNonce = useSurfaceStore(
    (state) => state.viewpointNonce + (state.surfaceViewViewpointNonces.get(surfaceViewId) ?? 0),
  );
  const showControls = useSurfaceStore((state) => state.showControls);
  const lightingSettings = useSurfaceStore(
    (state) =>
      getSurfaceViewSettingsForId(state.surfaceViewSettings, surfaceViewId).lightingSettings,
  );
  const displaySettings = useSurfaceStore(
    (state) =>
      getSurfaceViewSettingsForId(state.surfaceViewSettings, surfaceViewId).displaySettings,
  );
  const materialSettings = useSurfaceStore(
    (state) =>
      getSurfaceViewSettingsForId(state.surfaceViewSettings, surfaceViewId).materialSettings,
  );
  const projectionSettings = useSurfaceStore(
    (state) =>
      getSurfaceViewSettingsForId(state.surfaceViewSettings, surfaceViewId).projectionSettings,
  );

  // Linked cursor: mirror the volume crosshair onto the surface. world_mm is a
  // stable tuple reference held in the store, so this selector is render-safe.
  const crosshairWorld = useViewStateStore((state) => state.viewState.crosshair.world_mm);
  const crosshairVisible = useViewStateStore((state) => state.viewState.crosshair.visible);
  // SurfaceGeometryData exports vertices_world; both sides use the image/world
  // affine contract. Do not apply an additional axis reflection here.
  const markerWorldPosition = crosshairVisible ? crosshairWorld : null;
  const handleSurfacePick = useCallback((world: [number, number, number], picked?: { handle: string; vertex: number }) => {
    if (!world.every(Number.isFinite)) return;
    markActive();
    useSurfaceStore.getState().setPickedVertex(picked ? { surfaceId: picked.handle, vertex: picked.vertex, world } : null);
    void useViewStateStore.getState().setCrosshair(world, true);
  }, [markActive]);

  const surfacesToRender = useMemo(() => {
    const candidateSurfaces = renderSurfaces ?? [surface];
    const unique = new Map<string, LoadedSurface>();
    for (const item of candidateSurfaces) {
      if (!unique.has(item.handle)) {
        unique.set(item.handle, item);
      }
    }
    return Array.from(unique.values()) as SurfaceRenderable[];
  }, [renderSurfaces, surface]);

  const loadedSurfaces = useSurfaceStore(state => state.surfaces);
  const cursorAnatomy = useMemo(() => resolveCursorAnatomy(
    renderSurfaces ?? [surface], loadedSurfaces.values()), [renderSurfaces, surface, loadedSurfaces]);

  const renderHandlesKey = useMemo(
    () =>
      surfacesToRender
        .map((item) => item.handle)
        .sort()
        .join('|'),
    [surfacesToRender],
  );

  // The viewer applies the preset after its first fit, and the nonce
  // re-applies it when the checked preset is pressed again (phase 4: the
  // viewer is ours; the earlier prop-flip workaround is gone).
  useEffect(() => {
    getSurfaceCurvatureService().start();
  }, []);

  // D5: the camera basis for the frame's orientation glyph.
  const handleCameraChange = useCallback(
    (basis: CameraBasis) => useSurfaceCameraStore.getState().setBasis(surfaceViewId, basis),
    [surfaceViewId],
  );

  // Viewer conditions that otherwise leave a silent black pane (context loss,
  // a fit with no mesh bounds) go to the Log dock.
  // Named by the surface shown, not the view's internal id (QA 2026-10-30
  // F40: "5jYIE5B3…: WebGL context lost").
  const surfaceName = surface?.name;
  const handleViewerWarning = useCallback(
    (message: string) =>
      addLogEntry({
        level: 'warn',
        source: 'surface',
        message: surfaceName ? `Surface view (${surfaceName}): ${message}` : `Surface view: ${message}`,
      }),
    [surfaceName],
  );

  const handleExporterChange = useCallback(
    (exporter: SurfaceCanvasExporter | null) => {
      const exportService = getViewExportService();
      if (exporter) {
        exportService.registerExporter(surfaceContextId, exporter);
      } else {
        exportService.unregisterExporter(surfaceContextId);
      }
    },
    [surfaceContextId],
  );

  useEffect(() => {
    return () => {
      getViewExportService().unregisterExporter(surfaceContextId);
    };
  }, [surfaceContextId]);

  useEffect(() => {
    const handles = new Set(surfacesToRender.map((item) => item.handle));
    const handleOverlayApplied = (payload: unknown) => {
      const detail = (payload as { detail?: any })?.detail ?? payload;
      if (!detail?.surfaceId || !handles.has(detail.surfaceId)) return;
      setRenderSignal((value) => value + 1);
    };

    const eventBus = getEventBus();
    const unsubscribe = eventBus.on('surface.overlayApplied', handleOverlayApplied);

    return () => {
      unsubscribe();
    };
  }, [renderHandlesKey, surfacesToRender]);

  return (
    <NeuroSurfaceCanvas
      surfaces={surfacesToRender}
      width={width}
      height={height}
      viewpoint={viewpoint}
      viewpointNonce={viewpointNonce}
      showControls={showControls}
      lightingSettings={lightingSettings ?? DEFAULT_SURFACE_VIEW_SETTINGS.lightingSettings}
      displaySettings={displaySettings ?? DEFAULT_SURFACE_VIEW_SETTINGS.displaySettings}
      materialSettings={materialSettings ?? DEFAULT_SURFACE_VIEW_SETTINGS.materialSettings}
      projectionSettings={projectionSettings ?? DEFAULT_SURFACE_VIEW_SETTINGS.projectionSettings}
      markerWorldPosition={markerWorldPosition}
      cursorAnatomy={cursorAnatomy}
      markerSnapToSurface
      markerMaxSnapDistanceMm={20}
      renderSignal={renderSignal}
      onActivate={markActive}
      onContextMenu={handleContextMenu}
      onExporterChange={handleExporterChange}
      onCameraChange={handleCameraChange}
      onWarning={handleViewerWarning}
      onSurfacePick={handleSurfacePick}
    />
  );
};

export const SurfaceViewCanvas = React.memo(SurfaceViewCanvasInner);
