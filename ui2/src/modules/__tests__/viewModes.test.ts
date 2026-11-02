import { describe, expect, it, vi } from 'vitest';
import type { ModuleManifest, ModuleContext } from '../api';
import { ModuleRegistry } from '../registry';

const lazy = async () => ({ default: () => null });
const mode = { id: 'segment.trace', title: 'Segment', layoutPreset: 'segment.trace-layout', component: lazy, inspectorMode: 'segment.inspect' };
function fixture(activate: (ctx: ModuleContext) => void | Promise<void> = () => {}) {
  const switches: Record<string, boolean> = {};
  let change = () => {};
  const registry = new ModuleRegistry({
    overrides: () => switches, subscribeOverrides: (fn) => { change = fn; return () => {}; },
    host: () => 'desktop', capabilities: () => ({}), bridgeModules: {},
  });
  const manifest: ModuleManifest = {
    id: 'segment', title: 'Segment', description: 'Trace labels', version: '1', stage: 'preview', hosts: ['desktop'],
    contributes: {
      viewportTools: [{ id: 'segment.brush', title: 'Brush' }],
      viewModes: [mode], inspectorModes: [{ id: 'segment.inspect', title: 'Segment', component: lazy }],
      commands: [{ id: 'segment.brush', title: 'Brush', when: { viewMode: mode.id } }],
      keybindings: [{ command: 'segment.brush', key: 'b', when: { viewMode: mode.id } }],
    },
    activate: async () => ({ activate }),
  };
  let activeId = 'first';
  let activeMode: string | null = null;
  let epoch = 0;
  const apply = vi.fn((id: string, next: string) => { if (id !== activeId) return false; activeMode = next; return true; });
  registry.connectShell({
    openWorkspace: async () => null, activeWorkspaceType: () => 'orthogonal-flexible', activeViewMode: () => activeMode,
    captureView: () => { const revision = epoch; return { workspaceId: activeId, isCurrent: () => revision === epoch }; },
    enterViewMode: apply,
  });
  return {
    registry, manifest, apply,
    navigate(id: string) { epoch += 1; activeId = id; activeMode = null; },
    disable() { switches.segment = false; change(); },
  };
}

describe('module view modes', () => {
  it('lets an activating context enter its own view without awaiting itself', async () => {
    const f = fixture(async (ctx) => { expect(await ctx.views.enterMode(mode.id)).toBe(true); });
    f.registry.register(f.manifest);
    await f.registry.ensureActive('segment');
    expect(f.apply).toHaveBeenCalledExactlyOnceWith('first', mode.id);
  });
  it('registers only declared tools and removes their handlers on disable', async () => {
    const tool = { pointerDown: () => true, pointerMove() {}, pointerUp() {}, cancel() {} };
    const f = fixture((ctx) => {
      expect(() => ctx.views.registerTool('other.tool', tool)).toThrow(/not declared/);
      ctx.views.registerTool('segment.brush', tool);
    });
    f.registry.register(f.manifest);
    expect(f.registry.getViewportTool('segment.brush')).toBeUndefined();
    await f.registry.ensureActive('segment');
    expect(f.registry.getViewportTool('segment.brush')).toBe(tool);
    f.disable();
    expect(f.registry.getViewportTool('segment.brush')).toBeUndefined();
  });
  it('validates the layout and Inspector declarations before registration', () => {
    const f = fixture();
    expect(() => f.registry.register({ ...f.manifest, contributes: { viewModes: [{ ...mode, layoutPreset: 'trace' }] } })).toThrow(/namespaced layout|undeclared Inspector/);
    expect(f.registry.getViewModes()).toEqual([]);
  });

  it('changes the captured view in place after lazy activation and scopes commands to its mode', async () => {
    const brush = vi.fn();
    const f = fixture((ctx) => { ctx.commands.register('segment.brush', brush); });
    f.registry.register(f.manifest);
    expect(await f.registry.executeCommand('segment.brush')).toBe(false);
    expect(await f.registry.enterViewMode(mode.id)).toBe(true);
    expect(f.apply).toHaveBeenCalledWith('first', mode.id);
    expect(await f.registry.executeCommand('segment.brush')).toBe(true);
    expect(brush).toHaveBeenCalledTimes(1);
    f.navigate('second');
    expect(await f.registry.executeCommand('segment.brush')).toBe(false);
  });

  it('does not apply a pending mode after switching away and back to the original tab', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    const f = fixture(() => waiting);
    f.registry.register(f.manifest);
    const entering = f.registry.enterViewMode(mode.id);
    await Promise.resolve();
    f.navigate('second');
    f.navigate('first');
    finish();
    expect(await entering).toBe(false);
    expect(f.apply).not.toHaveBeenCalled();
  });

  it('hides modes on disable and refuses entry into missing modes', async () => {
    const f = fixture();
    f.registry.register(f.manifest);
    expect(f.registry.getViewModes()).toHaveLength(1);
    f.disable();
    expect(f.registry.getViewModes()).toEqual([]);
    expect(await f.registry.enterViewMode(mode.id)).toBe(false);
    expect(await f.registry.enterViewMode('unknown.mode')).toBe(false);
    expect(f.apply).not.toHaveBeenCalled();
  });
});
