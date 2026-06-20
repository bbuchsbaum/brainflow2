import type { SliceViewerCrosshairStyle, SliceViewerPlacement } from './types.js';
export declare function resolveSliceBorderColor(): string;
export declare function drawSliceBorder(ctx: CanvasRenderingContext2D, placement: SliceViewerPlacement, thickness: number, color?: string): void;
export declare function drawSliceViewerCrosshair({ ctx, canvasX, canvasY, bounds, style, }: {
    ctx: CanvasRenderingContext2D;
    canvasX: number;
    canvasY: number;
    bounds: Pick<SliceViewerPlacement, 'x' | 'y' | 'width' | 'height'>;
    style: SliceViewerCrosshairStyle;
}): void;
//# sourceMappingURL=drawing.d.ts.map