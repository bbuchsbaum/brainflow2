/**
 * HoverInfoService
 *
 * Central registry and coordinator for hover information providers.
 * Providers register here and are queried when the user hovers over views.
 *
 * Usage:
 *   // Register a provider at app startup
 *   hoverInfoService.register(coordsProvider);
 *   hoverInfoService.register(intensityProvider);
 *
 *   // Query on hover (typically from SliceViewCanvas)
 *   const entries = await hoverInfoService.getHoverInfo(context);
 */

import type {
  HoverInfoProvider,
  HoverInfoEntry,
  HoverContext,
  DEFAULT_ENTRY_PRIORITY,
} from '@/types/hoverInfo';
import { useHoverSettingsStore } from '@/stores/hoverSettingsStore';

class HoverInfoServiceImpl {
  private providers: Map<string, HoverInfoProvider> = new Map();

  /**
   * Register a hover info provider.
   * If a provider with the same ID exists, it will be replaced.
   */
  register(provider: HoverInfoProvider): void {
    if (this.providers.has(provider.id)) {
      console.warn(
        `[HoverInfoService] Replacing existing provider: ${provider.id}`
      );
    }
    this.providers.set(provider.id, provider);
    console.log(
      `[HoverInfoService] Registered provider: ${provider.id} (${provider.displayName})`
    );
  }

  /**
   * Unregister a provider by ID.
   * Useful for plugins that need to clean up on unload.
   */
  unregister(providerId: string): boolean {
    const removed = this.providers.delete(providerId);
    if (removed) {
      console.log(`[HoverInfoService] Unregistered provider: ${providerId}`);
    }
    return removed;
  }

  /**
   * Get a provider by ID (for testing/debugging).
   */
  getProvider(providerId: string): HoverInfoProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get all registered provider IDs (for settings UI).
   */
  getRegisteredProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get provider metadata for settings UI.
   */
  getProviderInfo(): Array<{ id: string; displayName: string; priority: number }> {
    return Array.from(this.providers.values())
      .map((p) => ({
        id: p.id,
        displayName: p.displayName,
        priority: p.priority,
      }))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Query all enabled providers and collect hover info entries.
   * Providers are called in priority order (lower first).
   * All async calls run in parallel for performance.
   */
  async getHoverInfo(ctx: HoverContext): Promise<HoverInfoEntry[]> {
    const settings = useHoverSettingsStore.getState();

    // Master toggle off - return empty
    if (!settings.enabled) {
      return [];
    }

    // Get enabled providers, sorted by priority
    const enabledProviders = Array.from(this.providers.values())
      .filter((p) => settings.enabledProviders.includes(p.id))
      .sort((a, b) => a.priority - b.priority);

    if (enabledProviders.length === 0) {
      return [];
    }

    // Run all providers in parallel
    const results = await Promise.all(
      enabledProviders.map(async (provider) => {
        try {
          const entries = await provider.getInfo(ctx);
          return entries ?? [];
        } catch (err) {
          console.error(
            `[HoverInfoService] Provider '${provider.id}' threw error:`,
            err
          );
          return [];
        }
      })
    );

    // Flatten and sort entries by priority
    const allEntries = results.flat();
    allEntries.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

    return allEntries;
  }

  /**
   * Clear all providers (useful for testing).
   */
  clear(): void {
    this.providers.clear();
  }
}

// Export singleton instance
export const hoverInfoService = new HoverInfoServiceImpl();

// Also export the class for testing
export { HoverInfoServiceImpl };
