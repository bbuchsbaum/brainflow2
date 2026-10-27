import { beforeEach, describe, expect, it } from 'vitest';
import { mergeEnabledProviders, useHoverSettingsStore } from '../hoverSettingsStore';

const KEY = 'brainflow-hover-settings';

function store(state: Record<string, unknown>, version: number) {
  localStorage.setItem(KEY, JSON.stringify({ state, version }));
}

describe('hoverSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useHoverSettingsStore.getState().reset();
  });

  it('enables the local hover providers by default; Neurosynth is opt-in', () => {
    expect(useHoverSettingsStore.getState().enabledProviders).toEqual([
      'coords',
      'intensity',
      'atlas',
      'sparkline',
    ]);
    expect(useHoverSettingsStore.getState().isProviderEnabled('neurosynth')).toBe(false);
  });

  it('migrates version 1 settings: new local providers on, Neurosynth off', async () => {
    store(
      {
        enabled: false,
        enabledProviders: ['atlas'],
        showInTooltip: false,
        showInStatusBar: true,
        throttleMs: 75,
      },
      1,
    );
    await useHoverSettingsStore.persist.rehydrate();
    const state = useHoverSettingsStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.showInTooltip).toBe(false);
    expect(state.throttleMs).toBe(75);
    expect(state.enabledProviders).toEqual(['atlas', 'coords', 'intensity', 'sparkline']);
  });

  it('turns off the Neurosynth that version 2 forced on, keeping local choices', async () => {
    store({ enabledProviders: ['coords', 'atlas', 'neurosynth'] }, 2);
    await useHoverSettingsStore.persist.rehydrate();
    expect(useHoverSettingsStore.getState().enabledProviders).toEqual(['coords', 'atlas']);
  });

  it('keeps a user who turned Neurosynth on, across reloads', async () => {
    useHoverSettingsStore.getState().setProviderEnabled('neurosynth', true);
    await useHoverSettingsStore.persist.rehydrate();
    expect(useHoverSettingsStore.getState().enabledProviders).toContain('neurosynth');
    await useHoverSettingsStore.persist.rehydrate();
    expect(useHoverSettingsStore.getState().isProviderEnabled('neurosynth')).toBe(true);
  });

  it('keeps a provider the user turned off off after reload and merge', async () => {
    useHoverSettingsStore.getState().setProviderEnabled('neurosynth', true);
    useHoverSettingsStore.getState().setProviderEnabled('neurosynth', false);
    useHoverSettingsStore.getState().setProviderEnabled('sparkline', false);
    await useHoverSettingsStore.persist.rehydrate();
    const enabled = useHoverSettingsStore.getState().enabledProviders;
    expect(enabled).not.toContain('neurosynth');
    expect(enabled).not.toContain('sparkline');
  });

  it('adds only genuinely new local providers, never network ones', () => {
    expect(mergeEnabledProviders(['atlas'], ['coords', 'intensity', 'atlas', 'neurosynth'])).toEqual([
      'atlas',
      'sparkline',
    ]);
    expect(mergeEnabledProviders([], ['coords', 'intensity', 'atlas', 'sparkline'])).toEqual([]);
    expect(mergeEnabledProviders([], [])).not.toContain('neurosynth');
  });
});
