/**
 * The world point under a pointer on a slice view: the hover readout's
 * mapping (SliceViewCanvas), the same client -> canvas -> image -> world path
 * as the viewer's click (useSliceViewerController) and the inverse of the
 * crosshair overlay's projection, with ONE placement (the render's).
 */
import { clientPointToWorld } from '@brainflow/visualization/slice';
import type { ViewPlane } from '@/types/coordinates';

export type SlicePlacement = Parameters<typeof clientPointToWorld>[3];

export function pointerToWorld(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement | null,
  placement: SlicePlacement | null,
  plane: ViewPlane | null | undefined,
): [number, number, number] | null {
  if (!canvas || !placement || !plane) return null;
  return clientPointToWorld(clientX, clientY, canvas, placement, plane) as [number, number, number] | null;
}
