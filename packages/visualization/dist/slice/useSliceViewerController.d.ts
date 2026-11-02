import type { MouseEvent } from 'react';
import type { ViewportTool } from './pointerTools.js';
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
    tool?: ViewportTool | null;
}
export declare function useSliceViewerController({ viewPlane, crosshair, crosshairStyle, showSliceBorder, sliceBorderWidth, onCanvasReady, onPlacementChange, onWorldClick, onMouseDown, customRender, tool, }: UseSliceViewerControllerArgs): {
    pointerHandlers: {
        onPointerDown(event: import("react").PointerEvent<HTMLDivElement>): void;
        onPointerMove(event: import("react").PointerEvent<HTMLDivElement>): void;
        onPointerUp(event: import("react").PointerEvent<HTMLDivElement>): void;
        onPointerCancel(event: import("react").PointerEvent<HTMLDivElement>): void;
        onLostPointerCapture(event: import("react").PointerEvent<HTMLDivElement>): void;
    };
    handleCanvasReady: (canvas: HTMLCanvasElement) => void;
    handleMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
    handleRender: SliceViewerCustomRender;
};
//# sourceMappingURL=useSliceViewerController.d.ts.map