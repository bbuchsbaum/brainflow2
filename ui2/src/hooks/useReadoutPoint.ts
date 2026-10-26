/**
 * The point the Inspector's per-layer readout describes (UI redesign phase
 * 3, item 6): the pointer while it is over a slice view, otherwise the
 * crosshair, like FSLeyes' location panel.
 */
import { useViewStateStore } from '@/stores/viewStateStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';

export interface ReadoutPoint {
  world: [number, number, number];
  source: 'pointer' | 'crosshair';
}

export function useReadoutPoint(): ReadoutPoint {
  const crosshair = useViewStateStore((s) => s.viewState.crosshair.world_mm);
  const pointer = useMouseCoordinateStore((s) => s.worldCoordinates);
  return pointer
    ? { world: pointer, source: 'pointer' }
    : { world: [crosshair[0], crosshair[1], crosshair[2]], source: 'crosshair' };
}
