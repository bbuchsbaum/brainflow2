export type SliceViewerWorldCoord = [number, number, number];
export type SliceViewerImagePoint = [number, number];
export interface SliceViewerPlane {
    origin_mm: SliceViewerWorldCoord;
    u_mm: SliceViewerWorldCoord;
    v_mm: SliceViewerWorldCoord;
    dim_px?: [number, number];
}
export interface SliceViewerPlacement {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
}
export interface SliceViewerCrosshair {
    visible: boolean;
    world_mm: SliceViewerWorldCoord;
}
export interface SliceViewerCrosshairStyle {
    color: string;
    lineWidth: number;
    lineDash?: number[];
    opacity?: number;
}
export type SliceViewerCustomRender = (ctx: CanvasRenderingContext2D, placement: SliceViewerPlacement) => void;
export interface SliceViewerSurfaceProps {
    width: number;
    height: number;
    customRender: SliceViewerCustomRender;
    onCanvasReady: (canvas: HTMLCanvasElement) => void;
}
//# sourceMappingURL=types.d.ts.map