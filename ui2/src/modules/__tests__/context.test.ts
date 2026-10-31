import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listen = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  resolve: [] as Array<() => void>,
  unlistened: [] as string[],
}));

vi.mock('@/utils/eventUtils', () => ({
  safeListen: (event: string, handler: (event: { payload: unknown }) => void) =>
    new Promise((resolve) => {
      listen.resolve.push(() => {
        listen.handlers.set(event, handler);
        resolve(() => listen.unlistened.push(event));
      });
    }),
  safeUnlisten: (fn: () => void) => fn(),
}));

import { createModuleContext, DisposableSet, moduleAppStore, resetModuleAppStoresForTests, type ContextHost } from '@/modules/context';

const host = (over: Partial<ContextHost> = {}): ContextHost => ({
  moduleId: 'm',
  moduleTitle: 'M',
  stage: 'preview',
  commands: new Map([['m.go', 'Go']]),
  workspaces: new Set(['m.tab']),
  isEnabled: () => true,
  matchesWhen: () => true,
  executeCommand: async () => true,
  openWorkspace: async () => 'id',
  ...over,
});

describe('module context', () => {
  beforeEach(() => {
    listen.handlers.clear();
    listen.resolve = [];
    listen.unlistened = [];
    localStorage.clear();
    resetModuleAppStoresForTests();
  });
  afterEach(() => localStorage.clear());

  it('disposes in reverse order, once, and undoes late registrations at once', () => {
    const set = new DisposableSet();
    const order: string[] = [];
    set.add(() => order.push('a'));
    const b = set.add(() => order.push('b'));
    b();
    b();
    set.add(() => order.push('c'));
    set.dispose();
    set.dispose();
    expect(order).toEqual(['b', 'c', 'a']);
    set.add(() => order.push('late'));
    expect(order).toEqual(['b', 'c', 'a', 'late']);
  });

  it('native listeners are unlistened on dispose, even when attached afterwards', async () => {
    const disposables = new DisposableSet();
    const ctx = createModuleContext(host(), disposables, new Map());
    const seen: unknown[] = [];
    ctx.events.listen('first', (p) => seen.push(p));
    ctx.events.listen('second', (p) => seen.push(p));
    listen.resolve.shift()!();
    await Promise.resolve();
    listen.handlers.get('first')!({ payload: 1 });
    expect(seen).toEqual([1]);

    disposables.dispose();
    expect(listen.unlistened).toEqual(['first']);
    // `second` attaches after the module was switched off: detached, never delivered.
    listen.resolve.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(listen.unlistened).toEqual(['first', 'second']);
    listen.handlers.get('first')!({ payload: 2 });
    expect(seen).toEqual([1]);
  });

  it('opens nothing after deactivation', async () => {
    const disposables = new DisposableSet();
    const openWorkspace = vi.fn(async () => 'x');
    const ctx = createModuleContext(host({ openWorkspace }), disposables, new Map());
    disposables.dispose();
    await expect(ctx.workspaces.open('m.tab')).resolves.toBeNull();
    expect(openWorkspace).not.toHaveBeenCalled();
  });

  it('state.app persists under the module key and migrates older payloads', async () => {
    localStorage.setItem(
      'brainflow-module:m:prefs',
      JSON.stringify({ state: { units: 'voxel' }, version: 0 }),
    );
    const migrate = vi.fn((persisted: unknown) => ({ unit: (persisted as { units: string }).units }));
    const store = moduleAppStore('m', 'prefs', { version: 1, initial: { unit: 'mm' }, migrate });
    await store.persist.rehydrate();
    expect(migrate).toHaveBeenCalledWith({ units: 'voxel' }, 0);
    expect(store.getState().unit).toBe('voxel');
    store.setState({ unit: 'mm' });
    expect(JSON.parse(localStorage.getItem('brainflow-module:m:prefs')!)).toEqual({ state: { unit: 'mm' }, version: 1 });
    // Same key, same store (a re-activated module keeps its data).
    expect(moduleAppStore('m', 'prefs', { version: 1, initial: { unit: 'mm' } })).toBe(store);
    expect(() => moduleAppStore('m', 'Bad name', { version: 1, initial: {} })).toThrow(/invalid state name/);
  });
});
