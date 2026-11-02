import type { SliceViewerWorldCoord } from './types.js';
/** Coalesced samples are in event order, mapped through the displayed slice. */
export interface ViewportPointerSample {
    world: SliceViewerWorldCoord | null;
    pressure: number;
    timeStamp: number;
    pointerId: number;
    pointerType: string;
    button: number;
    buttons: number;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
}
export type PointerCancelReason = 'cancelled' | 'capture-lost' | 'tool-changed' | 'disposed';
/** A stable tool instance. Returning false on down leaves the default crosshair in charge. */
export interface ViewportTool {
    pointerDown(samples: readonly ViewportPointerSample[]): boolean;
    pointerMove(samples: readonly ViewportPointerSample[]): void;
    pointerUp(samples: readonly ViewportPointerSample[]): void;
    cancel(reason: PointerCancelReason): void;
}
/** One pointer and one tool own a stroke until up/cancel; secondary contacts never steal it. */
export declare class ViewportPointerController {
    private tool;
    private owner;
    select(tool: ViewportTool | null): void;
    down(samples: readonly ViewportPointerSample[]): boolean;
    move(samples: readonly ViewportPointerSample[]): boolean;
    up(samples: readonly ViewportPointerSample[]): boolean;
    owns(pointerId: number): boolean;
    cancel(reason: PointerCancelReason): void;
}
//# sourceMappingURL=pointerTools.d.ts.map