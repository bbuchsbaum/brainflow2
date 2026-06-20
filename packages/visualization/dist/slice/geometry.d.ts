import type { SliceViewerImagePoint, SliceViewerPlacement, SliceViewerPlane, SliceViewerWorldCoord } from './types.js';
interface CanvasPoint {
    canvasX: number;
    canvasY: number;
}
export declare function sliceImagePointToWorld(imageX: number, imageY: number, plane: SliceViewerPlane): SliceViewerWorldCoord;
export declare function worldToSliceImagePoint(worldMm: SliceViewerWorldCoord, plane: SliceViewerPlane, toleranceMm?: number): SliceViewerImagePoint | null;
export declare function imagePointToCanvasPoint(imagePoint: SliceViewerImagePoint, placement: SliceViewerPlacement): CanvasPoint;
export declare function projectWorldToCanvas(worldMm: SliceViewerWorldCoord, plane: SliceViewerPlane, placement: SliceViewerPlacement, toleranceMm?: number): CanvasPoint | null;
export declare function isCanvasPointInPlacement(canvasPoint: CanvasPoint, placement: SliceViewerPlacement): boolean;
export declare function canvasPointToImagePoint(canvasPoint: CanvasPoint, placement: SliceViewerPlacement): SliceViewerImagePoint | null;
export declare function clientPointToCanvasPoint(clientX: number, clientY: number, canvas: HTMLCanvasElement): CanvasPoint | null;
export declare function clientPointToWorld(clientX: number, clientY: number, canvas: HTMLCanvasElement, placement: SliceViewerPlacement, plane: SliceViewerPlane): SliceViewerWorldCoord | null;
export {};
//# sourceMappingURL=geometry.d.ts.map