import { beforeEach, describe, expect, it } from 'vitest';
import { useHoverSettingsStore } from '../hoverSettingsStore';

describe('hoverSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useHoverSettingsStore.getState().reset();
  });

  it('enables the built-in hover providers by default', () => {
    expect(useHoverSettingsStore.getState().enabledProviders).toEqual([
      'coords',
      'intensity',
      'atlas',
      'sparkline',
      'neurosynth',
    ]);
  });

  it('migrates version 1 persisted settings to include the new providers', async () => {
    localStorage.setItem(
      'brainflow-hover-settings',
      JSON.stringify({
        state: {
          enabled: false,
          enabledProviders: ['atlas'],
          showInTooltip: false,
          showInStatusBar: true,
          throttleMs: 75,
        },
        version: 1,
      })
    );

    await useHoverSettingsStore.persist.rehydrate();

    expect(useHoverSettingsStore.getState().enabled).toBe(false);
    expect(useHoverSettingsStore.getState().showInTooltip).toBe(false);
    expect(useHoverSettingsStore.getState().throttleMs).toBe(75);
    expect(useHoverSettingsStore.getState().enabledProviders).toEqual([
      'atlas',
      'coords',
      'intensity',
      'sparkline',
      'neurosynth',
    ]);
  });
});
