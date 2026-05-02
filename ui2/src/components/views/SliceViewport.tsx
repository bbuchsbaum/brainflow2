import type { MouseEvent } from 'react';
import { SliceRenderer } from './SliceRenderer';
import type { CrosshairStyle } from '@/utils/crosshairUtils';
import type { ViewPlane } from '@/types/coordinates';
import type { RenderContext } from '@/types/renderContext';
import type { DisplayOpenIntent } from '@/types/loadIntent';
import { useRenderContextRegistration } from './viewport/useRenderContextRegistration';
import { useSliceViewportController } from './viewport/useSliceViewportController';

export interface SliceViewportPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

interface SliceViewportProps {
  width: number;
  height: number;
  context: RenderContext;
  tag?: string;
  viewPlane?: ViewPlane | null;
  crosshair?: {
    visible: boolean;
    world_mm: [number, number, number];
  } | null;
  crosshairStyle?: CrosshairStyle | null;
  showSliceBorder?: boolean;
  sliceBorderWidth?: number;
  className?: string;
  canvasClassName?: string;
  showLoading?: boolean;
  showError?: boolean;
  showNoLayers?: boolean;
  showLoadingVolume?: boolean;
  enableDragDrop?: boolean;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  onPlacementChange?: (placement: SliceViewportPlacement) => void;
  onWorldClick?: (worldCoord: [number, number, number], event: MouseEvent<HTMLDivElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseMove?: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseUp?: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: (event: MouseEvent<HTMLDivElement>) => void;
  onWheel?: (event: React.WheelEvent<HTMLDivElement>) => void;
  onFileDrop?: (file: File, intent: DisplayOpenIntent) => void;
  onPathDrop?: (path: string, intent: DisplayOpenIntent) => void;
  customRender?: SliceRendererProps['customRender'];
}

export function SliceViewport({
  width,
  height,
  context,
  tag,
  viewPlane,
  crosshair,
  crosshairStyle,
  showSliceBorder = false,
  sliceBorderWidth = 1,
  className = '',
  canvasClassName = '',
  showLoading = true,
  showError = true,
  showNoLayers = false,
  showLoadingVolume = false,
  enableDragDrop = false,
  onCanvasReady,
  onPlacementChange,
  onWorldClick,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onWheel,
  onFileDrop,
  onPathDrop,
  customRender,
}: SliceViewportProps) {
  useRenderContextRegistration(context);
  const { handleCanvasReady, handleMouseDown, handleRender } = useSliceViewportController({
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
    <div className={`relative w-full h-full ${className}`} onMouseDown={handleMouseDown}>
      <SliceRenderer
        width={width}
        height={height}
        context={context}
        tag={tag}
        showLoading={showLoading}
        showError={showError}
        showNoLayers={showNoLayers}
        showLoadingVolume={showLoadingVolume}
        enableDragDrop={enableDragDrop}
        onFileDrop={onFileDrop}
        onPathDrop={onPathDrop}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onWheel={onWheel}
        customRender={handleRender}
        onCanvasReady={handleCanvasReady}
        className="w-full h-full"
        canvasClassName={canvasClassName}
      />
    </div>
  );
}
