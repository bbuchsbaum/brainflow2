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
  useSurfaceStore,
} from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getEventBus } from '@/events/EventBus';
import { getViewExportService } from '@/services/ViewExportService';
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

  const viewpoint = useSurfaceStore((state) => state.viewpoint);
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
  const handleSurfacePick = useCallback((world: [number, number, number]) => {
    if (!world.every(Number.isFinite)) return;
    markActive();
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
      onSurfacePick={handleSurfacePick}
    />
  );
};

export const SurfaceViewCanvas = React.memo(SurfaceViewCanvasInner);
