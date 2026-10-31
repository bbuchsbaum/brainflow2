/**
 * Builds the `ModuleContext` handed to `activate(ctx)`. Every registration is
 * recorded so that deactivating the module (switching it off) undoes it; a
 * registration made after deactivation is undone at once.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getEventBus } from '@/events/EventBus';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';
import { formatTauriError } from '@/utils/formatTauriError';
import { safeListen, safeUnlisten, type Unlisten } from '@/utils/eventUtils';
import type {
  AppStateOptions,
  CommandHandler,
  DisposeFn,
  KeybindingContribution,
  ModuleAppStore,
  ModuleContext,
  ModuleStage,
  WhenClause,
} from './api';

/** What the registry tells a context about its module. */
export interface ContextHost {
  moduleId: string;
  moduleTitle: string;
  stage: ModuleStage;
  /** Declared command ids and titles of this module. */
  commands: ReadonlyMap<string, string>;
  /** Tool tab types this module declares. */
  workspaces: ReadonlySet<string>;
  isEnabled(): boolean;
  matchesWhen(when: WhenClause | undefined): boolean;
  executeCommand(id: string): Promise<boolean>;
  openWorkspace(type: string): Promise<string | null>;
}

/** Disposables of one activation, undone in reverse order. */
export class DisposableSet {
  private items: DisposeFn[] = [];
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  add(dispose: DisposeFn): DisposeFn {
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      this.items = this.items.filter((d) => d !== once);
      try {
        dispose();
      } catch (error) {
        console.error('[modules] dispose failed:', error);
      }
    };
    if (this.disposed) {
      once();
      return once;
    }
    this.items.push(once);
    return once;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const items = this.items.reverse();
    this.items = [];
    for (const dispose of items) dispose();
  }
}

/** Report a failed command run from a shortcut or a menu (there is no caller to catch it). */
export function reportCommandFailure(commandId: string, error: unknown): void {
  console.error(`[modules] command ${commandId} failed:`, error);
  getEventBus().emit('ui.notification', {
    type: 'error',
    message: `${commandId}: ${formatTauriError(error)}`,
  });
}

const chord = (b: KeybindingContribution) =>
  [b.modifiers?.meta && 'meta', b.modifiers?.ctrl && 'ctrl', b.modifiers?.alt && 'alt', b.modifiers?.shift && 'shift', b.key.toLowerCase()]
    .filter(Boolean)
    .join('+');

/** Check a keybinding against the module's declarations and stage. Returns problems. */
export function keybindingProblems(
  host: Pick<ContextHost, 'moduleId' | 'stage' | 'commands'>,
  binding: KeybindingContribution,
): string[] {
  const problems: string[] = [];
  if (!host.commands.has(binding.command)) {
    problems.push(`keybinding ${chord(binding)} names undeclared command "${binding.command}"`);
  }
  if (!binding.key) problems.push(`keybinding for "${binding.command}" has no key`);
  if (host.stage !== 'stable' && !binding.when?.workspace) {
    problems.push(
      `keybinding ${chord(binding)} is global; a ${host.stage} module must scope it with when.workspace`,
    );
  }
  return problems;
}

/** Register a module keybinding with the shared shortcut service. */
export function registerModuleKeybinding(
  host: ContextHost,
  binding: KeybindingContribution,
): DisposeFn {
  const problems = keybindingProblems(host, binding);
  if (problems.length > 0) throw new Error(`[modules] ${host.moduleId}: ${problems.join('; ')}`);
  const id = `module.${host.moduleId}.${binding.command}.${chord(binding)}`;
  return getKeyboardShortcutService().register({
    id,
    key: binding.key,
    modifiers: binding.modifiers,
    allowInInputs: binding.allowInInputs,
    category: host.moduleTitle,
    description: host.commands.get(binding.command) ?? binding.command,
    when: () => host.isEnabled() && host.matchesWhen(binding.when),
    handler: () => {
      host.executeCommand(binding.command).catch((error) => reportCommandFailure(binding.command, error));
    },
  });
}

const appStores = new Map<string, ModuleAppStore<object>>();
const STATE_NAME = /^[a-z][a-zA-Z0-9-]*$/;

/** The persisted app store `brainflow-module:<module>:<name>` (one instance per key). */
export function moduleAppStore<T extends object>(
  moduleId: string,
  name: string,
  options: AppStateOptions<T>,
): ModuleAppStore<T> {
  if (!STATE_NAME.test(name)) throw new Error(`[modules] ${moduleId}: invalid state name "${name}"`);
  if (!Number.isInteger(options.version) || options.version < 0) {
    throw new Error(`[modules] ${moduleId}: state "${name}" needs an integer version`);
  }
  const key = `brainflow-module:${moduleId}:${name}`;
  const existing = appStores.get(key);
  if (existing) return existing as ModuleAppStore<T>;
  const store = create<T>()(
    persist(() => ({ ...options.initial }), {
      name: key,
      version: options.version,
      // Without a migrate, an older payload is dropped rather than trusted.
      migrate: (persisted, version) =>
        options.migrate ? options.migrate(persisted, version) : { ...options.initial },
    }),
  );
  appStores.set(key, store as unknown as ModuleAppStore<object>);
  return store;
}

/** Test helper: forget cached app stores. */
export function resetModuleAppStoresForTests(): void {
  appStores.clear();
}

export function createModuleContext(
  host: ContextHost,
  disposables: DisposableSet,
  handlers: Map<string, CommandHandler>,
): ModuleContext {
  return {
    moduleId: host.moduleId,
    commands: {
      register(id, handler) {
        if (!host.commands.has(id)) {
          throw new Error(`[modules] ${host.moduleId}: command "${id}" is not declared in the manifest`);
        }
        if (handlers.has(id)) {
          throw new Error(`[modules] ${host.moduleId}: command "${id}" already has a handler`);
        }
        handlers.set(id, handler);
        return disposables.add(() => {
          if (handlers.get(id) === handler) handlers.delete(id);
        });
      },
    },
    keybindings: {
      register(binding) {
        return disposables.add(registerModuleKeybinding(host, binding));
      },
    },
    events: {
      listen<T>(event: string, handler: (payload: T) => void) {
        let unlisten: Unlisten | null = null;
        let stopped = false;
        const stop = disposables.add(() => {
          stopped = true;
          if (unlisten) void safeUnlisten(unlisten);
        });
        void safeListen<T>(event, (e: { payload: T }) => {
          if (!stopped) handler(e.payload);
        }).then((fn) => {
          // Disposed while the listener was being attached: detach it now.
          if (stopped) void safeUnlisten(fn);
          else unlisten = fn;
        });
        return stop;
      },
    },
    workspaces: {
      open(id) {
        if (!host.workspaces.has(id)) {
          return Promise.reject(
            new Error(`[modules] ${host.moduleId}: workspace "${id}" is not declared in the manifest`),
          );
        }
        if (disposables.isDisposed || !host.isEnabled()) return Promise.resolve(null);
        return host.openWorkspace(id);
      },
    },
    state: {
      app: (name, options) => moduleAppStore(host.moduleId, name, options),
    },
    disposables: {
      add(dispose) {
        disposables.add(dispose);
      },
    },
  };
}
