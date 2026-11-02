import { create } from 'zustand';
import type { AppStateOptions, DisposeFn, ModuleAppStore, ModuleWorkspaceState } from './api';

/** Shell adapter: importing the workspace store here would create a registry cycle. */
export interface WorkspaceStateHost {
  read(workspaceId: string): {
    timestamp: number;
    moduleState?: Record<string, Record<string, ModuleWorkspaceState>>;
  } | undefined;
  write(workspaceId: string, timestamp: number, moduleId: string, name: string, value: ModuleWorkspaceState): boolean;
  subscribe(listener: () => void): DisposeFn;
}

const NAME = /^[a-z][a-zA-Z0-9-]*$/;

function readSlot(
  state: Record<string, Record<string, ModuleWorkspaceState>> | undefined,
  moduleId: string,
  name: string,
): ModuleWorkspaceState | undefined {
  const slots = state && Object.hasOwn(state, moduleId) ? state[moduleId] : undefined;
  return slots && Object.hasOwn(slots, name) ? slots[name] : undefined;
}

/** Persistence is JSON data; reject lossy serialization before changing either store. */
function copyData<T extends object>(data: T): T {
  const seen = new Set<object>();
  const check = (value: unknown): void => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || seen.has(value)) throw new Error('Module workspace state must be finite, acyclic JSON data');
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error('Module workspace state must contain only JSON objects and arrays');
    }
    seen.add(value);
    if (Object.getOwnPropertySymbols(value).length) throw new Error('Module workspace state cannot contain symbol keys');
    Object.values(value).forEach(check);
    seen.delete(value);
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Module workspace state must be an object');
  check(data);
  return JSON.parse(JSON.stringify(data)) as T;
}

/** One manager per activation: old stores cannot write after disable or tab closure. */
export class WorkspaceStateManager {
  private disposed = false;
  private stores = new Map<string, { version: number; store: ModuleAppStore<object> }>();
  private stops = new Set<DisposeFn>();

  private readonly moduleId: string;
  private readonly host: WorkspaceStateHost;

  constructor(moduleId: string, host: WorkspaceStateHost) {
    this.moduleId = moduleId;
    this.host = host;
  }

  open<T extends object>(workspaceId: string, name: string, options: AppStateOptions<T>): ModuleAppStore<T> {
    if (this.disposed) throw new Error('Module workspace state has been disposed');
    if (!NAME.test(name)) throw new Error(`Invalid module workspace state name "${name}"`);
    if (!Number.isInteger(options.version) || options.version < 0) throw new Error('Module workspace state needs an integer version');
    const key = JSON.stringify([workspaceId, name]);
    const cached = this.stores.get(key);
    if (cached) {
      if (cached.version !== options.version) throw new Error(`Conflicting versions for module workspace state "${name}"`);
      return cached.store as ModuleAppStore<T>;
    }
    const workspace = this.host.read(workspaceId);
    if (!workspace) throw new Error(`Workspace "${workspaceId}" is closed`);
    const timestamp = workspace.timestamp;
    const saved = readSlot(workspace.moduleState, this.moduleId, name);
    const restore = (value: ModuleWorkspaceState | undefined): T => {
      if (!value) return copyData(options.initial);
      if (!Number.isInteger(value.version) || value.version < 0 || value.version > options.version) {
        throw new Error(`Unsupported version for module workspace state "${name}"`);
      }
      if (value.version === options.version) return copyData(value.data as T);
      return copyData(options.migrate ? options.migrate(value.data, value.version) : options.initial);
    };
    const initial = restore(saved);
    let revoked = false;
    let writing = false;
    let lastSaved = saved;
    const store = create<T>(() => initial);
    const setState = store.setState;
    const valid = () => !this.disposed && !revoked && this.host.read(workspaceId)?.timestamp === timestamp;
    const save = (data: T) => {
      if (!valid()) throw new Error(`Workspace state "${workspaceId}/${name}" is no longer owned by this activation`);
      const value = { version: options.version, data: copyData(data) };
      writing = true;
      try {
        if (!this.host.write(workspaceId, timestamp, this.moduleId, name, value)) {
          throw new Error(`Workspace "${workspaceId}" is closed`);
        }
        lastSaved = value;
      } finally {
        writing = false;
      }
    };
    // Validate and persist before notifying subscribers. A rejected update leaves
    // both the local state and the workspace record unchanged.
    store.setState = ((update: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean) => {
      if (!valid()) throw new Error(`Workspace state "${workspaceId}/${name}" is no longer owned by this activation`);
      const current = store.getState();
      const next = typeof update === 'function' ? update(current) : update;
      if (Object.is(next, current)) return;
      const data = copyData(replace ? next as T : { ...current, ...next });
      save(data);
      setState(data, true);
    }) as typeof store.setState;
    save(initial);
    const stop = this.host.subscribe(() => {
      if (writing || revoked) return;
      if (!valid()) {
        revoked = true;
        this.stores.delete(key);
        this.stops.delete(stop);
        stop();
        return;
      }
      const current = readSlot(this.host.read(workspaceId)?.moduleState, this.moduleId, name);
      if (current !== lastSaved) {
        const data = restore(current);
        lastSaved = current;
        setState(data, true);
      }
    });
    this.stops.add(stop);
    this.stores.set(key, { version: options.version, store: store as unknown as ModuleAppStore<object> });
    return store;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stops.forEach((stop) => stop());
    this.stops.clear();
    this.stores.clear();
  }
}
