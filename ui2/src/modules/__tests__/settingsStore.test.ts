import { beforeEach, describe, expect, it } from 'vitest';
import {
  MODULE_SETTINGS_KEY,
  migrateModuleSettings,
  sanitizeModuleSettings,
  useModuleSettingsStore,
} from '@/modules/settingsStore';

const reset = () =>
  useModuleSettingsStore.setState({
    enabled: {},
    pinned: [],
    startup: { mode: 'restore', tabs: ['orthogonal-flexible'] },
    appliedProposals: [],
  });

describe('module settings store', () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  it('persists explicit switches, pins and startup tabs under brainflow-modules v1', () => {
    const store = useModuleSettingsStore.getState();
    store.setModuleEnabled('analysis', false);
    store.setToolPinned('set-studio', true);
    store.setStartupMode('fixed');
    store.setStartupTab('set-studio', true, ['orthogonal-flexible', 'set-studio']);
    const saved = JSON.parse(localStorage.getItem(MODULE_SETTINGS_KEY)!);
    expect(saved.version).toBe(1);
    expect(saved.state).toEqual({
      enabled: { analysis: false },
      pinned: ['set-studio'],
      startup: { mode: 'fixed', tabs: ['orthogonal-flexible', 'set-studio'] },
      appliedProposals: [],
    });
  });

  it('guards no-op updates', () => {
    const before = useModuleSettingsStore.getState();
    before.setToolPinned('bids-explorer', false);
    before.setStartupMode('restore');
    before.setStartupTab('orthogonal-flexible', true, []);
    expect(useModuleSettingsStore.getState()).toBe(before);
  });

  it('keeps startup tabs in candidate order', () => {
    const order = ['orthogonal-flexible', 'mosaic', 'set-studio', 'bids-explorer'];
    const store = useModuleSettingsStore.getState();
    store.setStartupTab('bids-explorer', true, order);
    store.setStartupTab('mosaic', true, order);
    expect(useModuleSettingsStore.getState().startup.tabs).toEqual(['orthogonal-flexible', 'mosaic', 'bids-explorer']);
  });

  it('applies a manifest proposal once: an unpinned tool is never re-pinned', () => {
    const store = useModuleSettingsStore.getState();
    store.applyProposals({ pinned: ['seg.segment'], openAtStartup: ['seg.segment'] });
    expect(useModuleSettingsStore.getState().pinned).toEqual(['seg.segment']);
    expect(useModuleSettingsStore.getState().startup.tabs).toEqual(['orthogonal-flexible', 'seg.segment']);
    useModuleSettingsStore.getState().setToolPinned('seg.segment', false);
    useModuleSettingsStore.getState().applyProposals({ pinned: ['seg.segment'], openAtStartup: [] });
    expect(useModuleSettingsStore.getState().pinned).toEqual([]);
  });

  it('sanitizes malformed or foreign payloads', () => {
    expect(sanitizeModuleSettings({ enabled: { a: true, b: 'yes' }, pinned: ['x', 3, 'x'], startup: { mode: 'odd' } })).toEqual({
      enabled: { a: true },
      pinned: ['x'],
      startup: { mode: 'restore', tabs: ['orthogonal-flexible'] },
      appliedProposals: [],
    });
    expect(migrateModuleSettings(null, 0).startup.mode).toBe('restore');
  });

  it('rehydrates a saved payload', async () => {
    localStorage.setItem(
      MODULE_SETTINGS_KEY,
      JSON.stringify({ version: 1, state: { enabled: { analysis: false }, pinned: ['bids-explorer'], startup: { mode: 'fixed', tabs: ['mosaic'] }, appliedProposals: [] } }),
    );
    await useModuleSettingsStore.persist.rehydrate();
    const state = useModuleSettingsStore.getState();
    expect(state.enabled).toEqual({ analysis: false });
    expect(state.pinned).toEqual(['bids-explorer']);
    expect(state.startup).toEqual({ mode: 'fixed', tabs: ['mosaic'] });
  });
});
