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
  renderSurface,
}: ReusableSliceViewportProps) {
  const { handleCanvasReady, handleMouseDown, handleRender } = useSliceViewerController({
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
  });

  return (
    <div className={`relative h-full w-full ${className}`} onMouseDown={handleMouseDown}>
      {renderSurface({
        width,
        height,
        customRender: handleRender,
        onCanvasReady: handleCanvasReady,
      })}
    </div>
  );
}
