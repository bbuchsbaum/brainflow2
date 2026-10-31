import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineModule, type ModuleContext, type ModuleManifest } from '@/modules/api';
import { ModuleDisabledError, ModuleRegistry, type RegistryDeps } from '@/modules/registry';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';

const Empty = () => null;
const lazy = () => Promise.resolve({ default: Empty });

function fakeDeps(overrides: Partial<RegistryDeps> = {}) {
  const switches: Record<string, boolean> = {};
  let notify = () => {};
  const deps: RegistryDeps & { set(id: string, on: boolean): void } = {
    overrides: () => switches,
    subscribeOverrides: (listener) => {
      notify = listener;
      return () => {};
    },
    host: () => 'desktop',
    capabilities: () => ({ nativePaths: true, remoteMounts: true, externalProcesses: true }),
    bridgeModules: {},
    set(id, on) {
      switches[id] = on;
      notify();
    },
    ...overrides,
  };
  return deps;
}

function manifest(over: Partial<ModuleManifest> & { id: string }, activate?: (ctx: ModuleContext) => void | Promise<void>) {
  return defineModule({
    title: over.id,
    description: 'A test module.',
    version: '0.1.0',
    stage: 'preview',
    hosts: ['desktop'],
    contributes: {},
    activate: () => Promise.resolve({ activate: activate ?? (() => {}) }),
    ...over,
  } as ModuleManifest);
}

describe('ModuleRegistry registration', () => {
  it('rejects unnamespaced and duplicate contribution ids', () => {
    const registry = new ModuleRegistry(fakeDeps());
    expect(() =>
      registry.register(manifest({ id: 'seg', contributes: { commands: [{ id: 'open', title: 'Open' }] } })),
    ).toThrow(/command id "open" must be namespaced as "seg.<name>"/);

    registry.register(manifest({ id: 'seg', contributes: { commands: [{ id: 'seg.open', title: 'Open' }] } }));
    expect(() =>
      registry.register(manifest({ id: 'other', contributes: { commands: [{ id: 'seg.open', title: 'Open' }] } })),
    ).toThrow(/must be namespaced|already registered/);
    expect(() => registry.register(manifest({ id: 'seg' }))).toThrow(/already registered/);
  });

  it('allows a persisted workspace id only with legacyId, and never a core type', () => {
    const registry = new ModuleRegistry(fakeDeps());
    const workspace = { title: 'Old tool', label: 'Old', component: lazy };
    expect(() =>
      registry.register(manifest({ id: 'old', contributes: { workspaces: [{ id: 'old-tool', ...workspace }] } })),
    ).toThrow(/must be namespaced/);
    registry.register(
      manifest({ id: 'old', contributes: { workspaces: [{ id: 'old-tool', legacyId: true, ...workspace }] } }),
    );
    expect(registry.getToolDescriptor('old-tool')?.moduleId).toBe('old');
    expect(() =>
      registry.register(
        manifest({ id: 'clash', contributes: { workspaces: [{ id: 'mosaic', legacyId: true, ...workspace }] } }),
      ),
    ).toThrow(/workspace id "mosaic" is already registered/);
  });

  it('enforces stage gates: global shortcuts and top-bar proposals need a stable module', () => {
    const registry = new ModuleRegistry(fakeDeps());
    const commands = [{ id: 'seg.brush', title: 'Brush' }];
    expect(() =>
      registry.register(manifest({ id: 'seg', contributes: { commands, keybindings: [{ command: 'seg.brush', key: 'b' }] } })),
    ).toThrow(/global; a preview module must scope it/);
    expect(() =>
      registry.register(
        manifest({ id: 'seg', contributes: { workspaces: [{ id: 'seg.tab', title: 'Seg', label: 'Seg', component: lazy, pinned: true }] } }),
      ),
    ).toThrow(/only stable modules may propose/);
    registry.register(
      manifest({ id: 'seg', stage: 'stable', contributes: { commands, keybindings: [{ command: 'seg.brush', key: 'b' }] } }),
    );
  });

  it('rejects conflicting keybindings in one scope and undeclared command references', () => {
    const registry = new ModuleRegistry(fakeDeps());
    const when = { workspace: 'a.tab' };
    registry.register(
      manifest({ id: 'a', contributes: { commands: [{ id: 'a.go', title: 'Go' }], keybindings: [{ command: 'a.go', key: 'g', when }] } }),
    );
    expect(() =>
      registry.register(
        manifest({ id: 'b', contributes: { commands: [{ id: 'b.go', title: 'Go' }], keybindings: [{ command: 'b.go', key: 'G', when }] } }),
      ),
    ).toThrow(/conflicts with a:a.go in the same scope/);
    // Another scope is fine.
    registry.register(
      manifest({ id: 'b', contributes: { commands: [{ id: 'b.go', title: 'Go' }], keybindings: [{ command: 'b.go', key: 'g', when: { workspace: 'b.tab' } }] } }),
    );
    expect(() =>
      registry.register(manifest({ id: 'c', contributes: { menus: { 'view/workspace': [{ command: 'c.nope' }] } } })),
    ).toThrow(/menu item names undeclared command "c.nope"/);
  });
});

describe('ModuleRegistry enabled state', () => {
  it('defaults by stage, follows the user switch and filters contributions', () => {
    const deps = fakeDeps();
    const registry = new ModuleRegistry(deps);
    registry.register(manifest({ id: 'exp', stage: 'experimental', contributes: { commands: [{ id: 'exp.x', title: 'X' }] } }));
    registry.register(
      manifest({
        id: 'pre',
        contributes: {
          commands: [{ id: 'pre.open', title: 'Open pre' }],
          menus: { 'view/workspace': [{ command: 'pre.open', title: 'Pre' }] },
          workspaces: [{ id: 'pre.tab', title: 'Pre tab', label: 'Pre', component: lazy }],
        },
      }),
    );
    expect(registry.isEnabled('exp')).toBe(false);
    expect(registry.isEnabled('pre')).toBe(true);
    expect(registry.getCommands().map((c) => c.id)).toEqual(['pre.open']);
    expect(registry.getMenuItems()).toEqual([{ command: 'pre.open', label: 'Pre', path: 'view/workspace' }]);
    expect(registry.getTools().map((t) => t.type)).toContain('pre.tab');

    const changes: unknown[] = [];
    registry.onEnabledChange((change) => changes.push(change));
    const before = registry.getTools();
    deps.set('pre', false);
    deps.set('exp', true);
    expect(changes).toEqual([
      { enabled: [], disabled: ['pre'] },
      { enabled: ['exp'], disabled: [] },
    ]);
    expect(registry.getTools()).not.toBe(before);
    expect(registry.getTools().map((t) => t.type)).not.toContain('pre.tab');
    expect(registry.getMenuItems()).toEqual([]);
    expect(registry.getCommands().map((c) => c.id)).toEqual(['exp.x']);
    // Known even while off, so restore can park its tabs.
    expect(registry.getToolDescriptor('pre.tab')?.moduleId).toBe('pre');
    expect(registry.isToolAvailable('pre.tab')).toBe(false);
  });

  it('returns stable references until something changes', () => {
    const deps = fakeDeps();
    const registry = new ModuleRegistry(deps);
    registry.register(manifest({ id: 'pre' }));
    expect(registry.getTools()).toBe(registry.getTools());
    const version = registry.getVersion();
    deps.set('pre', true); // already on: no change
    expect(registry.getVersion()).toBe(version);
  });

  it('hides modules the host does not support', () => {
    const registry = new ModuleRegistry(fakeDeps({ host: () => 'browser' }));
    registry.register(manifest({ id: 'desk', hosts: ['desktop'] }));
    registry.register(manifest({ id: 'both', hosts: ['desktop', 'browser'] }));
    registry.register(manifest({ id: 'procs', hosts: ['desktop', 'browser'], requires: { hostCapabilities: ['externalProcesses'] } }));
    const browserCaps = new ModuleRegistry(
      fakeDeps({ host: () => 'browser', capabilities: () => ({ externalProcesses: false }) }),
    );
    browserCaps.register(manifest({ id: 'procs', hosts: ['desktop', 'browser'], requires: { hostCapabilities: ['externalProcesses'] } }));
    expect(registry.isEnabled('desk')).toBe(false);
    expect(registry.isSupported('desk')).toBe(false);
    expect(registry.isEnabled('both')).toBe(true);
    expect(browserCaps.isEnabled('procs')).toBe(false);
  });

  it('enables bridge modules with their UI module, and unknown ones by stage', () => {
    const deps = fakeDeps({
      bridgeModules: { pre: { stage: 'preview' }, orphan: { stage: 'stable' }, lab: { stage: 'experimental' } },
    });
    const registry = new ModuleRegistry(deps);
    registry.register(manifest({ id: 'pre' }));
    expect(registry.getEnabledBridgeModules()).toEqual(['pre', 'orphan']);
    deps.set('pre', false);
    expect(registry.getEnabledBridgeModules()).toEqual(['orphan']);
  });
});

describe('ModuleRegistry activation', () => {
  beforeEach(() => getKeyboardShortcutService().unregisterAll());
  afterEach(() => getKeyboardShortcutService().unregisterAll());

  it('activates lazily on first command and only once', async () => {
    const deps = fakeDeps();
    const registry = new ModuleRegistry(deps);
    const run = vi.fn();
    const activate = vi.fn((ctx: ModuleContext) => {
      ctx.commands.register('lazy.run', run);
    });
    registry.register(manifest({ id: 'lazy', contributes: { commands: [{ id: 'lazy.run', title: 'Run' }] } }, activate));
    expect(activate).not.toHaveBeenCalled();
    await expect(Promise.all([registry.executeCommand('lazy.run'), registry.executeCommand('lazy.run')])).resolves.toEqual([true, true]);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('disposes registrations when the module is switched off and refuses its commands', async () => {
    const deps = fakeDeps();
    const registry = new ModuleRegistry(deps);
    const disposed = vi.fn();
    registry.register(
      manifest(
        {
          id: 'kb',
          stage: 'stable',
          contributes: { commands: [{ id: 'kb.go', title: 'Go' }] },
        },
        (ctx) => {
          ctx.commands.register('kb.go', () => {});
          ctx.keybindings.register({ command: 'kb.go', key: 'j', modifiers: { alt: true } });
          ctx.disposables.add(disposed);
        },
      ),
    );
    await registry.ensureActive('kb');
    const shortcuts = () => Object.values(getKeyboardShortcutService().getAll()).flat().map((r) => r.id);
    expect(shortcuts()).toEqual(['module.kb.kb.go.alt+j']);

    deps.set('kb', false);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(shortcuts()).toEqual([]);
    expect(registry.isActive('kb')).toBe(false);
    await expect(registry.executeCommand('kb.go')).resolves.toBe(false);
    await expect(registry.ensureActive('kb')).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('tears down an activation that finishes after the module was switched off', async () => {
    const deps = fakeDeps();
    const registry = new ModuleRegistry(deps);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const disposed = vi.fn();
    registry.register(
      manifest({ id: 'slow', contributes: { commands: [{ id: 'slow.go', title: 'Go' }] } }, async (ctx) => {
        ctx.disposables.add(disposed);
        await gate;
        ctx.commands.register('slow.go', () => {});
      }),
    );
    const pending = registry.ensureActive('slow');
    await Promise.resolve();
    deps.set('slow', false);
    release();
    await expect(pending).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(registry.isActive('slow')).toBe(false);
    // Switching it back on activates afresh.
    deps.set('slow', true);
    await expect(registry.ensureActive('slow')).resolves.toBeTruthy();
  });

  it('only lets a module handle commands and open workspaces it declares', async () => {
    const registry = new ModuleRegistry(fakeDeps());
    const openWorkspace = vi.fn(async (type: string) => `${type}-1`);
    registry.connectShell({ openWorkspace, activeWorkspaceType: () => null });
    let ctx!: ModuleContext;
    registry.register(
      manifest(
        {
          id: 'own',
          contributes: {
            commands: [{ id: 'own.open', title: 'Open' }],
            workspaces: [{ id: 'own.tab', title: 'Own', label: 'Own', component: lazy }],
          },
        },
        (c) => {
          ctx = c;
        },
      ),
    );
    await registry.ensureActive('own');
    expect(() => ctx.commands.register('own.other', () => {})).toThrow(/not declared/);
    await expect(ctx.workspaces.open('own.tab')).resolves.toBe('own.tab-1');
    await expect(ctx.workspaces.open('mosaic')).rejects.toThrow(/not declared/);
  });

  it('runs a command only where its when clause holds', async () => {
    const registry = new ModuleRegistry(fakeDeps());
    let active: string | null = null;
    registry.connectShell({ openWorkspace: async () => null, activeWorkspaceType: () => active });
    const run = vi.fn();
    registry.register(
      manifest(
        { id: 'w', contributes: { commands: [{ id: 'w.go', title: 'Go', when: { workspace: 'w.tab' } }] } },
        (ctx) => {
          ctx.commands.register('w.go', run);
        },
      ),
    );
    await expect(registry.executeCommand('w.go')).resolves.toBe(false);
    active = 'w.tab';
    await expect(registry.executeCommand('w.go')).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
