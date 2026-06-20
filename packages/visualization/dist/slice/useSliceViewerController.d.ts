import type { MouseEvent } from 'react';
import type { SliceViewerCrosshair, SliceViewerCrosshairStyle, SliceViewerCustomRender, SliceViewerPlacement, SliceViewerPlane, SliceViewerWorldCoord } from './types.js';
export interface UseSliceViewerControllerArgs {
    viewPlane?: SliceViewerPlane | null;
    crosshair?: SliceViewerCrosshair | null;
    crosshairStyle?: SliceViewerCrosshairStyle | null;
    showSliceBorder?: boolean;
    sliceBorderWidth?: number;
    onCanvasReady?: (canvas: HTMLCanvasElement) => void;
    onPlacementChange?: (placement: SliceViewerPlacement) => void;
    onWorldClick?: (worldCoord: SliceViewerWorldCoord, event: MouseEvent<HTMLDivElement>) => void;
    onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
    customRender?: SliceViewerCustomRender;
}
export declare function useSliceViewerController({ viewPlane, crosshair, crosshairStyle, showSliceBorder, sliceBorderWidth, onCanvasReady, onPlacementChange, onWorldClick, onMouseDown, customRender, }: UseSliceViewerControllerArgs): {
    handleCanvasReady: (canvas: HTMLCanvasElement) => void;
    handleMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
    handleRender: SliceViewerCustomRender;
};
//# sourceMappingURL=useSliceViewerController.d.ts.map