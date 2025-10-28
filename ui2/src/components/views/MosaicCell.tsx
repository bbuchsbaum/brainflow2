/**
 * MosaicCell Component
 * 
 * Renders a single cell in the MosaicView grid with crosshair support.
 * Wraps SliceRenderer and adds crosshair rendering functionality.
 */

import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { SliceRenderer } from './SliceRenderer';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { getMosaicRenderService } from '@/services/MosaicRenderService';
import { drawCrosshair, getLineDash } from '@/utils/crosshairUtils';
import { CoordinateTransform } from '@/utils/coordinates';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { RenderContextFactory } from '@/types/renderContext';
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
  const viewState = useViewStateStore(state => state.viewState);
  // Use Zustand store for crosshair settings - works across all React roots
  const crosshairSettings = useCrosshairSettingsStore(state => state.getViewSettings(axis));
  
  // Register context with the store for type-safe rendering
  const hasRegisteredRef = useRef(false);
  useEffect(() => {
    if (hasRegisteredRef.current) return;
    const store = useRenderStateStore.getState();
    const existing = store.getContext?.(renderContext.id);
    if (!existing) {
      store.registerContext(renderContext);
      console.log(`[MosaicCell] Registered context for ${renderContext.id} (slice ${sliceIndex})`);
    } else {
      console.log(`[MosaicCell] Context already registered for ${renderContext.id} (slice ${sliceIndex})`);
    }
    hasRegisteredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderContext.id, sliceIndex]);
  
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
  // Store the redraw function from SliceRenderer
  const redrawCanvasRef = useRef<(() => void) | null>(null);
  // Custom render function to draw crosshairs
  const customRender = useCallback((
    ctx: CanvasRenderingContext2D,
    placement: { x: number; y: number; width: number; height: number; imageWidth: number; imageHeight: number }
  ) => {
    // Store image placement for click handling
    imagePlacementRef.current = placement;
    
    // Try to get the view plane from the current ViewState
    // But if it doesn't exist, just skip crosshair rendering
    // This prevents crashes when viewState changes
    if (!viewState.views || !viewState.views[axis]) {
      console.warn(`[MosaicCell] No view plane available for axis ${axis}, skipping crosshair render`);
      return;
    }
    const currentViewPlane = viewState.views[axis];
    
    // Store the view plane reference
    viewPlaneRef.current = currentViewPlane;
    
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
      viewState.crosshair.world_mm,
      axis,
      slicePositionRef.current,
      currentViewPlane
    );
    
    // Debug logging
    const debug = `Slice ${sliceIndex}: pos=${slicePositionRef.current.toFixed(1)}, crosshair=${viewState.crosshair.world_mm.map(v => v.toFixed(1)).join(',')}, visible=${viewState.crosshair.visible}, hasCoord=${!!crosshairInfo.screenCoord}, isActive=${crosshairInfo.isActive}`;
    console.log(`[MosaicCell] ${debug}`);
    
    // Log the difference between crosshair and slice position
    let diff = 0;
    switch (axis) {
      case 'axial':
        diff = Math.abs(viewState.crosshair.world_mm[2] - slicePositionRef.current);
        break;
      case 'sagittal':
        diff = Math.abs(viewState.crosshair.world_mm[0] - slicePositionRef.current);
        break;
      case 'coronal':
        diff = Math.abs(viewState.crosshair.world_mm[1] - slicePositionRef.current);
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
  }, [axis, sliceIndex, viewState.crosshair, viewState.views, mosaicRenderService, crosshairSettings]);
  
  // Note: We no longer need manual redraw triggers for settings changes
  // The customRender dependency on crosshairSettings ensures SliceRenderer
  // will automatically redraw when settings change via Zustand
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear the reference but don't close the bitmap
      // Let garbage collection handle it to avoid issues with async operations
      if (lastImageRef.current) {
        lastImageRef.current = null;
        console.debug(`[MosaicCell ${tag}] Cleared ImageBitmap reference on unmount`);
      }
    };
  }, [tag]);
  
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
  
  // Store the redraw function when SliceRenderer provides it
  const handleRedrawReady = useCallback((redrawFn: () => void) => {
    console.log(`[MosaicCell ${tag}] Received redraw function from SliceRenderer`);
    redrawCanvasRef.current = redrawFn;
  }, [tag]);
  
  const handleImageReceived = useCallback((imageBitmap: ImageBitmap) => {
    // Don't dispose the old bitmap - let it be garbage collected
    // This prevents issues with React effects trying to use disposed bitmaps
    
    // Store new bitmap
    lastImageRef.current = imageBitmap;
    
    // Browser handles memory management automatically
    console.debug(`[MosaicCell ${tag}] Received new image ${imageBitmap.width}x${imageBitmap.height}`);
  }, [tag]);
  
  return (
    <SliceRenderer
      width={width}
      height={height}
      context={renderContext}  // NEW: Pass structured context instead of tag string
      tag={tag}                // Keep for now for backward compatibility during transition
      customRender={customRender}
      onMouseDown={handleMouseDown}
      onCanvasReady={handleCanvasReady}
      onRedrawReady={handleRedrawReady}
      onImageReceived={handleImageReceived}
      className="cursor-crosshair"
      canvasClassName="mosaic-cell-canvas"
    />
  );
}
