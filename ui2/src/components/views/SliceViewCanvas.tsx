/**
 * SliceViewCanvas Component
 * 
 * A unified implementation of SliceView using SliceRenderer.
 * This replaces the custom canvas management in SliceView with
 * the same approach used by MosaicCell for consistency.
 */

import React, { useRef, useCallback, useMemo, useEffect } from 'react';
import { SliceRenderer } from './SliceRenderer';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { CoordinateTransform } from '@/utils/coordinates';
import { SliceSlider } from '@/components/ui/SliceSlider';
import { getSliceNavigationService } from '@/services/SliceNavigationService';
import { useTimeNavigation } from '@/hooks/useTimeNavigation';
import { useTransientOverlay } from '@/components/ui/TransientOverlay';
import { getTimeNavigationService } from '@/services/TimeNavigationService';
import { RenderErrorBoundary } from '@/components/ui/RenderErrorBoundary';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { drawCrosshair, getLineDash, type CrosshairStyle } from '@/utils/crosshairUtils';
import { throttle } from 'lodash';
import type { ViewPlane } from '@/types/coordinates';
import type { RenderContext } from '@/types/renderContext';

interface SliceViewCanvasProps {
  viewId: 'axial' | 'sagittal' | 'coronal';
  width: number;
  height: number;
  className?: string;
}

function SliceViewCanvasRaw({ viewId, width, height, className = '' }: SliceViewCanvasProps) {
  // Create RenderContext using viewId as the ID (already done in SliceView)
  const renderContext = useMemo(() => ({
    id: viewId,  // Use viewType directly as ID
    type: 'slice' as const,
    dimensions: { width, height },
    metadata: {
      viewType: viewId
    }
  } as RenderContext), [viewId, width, height]);
  
  // Register context with the store
  const registerContext = useRenderStateStore(state => state.registerContext);
  useEffect(() => {
    registerContext(renderContext);
    console.log(`[SliceViewCanvas] Registered context for ${renderContext.id}`);
  }, [renderContext, registerContext]);
  
  // Crosshair settings
  const crosshairSettings = useCrosshairSettingsStore(state => state.getViewSettings(viewId));
  
  // Time navigation
  const timeNav = useTimeNavigation();
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
  
  // Store subscriptions
  const viewPlane = useViewStateStore(state => state.viewState.views[viewId]);
  const crosshair = useViewStateStore(state => state.viewState.crosshair);
  const setCrosshair = useViewStateStore(state => state.setCrosshair);
  const layers = useLayerStore(state => state.layers);
  const loadingLayers = useLayerStore(state => state.loadingLayers);
  
  const hasLayers = layers.length > 0;
  const isLoadingAnyLayer = loadingLayers.size > 0;
  
  // Slider navigation using the same approach as original SliceView
  const sliceNavService = getSliceNavigationService();
  
  // Get min/max/step (only depends on layers, not crosshair)
  const sliderBounds = React.useMemo(() => {
    try {
      const range = sliceNavService.getSliceRange(viewId);
      return {
        min: range.min,
        max: range.max,
        step: range.step
      };
    } catch (error) {
      console.warn(`SliceViewCanvas ${viewId}: Failed to get slice range, using defaults`, error);
      return {
        min: -100,
        max: 100,
        step: 1
      };
    }
  }, [viewId, layers]);
  
  // Get current value from crosshair
  const sliderValue = React.useMemo(() => {
    switch (viewId) {
      case 'axial':
        return crosshair.world_mm[2];
      case 'sagittal':
        return crosshair.world_mm[0];
      case 'coronal':
        return crosshair.world_mm[1];
      default:
        return 0;
    }
  }, [viewId, crosshair.world_mm]);
  
  // Handle slider changes
  const handleSliderChange = useCallback((value: number) => {
    console.log(`[SliceViewCanvas ${viewId}] Slider changed to: ${value}`);
    sliceNavService.updateSlicePosition(viewId, value);
  }, [viewId]);
  
  // Custom render function for crosshair overlay
  const customRender = useCallback((
    ctx: CanvasRenderingContext2D,
    placement: { x: number; y: number; width: number; height: number; imageWidth: number; imageHeight: number }
  ) => {
    // Store placement for click handling
    imagePlacementRef.current = placement;
    
    // Skip if crosshair not visible
    if (!crosshair.visible || !crosshairSettings.visible) return;
    
    // Transform crosshair to screen coordinates
    const screenCoord = CoordinateTransform.worldToScreen(
      crosshair.world_mm,
      viewPlane
    );
    
    if (!screenCoord) return;
    
    // Transform to canvas coordinates
    const scaleX = placement.width / placement.imageWidth;
    const scaleY = placement.height / placement.imageHeight;
    
    const canvasX = placement.x + screenCoord[0] * scaleX;
    const canvasY = placement.y + screenCoord[1] * scaleY;
    
    // Draw crosshair
    const style: CrosshairStyle = {
      color: crosshairSettings.activeColor,
      lineWidth: crosshairSettings.activeThickness,
      lineDash: getLineDash(crosshairSettings.activeStyle, crosshairSettings.activeThickness),
      opacity: 1
    };
    
    drawCrosshair({
      ctx,
      canvasX,
      canvasY,
      bounds: placement,
      style
    });
  }, [crosshair, crosshairSettings, viewPlane]);
  
  // Handle mouse clicks to update crosshair
  const handleMouseClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current || !imagePlacementRef.current) return;
    
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
    const worldCoord = CoordinateTransform.screenToWorld(imageX, imageY, viewPlane);
    // Important: pass updateViews=true to ensure all views update their crosshair
    setCrosshair(worldCoord, true);
  }, [viewPlane, setCrosshair]);
  
  // Handle mouse wheel for time/slice navigation
  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    
    // Check if we have a 4D volume and time mode is active
    const primary = layers.find(l => l.visible);
    if (!primary) return;
    
    const has4D = timeNav.has4DVolume(primary.volumeId);
    const mode = timeNavService.getMode();
    
    if (has4D && mode === 'time') {
      // Time navigation
      if (event.deltaY > 0) {
        timeNav.previousTimePoint();
      } else {
        timeNav.nextTimePoint();
      }
      
      // Show time overlay
      const current = timeNav.getCurrentTimePoint();
      const total = timeNav.getTotalTimePoints();
      showTimeOverlay(`Time: ${current + 1}/${total}`);
    } else {
      // Slice navigation
      const delta = event.deltaY > 0 ? sliderBounds.step : -sliderBounds.step;
      const newValue = Math.max(
        sliderBounds.min,
        Math.min(sliderBounds.max, sliderValue + delta)
      );
      handleSliderChange(newValue);
    }
  }, [layers, timeNav, timeNavService, showTimeOverlay, sliderBounds, sliderValue, handleSliderChange]);
  
  // Throttle wheel events
  const throttledHandleWheel = useMemo(
    () => throttle(handleWheel, 50, { leading: true, trailing: true }),
    [handleWheel]
  );
  
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
  
  return (
    <>
      {timeOverlay}
      <div className={`flex flex-col h-full ${className}`}>
        <div className="flex-1 relative">
          <SliceRenderer
            context={renderContext}
            customRender={customRender}
            onMouseDown={handleMouseClick}
            onWheel={throttledHandleWheel}
            onCanvasReady={handleCanvasReady}
            enableDragDrop={true}
            onFileDrop={handleFileDrop}
            showLoading={false}  // We handle loading state differently
            showError={true}
            showLabel={true}
            label={viewId.charAt(0).toUpperCase() + viewId.slice(1)}
            labelPosition="bottom-right"
            showNoLayers={!hasLayers && !isLoadingAnyLayer}
            showLoadingVolume={isLoadingAnyLayer}
            className=""
            canvasClassName="border border-gray-300 cursor-crosshair"
          />
        </div>
        
        {/* Slice navigation slider */}
        {hasLayers && (
          <SliceSlider
            viewType={viewId}
            value={sliderValue}
            min={sliderBounds.min}
            max={sliderBounds.max}
            step={sliderBounds.step}
            disabled={false}
            onChange={handleSliderChange}
          />
        )}
      </div>
    </>
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