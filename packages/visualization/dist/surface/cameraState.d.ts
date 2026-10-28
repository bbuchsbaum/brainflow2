/** Portable camera state, independent of a renderer or application store. */
export interface SurfaceCameraState {
    position: [number, number, number];
    target: [number, number, number];
    rotation: [number, number, number, 'XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ' | 'ZYX'];
    up: [number, number, number];
    zoom: number;
}
export declare function isSurfaceCameraState(value: unknown): value is SurfaceCameraState;
//# sourceMappingURL=cameraState.d.ts.map