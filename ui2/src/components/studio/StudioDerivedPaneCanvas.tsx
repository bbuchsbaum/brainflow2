import { useEffect, useMemo, useRef, useState } from 'react';
import { SliceViewport } from '@/components/views/SliceViewport';
import { ViewportColorbar, type ColorbarLayer } from '@/components/views/viewportFrame';
import {
  getStudioDerivedMapService,
  isGpuTextureSlotsFull,
  type StudioDerivedMap,
} from '@/services/studio/StudioDerivedMapService';
import {
  clearStudioPane,
  scheduleStudioPaneRender,
  studioDerivedDisplay,
  studioPaneTag,
  type StudioPanePlane,
} from '@/services/studio/StudioPaneRenderService';
import { useAppModeStore } from '@/stores/appModeStore';
import { useMirrorsView } from '@/stores/viewDisplaySettingsStore';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { ViewPlane } from '@/types/coordinates';
import { buildActiveCrosshairStyle } from '@/utils/crosshairUtils';

/** Panes whose map is signed: drawn on the diverging map, symmetric about 0. */
const SIGNED_PANES = new Set(['residual', 'zscore']);

/**
 * Body of a derived Compare pane (B–D): the materialized map itself, held
 * through StudioDerivedMapService (never a workspace layer) and drawn by its
 * own render (StudioPaneRenderService), with its colorbar. It is bound to the
 * Studio's workspace and draws only while that workspace is in front. The pane
 * header carries status and provenance; the cache path is never shown (QA F8).
 */
export function StudioDerivedPaneCanvas({
  paneId,
  sourcePath,
  label,
  workspaceId,
  plane = 'axial',
}: {
  paneId: string;
  sourcePath: string;
  label: string;
  /** The Studio's workspace (captured by the lens, not the one in front). */
  workspaceId: string;
  plane?: StudioPanePlane;
}) {
  const active = useAppModeStore((state) => state.mode === 'studio');
  const inFront = useWorkspaceStore((state) => state.activeWorkspaceId === workspaceId);
  const studioActive = active && inFront;

  // Held while the Studio is in front; leaving it gives the map up and
  // re-entering acquires it again (review M1).
  const [map, setMap] = useState<StudioDerivedMap | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    setMap(null);
    setFailure(null);
    if (!studioActive) return;
    let alive = true;
    const hold = getStudioDerivedMapService().acquire(sourcePath);
    hold.map
      .then((loaded) => {
        if (!alive) return;
        if (loaded) setMap(loaded);
        else setFailure('The map could not be opened.');
      })
      .catch((error) => {
        if (!alive) return;
        // The GPU's volume slots are a hard budget: say so, with the way out.
        setFailure(
          isGpuTextureSlotsFull(error)
            ? 'GPU texture slots full: close a layer to show this map.'
            : 'The map could not be opened.',
        );
      });
    return () => {
      alive = false;
      hold.release();
    };
  }, [sourcePath, studioActive]);

  const layer = useMemo(
    () => (map ? studioDerivedDisplay(map, SIGNED_PANES.has(paneId), label) : null),
    [map, paneId, label],
  );

  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = host.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const next = { width: Math.floor(rect.width), height: Math.floor(rect.height) };
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A pane draws only its own map at the Studio crosshair: it follows the
  // crosshair (and frame), not every view-state edit (review W2).
  const crosshairWorld = useViewStateStore(
    (state) => state.getWorkspaceViewState(workspaceId).crosshair.world_mm,
  );
  const timepoint = useViewStateStore((state) => state.getWorkspaceViewState(workspaceId).timepoint);
  const tag = studioPaneTag(paneId, plane);
  const [viewPlane, setViewPlane] = useState<ViewPlane | null>(null);
  useEffect(() => {
    if (!studioActive || !map || !layer || size.width <= 0 || size.height <= 0) return;
    let alive = true;
    scheduleStudioPaneRender(
      { tag, workspaceId, map, layer, plane, width: size.width, height: size.height },
      (drawn) => {
        if (alive) setViewPlane(drawn);
      },
    );
    return () => {
      alive = false;
    };
  }, [
    studioActive,
    map,
    layer,
    size.width,
    size.height,
    workspaceId,
    crosshairWorld,
    timepoint,
    tag,
    plane,
  ]);
  // The pane's bitmap goes with the pane (review L2).
  useEffect(() => () => clearStudioPane(tag), [tag]);

  const crosshairVisible = useViewStateStore(
    (state) => state.getWorkspaceViewState(workspaceId).crosshair.visible,
  );
  const crosshair = useMemo(
    () => ({ visible: crosshairVisible, world_mm: crosshairWorld }),
    [crosshairVisible, crosshairWorld],
  );
  const settings = useCrosshairSettingsStore((state) => state.getViewSettings(plane));
  const crosshairStyle = useMemo(
    () =>
      buildActiveCrosshairStyle({
        activeColor: settings.activeColor,
        activeThickness: settings.activeThickness,
        activeStyle: settings.activeStyle,
        centerGap: settings.centerGap,
      }),
    [settings.activeColor, settings.activeThickness, settings.activeStyle, settings.centerGap],
  );
  const context = useMemo(
    () => ({
      id: tag,
      type: 'comparison-panel' as const,
      dimensions: { width: size.width, height: size.height },
      metadata: { panelId: tag, viewType: plane },
    }),
    [tag, size.width, size.height, plane],
  );
  const colorbar = useMemo<ColorbarLayer | null>(
    () =>
      layer && map
        ? {
            layerId: layer.id,
            name: label,
            nameLabel: label,
            colormap: layer.colormap,
            intensity: layer.intensity,
            threshold: layer.threshold,
            dataRange: map.dataRange,
          }
        : null,
    [layer, map, label],
  );

  // Radiological convention: axial/coronal drawn mirrored by the shared
  // SliceViewport; clicks and the crosshair map through its placement.
  const mirrorX = useMirrorsView(plane);
  const ready = studioActive && !!map && size.width > 0 && size.height > 0;
  return (
    <div ref={host} className="absolute inset-0" data-testid={`studio-derived-pane-${paneId}`}>
      {ready ? (
        <SliceViewport
          width={size.width}
          height={size.height}
          context={context}
          tag={tag}
          viewPlane={viewPlane}
          crosshair={crosshair}
          crosshairStyle={crosshairStyle}
          mirrorX={mirrorX}
          onWorldClick={(world) => {
            void useViewStateStore.getState().setCrosshair(world, true, false, workspaceId);
          }}
          className="h-full w-full"
          canvasClassName="cursor-crosshair"
        />
      ) : (
        <div className="flex h-full items-center justify-center px-4 text-center text-bf-xs text-muted-foreground">
          {failure ?? (studioActive ? 'Opening map…' : null)}
        </div>
      )}
      {ready && colorbar ? (
        <ViewportColorbar
          layer={colorbar}
          width={size.width}
          height={size.height}
          corner="top"
          maxWidth={Math.max(96, size.width - 16)}
        />
      ) : null}
    </div>
  );
}
