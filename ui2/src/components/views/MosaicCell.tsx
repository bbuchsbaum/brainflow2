/**
 * MosaicCell Component
 *
 * Renders a single cell in the MosaicView grid on top of the shared
 * SliceViewport, while keeping mosaic-specific mirror crosshair logic local.
 */

import { useCallback, useRef, useMemo, type MouseEvent } from 'react';
import { SliceViewport, type SliceViewportPlacement } from './SliceViewport';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getMosaicRenderService } from '@/services/MosaicRenderService';
import { drawCrosshair, getLineDash } from '@/utils/crosshairUtils';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { CoordinateTransform } from '@/utils/coordinates';
import type { CrosshairStyle } from '@/utils/crosshairUtils';
import type { ViewPlane } from '@/types/coordinates';

interface MosaicCellProps {
  width: number;
  height: number;
  tag: string;
  sliceIndex: number;
  axis: 'axial' | 'sagittal' | 'coronal';
  onCrosshairClick?: (worldCoord: [number, number, number]) => void;
}

export function MosaicCell({
  width,
  height,
  tag,
  sliceIndex,
  axis,
  onCrosshairClick
}: MosaicCellProps) {
  // Guard against invalid slice indices
  if (sliceIndex == null || sliceIndex < 0) {
    console.warn(`[MosaicCell] Invalid sliceIndex: ${sliceIndex}`);
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <span>No slice</span>
      </div>
    );
  }
  
  // Extract workspaceId from tag for RenderContext
  // Tag format: "mosaic-{workspaceId}-{axis}-{sliceIndex}"
  const workspaceId = useMemo(() => {
    const parts = tag.split('-');
    // Remove 'mosaic' prefix and extract workspaceId
    // If tag is "mosaic-default-axial-0", workspaceId is "default"
    return parts[1] || 'default';
  }, [tag]);
  
  // Create RenderContext using the tag as the ID
  const renderContext = useMemo(() => ({
    id: tag,  // Use the tag directly as ID
    type: 'mosaic-cell' as const,
    dimensions: { width, height },
    metadata: {
      workspaceId,
      viewType: axis,
      sliceIndex
    }
  }), [tag, width, height, workspaceId, axis, sliceIndex]);
  
  const mosaicRenderService = getMosaicRenderService();
  const crosshair = useViewStateStore(state => state.viewState.crosshair);
  const axisViewPlane = useViewStateStore(state => state.viewState.views[axis]);
  // Use Zustand store for crosshair settings - works across all React roots
  const crosshairSettings = useCrosshairSettingsStore(state => state.getViewSettings(axis));
  
  const slicePositionRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const placementRef = useRef<SliceViewportPlacement | null>(null);
  const cellViewPlaneRef = useRef<ViewPlane | null>(null);

  // Custom render function to draw crosshairs
  const customRender = useCallback((
    ctx: CanvasRenderingContext2D,
    placement: { x: number; y: number; width: number; height: number; imageWidth: number; imageHeight: number }
  ) => {
    placementRef.current = placement;
    const currentViewPlane = mosaicRenderService.getViewPlaneForTag(tag) ?? axisViewPlane;
    cellViewPlaneRef.current = currentViewPlane ?? null;

    if (!currentViewPlane) {
      console.warn(`[MosaicCell] No view plane available for axis ${axis}, skipping crosshair render`);
      return;
    }

    // Get the actual slice position from MosaicRenderService
    // This is the true mm position without any centering offsets
    const storedSlicePosition = mosaicRenderService.getSlicePositionForTag(tag);
    if (storedSlicePosition !== undefined) {
      slicePositionRef.current = storedSlicePosition;
    } else {
      // Fallback to extracting from ViewPlane origin (less accurate due to centering)
      console.warn(`[MosaicCell] No stored slice position for tag ${tag}, using ViewPlane origin`);
      switch (axis) {
        case 'axial':
          slicePositionRef.current = currentViewPlane.origin_mm[2];
          break;
        case 'sagittal':
          slicePositionRef.current = currentViewPlane.origin_mm[0];
          break;
        case 'coronal':
          slicePositionRef.current = currentViewPlane.origin_mm[1];
          break;
      }
    }
    
    // Calculate crosshair info
    const crosshairInfo = mosaicRenderService.calculateCrosshairForCell(
      crosshair.world_mm,
      axis,
      slicePositionRef.current,
      currentViewPlane
    );
    
    // Debug logging
    const debug = `Slice ${sliceIndex}: pos=${slicePositionRef.current.toFixed(1)}, crosshair=${crosshair.world_mm.map(v => v.toFixed(1)).join(',')}, visible=${crosshair.visible}, hasCoord=${!!crosshairInfo.screenCoord}, isActive=${crosshairInfo.isActive}`;
    console.log(`[MosaicCell] ${debug}`);
    
    // Log the difference between crosshair and slice position
    let diff = 0;
    switch (axis) {
      case 'axial':
        diff = Math.abs(crosshair.world_mm[2] - slicePositionRef.current);
        break;
      case 'sagittal':
        diff = Math.abs(crosshair.world_mm[0] - slicePositionRef.current);
        break;
      case 'coronal':
        diff = Math.abs(crosshair.world_mm[1] - slicePositionRef.current);
        break;
    }
    console.log(`[MosaicCell] Distance from crosshair: ${diff.toFixed(1)}mm`);
    
    // Draw crosshair if visible and we have screen coordinates
    if (crosshairSettings.visible && crosshair.visible && crosshairInfo.screenCoord && 
        (crosshairInfo.isActive || crosshairSettings.showMirror)) {
      const [screenX, screenY] = crosshairInfo.screenCoord;
      
      console.log(`[MosaicCell] Drawing crosshair at screen: ${screenX.toFixed(1)}, ${screenY.toFixed(1)}, isActive: ${crosshairInfo.isActive}`);
      
      // Transform screen coordinates to canvas coordinates
      const scaleX = placement.width / placement.imageWidth;
      const scaleY = placement.height / placement.imageHeight;
      
      const canvasX = placement.x + screenX * scaleX;
      const canvasY = placement.y + screenY * scaleY;
      
      console.log(`[MosaicCell] Canvas coords: ${canvasX.toFixed(1)}, ${canvasY.toFixed(1)}, bounds: ${placement.x},${placement.y} ${placement.width}x${placement.height}`);
      
      // Choose style based on whether this is the active slice
      const style: CrosshairStyle = crosshairInfo.isActive 
        ? {
            color: crosshairSettings.activeColor,
            lineWidth: crosshairSettings.activeThickness,
            lineDash: getLineDash(crosshairSettings.activeStyle, crosshairSettings.activeThickness),
            opacity: 1
          }
        : {
            color: crosshairSettings.mirrorColor,
            lineWidth: crosshairSettings.mirrorThickness,
            lineDash: getLineDash(crosshairSettings.mirrorStyle, crosshairSettings.mirrorThickness),
            opacity: crosshairSettings.mirrorOpacity
          };
      
      drawCrosshair({
        ctx,
        canvasX,
        canvasY,
        bounds: placement,
        style
      });
    }
  }, [axis, sliceIndex, crosshair, axisViewPlane, mosaicRenderService, crosshairSettings, tag]);
  
  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    canvasRef.current = canvas;
  }, []);

  const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!onCrosshairClick) return;
    if (event.button !== 0) return;

    const canvas = canvasRef.current;
    const placement = placementRef.current;
    const currentViewPlane =
      cellViewPlaneRef.current ?? mosaicRenderService.getViewPlaneForTag(tag) ?? axisViewPlane;
    if (!canvas || !placement || !currentViewPlane) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || placement.width <= 0 || placement.height <= 0) {
      return;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;

    if (
      canvasX < placement.x ||
      canvasX > placement.x + placement.width ||
      canvasY < placement.y ||
      canvasY > placement.y + placement.height
    ) {
      return;
    }

    const imageX = ((canvasX - placement.x) / placement.width) * placement.imageWidth;
    const imageY = ((canvasY - placement.y) / placement.height) * placement.imageHeight;
    const worldCoord = CoordinateTransform.screenToWorld(imageX, imageY, currentViewPlane);

    // Update the world coordinate based on the slice position
    let finalWorldCoord: [number, number, number];
    switch (axis) {
      case 'axial':
        finalWorldCoord = [worldCoord[0], worldCoord[1], slicePositionRef.current];
        break;
      case 'sagittal':
        finalWorldCoord = [slicePositionRef.current, worldCoord[1], worldCoord[2]];
        break;
      case 'coronal':
        finalWorldCoord = [worldCoord[0], slicePositionRef.current, worldCoord[2]];
        break;
    }

    event.preventDefault();
    onCrosshairClick(finalWorldCoord);
  }, [axis, axisViewPlane, mosaicRenderService, onCrosshairClick, tag]);
  
  return (
    <SliceViewport
      width={width}
      height={height}
      context={renderContext}
      tag={tag}
      viewPlane={axisViewPlane}
      customRender={customRender}
      onCanvasReady={handleCanvasReady}
      onMouseDown={handleMouseDown}
      className="cursor-crosshair"
      canvasClassName="mosaic-cell-canvas"
    />
  );
}
