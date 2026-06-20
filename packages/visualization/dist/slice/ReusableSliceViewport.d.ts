import type { MouseEvent, ReactNode } from 'react';
import type { SliceViewerCrosshair, SliceViewerCrosshairStyle, SliceViewerCustomRender, SliceViewerPlacement, SliceViewerPlane, SliceViewerSurfaceProps, SliceViewerWorldCoord } from './types.js';
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
export declare function ReusableSliceViewport({ width, height, viewPlane, crosshair, crosshairStyle, showSliceBorder, sliceBorderWidth, className, onCanvasReady, onPlacementChange, onWorldClick, onMouseDown, customRender, renderSurface, }: ReusableSliceViewportProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=ReusableSliceViewport.d.ts.map