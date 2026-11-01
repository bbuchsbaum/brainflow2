/**
 * Pane-overlay geometry in canvas-area CSS px, through the view's own image
 * placement (letterbox, radiological mirror, zoomed plane): where the data
 * and the crosshair are drawn, for the colorbar placement (QA 2026-10-31
 * N16; colorbarPlacement.ts).
 */
import { projectWorldToCanvas } from '@brainflow/visualization/slice';
import { clipPlacementToWorldBounds, type CrosshairWorldBounds } from '../sliceViewer/ReusableSliceViewport';
import type { ViewPlane } from '@/types/coordinates';
import type { PaneRect } from './colorbarPlacement';

type Placement = Parameters<typeof clipPlacementToWorldBounds>[0];

/** The data's world box as drawn on the crosshair's slice, scaled by `k` (CSS px per canvas px). */
export function dataRectOnPane(
  bounds: CrosshairWorldBounds | null | undefined,
  plane: ViewPlane | null | undefined,
  placement: Placement | null | undefined,
  crosshairWorld: readonly [number, number, number],
  k: number,
): PaneRect | null {
  if (!bounds || !plane || !placement) return null;
  const r = clipPlacementToWorldBounds(placement, plane, crosshairWorld, bounds);
  return { left: r.x * k, top: r.y * k, right: (r.x + r.width) * k, bottom: (r.y + r.height) * k };
}

/** The crosshair centre on the pane, or null off the slice. */
export function crosshairOnPane(
  world: readonly [number, number, number],
  plane: ViewPlane | null | undefined,
  placement: Placement | null | undefined,
  k: number,
): { x: number; y: number } | null {
  if (!plane || !placement) return null;
  const p = projectWorldToCanvas([world[0], world[1], world[2]], plane, placement, 1e6);
  return p ? { x: p.canvasX * k, y: p.canvasY * k } : null;
}
