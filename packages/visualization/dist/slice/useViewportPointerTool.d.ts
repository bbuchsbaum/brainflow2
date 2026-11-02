import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { type ViewportTool } from './pointerTools.js';
import type { SliceViewerWorldCoord } from './types.js';
export declare function useViewportPointerTool(tool: ViewportTool | null | undefined, mapPoint: (x: number, y: number) => SliceViewerWorldCoord | null, defaultDown: (event: MouseEvent<HTMLDivElement>) => void): {
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void;
    onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void;
    onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void;
    onLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>): void;
};
//# sourceMappingURL=useViewportPointerTool.d.ts.map