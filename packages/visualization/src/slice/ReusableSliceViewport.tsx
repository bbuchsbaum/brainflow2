import type { ViewportTool } from './pointerTools.js';
import type { MouseEvent, ReactNode } from 'react';
import { useSliceViewerController } from './useSliceViewerController.js';
import type {
  SliceViewerCrosshair,
  SliceViewerCrosshairStyle,
  SliceViewerCustomRender,
  SliceViewerPlacement,
  SliceViewerPlane,
  SliceViewerSurfaceProps,
  SliceViewerWorldCoord,
} from './types.js';

export interface ReusableSliceViewportProps {
  width: number;
  height: number;
  viewPlane?: SliceViewerPlane | null;
  crosshair?: SliceViewerCrosshair | null;
  crosshairStyle?: SliceViewerCrosshairStyle | null;
  showSliceBorder?: boolean;
  sliceBorderWidth?: number;
  className?: string;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  onPlacementChange?: (placement: SliceViewerPlacement) => void;
  onWorldClick?: (worldCoord: SliceViewerWorldCoord, event: MouseEvent<HTMLDivElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  customRender?: SliceViewerCustomRender;
  tool?: ViewportTool | null;
  renderSurface: (props: SliceViewerSurfaceProps) => ReactNode;
}

export function ReusableSliceViewport({
  width,
  height,
  viewPlane,
  crosshair,
  crosshairStyle,
  showSliceBorder = false,
  sliceBorderWidth = 1,
  className = '',
  onCanvasReady,
  onPlacementChange,
  onWorldClick,
  onMouseDown,
  customRender,
  tool,
  renderSurface,
}: ReusableSliceViewportProps) {
  const { handleCanvasReady, handleMouseDown, handleRender, pointerHandlers } = useSliceViewerController({
    viewPlane,
    crosshair,
    crosshairStyle,
    showSliceBorder,
    sliceBorderWidth,
    onCanvasReady,
    onPlacementChange,
    onWorldClick,
    onMouseDown,
    customRender,
    tool,
  });

  return (
    <div className={`relative h-full w-full ${className}`} style={tool ? { touchAction: 'none' } : undefined} {...pointerHandlers} onMouseDown={handleMouseDown}>
      {renderSurface({
        width,
        height,
        customRender: handleRender,
        onCanvasReady: handleCanvasReady,
      })}
    </div>
  );
}
