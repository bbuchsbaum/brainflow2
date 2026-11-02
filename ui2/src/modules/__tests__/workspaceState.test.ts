import { describe, expect, it, vi } from 'vitest';
import { WorkspaceStateManager, type WorkspaceStateHost } from '../workspaceState';
import type { ModuleWorkspaceState } from '../api';

function fixture() {
  const records = new Map<string, { timestamp: number; moduleState?: Record<string, Record<string, ModuleWorkspaceState>> }>([
    ['a', { timestamp: 1 }], ['b', { timestamp: 2 }],
  ]);
  const listeners = new Set<() => void>();
  const notify = () => [...listeners].forEach((fn) => fn());
  const host: WorkspaceStateHost = {
    read: (id) => records.get(id),
    write: (id, timestamp, moduleId, name, value) => {
      const current = records.get(id);
      if (!current || current.timestamp !== timestamp) return false;
      records.set(id, {
        ...current,
        moduleState: { ...current.moduleState, [moduleId]: { ...current.moduleState?.[moduleId], [name]: value } },
      });
      notify();
      return true;
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { host, records, listeners, notify };
}

const options = { version: 1, initial: { label: 1, geometry: { slice: 3 } } };

describe('workspace-owned module state', () => {
  it('treats valid property-like names as data rather than inherited object properties', () => {
    const f = fixture();
    const m = new WorkspaceStateManager('segment', f.host);
    m.open('a', 'session', options);
    expect(m.open('a', 'constructor', options).getState()).toEqual(options.initial);
    expect(m.open('a', 'toString', options).getState()).toEqual(options.initial);
  });
  it('isolates workspaces and modules, caches within an activation, and persists on the record', () => {
    const f = fixture();
    const m = new WorkspaceStateManager('segment', f.host);
    const a = m.open('a', 'session', options);
    const b = m.open('b', 'session', options);
    const other = new WorkspaceStateManager('other', f.host).open('a', 'session', options);
    expect(m.open('a', 'session', options)).toBe(a);
    expect(a.getState().geometry).not.toBe(b.getState().geometry);
    a.setState((s) => ({ label: s.label + 1 }));
    expect(a.getState()).toEqual({ label: 2, geometry: { slice: 3 } });
    expect(b.getState().label).toBe(1);
    expect(other.getState().label).toBe(1);
    expect(f.records.get('a')?.moduleState?.segment.session).toEqual({ version: 1, data: a.getState() });
    expect(f.records.get('a')?.moduleState?.other.session.data).toEqual(options.initial);
  });

  it('restores and migrates after serialization, preserving unrelated module data', () => {
    const f = fixture();
    f.records.set('a', { timestamp: 1, moduleState: {
      segment: { session: { version: 0, data: { slice: 7 } } },
      other: { settings: { version: 4, data: { value: 'kept' } } },
    } });
    const migrate = vi.fn((value: unknown) => ({ label: 8, geometry: { slice: (value as { slice: number }).slice } }));
    const m = new WorkspaceStateManager('segment', f.host);
    const a = m.open('a', 'session', { ...options, migrate });
    expect(migrate).toHaveBeenCalledWith({ slice: 7 }, 0);
    expect(a.getState()).toEqual({ label: 8, geometry: { slice: 7 } });
    m.dispose();
    f.records.set('a', JSON.parse(JSON.stringify(f.records.get('a'))));
    const restored = new WorkspaceStateManager('segment', f.host).open('a', 'session', options);
    expect(restored.getState()).toEqual(a.getState());
    expect(f.records.get('a')?.moduleState?.other.settings.data).toEqual({ value: 'kept' });
  });

  it('revokes a closed workspace permanently even when the same id is later reused', () => {
    const f = fixture();
    const m = new WorkspaceStateManager('segment', f.host);
    const a = m.open('a', 'session', options);
    f.records.delete('a');
    f.notify();
    expect(f.listeners.size).toBe(0);
    expect(() => a.setState({ label: 9 })).toThrow(/no longer owned/);
    f.records.set('a', { timestamp: 1 });
    const next = m.open('a', 'session', options);
    expect(next).not.toBe(a);
    expect(() => a.setState({ label: 9 })).toThrow(/no longer owned/);
    expect(next.getState().label).toBe(1);
  });

  it('rejects writes to a replaced workspace before it can overwrite the new record', () => {
    const f = fixture();
    const a = new WorkspaceStateManager('segment', f.host).open('a', 'session', options);
    f.records.set('a', { timestamp: 10 });
    expect(() => a.setState({ label: 9 })).toThrow(/no longer owned/);
    expect(f.records.get('a')).toEqual({ timestamp: 10 });
  });

  it('deactivation releases subscriptions and preserves data for a fresh activation', () => {
    const f = fixture();
    const m = new WorkspaceStateManager('segment', f.host);
    const a = m.open('a', 'session', options);
    a.setState({ label: 5 });
    m.dispose();
    m.dispose();
    expect(f.listeners.size).toBe(0);
    expect(() => a.setState({ label: 6 })).toThrow(/no longer owned/);
    expect(() => m.open('a', 'session', options)).toThrow(/disposed/);
    const fresh = new WorkspaceStateManager('segment', f.host).open('a', 'session', options);
    expect(fresh.getState().label).toBe(5);
  });

  it('refuses newer versions and invalid data without losing the saved payload', () => {
    const f = fixture();
    const future = { timestamp: 1, moduleState: { segment: { session: { version: 2, data: { future: true } } } } };
    f.records.set('a', future);
    const m = new WorkspaceStateManager('segment', f.host);
    expect(() => m.open('a', 'session', options)).toThrow(/Unsupported version/);
    expect(f.records.get('a')).toBe(future);
    const b = m.open('b', 'session', options);
    const before = f.records.get('b');
    expect(() => b.setState({ label: NaN })).toThrow(/JSON/);
    expect(f.records.get('b')).toBe(before);
    expect(b.getState()).toEqual(options.initial);
    expect(() => m.open('b', 'session', { ...options, version: 3 })).toThrow(/Conflicting versions/);
  });

  it('observes a restored workspace payload without sending it back in a loop', () => {
    const f = fixture();
    const a = new WorkspaceStateManager('segment', f.host).open('a', 'session', options);
    const listener = vi.fn();
    a.subscribe(listener);
    f.records.set('a', { timestamp: 1, moduleState: { segment: { session: { version: 1, data: { label: 7, geometry: { slice: 4 } } } } } });
    f.notify();
    expect(a.getState().label).toBe(7);
    expect(listener).toHaveBeenCalledTimes(1);
    f.notify();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
