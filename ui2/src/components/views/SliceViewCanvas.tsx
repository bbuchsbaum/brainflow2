/**
 * SliceViewCanvas Component
 * 
 * A unified implementation of SliceView using SliceRenderer.
 * This replaces the custom canvas management in SliceView with
 * the same approach used by MosaicCell for consistency.
 */

import React, { useRef, useCallback, useMemo, useEffect } from 'react';
import { SliceRenderer } from './SliceRenderer';
import { CoordinateTransform } from '@/utils/coordinates';
import { SliceSlider } from '@/components/ui/SliceSlider';
import { getSliceNavigationService } from '@/services/SliceNavigationService';
import { useTransientOverlay } from '@/components/ui/TransientOverlay';
import { getTimeNavigationService } from '@/services/TimeNavigationService';
import { RenderErrorBoundary } from '@/components/ui/RenderErrorBoundary';
import { drawCrosshair, getLineDash, type CrosshairStyle } from '@/utils/crosshairUtils';
import { throttle } from 'lodash';
import { pixelToWorld, sampleLayerValueAtWorld } from '@brainflow/api';
import { useSliceViewModel } from '@/hooks/useSliceViewModel';
import { SLIDER_HEIGHT } from './constants';
import { useViewStateStore } from '@/stores/viewStateStore';

// Equality helpers now live in the view-model hook; no need here.

// Removed: direct store typing alias is unnecessary in this component

interface SliceViewCanvasProps {
  viewId: 'axial' | 'sagittal' | 'coronal';
  width: number;
  height: number;
  className?: string;
}

function SliceViewCanvasRaw({ viewId, width, height, className = '' }: SliceViewCanvasProps) {
  const model = useSliceViewModel(viewId, { width, height });
  const { viewPlane, crosshair, layers, hasLayers, isLoadingAnyLayer, canvasHeight, renderContext, primaryLayer, primaryOptions } = model;

  // Access setter without subscribing to it (stable reference)
  const setCrosshair = useRef(useViewStateStore.getState().setCrosshair).current;

  if (!viewPlane) {
    return (
      <div className={`h-full w-full relative ${className}`} data-view-id={viewId}>
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
          Loading view…
        </div>
      </div>
    );
  }

  // RenderContext registration handled by useSliceViewModel
  
  // Crosshair settings provided by the controller
  const crosshairSettings = model.crosshairSettings;
  
  // Time navigation (service-only to avoid extra store subscriptions)
  const timeNavService = getTimeNavigationService();
  const { show: showTimeOverlay, overlay: timeOverlay } = useTransientOverlay({
    duration: 500,
    position: 'center'
  });
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagePlacementRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  } | null>(null);
  const showMarkers = primaryOptions.showOrientationMarkers;
  const showHover = primaryOptions.showValueOnHover;
  
  // Hover value overlay
  const [hoverValue, setHoverValue] = React.useState<number | null>(null);

  // Stable ref for viewPlane to prevent infinite loop in handleMouseMove
  // The viewPlane object reference changes on every store update, which would
  // cause useCallback to recreate handleMouseMove, triggering infinite re-renders
  const viewPlaneRef = React.useRef(viewPlane);
  React.useEffect(() => {
    if (viewPlane) {
      viewPlaneRef.current = viewPlane;
    }
  }, [viewPlane]);
  // Keep latest crosshair and settings in refs for stable customRender
  const crosshairRef = React.useRef(crosshair);
  useEffect(() => { crosshairRef.current = crosshair; }, [crosshair]);
  const crosshairSettingsRef = React.useRef(crosshairSettings);
  useEffect(() => { crosshairSettingsRef.current = crosshairSettings; }, [crosshairSettings]);

  // Slider navigation using the same approach as original SliceView
  const sliceNavService = getSliceNavigationService();
  
  // Get min/max/step (only depends on layers, not crosshair)
  const axisIndex = viewId === 'axial' ? 2 : viewId === 'sagittal' ? 0 : 1;
  const sliderBounds = React.useMemo(() => {
    try {
      const range = sliceNavService.getSliceRange(viewId);
      return {
        min: range.min,
        max: range.max,
        step: range.step,
        current: range.current
      };
    } catch (error) {
      console.warn(`SliceViewCanvas ${viewId}: Failed to get slice range, using defaults`, error);
      return {
        min: -100,
        max: 100,
        step: 1,
        current: crosshair.world_mm[axisIndex] ?? 0
      };
    }
  }, [sliceNavService, viewId, layers, axisIndex, crosshair.world_mm[axisIndex]]);
  
  // Current slider value mirrors crosshair position for this axis
  const sliderValue = sliderBounds.current ?? crosshair.world_mm[axisIndex];

  // Handle slider changes
  // Guard against no-op updates to break Slider -> store -> Slider loop
  const sliderValueRef = useRef(sliderValue);
  useEffect(() => { sliderValueRef.current = sliderValue; }, [sliderValue]);
  const handleSliderChange = useCallback((value: number) => {
    if (Object.is(value, sliderValueRef.current)) return;
    sliceNavService.updateSlicePosition(viewId, value);
  }, [sliceNavService, viewId]);
  
  // Custom render function for crosshair overlay
  const customRender = useCallback((
    ctx: CanvasRenderingContext2D,
    placement: { x: number; y: number; width: number; height: number; imageWidth: number; imageHeight: number }
  ) => {
    // Store placement for click handling
    imagePlacementRef.current = placement;
    const cr = crosshairRef.current;
    const chs = crosshairSettingsRef.current;
    const vp = viewPlaneRef.current;
    // Skip if crosshair not visible
    if (!cr?.visible || !chs?.visible || !vp) return;

    // Transform crosshair to screen coordinates
    const screenCoord = CoordinateTransform.worldToScreen(
      cr.world_mm,
      vp
    );
    
    if (!screenCoord) return;
    
    // Transform to canvas coordinates
    const scaleX = placement.width / placement.imageWidth;
    const scaleY = placement.height / placement.imageHeight;
    
    const canvasX = placement.x + screenCoord[0] * scaleX;
    const canvasY = placement.y + screenCoord[1] * scaleY;
    
    // Draw crosshair
    const style: CrosshairStyle = {
      color: chs.activeColor,
      lineWidth: chs.activeThickness,
      lineDash: getLineDash(chs.activeStyle, chs.activeThickness),
      opacity: 1
    };
    
    drawCrosshair({
      ctx,
      canvasX,
      canvasY,
      bounds: placement,
      style
    });
  }, []);
  
  // Handle mouse clicks to update crosshair
  const handleMouseClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current || !imagePlacementRef.current) return;
    const currentView = viewPlaneRef.current;
    if (!currentView) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    // Convert click to canvas coordinates
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    
    const placement = imagePlacementRef.current;
    
    // Check if click is within image bounds
    if (canvasX < placement.x || canvasX > placement.x + placement.width ||
        canvasY < placement.y || canvasY > placement.y + placement.height) {
      return;
    }
    
    // Transform to image coordinates
    const imageX = (canvasX - placement.x) / placement.width * placement.imageWidth;
    const imageY = (canvasY - placement.y) / placement.height * placement.imageHeight;
    
    // Transform to world coordinates
    const worldCoord = CoordinateTransform.screenToWorld(imageX, imageY, currentView);
    // Important: pass updateViews=true to ensure all views update their crosshair
    setCrosshair(worldCoord, true);
  }, [setCrosshair]);

  // Handle mouse move → sample value if enabled
  // Stable throttled hover sampler
  const showHoverRef = useRef(showHover);
  useEffect(() => { showHoverRef.current = showHover; }, [showHover]);
  const primaryLayerIdRef = useRef<string | null>(primaryLayer?.id ?? null);
  useEffect(() => { primaryLayerIdRef.current = primaryLayer?.id ?? null; }, [primaryLayer]);
  const handleMouseMove = useMemo(
    () => throttle(async (event: React.MouseEvent<HTMLDivElement>) => {
      try {
        if (!showHoverRef.current) { setHoverValue(null); return; }
        if (!canvasRef.current || !imagePlacementRef.current) return;
        const layerId = primaryLayerIdRef.current;
        if (!layerId) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const canvasX = (event.clientX - rect.left) * scaleX;
        const canvasY = (event.clientY - rect.top) * scaleY;

        const placement = imagePlacementRef.current;
        if (!placement) return;
        if (
          canvasX < placement.x || canvasX > placement.x + placement.width ||
          canvasY < placement.y || canvasY > placement.y + placement.height
        ) { setHoverValue(null); return; }

        const imageX = (canvasX - placement.x) / placement.width * placement.imageWidth;
        const imageY = (canvasY - placement.y) / placement.height * placement.imageHeight;

        // Obtain frame vectors from viewPlane ref (stable reference)
        const origin = (viewPlaneRef.current as any)?.frame?.origin_mm as [number, number, number, number];
        const u = (viewPlaneRef.current as any)?.frame?.u_mm as [number, number, number, number];
        const v = (viewPlaneRef.current as any)?.frame?.v_mm as [number, number, number, number];
        if (!origin || !u || !v) { setHoverValue(null); return; }

        const world = pixelToWorld(imageX, imageY, placement.imageWidth, placement.imageHeight, origin, u, v);
        const value = await sampleLayerValueAtWorld(layerId, world);
        setHoverValue(prev => (prev !== null && Math.abs(prev - value) < 1e-6) ? prev : value);
      } catch {
        setHoverValue(null);
      }
    }, 40, { leading: true, trailing: true }),
    []
  );
  useEffect(() => () => (handleMouseMove as any).cancel?.(), [handleMouseMove]);

  // Handle mouse wheel for time/slice navigation
  // Stable throttled wheel handler
  const layersRef = useRef(layers);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  const sliderBoundsRef = useRef(sliderBounds);
  useEffect(() => { sliderBoundsRef.current = sliderBounds; }, [sliderBounds]);
  const showTimeOverlayRef = useRef(showTimeOverlay);
  useEffect(() => { showTimeOverlayRef.current = showTimeOverlay; }, [showTimeOverlay]);
  const throttledHandleWheel = useMemo(() => {
    const fn = throttle((event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const primary = layersRef.current.find(l => l.visible);
      if (!primary) return;
      const has4D = timeNavService.has4DVolume();
      const mode = timeNavService.getMode();
      if (has4D && mode === 'time') {
        event.deltaY > 0 ? timeNavService.previousTimepoint() : timeNavService.nextTimepoint();
        const info = timeNavService.getTimeInfo();
        if (info) {
          showTimeOverlayRef.current(`Time: ${info.currentTimepoint + 1}/${info.totalTimepoints}`);
        }
      } else {
        const { min, max, step } = sliderBoundsRef.current;
        const curr = sliderValueRef.current;
        const delta = event.deltaY > 0 ? step : -step;
        const next = Math.max(min, Math.min(max, curr + delta));
        if (!Object.is(next, curr)) {
          sliceNavService.updateSlicePosition(viewId, next);
        }
      }
    }, 50, { leading: true, trailing: true });
    return fn;
  }, [viewId, sliceNavService, timeNavService]);
  useEffect(() => () => throttledHandleWheel.cancel(), [throttledHandleWheel]);
  
  // Handle canvas ready callback
  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    canvasRef.current = canvas;
  }, []);
  
  // Handle file drops
  const handleFileDrop = useCallback(async (file: File) => {
    // Use FileLoadingService to load the file
    const { getFileLoadingService } = await import('@/services/FileLoadingService');
    const fileService = getFileLoadingService();
    await fileService.loadFile(file);
  }, []);
  
  // For Allotment compatibility, we need proper height inheritance
  // The component must fill the Allotment.Pane completely
  
  const containerRef = React.useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className={`h-full w-full relative ${className}`} data-view-id={viewId}>
      {timeOverlay}
      
      {/* Canvas area - positioned absolutely to leave room for slider */}
      <div
        className="absolute inset-0"
        style={{ bottom: hasLayers ? `${SLIDER_HEIGHT}px` : '0' }}
        onClick={handleMouseClick}
      >
        <SliceRenderer
          width={width}
          height={canvasHeight}
          context={renderContext}
          onCanvasReady={handleCanvasReady}
          customRender={customRender}
          onMouseMove={handleMouseMove}
          onWheel={throttledHandleWheel}
          onFileDrop={handleFileDrop}
          enableDragDrop={true}
          showNoLayers={!hasLayers && !isLoadingAnyLayer}
          showLoadingVolume={isLoadingAnyLayer}
          className="w-full h-full"
        />
      </div>
      
      {/* Slider positioned at the bottom */}
      {hasLayers && (
        <div className="absolute bottom-0 left-0 right-0" style={{ height: `${SLIDER_HEIGHT}px` }}>
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

      {/* Hover value overlay */}
      {hoverValue !== null && showHover && (
        <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1 py-0.5 rounded">
          {hoverValue.toFixed(3)}
        </div>
      )}
    </div>
  );
}

// Export with error boundary
export function SliceViewCanvas(props: SliceViewCanvasProps) {
  return (
    <RenderErrorBoundary viewId={props.viewId}>
      <SliceViewCanvasRaw {...props} />
    </RenderErrorBoundary>
  );
}
