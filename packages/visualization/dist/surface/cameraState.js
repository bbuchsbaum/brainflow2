export function isSurfaceCameraState(value) {
    if (!value || typeof value !== 'object')
        return false;
    const state = value;
    const triple = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    return triple(state.up) && state.up.some((v) => v !== 0) && triple(state.position) && triple(state.target) && Array.isArray(state.rotation) &&
        state.rotation.length === 4 && state.rotation.slice(0, 3).every(Number.isFinite) &&
        ['XYZ', 'YZX', 'ZXY', 'XZY', 'YXZ', 'ZYX'].includes(state.rotation[3]) &&
        typeof state.zoom === 'number' && Number.isFinite(state.zoom) && state.zoom > 0 &&
        state.position.some((v, i) => v !== state.target[i]);
}
//# sourceMappingURL=cameraState.js.map