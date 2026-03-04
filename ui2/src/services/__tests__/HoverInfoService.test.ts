import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HoverInfoServiceImpl } from '../HoverInfoService';
import type { HoverInfoProvider, HoverContext, HoverInfoEntry } from '@/types/hoverInfo';
import { useHoverSettingsStore } from '@/stores/hoverSettingsStore';

// Helper to create a mock provider
function createMockProvider(
  id: string,
  priority: number,
  entries: HoverInfoEntry[] | null
): HoverInfoProvider {
  return {
    id,
    displayName: `${id} Provider`,
    priority,
    getInfo: vi.fn().mockResolvedValue(entries),
  };
}

// Helper to create a mock context
function createMockContext(overrides?: Partial<HoverContext>): HoverContext {
  return {
    worldCoord: [10, 20, 30],
    viewId: 'test-view',
    screenPos: { x: 100, y: 200 },
    activeLayerId: 'layer-1',
    ...overrides,
  };
}

describe('HoverInfoService', () => {
  let service: HoverInfoServiceImpl;

  beforeEach(() => {
    service = new HoverInfoServiceImpl();
    // Reset settings store to defaults
    useHoverSettingsStore.getState().reset();
  });

  afterEach(() => {
    service.clear();
  });

  describe('Provider Registration', () => {
    it('registers a provider successfully', () => {
      const provider = createMockProvider('test', 50, []);

      service.register(provider);

      expect(service.getProvider('test')).toBe(provider);
      expect(service.getRegisteredProviderIds()).toContain('test');
    });

    it('replaces existing provider with same ID', () => {
      const provider1 = createMockProvider('test', 50, []);
      const provider2 = createMockProvider('test', 60, []);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      service.register(provider1);
      service.register(provider2);

      expect(service.getProvider('test')).toBe(provider2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Replacing existing provider')
      );

      consoleSpy.mockRestore();
    });

    it('unregisters a provider', () => {
      const provider = createMockProvider('test', 50, []);
      service.register(provider);

      const result = service.unregister('test');

      expect(result).toBe(true);
      expect(service.getProvider('test')).toBeUndefined();
    });

    it('returns false when unregistering non-existent provider', () => {
      const result = service.unregister('non-existent');
      expect(result).toBe(false);
    });

    it('clears all providers', () => {
      service.register(createMockProvider('a', 10, []));
      service.register(createMockProvider('b', 20, []));

      service.clear();

      expect(service.getRegisteredProviderIds()).toHaveLength(0);
    });

    it('getProviderInfo returns sorted list by priority', () => {
      service.register(createMockProvider('high', 100, []));
      service.register(createMockProvider('low', 10, []));
      service.register(createMockProvider('mid', 50, []));

      const info = service.getProviderInfo();

      expect(info.map((p) => p.id)).toEqual(['low', 'mid', 'high']);
    });
  });

  describe('getHoverInfo', () => {
    it('returns empty array when master toggle is disabled', async () => {
      const provider = createMockProvider('test', 50, [
        { label: 'Test', value: '123', priority: 50 },
      ]);
      service.register(provider);

      // Enable provider in settings
      useHoverSettingsStore.getState().setProviderEnabled('test', true);
      // Disable master toggle
      useHoverSettingsStore.getState().setEnabled(false);

      const result = await service.getHoverInfo(createMockContext());

      expect(result).toEqual([]);
      expect(provider.getInfo).not.toHaveBeenCalled();
    });

    it('only queries enabled providers', async () => {
      const enabledProvider = createMockProvider('enabled', 50, [
        { label: 'Enabled', value: 'yes' },
      ]);
      const disabledProvider = createMockProvider('disabled', 50, [
        { label: 'Disabled', value: 'no' },
      ]);

      service.register(enabledProvider);
      service.register(disabledProvider);

      // Enable only one provider
      useHoverSettingsStore.getState().setProviderEnabled('enabled', true);
      useHoverSettingsStore.getState().setProviderEnabled('disabled', false);

      const ctx = createMockContext();
      await service.getHoverInfo(ctx);

      expect(enabledProvider.getInfo).toHaveBeenCalledWith(ctx);
      expect(disabledProvider.getInfo).not.toHaveBeenCalled();
    });

    it('runs providers in parallel and collects results', async () => {
      const provider1 = createMockProvider('p1', 10, [
        { label: 'P1', value: 'v1', priority: 10 },
      ]);
      const provider2 = createMockProvider('p2', 20, [
        { label: 'P2', value: 'v2', priority: 20 },
      ]);

      service.register(provider1);
      service.register(provider2);

      useHoverSettingsStore.getState().setProviderEnabled('p1', true);
      useHoverSettingsStore.getState().setProviderEnabled('p2', true);

      const result = await service.getHoverInfo(createMockContext());

      expect(result).toHaveLength(2);
      expect(result[0].label).toBe('P1');
      expect(result[1].label).toBe('P2');
    });

    it('sorts entries by priority', async () => {
      const provider = createMockProvider('multi', 10, [
        { label: 'Low', value: 'low', priority: 100 },
        { label: 'High', value: 'high', priority: 10 },
        { label: 'Mid', value: 'mid', priority: 50 },
      ]);

      service.register(provider);
      useHoverSettingsStore.getState().setProviderEnabled('multi', true);

      const result = await service.getHoverInfo(createMockContext());

      expect(result.map((e) => e.label)).toEqual(['High', 'Mid', 'Low']);
    });

    it('uses default priority (50) for entries without priority', async () => {
      const provider = createMockProvider('defaults', 10, [
        { label: 'NoPriority', value: 'np' },
        { label: 'Priority10', value: 'p10', priority: 10 },
        { label: 'Priority90', value: 'p90', priority: 90 },
      ]);

      service.register(provider);
      useHoverSettingsStore.getState().setProviderEnabled('defaults', true);

      const result = await service.getHoverInfo(createMockContext());

      expect(result.map((e) => e.label)).toEqual([
        'Priority10',
        'NoPriority',
        'Priority90',
      ]);
    });

    it('handles provider returning null gracefully', async () => {
      const nullProvider = createMockProvider('null', 10, null);
      const normalProvider = createMockProvider('normal', 20, [
        { label: 'Normal', value: 'yes' },
      ]);

      service.register(nullProvider);
      service.register(normalProvider);
      useHoverSettingsStore.getState().setProviderEnabled('null', true);
      useHoverSettingsStore.getState().setProviderEnabled('normal', true);

      const result = await service.getHoverInfo(createMockContext());

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Normal');
    });

    it('handles provider throwing error gracefully', async () => {
      const errorProvider: HoverInfoProvider = {
        id: 'error',
        displayName: 'Error Provider',
        priority: 10,
        getInfo: vi.fn().mockRejectedValue(new Error('Provider error')),
      };
      const normalProvider = createMockProvider('normal', 20, [
        { label: 'Normal', value: 'yes' },
      ]);

      service.register(errorProvider);
      service.register(normalProvider);
      useHoverSettingsStore.getState().setProviderEnabled('error', true);
      useHoverSettingsStore.getState().setProviderEnabled('normal', true);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.getHoverInfo(createMockContext());

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Normal');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Provider 'error' threw error"),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('returns empty array when no providers are enabled', async () => {
      service.register(createMockProvider('test', 50, []));

      // Disable all providers
      useHoverSettingsStore.setState({ enabledProviders: [] });

      const result = await service.getHoverInfo(createMockContext());

      expect(result).toEqual([]);
    });
  });
});
