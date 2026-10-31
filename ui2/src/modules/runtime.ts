/**
 * Connects the module registry to the running shell (App calls
 * `initModuleRuntime()` once, first thing on mount):
 *
 * - shell bindings: modules open their tabs through workspaceNavigation and
 *   `when` clauses read the active tab;
 * - manifest proposals (`pinned`, `openAtStartup`) are applied once;
 * - manifest keybindings of enabled modules are registered with the shortcut
 *   service;
 * - the bridge: `set_enabled_modules` with the enabled modules that have a
 *   bridge section, at start and on every change (desktop only). Sends are
 *   serialized, latest wins, and a superseded response is ignored. A failed
 *   switch is retried with bounded backoff (not a rejected request); a module
 *   with a bridge section activates only once the bridge acknowledged the
 *   current set, and does not start if the switch finally fails;
 * - native menus: the menu model of enabled modules goes to Rust
 *   (`set_module_menu_items`, src-tauri main.rs), which places the items and
 *   emits `module-command` on a click; the command runs here (desktop only);
 * - switching a module off parks its tabs; switching it on brings them back.
 */

import type { ModuleInfo } from '@brainflow/api';
import { getEventBus } from '@/events/EventBus';
import { getTransport } from '@/services/transport';
import { isModalDialogOpen, openTool } from '@/services/workspaceNavigation';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { formatTauriError } from '@/utils/formatTauriError';
import { safeListen, safeUnlisten, type Unlisten } from '@/utils/eventUtils';
import type { DisposeFn } from './api';
import { registerModuleKeybinding, reportCommandFailure } from './context';
import { currentModuleHost } from './hostInfo';
import { createLatestSender } from './latestSender';
import { moduleRegistry, type ModuleMenuItem, type ModuleRegistry } from './registry';
import { useModuleSettingsStore } from './settingsStore';

export interface ModuleRuntimeDeps {
  registry: ModuleRegistry;
  invoke<T>(cmd: string, args?: unknown): Promise<T>;
  /** Native integrations (bridge, menus) exist only in the desktop shell. */
  isDesktop(): boolean;
  openWorkspace(type: string): Promise<string | null>;
  activeWorkspaceType(): string | null;
  parkModuleWorkspaces(moduleId: string): void;
  unparkModuleWorkspaces(moduleId: string): void;
  notifyError(message: string): void;
  /** Listen to a native event; resolves to its unlisten function. */
  listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten>;
  unlisten(fn: Unlisten): void;
  /** Native accelerators reach the UI behind dialogs; menu commands must not act there. */
  isModalDialogOpen(): boolean;
}

/** The native event a module menu item emits (src-tauri menu_builder.rs). */
export const MODULE_COMMAND_EVENT = 'module-command';

function defaultDeps(): ModuleRuntimeDeps {
  return {
    registry: moduleRegistry,
    invoke: (cmd, args) => getTransport().invoke(cmd, args),
    isDesktop: () => currentModuleHost() === 'desktop',
    openWorkspace: openTool,
    activeWorkspaceType: () => {
      const { activeWorkspaceId, workspaces } = useWorkspaceStore.getState();
      return activeWorkspaceId ? (workspaces.get(activeWorkspaceId)?.type ?? null) : null;
    },
    parkModuleWorkspaces: (id) => useWorkspaceStore.getState().parkModuleWorkspaces(id),
    unparkModuleWorkspaces: (id) => useWorkspaceStore.getState().unparkModuleWorkspaces(id),
    notifyError: (message) => getEventBus().emit('ui.notification', { type: 'error', message }),
    listen: (event, handler) => safeListen(event, (e: { payload: never }) => handler(e.payload)),
    unlisten: (fn) => void safeUnlisten(fn),
    isModalDialogOpen: () => isModalDialogOpen(),
  };
}

export interface ModuleRuntime {
  /** Resolves when queued native updates have been sent (tests). */
  idle(): Promise<void>;
  dispose(): void;
}

/** Delays between retries of a failed `set_enabled_modules` (then give up). */
export const BRIDGE_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000, 4000];

/** A rejected request (`BridgeError::Input`, e.g. an unknown id) is not retried. */
function isBadRequest(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'Input' in error;
}

/** Keep `set_enabled_modules` in step with the registry. */
function bridgeSync(deps: ModuleRuntimeDeps) {
  /** Key (joined ids) of the last set sent, and of the last set the bridge applied. */
  let requested: string | null = null;
  let acknowledged: string | null = null;
  /** The set that finally failed, after its retries. */
  let failed: { key: string; error: Error } | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let waiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  let disposed = false;

  const currentKey = () => deps.registry.getEnabledBridgeModules().join(',');
  const clearRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };
  /** Release activations waiting for the current set. */
  const settle = () => {
    const key = currentKey();
    const pending = waiters;
    if (acknowledged === key) {
      waiters = [];
      pending.forEach((w) => w.resolve());
    } else if (failed?.key === key) {
      waiters = [];
      const error = failed.error;
      pending.forEach((w) => w.reject(error));
    }
  };

  const sender = createLatestSender<string[], ModuleInfo[]>(
    (moduleIds) => deps.invoke<ModuleInfo[]>('set_enabled_modules', { moduleIds }),
    {
      onResult: (moduleIds, infos) => {
        attempt = 0;
        acknowledged = moduleIds.join(',');
        const on = new Set(moduleIds);
        const drift = (infos ?? []).filter((info) => info.enabled !== on.has(info.id));
        if (drift.length > 0) {
          console.warn('[modules] bridge module state differs from the request:', drift);
        }
        settle();
      },
      onError: (moduleIds, error) => {
        const key = moduleIds.join(',');
        if (!isBadRequest(error) && attempt < BRIDGE_RETRY_DELAYS_MS.length) {
          const delay = BRIDGE_RETRY_DELAYS_MS[attempt];
          attempt += 1;
          clearRetry();
          retryTimer = setTimeout(() => {
            retryTimer = null;
            if (!disposed && requested === key) sender.push(moduleIds);
          }, delay);
          return;
        }
        // Give up until the next change; the bridge keeps its previous state.
        attempt = 0;
        requested = null;
        const message = formatTauriError(error);
        failed = { key, error: new Error(`The bridge did not switch modules: ${message}`, { cause: error }) };
        deps.notifyError(`Could not switch modules: ${message}`);
        settle();
      },
    },
  );
  return {
    sync() {
      if (!deps.isDesktop()) return;
      const ids = deps.registry.getEnabledBridgeModules();
      const key = ids.join(',');
      if (key === requested) return;
      requested = key;
      attempt = 0;
      failed = null;
      clearRetry();
      sender.push(ids);
      // Waiters for a set the user already moved away from are released by
      // the activation's own epoch check; settle in case nothing is sent.
      settle();
    },
    /** Resolves once the bridge applied the current set; rejects if that finally failed. */
    acknowledged(): Promise<void> {
      if (!deps.isDesktop() || acknowledged === currentKey()) return Promise.resolve();
      if (failed && failed.key === currentKey()) return Promise.reject(failed.error);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    idle: () => sender.idle(),
    dispose() {
      disposed = true;
      clearRetry();
      sender.dispose();
      const pending = waiters;
      waiters = [];
      pending.forEach((w) => w.reject(new Error('The module runtime stopped')));
    },
  };
}

/** Keep the native menu's module items in step with the registry. */
function menuSync(deps: ModuleRuntimeDeps) {
  let requested: readonly ModuleMenuItem[] | null = null;
  const sender = createLatestSender<readonly ModuleMenuItem[], void>(
    (items) => deps.invoke<void>('set_module_menu_items', { items }),
    {
      onResult: () => {},
      onError: (_items, error) => {
        requested = null;
        console.error('[modules] could not update the native menu:', error);
      },
    },
  );
  return {
    sync() {
      if (!deps.isDesktop()) return;
      // The registry returns the same array until the enabled set changes.
      const items = deps.registry.getMenuItems();
      if (items === requested) return;
      requested = items;
      sender.push(items);
    },
    idle: () => sender.idle(),
    dispose: () => sender.dispose(),
  };
}

/** Run `module-command` events (native module menu items) through the registry. */
function menuCommands(deps: ModuleRuntimeDeps): DisposeFn {
  if (!deps.isDesktop()) return () => {};
  let unlisten: Unlisten | null = null;
  let disposed = false;
  void deps
    .listen<{ command?: unknown }>(MODULE_COMMAND_EVENT, (payload) => {
      const command = typeof payload?.command === 'string' ? payload.command : null;
      if (!command || disposed || deps.isModalDialogOpen()) return;
      deps.registry.executeCommand(command).catch((error) => reportCommandFailure(command, error));
    })
    .then((fn) => {
      if (disposed) deps.unlisten(fn);
      else unlisten = fn;
    });
  return () => {
    disposed = true;
    if (unlisten) deps.unlisten(unlisten);
  };
}

/** Register the manifest keybindings of enabled modules; re-register on change. */
function keybindingSync(deps: ModuleRuntimeDeps) {
  let registered: DisposeFn[] = [];
  const clear = () => {
    registered.forEach((dispose) => dispose());
    registered = [];
  };
  return {
    sync() {
      clear();
      for (const binding of deps.registry.getKeybindings()) {
        const host = deps.registry.contextHostFor(binding.moduleId);
        if (host) registered.push(registerModuleKeybinding(host, binding, 'manifest'));
      }
    },
    dispose: clear,
  };
}

export function startModuleRuntime(deps: ModuleRuntimeDeps = defaultDeps()): ModuleRuntime {
  const { registry } = deps;
  const bridge = bridgeSync(deps);
  registry.connectShell({
    openWorkspace: deps.openWorkspace,
    activeWorkspaceType: deps.activeWorkspaceType,
    beforeActivate: (moduleId) =>
      registry.hasBridgeSection(moduleId) ? bridge.acknowledged() : Promise.resolve(),
  });
  useModuleSettingsStore.getState().applyProposals(registry.getProposals());

  const keys = keybindingSync(deps);
  const menus = menuSync(deps);
  bridge.sync();
  keys.sync();
  menus.sync();
  const stopMenuCommands = menuCommands(deps);

  const offChange = registry.onEnabledChange((change) => {
    // Bridge first: a restored tab activates its module only once the bridge
    // has applied this change (beforeActivate above).
    bridge.sync();
    keys.sync();
    menus.sync();
    change.disabled.forEach((id) => deps.parkModuleWorkspaces(id));
    change.enabled.forEach((id) => deps.unparkModuleWorkspaces(id));
  });

  return {
    idle: async () => {
      await Promise.all([bridge.idle(), menus.idle()]);
    },
    dispose() {
      offChange();
      stopMenuCommands();
      keys.dispose();
      menus.dispose();
      bridge.dispose();
      registry.connectShell(null);
    },
  };
}

let shared: { runtime: ModuleRuntime; refs: number } | null = null;

/**
 * Start the shared runtime (idempotent; StrictMode mounts twice). Returns the
 * release function for an effect cleanup.
 */
export function initModuleRuntime(): () => void {
  if (shared) shared.refs += 1;
  else shared = { runtime: startModuleRuntime(), refs: 1 };
  let released = false;
  return () => {
    if (released || !shared) return;
    released = true;
    shared.refs -= 1;
    if (shared.refs === 0) {
      shared.runtime.dispose();
      shared = null;
    }
  };
}
