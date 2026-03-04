/**
 * Built-in Hover Info Providers
 *
 * These providers are registered at app startup to provide standard
 * hover information (coordinates, intensity values, atlas regions).
 */

export { coordsProvider } from './coordsProvider';
export { intensityProvider } from './intensityProvider';
export { atlasProvider } from './atlasProvider';

import { hoverInfoService } from '../HoverInfoService';
import { coordsProvider } from './coordsProvider';
import { intensityProvider } from './intensityProvider';
import { atlasProvider } from './atlasProvider';

/**
 * Register all built-in providers with the HoverInfoService.
 * Call this once at app initialization.
 */
export function registerBuiltinHoverProviders(): void {
  hoverInfoService.register(coordsProvider);
  hoverInfoService.register(intensityProvider);
  hoverInfoService.register(atlasProvider);
}
