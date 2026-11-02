import { describe, expect, it, vi } from 'vitest';
import type { ModuleManifest } from '../api';
import { ModuleRegistry } from '../registry';
import { startModuleRuntime, type ModuleRuntimeDeps } from '../runtime';

function fixture() {
  const activate = vi.fn();
  const dispose = vi.fn();
  const registry = new ModuleRegistry({ overrides: () => ({}), subscribeOverrides: () => () => {}, host: () => 'desktop', capabilities: () => ({}), bridgeModules: {} });
  const manifest: ModuleManifest = { id: 'caps', title: 'Capability fixture', description: 'Needs editable volumes.', version: '1', stage: 'preview', hosts: ['desktop'], requires: { renderFeatures: ['editableLabels', 'subRegionUpload'] }, contributes: { commands: [{ id: 'caps.go', title: 'Edit' }] }, activate: async () => ({ activate(ctx) { activate(); ctx.disposables.add(dispose); } }) };
  return { registry, manifest, activate, dispose };
}

describe('module capabilities', () => {
  it('requires affirmative host support, including unknown capabilities', () => {
    const f = fixture();
    f.registry.register({ ...f.manifest, requires: { hostCapabilities: ['nativePaths'] } });
    expect(f.registry.isSupported('caps')).toBe(false);
    expect(f.registry.unavailableReasons('caps')).toEqual(['Requires host capability: nativePaths.']);
  });

  it('hides contributions until every required render feature is confirmed, then tears down on loss', async () => {
    const f = fixture();
    f.registry.register(f.manifest);
    expect(f.registry.getCommands()).toEqual([]);
    await expect(f.registry.ensureActive('caps')).rejects.toThrow(/off/);
    expect(f.activate).not.toHaveBeenCalled();
    f.registry.setRenderCapabilities({ features: ['editableLabels'] });
    expect(f.registry.unavailableReasons('caps')).toEqual(['Requires renderer feature: subRegionUpload.']);
    f.registry.setRenderCapabilities({ features: ['editableLabels', 'subRegionUpload'] });
    expect(f.registry.getCommands().map((c) => c.id)).toEqual(['caps.go']);
    await f.registry.ensureActive('caps');
    f.registry.setRenderCapabilities(null);
    expect(f.dispose).toHaveBeenCalledOnce();
    expect(f.registry.getCommands()).toEqual([]);
  });

  it('ignores late capability replies from a disposed runtime', async () => {
    const f = fixture(); f.registry.register(f.manifest);
    let resolve!: (value: unknown) => void;
    const reply = new Promise((done) => { resolve = done; });
    const deps: ModuleRuntimeDeps = {
      registry: f.registry, invoke: <T>() => reply as Promise<T>, isDesktop: () => false,
      openWorkspace: async () => null, activeWorkspaceType: () => null,
      parkModuleWorkspaces() {}, unparkModuleWorkspaces() {}, notifyError() {},
      listen: async () => () => {}, unlisten: (fn) => { void fn(); }, isModalDialogOpen: () => false,
    };
    const runtime = startModuleRuntime(deps); runtime.dispose();
    resolve({ features: ['editableLabels', 'subRegionUpload'] });
    await runtime.idle();
    expect(f.registry.isEnabled('caps')).toBe(false);
  });
});
