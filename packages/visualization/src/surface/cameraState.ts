/** Portable camera state, independent of a renderer or application store. */
export interface SurfaceCameraState {
  position: [number, number, number];
  target: [number, number, number];
  rotation: [number, number, number, 'XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ' | 'ZYX'];
  up: [number, number, number];
  zoom: number;
}

export function isSurfaceCameraState(value: unknown): value is SurfaceCameraState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<SurfaceCameraState>;
  const triple = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  return triple(state.up) && state.up!.some((v) => v !== 0) && triple(state.position) && triple(state.target) && Array.isArray(state.rotation) &&
    state.rotation.length === 4 && state.rotation.slice(0, 3).every(Number.isFinite) &&
    ['XYZ', 'YZX', 'ZXY', 'XZY', 'YXZ', 'ZYX'].includes(state.rotation[3]) &&
    typeof state.zoom === 'number' && Number.isFinite(state.zoom) && state.zoom > 0 &&
    state.position!.some((v, i) => v !== state.target![i]);
}
