/**
 * Built-in Hover Info Providers
 *
 * These providers are registered at app startup to provide standard
 * hover information (coordinates, intensity values, atlas regions).
 */

export { coordsProvider } from "./coordsProvider";
export { intensityProvider } from "./intensityProvider";
export { atlasProvider } from "./atlasProvider";
export { sparklineProvider } from "./sparklineProvider";
export { neurosynthProvider } from "./neurosynthProvider";

import { hoverInfoService } from "../HoverInfoService";
import { coordsProvider } from "./coordsProvider";
import { intensityProvider } from "./intensityProvider";
import { sparklineProvider } from "./sparklineProvider";
import { neurosynthProvider } from "./neurosynthProvider";

/**
 * Register all built-in providers with the HoverInfoService.
 * Call this once at app initialization.
 *
 * NOTE: the atlas region readout is intentionally NOT a hover provider. It is
 * surfaced persistently in the status bar 'Region' slot, driven by the
 * crosshair (see StatusBarService + atlasRegionLookup), to avoid a distracting
 * floating tooltip for region identity.
 */
export function registerBuiltinHoverProviders(): void {
  hoverInfoService.register(coordsProvider);
  hoverInfoService.register(intensityProvider);
  hoverInfoService.register(sparklineProvider);
  hoverInfoService.register(neurosynthProvider);
}
