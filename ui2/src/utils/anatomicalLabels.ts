import type { ViewPlane } from '@/types/coordinates';

/** NIfTI affine world axes are +R, +A, +S; labels follow the displayed basis. */
export function anatomicalLabels(view: Pick<ViewPlane, 'u_mm' | 'v_mm'>) {
  const direction = (axis: number[], sign: number) => {
    const dimension = axis.reduce(
      (best, value, i) => (Math.abs(value) > Math.abs(axis[best]) ? i : best),
      0,
    );
    if (!Number.isFinite(axis[dimension]) || axis[dimension] === 0) return '';
    return (axis[dimension] * sign > 0 ? ['R', 'A', 'S'] : ['L', 'P', 'I'])[dimension];
  };
  return {
    left: direction(view.u_mm, -1),
    right: direction(view.u_mm, 1),
    top: direction(view.v_mm, -1),
    bottom: direction(view.v_mm, 1),
  };
}
