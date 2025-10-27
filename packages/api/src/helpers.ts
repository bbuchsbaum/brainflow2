// Lightweight wrappers around Tauri invoke for typed usage
// Consumers may replace `tauriInvoke` with their own bridge if desired.

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<any>;

let tauriInvokeRef: InvokeFn | null = null;

export function configureInvoker(invokeFn: InvokeFn) {
  tauriInvokeRef = invokeFn;
}

function getInvoker(): InvokeFn {
  if (tauriInvokeRef) return tauriInvokeRef;
  // Attempt dynamic import of @tauri-apps/api/tauri if available
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { invoke } = require('@tauri-apps/api/tauri');
    return invoke as InvokeFn;
  } catch {
    if (typeof (window as any)?.__TAURI__?.invoke === 'function') {
      return (window as any).__TAURI__.invoke as InvokeFn;
    }
    throw new Error('No Tauri invoke function configured. Call configureInvoker() first.');
  }
}

// Set per-layer slice border
export async function setLayerBorder(layerId: string, enabled: boolean, thicknessPx = 1): Promise<void> {
  const invoke = getInvoker();
  await invoke('plugin:api-bridge|set_layer_border', {
    layerId,
    enabled,
    thicknessPx,
  });
}

// Sample layer value at a world-space coordinate
export async function sampleLayerValueAtWorld(
  layerId: string,
  worldCoords: [number, number, number]
): Promise<number> {
  const invoke = getInvoker();
  const value = await invoke('plugin:api-bridge|sample_layer_value_at_world', {
    layerId,
    worldCoords,
  });
  return value as number;
}

// Compute world coords from a pixel on the view given frame vectors.
// Shader convention: world = origin + ndc.x * u + ndc.y * v, with ndc in [0,1].
export function pixelToWorld(
  x: number,
  y: number,
  width: number,
  height: number,
  origin_mm: [number, number, number, number],
  u_mm: [number, number, number, number],
  v_mm: [number, number, number, number]
): [number, number, number] {
  // Map pixel center to ndc [0,1]
  const ndcX = (x + 0.5) / Math.max(1, width);
  const ndcY = (y + 0.5) / Math.max(1, height);
  const wx = origin_mm[0] + ndcX * u_mm[0] + ndcY * v_mm[0];
  const wy = origin_mm[1] + ndcX * u_mm[1] + ndcY * v_mm[1];
  const wz = origin_mm[2] + ndcX * u_mm[2] + ndcY * v_mm[2];
  return [wx, wy, wz];
}

