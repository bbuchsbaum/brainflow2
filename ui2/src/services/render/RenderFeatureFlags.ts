/**
 * Singleton feature flags for render configuration.
 * Window globals are registered here for console access.
 */
export class RenderFeatureFlags {
  useBinaryIPC = true;
  useRawRGBA = true;
  debugBrighten = false;
  useNewRenderAPI = true;
  legacyRenderFallbackEnabled = false;
}

export const renderFlags = new RenderFeatureFlags();

// Module-level setters
export function setBinaryIPC(enable: boolean) {
  renderFlags.useBinaryIPC = enable;
  console.log(`[RenderFeatureFlags] Binary IPC ${enable ? 'enabled' : 'disabled'}`);
}

export function setRawRGBA(enable: boolean) {
  renderFlags.useRawRGBA = enable;
  console.log(`[RenderFeatureFlags] Raw RGBA transfer ${enable ? 'enabled' : 'disabled'}`);
}

export function setDebugBrighten(enable: boolean) {
  renderFlags.debugBrighten = enable;
  console.log(`[RenderFeatureFlags] Debug brightening ${enable ? 'enabled' : 'disabled'}`);
}

export function setUseNewRenderAPI(enable: boolean) {
  renderFlags.useNewRenderAPI = enable;
  console.log(`[RenderFeatureFlags] New render_view API ${enable ? 'enabled' : 'disabled'}`);
}

export function setLegacyRenderFallbackEnabled(enable: boolean) {
  renderFlags.legacyRenderFallbackEnabled = enable;
  console.log(`[RenderFeatureFlags] Legacy render fallbacks ${enable ? 'enabled' : 'disabled'}`);
}

// Register window globals for console access
if (typeof window !== 'undefined') {
  (window as any).setBinaryIPC = setBinaryIPC;
  (window as any).setRawRGBA = setRawRGBA;
  (window as any).setDebugBrighten = setDebugBrighten;
  (window as any).setUseNewRenderAPI = setUseNewRenderAPI;
  (window as any).setLegacyRenderFallbackEnabled = setLegacyRenderFallbackEnabled;
}
