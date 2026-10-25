import { beforeEach, describe, expect, it } from 'vitest';
import {
  CROSSHAIR_SETTINGS_VERSION,
  DEFAULT_CROSSHAIR_COLOR,
  DEFAULT_SETTINGS,
  MEDICAL_COLOR_PRESETS,
  migrateCrosshairSettings,
  useCrosshairSettingsStore,
} from '../crosshairSettingsStore';
import { DEFAULT_CROSSHAIR_STYLES } from '@/utils/crosshairUtils';

describe('crosshair defaults', () => {
  it('defaults to the green crosshair, listed first, with no accent amber or pure red preset', () => {
    expect(DEFAULT_CROSSHAIR_COLOR).toBe('#5fe0a0');
    expect(DEFAULT_SETTINGS.activeColor).toBe('#5fe0a0');
    expect(DEFAULT_CROSSHAIR_STYLES.active.color).toBe('#5fe0a0');
    expect(MEDICAL_COLOR_PRESETS[0]).toEqual({ name: 'Green (default)', value: '#5fe0a0' });
    const values = MEDICAL_COLOR_PRESETS.map((p) => p.value.toLowerCase());
    expect(values).not.toContain('#e0a63f');
    expect(values).not.toContain('#ff0000');
    expect(MEDICAL_COLOR_PRESETS.map((p) => p.name)).toContain('Orange');
  });

  it('turns the centre gap on by default, including for payloads saved before it existed', () => {
    expect(DEFAULT_SETTINGS.centerGap).toBe(true);
    const { centerGap: _omit, ...legacy } = DEFAULT_SETTINGS;
    expect(migrateCrosshairSettings({ ...legacy, _version: 3 }).centerGap).toBe(true);
    expect(migrateCrosshairSettings({ ...DEFAULT_SETTINGS, centerGap: false, _version: 3 }).centerGap).toBe(false);
  });
});

describe('crosshair thickness default', () => {
  it('defaults to a 2px core, matching the canvas default style', () => {
    expect(DEFAULT_SETTINGS.activeThickness).toBe(2);
    expect(DEFAULT_CROSSHAIR_STYLES.active.lineWidth).toBe(2);
  });
});

describe('migrateCrosshairSettings', () => {
  it.each([undefined, 2])('moves the former 1px default (version %s) to 2px', (version) => {
    const migrated = migrateCrosshairSettings({
      ...DEFAULT_SETTINGS,
      activeThickness: 1,
      ...(version === undefined ? {} : { _version: version }),
    });
    expect(migrated.activeThickness).toBe(2);
  });

  it('keeps 1px chosen explicitly in the current version', () => {
    const migrated = migrateCrosshairSettings({
      ...DEFAULT_SETTINGS,
      activeThickness: 1,
      _version: CROSSHAIR_SETTINGS_VERSION,
    });
    expect(migrated.activeThickness).toBe(1);
  });

  it('keeps amber chosen at version 2 while upgrading its thickness', () => {
    const migrated = migrateCrosshairSettings({
      ...DEFAULT_SETTINGS,
      activeColor: '#e0a63f',
      activeThickness: 1,
      _version: 2,
    });
    expect(migrated.activeColor).toBe('#e0a63f');
    expect(migrated.activeThickness).toBe(2);
  });

  it.each(['#e0a63f', '#e07830', '#E0A63F'])(
    'moves an unversioned former default (%s) to the new default',
    (old) => {
      const migrated = migrateCrosshairSettings({ ...DEFAULT_SETTINGS, activeColor: old });
      expect(migrated.activeColor).toBe(DEFAULT_CROSSHAIR_COLOR);
    }
  );

  it('keeps any other customised colour', () => {
    const migrated = migrateCrosshairSettings({ ...DEFAULT_SETTINGS, activeColor: '#ff00ff' });
    expect(migrated.activeColor).toBe('#ff00ff');
  });

  it('keeps amber chosen explicitly after the version bump', () => {
    const migrated = migrateCrosshairSettings({
      ...DEFAULT_SETTINGS,
      activeColor: '#e0a63f',
      _version: CROSSHAIR_SETTINGS_VERSION,
    });
    expect(migrated.activeColor).toBe('#e0a63f');
    expect(migrated).not.toHaveProperty('_version');
  });

  it('preserves every other persisted field', () => {
    const migrated = migrateCrosshairSettings({
      ...DEFAULT_SETTINGS,
      activeColor: '#e0a63f',
      activeThickness: 3,
      showMirror: false,
    });
    expect(migrated.activeThickness).toBe(3);
    expect(migrated.showMirror).toBe(false);
  });
});

describe('loadSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    useCrosshairSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  });

  it('migrates a legacy persisted default once and re-persists it versioned', async () => {
    localStorage.setItem(
      'crosshair-settings',
      JSON.stringify({ ...DEFAULT_SETTINGS, activeColor: '#e0a63f' })
    );
    await useCrosshairSettingsStore.getState().loadSettings();
    expect(useCrosshairSettingsStore.getState().settings.activeColor).toBe(DEFAULT_CROSSHAIR_COLOR);
    const stored = JSON.parse(localStorage.getItem('crosshair-settings')!);
    expect(stored._version).toBe(CROSSHAIR_SETTINGS_VERSION);
    expect(stored.activeColor).toBe(DEFAULT_CROSSHAIR_COLOR);
  });

  it('round-trips an explicit amber choice made in the current version', async () => {
    useCrosshairSettingsStore.getState().updateSettings({ activeColor: '#e0a63f' });
    useCrosshairSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    await useCrosshairSettingsStore.getState().loadSettings();
    expect(useCrosshairSettingsStore.getState().settings.activeColor).toBe('#e0a63f');
  });

  it('resetSettings restores the defaults exactly', () => {
    useCrosshairSettingsStore.getState().updateSettings({ activeColor: '#123456', activeThickness: 4 });
    useCrosshairSettingsStore.getState().resetSettings();
    expect(useCrosshairSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });
});
