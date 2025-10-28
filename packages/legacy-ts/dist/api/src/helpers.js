// Lightweight wrappers around Tauri invoke for typed usage
// Consumers may replace `tauriInvoke` with their own bridge if desired.
let tauriInvokeRef = null;
export function configureInvoker(invokeFn) {
    tauriInvokeRef = invokeFn;
}
function getInvoker() {
    if (tauriInvokeRef)
        return tauriInvokeRef;
    // Attempt dynamic import of @tauri-apps/api/tauri if available
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { invoke } = require('@tauri-apps/api/tauri');
        return invoke;
    }
    catch {
        if (typeof window?.__TAURI__?.invoke === 'function') {
            return window.__TAURI__.invoke;
        }
        throw new Error('No Tauri invoke function configured. Call configureInvoker() first.');
    }
}
// Set per-layer slice border
export async function setLayerBorder(layerId, enabled, thicknessPx = 1) {
    const invoke = getInvoker();
    await invoke('plugin:api-bridge|set_layer_border', {
        layerId,
        enabled,
        thicknessPx,
    });
}
// Sample layer value at a world-space coordinate
export async function sampleLayerValueAtWorld(layerId, worldCoords) {
    const invoke = getInvoker();
    const value = await invoke('plugin:api-bridge|sample_layer_value_at_world', {
        layerId,
        worldCoords,
    });
    return value;
}
// Compute world coords from a pixel on the view given frame vectors.
// Shader convention: world = origin + ndc.x * u + ndc.y * v, with ndc in [0,1].
export function pixelToWorld(x, y, width, height, origin_mm, u_mm, v_mm) {
    // Map pixel center to ndc [0,1]
    const ndcX = (x + 0.5) / Math.max(1, width);
    const ndcY = (y + 0.5) / Math.max(1, height);
    const wx = origin_mm[0] + ndcX * u_mm[0] + ndcY * v_mm[0];
    const wy = origin_mm[1] + ndcX * u_mm[1] + ndcY * v_mm[1];
    const wz = origin_mm[2] + ndcX * u_mm[2] + ndcY * v_mm[2];
    return [wx, wy, wz];
}
