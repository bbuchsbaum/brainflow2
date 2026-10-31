import { describe, expect, it } from 'vitest';
import { BRIDGE_MODULES } from '@brainflow/api';
import { createBackend } from '../backend';
import type { HarnessFixtures } from '../fixtures';

const fixtures = { mni: null, stats: null, surface: null } as unknown as HarnessFixtures;

describe('harness backend: bridge modules', () => {
  it('handles list_modules / set_enabled_modules and gates module commands like the bridge', () => {
    const { handlers } = createBackend(fixtures);
    const list = () => handlers.list_modules({}) as Array<{ id: string; enabled: boolean }>;
    expect(list().map((m) => m.id)).toEqual(Object.keys(BRIDGE_MODULES));
    expect(list().every((m) => m.enabled)).toBe(true);
    expect(handlers.list_analyses({})).toBeTruthy();

    handlers.set_enabled_modules({ moduleIds: [] });
    expect(list().find((m) => m.id === 'analysis')?.enabled).toBe(false);
    expect(() => handlers.list_analyses({})).toThrow(/ModuleDisabled \(12001\)/);
    expect(() => handlers.set_enabled_modules({ moduleIds: ['nope'] })).toThrow(/Unknown module id 'nope'/);

    handlers.set_enabled_modules({ moduleIds: ['analysis'] });
    expect(handlers.list_analyses({})).toBeTruthy();
  });

  it('every bridge module command has a handler', () => {
    const { handlers } = createBackend(fixtures);
    for (const module of Object.values(BRIDGE_MODULES)) {
      for (const command of module.commands) expect(handlers[command], command).toBeTypeOf('function');
    }
  });
});
