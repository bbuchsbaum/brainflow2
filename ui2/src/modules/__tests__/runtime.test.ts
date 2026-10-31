import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleInfo } from '@brainflow/api';
import { defineModule, type ModuleManifest } from '@/modules/api';
import { ModuleRegistry, type RegistryDeps } from '@/modules/registry';
import { startModuleRuntime, type ModuleRuntimeDeps } from '@/modules/runtime';
import { createLatestSender } from '@/modules/latestSender';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';

function registryWith(manifests: ModuleManifest[], bridgeModules: RegistryDeps['bridgeModules']) {
  const switches: Record<string, boolean> = {};
  let notify = () => {};
  const registry = new ModuleRegistry({
    overrides: () => switches,
    subscribeOverrides: (listener) => {
      notify = listener;
      return () => {};
    },
    host: () => 'desktop',
    capabilities: () => ({}),
    bridgeModules,
  });
  manifests.forEach((m) => registry.register(m));
  return {
    registry,
    set(id: string, on: boolean) {
      switches[id] = on;
      notify();
    },
  };
}

const module = (id: string, stage: ModuleManifest['stage'] = 'preview', contributes: ModuleManifest['contributes'] = {}) =>
  defineModule({
    id,
    title: id,
    description: 'Test module.',
    version: '0.1.0',
    stage,
    hosts: ['desktop'],
    contributes,
    activate: () => Promise.resolve({ activate: () => {} }),
  } as ModuleManifest);

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function runtimeDeps(registry: ModuleRegistry, over: Partial<ModuleRuntimeDeps> = {}) {
  const calls: Array<{ cmd: string; args: unknown; reply: Deferred<unknown> }> = [];
  const deps: ModuleRuntimeDeps = {
    registry,
    invoke: <T,>(cmd: string, args?: unknown) => {
      const reply = deferred<unknown>();
      calls.push({ cmd, args, reply });
      return reply.promise as Promise<T>;
    },
    isDesktop: () => true,
    openWorkspace: vi.fn(async () => null),
    activeWorkspaceType: () => null,
    parkModuleWorkspaces: vi.fn(),
    unparkModuleWorkspaces: vi.fn(),
    notifyError: vi.fn(),
    ...over,
  };
  return { deps, calls };
}

const infos = (ids: string[], all: string[]): ModuleInfo[] =>
  all.map((id) => ({ id, title: id, version: '0.1.0', stage: 'preview', enabled: ids.includes(id) }));

describe('module runtime: bridge sync', () => {
  afterEach(() => getKeyboardShortcutService().unregisterAll());

  it('sends the enabled bridge modules at start and on every change, never a no-op', async () => {
    const { registry, set } = registryWith([module('ana'), module('lab', 'experimental'), module('ui-only')], {
      ana: { stage: 'preview' },
      lab: { stage: 'experimental' },
    });
    const { deps, calls } = runtimeDeps(registry);
    const runtime = startModuleRuntime(deps);
    expect(calls.map((c) => c.args)).toEqual([{ moduleIds: ['ana'] }]);
    calls[0].reply.resolve(infos(['ana'], ['ana', 'lab']));
    await runtime.idle();

    set('ui-only', false); // no bridge section: nothing to send
    expect(calls).toHaveLength(1);
    set('lab', true);
    expect(calls.map((c) => c.args)).toEqual([{ moduleIds: ['ana'] }, { moduleIds: ['ana', 'lab'] }]);
    runtime.dispose();
  });

  it('keeps one request in flight and sends only the latest; a superseded reply is ignored', async () => {
    const { registry, set } = registryWith([module('ana'), module('lab', 'experimental')], {
      ana: { stage: 'preview' },
      lab: { stage: 'experimental' },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps, calls } = runtimeDeps(registry);
    const runtime = startModuleRuntime(deps);
    set('lab', true);
    set('ana', false);
    // Still one call in flight; the two changes collapse into one queued send.
    expect(calls).toHaveLength(1);
    // The first reply arrives after newer state was queued: not reported as drift.
    calls[0].reply.resolve(infos(['ana'], ['ana', 'lab']));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].args).toEqual({ moduleIds: ['lab'] });
    calls[1].reply.resolve(infos(['lab'], ['ana', 'lab']));
    await runtime.idle();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    runtime.dispose();
  });

  it('reports a failed switch and retries with the next change', async () => {
    const { registry, set } = registryWith([module('ana'), module('lab', 'experimental')], {
      ana: { stage: 'preview' },
      lab: { stage: 'experimental' },
    });
    const { deps, calls } = runtimeDeps(registry);
    const runtime = startModuleRuntime(deps);
    calls[0].reply.reject({ Input: { code: 12002, details: "Unknown module id 'ana'" } });
    await runtime.idle();
    expect(deps.notifyError).toHaveBeenCalledWith("Could not switch modules: Unknown module id 'ana'");
    // Back to the state that failed: sent again, not skipped as unchanged.
    set('lab', true);
    expect(calls[1].args).toEqual({ moduleIds: ['ana', 'lab'] });
    set('lab', false);
    calls[1].reply.resolve(infos(['ana', 'lab'], ['ana', 'lab']));
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].args).toEqual({ moduleIds: ['ana'] });
    calls[2].reply.resolve(infos(['ana'], ['ana', 'lab']));
    await runtime.idle();
    runtime.dispose();
  });

  it('does nothing natively in the browser host', () => {
    const { registry } = registryWith([module('ana')], { ana: { stage: 'preview' } });
    const { deps, calls } = runtimeDeps(registry, { isDesktop: () => false });
    const runtime = startModuleRuntime(deps);
    expect(calls).toEqual([]);
    runtime.dispose();
  });

  it('activates a bridge module only after the bridge applied its switch', async () => {
    const { registry, set } = registryWith([module('lab', 'experimental')], { lab: { stage: 'experimental' } });
    const { deps, calls } = runtimeDeps(registry);
    const runtime = startModuleRuntime(deps);
    calls[0].reply.resolve(infos([], ['lab']));
    await runtime.idle();
    set('lab', true);
    let active = false;
    const activation = registry.ensureActive('lab').then(() => (active = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(false);
    calls[1].reply.resolve(infos(['lab'], ['lab']));
    await activation;
    expect(active).toBe(true);
    runtime.dispose();
  });
});

describe('module runtime: tabs and keybindings', () => {
  beforeEach(() => getKeyboardShortcutService().unregisterAll());
  afterEach(() => getKeyboardShortcutService().unregisterAll());

  it('parks a module’s tabs when it is switched off and restores them when on', () => {
    const { registry, set } = registryWith([module('ana')], {});
    const { deps } = runtimeDeps(registry);
    const runtime = startModuleRuntime(deps);
    set('ana', false);
    expect(deps.parkModuleWorkspaces).toHaveBeenCalledWith('ana');
    set('ana', true);
    expect(deps.unparkModuleWorkspaces).toHaveBeenCalledWith('ana');
    runtime.dispose();
  });

  it('registers manifest keybindings of enabled modules and drops them when off', () => {
    const { registry, set } = registryWith(
      [
        module('seg', 'preview', {
          commands: [{ id: 'seg.brush', title: 'Brush' }],
          keybindings: [{ command: 'seg.brush', key: 'b', when: { workspace: 'seg.tab' } }],
        }),
      ],
      {},
    );
    const { deps } = runtimeDeps(registry);
    const runtime = startModuleRuntime(deps);
    const ids = () => Object.values(getKeyboardShortcutService().getAll()).flat().map((r) => r.id);
    expect(ids()).toEqual(['module.seg.seg.brush.b']);
    set('seg', false);
    expect(ids()).toEqual([]);
    set('seg', true);
    expect(ids()).toEqual(['module.seg.seg.brush.b']);
    runtime.dispose();
    expect(ids()).toEqual([]);
  });
});

describe('createLatestSender', () => {
  it('survives a send that throws synchronously', async () => {
    const results: number[] = [];
    let fail = true;
    const sender = createLatestSender<number, number>(
      (v) => {
        if (fail) throw new Error('sync');
        return Promise.resolve(v);
      },
      { onResult: (_v, r) => results.push(r), onError: () => results.push(-1) },
    );
    sender.push(1);
    await sender.idle();
    fail = false;
    sender.push(2);
    await sender.idle();
    expect(results).toEqual([-1, 2]);
    sender.dispose();
    sender.push(3);
    await sender.idle();
    expect(results).toEqual([-1, 2]);
  });
});
