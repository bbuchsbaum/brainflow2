/**
 * MosaicCell Component
 * 
 * Renders a single cell in the MosaicView grid with crosshair support.
 * Wraps SliceRenderer and adds crosshair rendering functionality.
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { SliceRenderer } from './SliceRenderer';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getMosaicRenderService } from '@/services/MosaicRenderService';
import { drawCrosshair, getLineDash } from '@/utils/crosshairUtils';
import { CoordinateTransform } from '@/utils/coordinates';
import { useViewCrosshairSettings } from '@/contexts/CrosshairContext';
import type { ViewPlane } from '@/types/coordinates';
import type { CrosshairStyle } from '@/utils/crosshairUtils';

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
  const mosaicRenderService = getMosaicRenderService();
  const viewState = useViewStateStore(state => state.viewState);
  const crosshairSettings = useViewCrosshairSettings(axis);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagePlacementRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  } | null>(null);
  const viewPlaneRef = useRef<ViewPlane | null>(null);
  const slicePositionRef = useRef<number>(0);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const lastImageRef = useRef<ImageBitmap | null>(null);
  
  // Custom render function to draw crosshairs
  const customRender = useCallback((
    ctx: CanvasRenderingContext2D,
    placement: { x: number; y: number; width: number; height: number; imageWidth: number; imageHeight: number }
  ) => {
    // Store image placement for click handling
    imagePlacementRef.current = placement;
    
    // For MosaicView, we need to use the view plane that matches what MosaicRenderService created
    // The service modifies the view plane for each cell to show the correct slice
    // We'll reconstruct a similar view plane here
    const baseViewPlane = viewState.views[axis];
    if (!baseViewPlane) {
      console.warn(`[MosaicCell] No view plane for axis ${axis}`);
      return;
    }
    
    // Calculate slice position based on slice index
    // This is approximate - actual position is calculated by MosaicRenderService
    const volumeBounds = { min: [-96, -132, -78], max: [96, 96, 114] }; // Default MNI bounds
    let sliceMin: number, sliceMax: number;
    switch (axis) {
      case 'axial':
        sliceMin = volumeBounds.min[2];
        sliceMax = volumeBounds.max[2];
        break;
      case 'sagittal':
        sliceMin = volumeBounds.min[0];
        sliceMax = volumeBounds.max[0];
        break;
      case 'coronal':
        sliceMin = volumeBounds.min[1];
        sliceMax = volumeBounds.max[1];
        break;
    }
    
    const sliceRange = sliceMax - sliceMin;
    const totalSlices = Math.ceil(sliceRange);
    const slicePosition = sliceMin + (sliceIndex * (sliceRange / totalSlices));
    slicePositionRef.current = slicePosition;
    
    // Create a view plane for this specific mosaic cell
    // This needs to match what MosaicRenderService creates
    const volumeCenter: [number, number, number] = [
      (volumeBounds.min[0] + volumeBounds.max[0]) / 2,
      (volumeBounds.min[1] + volumeBounds.max[1]) / 2,
      (volumeBounds.min[2] + volumeBounds.max[2]) / 2
    ];
    
    // Calculate extent based on axis
    let extent_mm: [number, number];
    switch (axis) {
      case 'axial':
        extent_mm = [
          volumeBounds.max[0] - volumeBounds.min[0],
          volumeBounds.max[1] - volumeBounds.min[1]
        ];
        break;
      case 'sagittal':
        extent_mm = [
          volumeBounds.max[1] - volumeBounds.min[1],
          volumeBounds.max[2] - volumeBounds.min[2]
        ];
        break;
      case 'coronal':
        extent_mm = [
          volumeBounds.max[0] - volumeBounds.min[0],
          volumeBounds.max[2] - volumeBounds.min[2]
        ];
        break;
    }
    
    // Add padding
    extent_mm[0] *= 1.1;
    extent_mm[1] *= 1.1;
    
    // Calculate pixel size
    const pixelSize = Math.max(extent_mm[0] / width, extent_mm[1] / height);
    const actualExtentX = pixelSize * width;
    const actualExtentY = pixelSize * height;
    
    // Create the view plane for this cell
    const cellViewPlane: ViewPlane = { ...baseViewPlane };
    cellViewPlane.dim_px = [width, height];
    
    if (axis === 'axial') {
      cellViewPlane.origin_mm = [volumeCenter[0] - actualExtentX/2, volumeCenter[1] + actualExtentY/2, slicePosition];
      cellViewPlane.u_mm = [pixelSize, 0, 0];
      cellViewPlane.v_mm = [0, -pixelSize, 0];
    } else if (axis === 'sagittal') {
      cellViewPlane.origin_mm = [slicePosition, volumeCenter[1] + actualExtentX/2, volumeCenter[2] + actualExtentY/2];
      cellViewPlane.u_mm = [0, -pixelSize, 0];
      cellViewPlane.v_mm = [0, 0, -pixelSize];
    } else if (axis === 'coronal') {
      cellViewPlane.origin_mm = [volumeCenter[0] - actualExtentX/2, slicePosition, volumeCenter[2] + actualExtentY/2];
      cellViewPlane.u_mm = [pixelSize, 0, 0];
      cellViewPlane.v_mm = [0, 0, -pixelSize];
    }
    
    viewPlaneRef.current = cellViewPlane;
    
    // Calculate crosshair info
    const crosshairInfo = mosaicRenderService.calculateCrosshairForCell(
      viewState.crosshair.world_mm,
      axis,
      slicePosition,
      cellViewPlane
    );
    
    // Debug logging
    const debug = `Slice ${sliceIndex}: pos=${slicePosition.toFixed(1)}, crosshair=${viewState.crosshair.world_mm.map(v => v.toFixed(1)).join(',')}, visible=${viewState.crosshair.visible}, hasCoord=${!!crosshairInfo.screenCoord}, isActive=${crosshairInfo.isActive}`;
    console.log(`[MosaicCell] ${debug}`);
    
    // Log the difference between crosshair and slice position
    let diff = 0;
    switch (axis) {
      case 'axial':
        diff = Math.abs(viewState.crosshair.world_mm[2] - slicePosition);
        break;
      case 'sagittal':
        diff = Math.abs(viewState.crosshair.world_mm[0] - slicePosition);
        break;
      case 'coronal':
        diff = Math.abs(viewState.crosshair.world_mm[1] - slicePosition);
        break;
    }
    console.log(`[MosaicCell] Distance from crosshair: ${diff.toFixed(1)}mm`);
    
    // Draw crosshair if visible and we have screen coordinates
    if (crosshairSettings.visible && viewState.crosshair.visible && crosshairInfo.screenCoord && 
        (crosshairInfo.isActive || crosshairSettings.showMirror)) {
      const [screenX, screenY] = crosshairInfo.screenCoord;
      
      console.log(`[MosaicCell] Drawing crosshair at screen: ${screenX.toFixed(1)}, ${screenY.toFixed(1)}, isActive: ${crosshairInfo.isActive}`);
      
      // Transform screen coordinates to canvas coordinates
      const scaleX = placement.width / placement.imageWidth;
      const scaleY = placement.height / placement.imageHeight;
      
      const canvasX = placement.x + screenX * scaleX;
      const canvasY = placement.y + screenY * scaleY;
      
      console.log(`[MosaicCell] Canvas coords: ${canvasX.toFixed(1)}, ${canvasY.toFixed(1)}, bounds: ${placement.x},${placement.y} ${placement.width}x${placement.height}`);
      
      // Choose style based on whether this is the active slice and current settings
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
  }, [axis, sliceIndex, viewState.crosshair, viewState.views, mosaicRenderService]);
  
  // Re-render the canvas when crosshair changes
  useEffect(() => {
    if (!canvasRef.current || !lastImageRef.current || !imagePlacementRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Clear and redraw the image
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    // Redraw the image
    const placement = imagePlacementRef.current;
    ctx.drawImage(
      lastImageRef.current,
      0, 0, lastImageRef.current.width, lastImageRef.current.height,
      placement.x, placement.y, placement.width, placement.height
    );
    
    // Call custom render to draw crosshair
    customRender(ctx, placement);
  }, [viewState.crosshair, customRender]);
  
  // Handle mouse clicks to update crosshair
  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!onCrosshairClick || !imagePlacementRef.current || !viewPlaneRef.current) return;
    
    // Get canvas element
    const canvas = (event.currentTarget as HTMLDivElement).querySelector('canvas');
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    // Convert click position to canvas coordinates
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    
    const placement = imagePlacementRef.current;
    
    // Check if click is within the image bounds
    if (canvasX < placement.x || canvasX > placement.x + placement.width ||
        canvasY < placement.y || canvasY > placement.y + placement.height) {
      return;
    }
    
    // Transform canvas coordinates to image coordinates
    const imageX = (canvasX - placement.x) / placement.width * placement.imageWidth;
    const imageY = (canvasY - placement.y) / placement.height * placement.imageHeight;
    
    // Transform to world coordinates
    const worldCoord = CoordinateTransform.screenToWorld(imageX, imageY, viewPlaneRef.current);
    
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
    
    onCrosshairClick(finalWorldCoord);
  }, [axis, onCrosshairClick]);
  
  // Callback to store canvas ref and last image
  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    canvasRef.current = canvas;
  }, []);
  
  const handleImageReceived = useCallback((imageBitmap: ImageBitmap) => {
    lastImageRef.current = imageBitmap;
  }, []);
  
  return (
    <SliceRenderer
      width={width}
      height={height}
      tag={tag}
      customRender={customRender}
      onMouseDown={handleMouseDown}
      onCanvasReady={handleCanvasReady}
      onImageReceived={handleImageReceived}
      className="cursor-crosshair"
      canvasClassName="mosaic-cell-canvas"
    />
  );
}