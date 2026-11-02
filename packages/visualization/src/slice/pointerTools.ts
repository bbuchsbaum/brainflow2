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
export class ViewportPointerController {
  private tool: ViewportTool | null = null;
  private owner: { pointerId: number; tool: ViewportTool } | null = null;

  select(tool: ViewportTool | null): void {
    if (tool === this.tool) return;
    this.cancel('tool-changed');
    this.tool = tool;
  }

  down(samples: readonly ViewportPointerSample[]): boolean {
    const first = samples[0];
    if (!first || first.button !== 0) return false;
    // Swallow another primary contact while a stroke is in progress. It must
    // neither start a second stroke nor move the default crosshair.
    if (this.owner) return true;
    const tool = this.tool;
    if (!tool || !tool.pointerDown(samples)) return false;
    this.owner = { pointerId: first.pointerId, tool };
    return true;
  }

  move(samples: readonly ViewportPointerSample[]): boolean {
    if (!this.owner || samples[0]?.pointerId !== this.owner.pointerId) return false;
    this.owner.tool.pointerMove(samples);
    return true;
  }

  up(samples: readonly ViewportPointerSample[]): boolean {
    const owner = this.owner;
    if (!owner || samples[0]?.pointerId !== owner.pointerId) return false;
    this.owner = null;
    owner.tool.pointerUp(samples);
    return true;
  }

  owns(pointerId: number): boolean { return this.owner?.pointerId === pointerId; }

  cancel(reason: PointerCancelReason): void {
    const owner = this.owner;
    this.owner = null;
    owner?.tool.cancel(reason);
  }
}
