/**
 * SliceViewCanvas Component
 *
 * Orthogonal slice view implementation built on the shared SliceViewport.
 * Higher-level behaviors like hover info, window/level, wheel navigation,
 * and context menus stay here while viewport mechanics are shared.
 */

import { writeLayerDisplayField } from "@/utils/layerDisplayWrite";
import React, {
  useRef,
  useCallback,
  useMemo,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { SliceViewport, type SliceViewportPlacement } from "./SliceViewport";
import { SliceSlider } from "@/components/ui/SliceSlider";
import { Slider } from "@/components/ui/bf";
import { getSliceNavigationService } from "@/services/SliceNavigationService";
import { useTransientOverlay } from "@/components/ui/TransientOverlay";
import { getTimeNavigationService } from "@/services/TimeNavigationService";
import { RenderErrorBoundary } from "@/components/ui/RenderErrorBoundary";
import { useCrosshairSettingsStore } from "@/stores/crosshairSettingsStore";
import {
  buildActiveCrosshairStyle,
  type CrosshairRect,
  type CrosshairStyle,
} from "@/utils/crosshairUtils";
import { useSliceViewModel } from "@/hooks/useSliceViewModel";
import { SLIDER_HEIGHT } from "./constants";
import { useViewStateStore } from "@/stores/viewStateStore";
import { useLayerStore } from "@/stores/layerStore";
import { useWindowLevel } from "@/hooks/useWindowLevel";
import { useShortcut } from "@/hooks/useShortcut";
import { useDisplayOptionsStore } from "@/stores/displayOptionsStore";
import { useViewContextMenu } from "@/hooks/useViewContextMenu";
import { useActiveRenderable } from "@/hooks/useActiveRenderable";
import { useHoverInfo } from "@/hooks/useHoverInfo";
import type { DisplayOpenIntent } from "@/types/loadIntent";
import { CoordinateTransform } from "@/utils/coordinates";
import { TemporalHeatmapOverlay } from "./TemporalHeatmapOverlay";
import {
  TemporalMetricSelector,
  type TemporalMetricOption,
} from "@/components/ui/TemporalMetricSelector";
import type { SliceAxis } from "@/services/TemporalHeatmapService";
import {
  computeTemporalHeatmapSliceIndex,
  isTemporalHeatmapEligible,
} from "./temporalHeatmapState";
import { useActiveLayer } from "@/utils/activeLayer";
import { useLayerValueAtWorld } from "@/hooks/useLayerValueAtWorld";
import { pointerToWorld } from "@/utils/slicePointer";
import { createWheelStepper } from "@/utils/wheelSteps";
import { imagePointToCanvasPoint } from "@brainflow/visualization/slice";
import { useMirrorsView } from "@/stores/viewDisplaySettingsStore";
import { useCanvasPixelRatio } from "@/hooks/useCanvasPixelRatio";
import {
  beginRenderInteraction,
  endRenderInteraction,
  pulseRenderInteraction,
  renderInteractionActive,
  subscribeRenderRatio,
} from "@/utils/renderPixelRatio";
import { useViewPanZoom, wheelZoomFactor } from "@/hooks/useViewPanZoom";
import { fitActiveView, fitView, useIsViewZoomed, zoomView } from "@/services/ViewZoomService";
import { isClickOnData, useLayerEdgeBounds } from "./clickDataBounds";
import { useColorbarGroup, useViewportFrameStore } from "./viewportFrame/viewportFrameStore";
import { ColorbarFit, placeColorbarBlock } from "./viewportFrame/colorbarPlacement";
import { measureColorbar } from "./viewportFrame/colorbarMeasure";
import { dataRectOnPane, paneRectFromKey, paneRectKey } from "./viewportFrame/paneGeometry";
import {
  OrientationLabels,
  ViewportColorbar,
  ViewportHeader,
  orientationLabelKey as buildOrientationLabelKey,
  useColorbarHostPlane,
  useOrientationLabelKnockouts,
  useOverlayColorbar,
} from "./viewportFrame";

/** Pane width below which the Temporal selector shows its menu only. */
const TEMPORAL_CAPTION_MIN_WIDTH = 480;

function getSliceAxisIndex(viewId: SliceViewCanvasProps["viewId"]): 0 | 1 | 2 {
  if (viewId === "sagittal") return 0;
  if (viewId === "coronal") return 1;
  return 2;
}

// Equality helpers now live in the view-model hook; no need here.

// Removed: direct store typing alias is unnecessary in this component

interface SliceViewCanvasProps {
  viewId: "axial" | "sagittal" | "coronal";
  width: number;
  height: number;
  className?: string;
  /**
   * Top-right space a container control covers (the orthogonal workspace's
   * lock button, LAYOUT_BUTTON_RESERVE): the colorbar keeps below it. 0 where
   * there is none (Orthogonal Panels, the Studio Deck), review L4.
   */
  topRightReserve?: number;
}

function SliceViewCanvasRaw({
  viewId,
  width,
  height,
  className = "",
  topRightReserve = 0,
}: SliceViewCanvasProps) {
  const model = useSliceViewModel(viewId, { width, height });
  // The early return lives here, and every other hook in the body component,
  // so the hook order never changes between renders (rules of hooks).
  if (!model.viewPlane) {
    return (
      <div
        className={`h-full w-full relative ${className}`}
        data-view-id={viewId}
      >
        <div className="absolute inset-0 flex items-center justify-center text-bf-xs text-bf-text-secondary">
          Loading view…
        </div>
      </div>
    );
  }
  return (
    <SliceViewCanvasBody
      viewId={viewId}
      width={width}
      height={height}
      className={className}
      model={model}
      topRightReserve={topRightReserve}
    />
  );
}

type SliceViewModel = ReturnType<typeof useSliceViewModel>;

function SliceViewCanvasBody({
  viewId,
  width,
  height,
  className,
  model,
  topRightReserve = 0,
}: SliceViewCanvasProps & { className: string; model: SliceViewModel }) {
  const {
    crosshair,
    layers,
    hasLayers,
    isLoadingAnyLayer,
    canvasHeight,
    renderContext,
    primaryLayer,
    windowLevelLayer,
    primaryOptions,
    hoverEnabled,
    hoverLayerIds,
  } = model;
  const viewPlane = model.viewPlane as NonNullable<SliceViewModel["viewPlane"]>;

  // Access setter without subscribing to it (stable reference)
  const setCrosshair = useRef(
    useViewStateStore.getState().setCrosshair,
  ).current;

  // RenderContext registration handled by useSliceViewModel

  // Crosshair settings provided by the controller
  const crosshairSettings = model.crosshairSettings;

  // Time navigation (service-only to avoid extra store subscriptions)
  const timeNavService = getTimeNavigationService();
  const { show: showTimeOverlay, overlay: timeOverlay } = useTransientOverlay({
    duration: 500,
    position: "center",
  });

  // Temporal heatmap state
  const [temporalMetric, setTemporalMetric] =
    useState<TemporalMetricOption>("none");
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.5);
  const axisIndex = getSliceAxisIndex(viewId);

  // Detect whether the primary layer is a 4D volume
  const is4DVolume = useMemo(() => {
    return isTemporalHeatmapEligible(primaryLayer);
  }, [primaryLayer]);

  // Map viewId to SliceAxis for the heatmap service
  const sliceAxis = useMemo((): SliceAxis => {
    if (viewId === "sagittal") return "sagittal";
    if (viewId === "coronal") return "coronal";
    return "axial";
  }, [viewId]);

  // The 4D layer's affine: the heatmap is placed through it onto the image.
  const heatmapAffine = useLayerStore((s) =>
    primaryLayer?.id ? s.layerMetadata.get(primaryLayer.id)?.voxelToWorld ?? null : null,
  );

  // Current slice index in voxel space (integer, clamped to valid range)
  const heatmapSliceIndex = useMemo(() => {
    if (!primaryLayer?.id) return 0;
    const metadata = useLayerStore.getState().getLayerMetadata(primaryLayer.id);
    try {
      return computeTemporalHeatmapSliceIndex(
        metadata,
        crosshair.world_mm,
        axisIndex,
      );
    } catch (error) {
      console.warn(
        `SliceViewCanvas ${viewId}: Failed to compute temporal heatmap slice index`,
        error,
      );
      return 0;
    }
  }, [axisIndex, crosshair.world_mm, primaryLayer?.id, viewId]);

  // Container ref for window/level hook
  const containerAreaRef = useRef<HTMLDivElement>(null);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagePlacementRef = useRef<SliceViewportPlacement | null>(null);
  const showMarkers = primaryOptions.showOrientationMarkers;
  const showHover = hoverEnabled;

  // Window/level edits the selected (else topmost visible) windowed layer.
  const windowLevelLayerId = windowLevelLayer?.id ?? null;
  const dataRange = useMemo(() => {
    if (!windowLevelLayerId) return null;
    const metadata = useLayerStore.getState().getLayerMetadata(windowLevelLayerId);
    const dr = metadata?.dataRange;
    if (!dr) return null;
    return { min: dr.min, max: dr.max };
  }, [windowLevelLayerId]);

  // Window/level handler: updates layer intensity in viewStateStore
  const handleWindowLevelUpdate = useCallback(
    (intensity: [number, number]) => {
      if (!windowLevelLayerId) return;
      // Panel-aware in an unlinked Compare (the Inspector's rule).
      writeLayerDisplayField(windowLevelLayerId, 'intensity', intensity);
    },
    [windowLevelLayerId],
  );

  // useWindowLevel hook — attaches to the canvas area div
  const { isDragging, overlayProps } = useWindowLevel({
    canvasRef: containerAreaRef,
    layerId: windowLevelLayerId,
    dataRange,
    // A drag starts from the layer's current window (never the data range).
    getCurrentWindow: () =>
      windowLevelLayerId
        ? useViewStateStore.getState().viewState.layers.find((l) => l.id === windowLevelLayerId)?.intensity
        : null,
    onUpdate: handleWindowLevelUpdate,
  });

  // Stable ref for viewPlane to prevent infinite loop in handleMouseMove
  const viewPlaneRef = React.useRef(viewPlane);
  React.useEffect(() => {
    if (viewPlane) {
      viewPlaneRef.current = viewPlane;
    }
  }, [viewPlane]);

  const activeAtlasId = useMemo(() => {
    const atlasLayer = layers.find(
      (layer) => layer.type === "label" && layer.atlasMetadata,
    );
    return atlasLayer?.id;
  }, [layers]);
  const markActive = useActiveRenderable(viewId);

  // Pointer -> world through the shared viewer's click-to-world path
  // (clientPointToWorld: client point -> canvas pixels -> image -> world), so
  // the hover readout, the status Mouse slot and a click at the same pixel
  // agree. Measuring from the hovered container instead of the canvas put
  // the readout about a pixel off (P3 v1 fidelity critique).
  const canvasToWorld = useCallback(
    (
      _canvasX: number,
      _canvasY: number,
      clientX: number,
      clientY: number,
    ): [number, number, number] | null => {
      return pointerToWorld(
        clientX,
        clientY,
        canvasRef.current,
        imagePlacementRef.current,
        viewPlaneRef.current,
      );
    },
    [],
  );

  const { handleMouseMove, handleMouseLeave } = useHoverInfo({
    viewId,
    enabled: showHover,
    activeLayerId: primaryLayer?.id,
    activeAtlasId,
    layerIds: hoverLayerIds,
    canvasToWorld,
    onHoverStart: markActive,
    // A slice step or zoom under a still pointer re-reads the pointer (F5).
    viewKey: `${viewPlane.origin_mm}|${viewPlane.u_mm}|${viewPlane.v_mm}|${viewPlane.dim_px}`,
  });

  // Slider navigation using the same approach as original SliceView
  const sliceNavService = getSliceNavigationService();

  const snapToVoxelSetting = useCrosshairSettingsStore((s) => s.settings.snapToVoxel);
  // Get min/max/step (only depends on layers, not crosshair)
  const sliderBounds = React.useMemo(() => {
    try {
      const range = sliceNavService.getSliceRange(viewId);
      return {
        min: range.min,
        max: range.max,
        step: range.step,
        current: range.current,
      };
    } catch (error) {
      console.warn(
        `SliceViewCanvas ${viewId}: Failed to get slice range, using defaults`,
        error,
      );
      return {
        min: -100,
        max: 100,
        step: 1,
        current: crosshair.world_mm[axisIndex] ?? 0,
      };
    }
  }, [
    sliceNavService,
    viewId,
    layers,
    axisIndex,
    crosshair.world_mm[axisIndex],
    // The grid changes with the snapping setting (navigationMetadata).
    snapToVoxelSetting,
  ]);

  // Current slider value mirrors crosshair position for this axis
  const sliderValue = sliderBounds.current ?? crosshair.world_mm[axisIndex];

  // Handle slider changes
  // Guard against no-op updates to break Slider -> store -> Slider loop
  const sliderValueRef = useRef(sliderValue);
  useEffect(() => {
    sliderValueRef.current = sliderValue;
  }, [sliderValue]);
  const handleSliderChange = useCallback(
    (value: number) => {
      if (Object.is(value, sliderValueRef.current)) return;
      sliceNavService.updateSlicePosition(viewId, value);
    },
    [sliceNavService, viewId],
  );

  const centerGapSetting = useCrosshairSettingsStore(
    (state) => state.settings.centerGap,
  );
  const crosshairStyle = useMemo<CrosshairStyle>(
    () =>
      buildActiveCrosshairStyle({
        activeColor: crosshairSettings.activeColor,
        activeThickness: crosshairSettings.activeThickness,
        activeStyle: crosshairSettings.activeStyle,
        centerGap: centerGapSetting,
      }),
    [
      crosshairSettings.activeColor,
      crosshairSettings.activeThickness,
      crosshairSettings.activeStyle,
      centerGapSetting,
    ],
  );

  // Orientation letters: the crosshair stroke is clipped around them (the
  // letters and the line geometry are unchanged). Measured at draw time.
  // Radiological convention: axial and coronal panes are drawn mirrored (a
  // display transform; the placement carries it to every mapping).
  const mirrorX = useMirrorsView(viewId);
  // HiDPI backing store (docs/plans/hidpi-slice-rendering-2026-10-31.md).
  const pixelRatio = useCanvasPixelRatio();
  const orientationLabelKey = buildOrientationLabelKey(
    viewPlane,
    showMarkers && hasLayers,
    mirrorX,
  );
  const { refs: orientationLabelRefs, getKnockouts: getCrosshairKnockouts } =
    useOrientationLabelKnockouts(orientationLabelKey);

  // Viewport frame: header (plane, slice mm, selected layer) and the on-image
  // colorbar for the selected overlay, hosted by the largest orthogonal view.
  // The single active-layer rule (utils/activeLayer), shared with the
  // status bar's Layer/Value slots and the colorbar.
  const viewStateLayers = useViewStateStore((s) => s.viewState.layers);
  const headerLayer = useActiveLayer(viewStateLayers);
  const headerLayerName = headerLayer ? headerLayer.name || headerLayer.id : null;
  // The scrub range (same as the rail): the header reserves its widest value.
  const headerRangeMm = useMemo<[number, number]>(
    () => [sliderBounds.min, sliderBounds.max],
    [sliderBounds.min, sliderBounds.max],
  );
  // The header is clipped out of the crosshair stroke like a letter (slot 4).
  const setHeaderElement = useCallback(
    (el: HTMLDivElement | null) => {
      orientationLabelRefs.current[4] = el;
    },
    [orientationLabelRefs],
  );
  const colorbarLayer = useOverlayColorbar();
  const colorbarHost = useColorbarHostPlane();
  const showColorbar = hasLayers && !!colorbarLayer && colorbarHost === viewId;
  // Caret on the colorbar: the colorbar layer's value at the crosshair (the
  // same shared, debounced sample the status bar's Value slot uses).
  const colorbarReading = useLayerValueAtWorld(
    showColorbar ? colorbarLayer?.layerId : null,
    crosshair.world_mm,
  );
  const [placementState, setPlacementState] =
    useState<SliceViewportPlacement | null>(null);
  // Image rectangle and crosshair centre in canvas-area CSS px, from the
  // placement the shared viewport computed (read-only; no new fit math). The
  // image rectangle is keyed on whole px, apart from the crosshair, so the
  // colorbar placement does not rerun on every crosshair move (review W4).
  const imageRectKey = useMemo(() => {
    const canvas = canvasRef.current;
    const p = placementState;
    if (!canvas || !p || canvas.width === 0) return "";
    const rect = canvas.getBoundingClientRect();
    const k = rect.width > 0 ? rect.width / canvas.width : 1;
    return paneRectKey({
      left: p.x * k,
      top: p.y * k,
      right: (p.x + p.width) * k,
      bottom: (p.y + p.height) * k,
    });
    // width / canvasHeight: the canvas is re-measured after a resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementState, width, canvasHeight]);
  const frameImageRect = useMemo(() => paneRectFromKey(imageRectKey), [imageRectKey]);
  const crosshairPoint = useMemo(() => {
    const p = placementState;
    if (!frameImageRect || !p || !crosshair.visible || !(p.imageWidth > 0) || !(p.imageHeight > 0)) {
      return null;
    }
    const k = (frameImageRect.right - frameImageRect.left) / p.width;
    const [ix, iy] = CoordinateTransform.worldToScreenUnchecked(crosshair.world_mm, viewPlane);
    // Through the placement, so a mirrored display is followed.
    const point = imagePointToCanvasPoint([ix, iy], p);
    return { x: point.canvasX * k, y: point.canvasY * k };
  }, [placementState, frameImageRect, crosshair.visible, crosshair.world_mm, viewPlane]);

  // Handle mouse clicks to update crosshair — skip if window/level drag is active
  const isDraggingRef = useRef(isDragging);
  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);
  // 1× while a window/level drag runs (utils/renderPixelRatio).
  useEffect(() => {
    if (!isDragging) return;
    const source = `window-level:${viewId}`;
    beginRenderInteraction(source);
    return () => endRenderInteraction(source);
  }, [isDragging, viewId]);

  // Clicks off the image data (letterbox / margin around the volume inside
  // the bitmap) do not move the crosshair.
  const dataLayerIds = useMemo(() => layers.map((l) => l.id), [layers]);
  const dataEdgeBounds = useLayerEdgeBounds(dataLayerIds);
  // Where the data is drawn: the colorbar keeps off it (QA 2026-10-31 N16).
  // The CSS scale comes from the measured image rectangle, never a layout
  // read per crosshair move (review L4a); keyed on whole px like it.
  const colorbarDataKey = useMemo(() => {
    if (!frameImageRect || !placementState || !(placementState.width > 0)) return "";
    const k = (frameImageRect.right - frameImageRect.left) / placementState.width;
    return paneRectKey(dataRectOnPane(dataEdgeBounds, viewPlane, placementState, crosshair.world_mm, k));
  }, [dataEdgeBounds, viewPlane, placementState, crosshair.world_mm, frameImageRect]);
  const colorbarDataRect = useMemo(() => paneRectFromKey(colorbarDataKey), [colorbarDataKey]);

  // How well this view holds the colorbar, by the same placement rule the
  // colorbar uses (the volume's on-screen bounds vs the pane): one view per
  // colorbar group hosts it, chosen with hysteresis (viewportFrameStore).
  // The side letters are centred on the whole panel, slider included.
  const { group: colorbarGroup } = useColorbarGroup();
  const sideLetterY = (canvasHeight + SLIDER_HEIGHT) / 2;
  // The block's forms, measured once per layer (review W4) and with the same
  // inputs in every view: only the host samples a caret value, so measuring
  // with it would let a long value (−1.2e−3) downgrade the host's fit, move
  // the bar, and the previous host's fit recover: the bar would alternate
  // between views. The value column reserves its usual width regardless.
  const colorbarForms = useMemo(
    () => (colorbarLayer ? measureColorbar(colorbarLayer).forms : null),
    [colorbarLayer],
  );
  const colorbarFit = useMemo(() => {
    if (!hasLayers || !colorbarForms || !frameImageRect) return null;
    // The same inputs the colorbar itself places with (review S5).
    const placed = placeColorbarBlock(
      {
        width,
        height: canvasHeight,
        imageRect: frameImageRect,
        dataRect: colorbarDataRect,
        avoidPoint: crosshairPoint,
        topReserve: topRightReserve,
        sideLetterY,
      },
      colorbarForms,
    );
    if (!placed) return { fit: ColorbarFit.None, room: 0 };
    return { fit: placed.fit, room: placed.fit === ColorbarFit.Corner ? 0 : Math.round(placed.room) };
  }, [
    hasLayers,
    colorbarForms,
    frameImageRect,
    colorbarDataRect,
    crosshairPoint,
    width,
    canvasHeight,
    topRightReserve,
    sideLetterY,
  ]);
  // While a resize or zoom runs (a splitter drag) the colorbar holds its
  // slot and its view; it chooses again once quiet (the image and the pane
  // disagree mid-drag, and re-choosing flickered the bar across the brain).
  const colorbarHold = useSyncExternalStore(subscribeRenderRatio, renderInteractionActive);
  useEffect(() => {
    if (colorbarHold) return;
    const setSlot = useViewportFrameStore.getState().setSlot;
    if (!colorbarFit) {
      setSlot(colorbarGroup, viewId, null);
      return;
    }
    setSlot(colorbarGroup, viewId, {
      area: Math.round(width * canvasHeight),
      fit: colorbarFit.fit,
      room: colorbarFit.room,
    });
  }, [colorbarGroup, viewId, width, canvasHeight, colorbarFit, colorbarHold]);
  useEffect(
    () => () => useViewportFrameStore.getState().setSlot(colorbarGroup, viewId, null),
    [colorbarGroup, viewId],
  );

  const handleWorldClick = useCallback(
    (
      worldCoord: [number, number, number],
      event: React.MouseEvent<HTMLDivElement>,
    ) => {
      // Suppress crosshair update if W/L drag just ended
      if (isDraggingRef.current) return;
      if (!isClickOnData(worldCoord, viewPlane, dataEdgeBounds)) return;
      markActive();
      // Important: pass updateViews=true to ensure all views update their crosshair
      setCrosshair(worldCoord, true);
    },
    [setCrosshair, markActive, viewPlane, dataEdgeBounds],
  );

  // Handle mouse wheel for time/slice navigation
  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);
  const showTimeOverlayRef = useRef(showTimeOverlay);
  useEffect(() => {
    showTimeOverlayRef.current = showTimeOverlay;
  }, [showTimeOverlay]);
  // Notches and trackpad pixels become whole steps (utils/wheelSteps); the
  // steps of one frame are applied together so a fast burst is not lost to a
  // throttle or to reading a crosshair the previous step has not settled.
  const handleWheel = useMemo(() => {
    const toSteps = createWheelStepper();
    let pending = 0;
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      const steps = pending;
      pending = 0;
      if (steps === 0) return;
      const has4D = timeNavService.has4DVolume();
      if (has4D && timeNavService.getMode() === "time") {
        if (steps === 1) timeNavService.nextTimepoint();
        else if (steps === -1) timeNavService.previousTimepoint();
        else timeNavService.jumpTimepoints(steps);
        const info = timeNavService.getTimeInfo();
        if (info) {
          showTimeOverlayRef.current(
            `Time: ${info.currentTimepoint + 1}/${info.totalTimepoints}`,
          );
        }
      } else {
        sliceNavService.stepSlice(viewId, steps);
      }
    };
    let zoomFactor = 1;
    let zoomAt = { x: 0, y: 0 };
    let zoomFrame: number | null = null;
    const flushZoom = () => {
      zoomFrame = null;
      const factor = zoomFactor;
      zoomFactor = 1;
      if (factor !== 1) {
        pulseRenderInteraction(`zoom:${viewId}`);
        zoomView(viewId, factor, zoomAt, canvasRef.current);
      }
    };
    const fn = (event: WheelEvent) => {
      event.preventDefault();
      markActive();
      if (!layersRef.current.some((l) => l.visible)) return;
      // ⌥-scroll and a pinch (ctrl-wheel) zoom about the pointer; plain and
      // ⌘-scroll step slices (QA features 2026-10-31 §1).
      const factor = wheelZoomFactor(event);
      if (factor !== null) {
        zoomFactor *= factor;
        zoomAt = { x: event.clientX, y: event.clientY };
        if (zoomFrame === null) zoomFrame = requestAnimationFrame(flushZoom);
        return;
      }
      const steps = toSteps(event as WheelEvent & { wheelDeltaY?: number });
      if (steps === 0) return;
      // One reference voxel per step (ten with Shift), always moving.
      pending += event.shiftKey ? steps * 10 : steps;
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    fn.cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (zoomFrame !== null) cancelAnimationFrame(zoomFrame);
      frame = null;
      zoomFrame = null;
      pending = 0;
      zoomFactor = 1;
    };
    return fn;
  }, [viewId, sliceNavService, timeNavService, markActive]);
  useEffect(() => () => handleWheel.cancel(), [handleWheel]);

  // Attach native wheel listener with { passive: false } so preventDefault() works
  useEffect(() => {
    const el = containerAreaRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    canvasRef.current = canvas;
  }, []);

  const handlePlacementChange = useCallback(
    (placement: SliceViewportPlacement) => {
      imagePlacementRef.current = placement;
      setPlacementState((prev) =>
        prev &&
        prev.x === placement.x &&
        prev.y === placement.y &&
        prev.width === placement.width &&
        prev.height === placement.height &&
        prev.imageWidth === placement.imageWidth &&
        prev.imageHeight === placement.imageHeight &&
        // The radiological mirror changes every mapping (heatmap, colorbar).
        !!prev.mirrorX === !!placement.mirrorX
          ? prev
          : placement,
      );
    },
    [],
  );

  // 'L' key: toggle orientation labels for all visible layers.
  // All three views register the same id so only one entry exists in the service.
  // The handler is identical across views — it reads current state at call time.
  useShortcut({
    id: "toggle-orientation-labels",
    key: "l",
    category: "View",
    description: "Toggle orientation labels",
    handler: () => {
      const store = useDisplayOptionsStore.getState();
      const allLayers = useLayerStore.getState().layers;
      const visibleLayers = allLayers.filter((l) => l.visible);
      if (visibleLayers.length === 0) return;
      const primaryId = visibleLayers[0].id;
      const current = store.getOptions(primaryId).showOrientationMarkers;
      for (const layer of visibleLayers) {
        store.setOptions(layer.id, { showOrientationMarkers: !current });
      }
    },
  });

  // Pan (Space-drag, middle drag) and pinch zoom; Fit with F (all views
  // register one id; it fits the view under the pointer, else the active one).
  const { panReady, panning } = useViewPanZoom({
    viewType: viewId,
    areaRef: containerAreaRef,
    canvas: () => canvasRef.current,
    size: [width, canvasHeight],
  });
  const zoomed = useIsViewZoomed(viewId);
  useShortcut({
    id: "view.fit",
    key: "f",
    category: "View",
    description: "Fit the view (reset zoom and pan)",
    handler: () => void fitActiveView(),
  });

  // Context menu (right-click)
  const handleContextMenu = useViewContextMenu(viewId);

  // Handle file drops
  const handleFileDrop = useCallback(
    async (file: File, intent: DisplayOpenIntent) => {
      // Use FileLoadingService to load the file
      const { getFileLoadingService } = await import(
        "@/services/FileLoadingService"
      );
      const fileService = getFileLoadingService();
      await fileService.loadDroppedFile(file, intent);
    },
    [],
  );

  const handlePathDrop = useCallback(
    async (path: string, intent: DisplayOpenIntent) => {
      const { getFileLoadingService } = await import(
        "@/services/FileLoadingService"
      );
      const fileService = getFileLoadingService();
      await fileService.loadFile(path, "drag-drop", intent);
    },
    [],
  );

  // For Allotment compatibility, we need proper height inheritance
  // The component must fill the Allotment.Pane completely

  const containerRef = React.useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full relative outline-none ${className}`}
      data-view-id={viewId}
      // The image placement hover, click and overlay share (tests and the
      // harness read it rather than recomputing one).
      data-placement={
        placementState
          ? `${placementState.x},${placementState.y},${placementState.width},${placementState.height},${placementState.imageWidth},${placementState.imageHeight}`
          : undefined
      }
      // Programmatic focus target only (not in the Tab order): dialogs opened
      // by a shortcut return focus here instead of <body> (Modal).
      tabIndex={-1}
      data-focus-return="viewport"
      // The focus-return target is a named landmark ("Axial view").
      role="region"
      aria-label={`${viewId.charAt(0).toUpperCase()}${viewId.slice(1)} view`}
      onPointerDown={markActive}
      onMouseEnter={markActive}
      onContextMenu={handleContextMenu}
    >
      {timeOverlay}

      {/* Canvas area - positioned absolutely to leave room for slider */}
      <div
        ref={containerAreaRef}
        className="absolute inset-0"
        style={{ bottom: hasLayers ? `${SLIDER_HEIGHT}px` : "0" }}
      >
        <SliceViewport
          width={width}
          height={canvasHeight}
          context={renderContext}
          viewPlane={viewPlane}
          crosshair={crosshair}
          crosshairStyle={crosshairStyle}
          getCrosshairKnockouts={getCrosshairKnockouts}
          showSliceBorder={primaryOptions.showBorder}
          sliceBorderWidth={primaryOptions.borderThicknessPx}
          onCanvasReady={handleCanvasReady}
          onPlacementChange={handlePlacementChange}
          onWorldClick={handleWorldClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onFileDrop={handleFileDrop}
          onPathDrop={handlePathDrop}
          enableDragDrop={true}
          showLoading={false}
          showError={true}
          // The stack shows one empty state (EmptyStackOverlay); the pane
          // keeps its frame and plane word.
          showNoLayers={false}
          showLoadingVolume={isLoadingAnyLayer}
          className="w-full h-full"
          mirrorX={mirrorX}
          pixelRatio={pixelRatio}
          canvasClassName={panning ? "cursor-grabbing" : panReady ? "cursor-grab" : ""}
        />

        {/* Temporal heatmap overlay */}
        {is4DVolume && temporalMetric !== "none" && primaryLayer?.volumeId && (
          <TemporalHeatmapOverlay
            volumeId={primaryLayer.volumeId}
            metric={temporalMetric}
            axis={sliceAxis}
            sliceIndex={heatmapSliceIndex}
            width={width}
            height={canvasHeight}
            viewPlane={viewPlane}
            placement={placementState}
            voxelToWorld={heatmapAffine}
            pixelRatio={pixelRatio}
            opacity={heatmapOpacity}
          />
        )}

        {/* Viewport frame overlays (no layout height) */}
        {!hasLayers && (
          // Empty pane: just the plane word in the header position, so the
          // layout reads before data arrives (P3.11).
          <span
            className="pointer-events-none absolute left-1.5 top-1 select-none text-bf-xs text-bf-text-muted"
            data-testid="viewport-empty-plane"
          >
            {viewId.charAt(0).toUpperCase() + viewId.slice(1)}
          </span>
        )}
        {hasLayers && (
          <ViewportHeader
            plane={viewId}
            positionMm={crosshair.world_mm[axisIndex]}
            layerName={headerLayerName}
            elementRef={setHeaderElement}
            width={width}
            height={canvasHeight}
            rangeMm={headerRangeMm}
          />
        )}
        {showColorbar && colorbarLayer && (
          <ViewportColorbar
            layer={colorbarLayer}
            width={width}
            height={canvasHeight}
            imageRect={frameImageRect}
            avoidPoint={crosshairPoint}
            dataRect={colorbarDataRect}
            topReserve={topRightReserve}
            sideLetterY={sideLetterY}
            hold={colorbarHold}
            value={colorbarReading?.value ?? null}
          />
        )}

        {/* Window/level drag overlay */}
        {overlayProps && (
          <div style={overlayProps.style}>{overlayProps.children}</div>
        )}

        {/* Radiological convention: the screen's left is the patient's right. */}
        {hasLayers && mirrorX && (
          <span
            className="pointer-events-none absolute bottom-1 left-1.5 select-none font-mono text-bf-xs text-bf-text-muted"
            data-testid="radiological-badge"
            title="Radiological convention: the patient's right is on the left"
          >
            R | L
          </span>
        )}
        {hasLayers && zoomed && (
          <button
            type="button"
            className="absolute bottom-1 right-1 rounded-sm border border-bf-border bg-bf-bg-canvas/90 px-1.5 py-0.5 text-bf-xs text-bf-text-secondary hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => void fitView(viewId)}
            onMouseDown={(event) => event.stopPropagation()}
            title="Fit the view (F)"
            data-testid="view-fit"
          >
            Fit
          </button>
        )}
      </div>

      {/* Slider positioned at the bottom */}
      {hasLayers && (
        <div
          className="absolute bottom-0 left-0 right-0"
          style={{ height: `${SLIDER_HEIGHT}px` }}
        >
          <SliceSlider
            viewType={viewId}
            value={sliderValue}
            min={sliderBounds.min}
            max={sliderBounds.max}
            step={sliderBounds.step}
            onChange={handleSliderChange}
          />
        </div>
      )}

      {/* Temporal metric selector (only for 4D volumes), left of the
          viewport's layout button in the same row (v4 visual: they collided).
          It sits over the image, so it has a backing, and a narrow pane
          drops its caption (native R4: "Temporal:" lost on a bright head). */}
      {is4DVolume && (
        <div className="absolute top-1 right-10 flex items-center gap-1 rounded-sm bg-bf-bg-canvas/90 px-1">
          <TemporalMetricSelector
            value={temporalMetric}
            onChange={setTemporalMetric}
            compact={width < TEMPORAL_CAPTION_MIN_WIDTH}
          />
          {temporalMetric !== "none" && (
            <Slider
              label="Overlay opacity"
              min={0}
              max={1}
              step={0.05}
              value={heatmapOpacity}
              onValueChange={setHeatmapOpacity}
              format={(v) => `${Math.round(v * 100)}%`}
              valueText={(v) => `${Math.round(v * 100)}%`}
              className="w-16"
            />
          )}
        </div>
      )}

      {/* Orientation labels */}
      {showMarkers && hasLayers && (
        <OrientationLabels
          viewPlane={viewPlane}
          refs={orientationLabelRefs}
          bottomInset={SLIDER_HEIGHT}
          mirrorX={mirrorX}
        />
      )}

      {/* No in-canvas hover value: it duplicated the hover readout's value
          without naming its layer (P3 critics). The readout names it. */}
    </div>
  );
}

// Export with error boundary
const SliceViewCanvasInner = React.memo(SliceViewCanvasRaw);

export const SliceViewCanvas = React.memo(function SliceViewCanvas(
  props: SliceViewCanvasProps,
) {
  return (
    <RenderErrorBoundary viewId={props.viewId}>
      <SliceViewCanvasInner {...props} />
    </RenderErrorBoundary>
  );
});
