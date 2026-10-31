/**
 * The module registry (docs/plans/module-architecture.md, Phase A).
 *
 * - Static manifests (`./index.ts`) and the core entries
 *   (`./coreContributions.ts`) are registered synchronously when this file is
 *   imported, so tab restore, menus and the palette can consult them before
 *   any module code loads.
 * - Registration rejects malformed manifests: unnamespaced or duplicate
 *   contribution ids (`<module>.<name>`; persisted ids are allowed with
 *   `legacyId`), undeclared command references, conflicting keybindings in one
 *   scope, and stage violations (only stable modules bind global keys or
 *   propose top-bar defaults).
 * - Queries return contributions of enabled modules only. A module is enabled
 *   when its host is supported (`hosts`, `requires.hostCapabilities`) and the
 *   user's switch, or else its stage default, says so.
 * - `ensureActive` loads and runs `activate(ctx)` on first use; switching a
 *   module off disposes everything its context registered. An activation that
 *   finishes after the module was switched off is torn down at once.
 *
 * Shell code imports this file, `./api` and the other framework files at the
 * top of `src/modules/`, never a module's own folder (eslint.config.js).
 */

import { useSyncExternalStore } from 'react';
import { BRIDGE_MODULES } from '@brainflow/api';
import { CORE_WORKSPACE_TYPES } from '@/types/workspace';
import type {
  CommandContribution,
  CommandHandler,
  HostCapability,
  KeybindingContribution,
  LazyComponent,
  MenuPath,
  ModuleHostKind,
  ModuleManifest,
  ModuleStage,
  WhenClause,
  WorkspaceComponentProps,
  WorkspaceContribution,
} from './api';
import {
  CORE_DOCK_TABS,
  CORE_INSPECTOR_MODES,
  CORE_TOOLS,
  type DockTabDescriptor,
  type InspectorModeDescriptor,
  type ToolDescriptor,
} from './coreContributions';
import { createModuleContext, DisposableSet, keybindingProblems, type ContextHost } from './context';
import { currentHostCapabilities, currentModuleHost } from './hostInfo';
import { FIRST_PARTY_MODULES } from './index';
import { useModuleSettingsStore } from './settingsStore';

export type { ToolDescriptor, InspectorModeDescriptor, DockTabDescriptor };

/** A tool tab contributed by a module, with its components. */
export interface ModuleToolDescriptor extends ToolDescriptor {
  moduleId: string;
  stage: ModuleStage;
  bottomDock: boolean;
  component: LazyComponent<WorkspaceComponentProps>;
  inspector?: LazyComponent;
}

export interface ModuleInspectorMode extends InspectorModeDescriptor {
  component?: LazyComponent;
}

export interface ModuleDockTab extends DockTabDescriptor {
  component?: LazyComponent;
}

export interface RegisteredCommand extends CommandContribution {
  moduleId: string;
}

export interface RegisteredKeybinding extends KeybindingContribution {
  moduleId: string;
}

/** A native menu item of an enabled module (sent to Rust as the menu model). */
export interface ModuleMenuItem {
  command: string;
  label: string;
  path: MenuPath;
}

/** Shell services the registry needs but cannot import (they import it). */
export interface ShellBindings {
  openWorkspace(type: string): Promise<string | null>;
  activeWorkspaceType(): string | null;
  /**
   * Awaited before a module activates: the runtime waits until the bridge has
   * applied the latest `set_enabled_modules`, so a module just switched on
   * never calls its commands while the bridge still rejects them.
   */
  beforeActivate?(moduleId: string): Promise<void>;
}

export interface RegistryDeps {
  overrides(): Readonly<Record<string, boolean>>;
  subscribeOverrides(listener: () => void): () => void;
  host(): ModuleHostKind;
  capabilities(): Partial<Record<HostCapability, boolean>>;
  /** Bridge modules (generated `BRIDGE_MODULES`): id → stage. */
  bridgeModules: Readonly<Record<string, { stage: ModuleStage }>>;
}

export interface EnabledChange {
  enabled: string[];
  disabled: string[];
}

export class ModuleDisabledError extends Error {
  readonly moduleId: string;
  constructor(moduleId: string) {
    super(`The ${moduleId} module is switched off`);
    this.name = 'ModuleDisabledError';
    this.moduleId = moduleId;
  }
}

const MODULE_ID = /^[a-z][a-z0-9-]*$/;
const LEGACY_ID = /^[a-z][a-z0-9-]*$/;
const STAGES: readonly ModuleStage[] = ['experimental', 'preview', 'stable'];
const HOSTS: readonly ModuleHostKind[] = ['desktop', 'browser'];
const MENU_PATHS: readonly MenuPath[] = ['view/workspace'];
/** Limits of the native menu model; src-tauri `plan_module_menu_items` enforces the same. */
export const MAX_MODULE_MENU_ITEMS = 64;
const MAX_MENU_LABEL = 64;

/** A menu label Rust accepts: 1-64 printable characters after trimming. */
function menuLabelOk(label: string): boolean {
  const trimmed = label.trim();
  const length = [...trimmed].length;
  return length >= 1 && length <= MAX_MENU_LABEL && !/\p{Cc}/u.test(trimmed);
}

const namespaced = (moduleId: string, id: string) =>
  id.startsWith(`${moduleId}.`) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id.slice(moduleId.length + 1));

/** The scope key of a keybinding: chord plus `when.workspace`. */
function keybindingScopeKey(b: KeybindingContribution): string {
  const m = b.modifiers ?? {};
  return [m.meta ? 'meta' : '', m.ctrl ? 'ctrl' : '', m.alt ? 'alt' : '', m.shift ? 'shift' : '', b.key.toLowerCase(), b.when?.workspace ?? '*'].join('|');
}

/** The label lists show beside a module that is not stable yet. */
export function moduleStageLabel(stage: ModuleStage | null | undefined): string | null {
  if (stage === 'experimental') return 'Experimental';
  if (stage === 'preview') return 'Preview';
  return null;
}

/** Default switch position for a stage: experimental modules start off. */
export function stageDefaultEnabled(stage: ModuleStage): boolean {
  return stage !== 'experimental';
}

interface ActiveModule {
  handlers: Map<string, CommandHandler>;
  disposables: DisposableSet;
}

type Activation =
  | { status: 'inactive' }
  | { status: 'activating'; promise: Promise<ActiveModule>; active: ActiveModule }
  | { status: 'active'; active: ActiveModule };

interface ModuleRecord {
  manifest: ModuleManifest;
  commands: Map<string, CommandContribution>;
  workspaces: Map<string, WorkspaceContribution>;
  activation: Activation;
  /** Why the last activation failed (cleared when one succeeds or the module goes off). */
  activationError: unknown;
  /** Bumped on every deactivation; an activation from an older epoch is stale. */
  epoch: number;
}

export class ModuleRegistry {
  private readonly deps: RegistryDeps;
  private readonly records = new Map<string, ModuleRecord>();
  private readonly commandOwner = new Map<string, string>();
  private readonly workspaceOwner = new Map<string, string>();
  private readonly inspectorModeIds = new Set<string>(CORE_INSPECTOR_MODES.map((m) => m.id));
  private readonly dockTabIds = new Set<string>(CORE_DOCK_TABS.map((t) => t.id));
  private readonly keybindingScopes = new Map<string, string>();
  /** Commands that have a native menu item (one item per command). */
  private readonly menuCommands = new Set<string>();
  private readonly reservedWorkspaceTypes = new Set<string>([
    ...CORE_WORKSPACE_TYPES,
    ...CORE_TOOLS.map((t) => t.type),
  ]);
  private readonly listeners = new Set<() => void>();
  private readonly enabledListeners = new Set<(change: EnabledChange) => void>();
  private shell: ShellBindings | null = null;
  private version = 0;
  private enabledIds: ReadonlySet<string> = new Set();
  private cache = new Map<string, unknown>();

  constructor(deps: RegistryDeps) {
    this.deps = deps;
    deps.subscribeOverrides(() => this.refresh());
  }

  // ── registration ─────────────────────────────────────────────────────────

  /** Validate and add a manifest. Throws with every problem found. */
  register(manifest: ModuleManifest): void {
    const problems = this.validate(manifest);
    if (problems.length > 0) {
      throw new Error(`[modules] invalid manifest "${manifest.id}":\n  - ${problems.join('\n  - ')}`);
    }
    const commands = new Map((manifest.contributes.commands ?? []).map((c) => [c.id, c]));
    const workspaces = new Map((manifest.contributes.workspaces ?? []).map((w) => [w.id, w]));
    this.records.set(manifest.id, {
      manifest,
      commands,
      workspaces,
      activation: { status: 'inactive' },
      activationError: null,
      epoch: 0,
    });
    commands.forEach((_, id) => this.commandOwner.set(id, manifest.id));
    workspaces.forEach((_, id) => this.workspaceOwner.set(id, manifest.id));
    manifest.contributes.inspectorModes?.forEach((m) => this.inspectorModeIds.add(m.id));
    manifest.contributes.dockTabs?.forEach((t) => this.dockTabIds.add(t.id));
    manifest.contributes.keybindings?.forEach((b) =>
      this.keybindingScopes.set(keybindingScopeKey(b), `${manifest.id}:${b.command}`),
    );
    for (const items of Object.values(manifest.contributes.menus ?? {})) {
      items?.forEach((item) => this.menuCommands.add(item.command));
    }
    this.refresh(true);
  }

  private validate(m: ModuleManifest): string[] {
    const problems: string[] = [];
    if (!MODULE_ID.test(m.id ?? '')) problems.push(`module id "${m.id}" must match ${MODULE_ID}`);
    if (this.records.has(m.id)) problems.push(`module id "${m.id}" is already registered`);
    if (!m.title) problems.push('title is required');
    if (!m.description) problems.push('description is required');
    if (!m.version) problems.push('version is required');
    if (!STAGES.includes(m.stage)) problems.push(`unknown stage "${m.stage}"`);
    if (!m.hosts?.length || m.hosts.some((h) => !HOSTS.includes(h))) {
      problems.push(`hosts must be a non-empty subset of ${HOSTS.join(', ')}`);
    }
    if (typeof m.activate !== 'function') problems.push('activate must be a dynamic import');
    const c = m.contributes ?? {};
    const stable = m.stage === 'stable';

    const seen = new Set<string>();
    const checkId = (kind: string, id: string, taken: (id: string) => boolean, legacy = false) => {
      if (legacy) {
        if (!LEGACY_ID.test(id)) problems.push(`${kind} legacy id "${id}" must match ${LEGACY_ID}`);
      } else if (!namespaced(m.id, id)) {
        problems.push(`${kind} id "${id}" must be namespaced as "${m.id}.<name>"`);
      }
      const key = `${kind}:${id}`;
      if (seen.has(key) || taken(id)) problems.push(`${kind} id "${id}" is already registered`);
      seen.add(key);
    };

    const commandTitles = new Map<string, string>();
    for (const command of c.commands ?? []) {
      checkId('command', command.id, (id) => this.commandOwner.has(id));
      if (!command.title) problems.push(`command "${command.id}" needs a title`);
      commandTitles.set(command.id, command.title);
    }
    for (const workspace of c.workspaces ?? []) {
      checkId('workspace', workspace.id, (id) => this.workspaceOwner.has(id) || this.reservedWorkspaceTypes.has(id), workspace.legacyId);
      if (!workspace.title || !workspace.label) problems.push(`workspace "${workspace.id}" needs a title and a label`);
      if (typeof workspace.component !== 'function') problems.push(`workspace "${workspace.id}" needs a lazy component`);
      if (!stable && (workspace.pinned || workspace.openAtStartup)) {
        problems.push(`workspace "${workspace.id}": only stable modules may propose top-bar or startup defaults`);
      }
    }
    for (const mode of c.inspectorModes ?? []) {
      checkId('inspector mode', mode.id, (id) => this.inspectorModeIds.has(id));
    }
    for (const tab of c.dockTabs ?? []) {
      checkId('dock tab', tab.id, (id) => this.dockTabIds.has(id));
    }
    const scopes = new Set<string>();
    for (const binding of c.keybindings ?? []) {
      problems.push(...keybindingProblems({ moduleId: m.id, stage: m.stage, commands: commandTitles }, binding));
      const scope = keybindingScopeKey(binding);
      const other = this.keybindingScopes.get(scope);
      if (scopes.has(scope) || other) {
        problems.push(`keybinding for "${binding.command}" conflicts with ${other ?? 'another binding of this module'} in the same scope`);
      }
      scopes.add(scope);
    }
    // The native menu model must pass src-tauri's plan_module_menu_items, which
    // rejects the whole model (every module's items) on one bad item.
    const menuCommands = new Set<string>();
    for (const [path, items] of Object.entries(c.menus ?? {})) {
      if (!MENU_PATHS.includes(path as MenuPath)) problems.push(`unknown menu path "${path}"`);
      for (const item of items ?? []) {
        if (!commandTitles.has(item.command)) problems.push(`menu item names undeclared command "${item.command}"`);
        if (menuCommands.has(item.command) || this.menuCommands.has(item.command)) {
          problems.push(`menu item "${item.command}" is listed twice`);
        }
        menuCommands.add(item.command);
        const label = item.title ?? commandTitles.get(item.command) ?? '';
        if (!menuLabelOk(label)) {
          problems.push(`menu item "${item.command}" needs a label of 1-${MAX_MENU_LABEL} printable characters`);
        }
      }
    }
    if (this.menuCommands.size + menuCommands.size > MAX_MODULE_MENU_ITEMS) {
      problems.push(`at most ${MAX_MODULE_MENU_ITEMS} module menu items are allowed`);
    }
    return problems;
  }

  // ── enabled state ────────────────────────────────────────────────────────

  /** Whether the module can run in this host (`hosts`, `requires`). */
  isSupported(moduleId: string): boolean {
    const record = this.records.get(moduleId);
    if (!record) return false;
    const { hosts, requires } = record.manifest;
    if (!hosts.includes(this.deps.host())) return false;
    const caps = this.deps.capabilities();
    return (requires?.hostCapabilities ?? []).every((cap) => caps[cap] !== false);
  }

  /** The user's switch, or the stage default; ignores host support. */
  isSwitchedOn(moduleId: string): boolean {
    const record = this.records.get(moduleId);
    if (!record) return false;
    return this.deps.overrides()[moduleId] ?? stageDefaultEnabled(record.manifest.stage);
  }

  isEnabled(moduleId: string): boolean {
    return this.enabledIds.has(moduleId);
  }

  private computeEnabled(): Set<string> {
    const ids = new Set<string>();
    for (const id of this.records.keys()) {
      if (this.isSupported(id) && this.isSwitchedOn(id)) ids.add(id);
    }
    return ids;
  }

  /** Recompute the enabled set; notify and tear down when it changed. */
  refresh(force = false): void {
    const next = this.computeEnabled();
    const prev = this.enabledIds;
    const enabled = [...next].filter((id) => !prev.has(id));
    const disabled = [...prev].filter((id) => !next.has(id));
    if (!force && enabled.length === 0 && disabled.length === 0) return;
    this.enabledIds = next;
    this.version += 1;
    this.cache = new Map();
    disabled.forEach((id) => this.deactivate(id));
    if (enabled.length > 0 || disabled.length > 0) {
      const change = { enabled, disabled };
      this.enabledListeners.forEach((listener) => listener(change));
    }
    this.listeners.forEach((listener) => listener());
  }

  /** React subscription (useSyncExternalStore). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  /** Modules switched on or off (after their contributions changed). */
  onEnabledChange(listener: (change: EnabledChange) => void): () => void {
    this.enabledListeners.add(listener);
    return () => this.enabledListeners.delete(listener);
  }

  /** Re-render subscribers without changing contributions (activation state). */
  private notify(): void {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  private memo<T>(key: string, compute: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, compute());
    return this.cache.get(key) as T;
  }

  // ── queries ──────────────────────────────────────────────────────────────

  /** Every registered manifest (Settings › Modules), in registration order. */
  getModules(): readonly ModuleManifest[] {
    return this.memo('modules', () => [...this.records.values()].map((r) => r.manifest));
  }

  getModule(moduleId: string): ModuleManifest | undefined {
    return this.records.get(moduleId)?.manifest;
  }

  private toolOf(moduleId: string, w: WorkspaceContribution): ModuleToolDescriptor {
    return {
      type: w.id,
      label: w.label,
      shortLabel: w.shortLabel ?? w.label,
      title: w.title,
      moduleId,
      stage: this.records.get(moduleId)!.manifest.stage,
      bottomDock: w.bottomDock ?? false,
      component: w.component,
      inspector: w.inspector,
    };
  }

  /** Core tools, then the tools of enabled modules, in menu order. */
  getTools(): readonly ToolDescriptor[] {
    return this.memo('tools', () => {
      const tools: ToolDescriptor[] = [...CORE_TOOLS];
      for (const record of this.records.values()) {
        if (!this.isEnabled(record.manifest.id)) continue;
        record.workspaces.forEach((w) => tools.push(this.toolOf(record.manifest.id, w)));
      }
      return tools;
    });
  }

  /** A tool type, whether or not its module is enabled. */
  getToolDescriptor(type: string | null | undefined): ToolDescriptor | undefined {
    if (!type) return undefined;
    const core = CORE_TOOLS.find((t) => t.type === type);
    if (core) return core;
    const moduleId = this.workspaceOwner.get(type);
    if (!moduleId) return undefined;
    return this.memo(`tool:${type}`, () =>
      this.toolOf(moduleId, this.records.get(moduleId)!.workspaces.get(type)!),
    );
  }

  /** A module tool tab with its components, whether or not the module is enabled. */
  getModuleTool(type: string | null | undefined): ModuleToolDescriptor | undefined {
    const tool = this.getToolDescriptor(type);
    return tool?.moduleId ? (tool as ModuleToolDescriptor) : undefined;
  }

  /** The module that owns a workspace type, or null (core or unknown). */
  workspaceModule(type: string | null | undefined): string | null {
    return (type && this.workspaceOwner.get(type)) || null;
  }

  /** True for a core tool or the tool of an enabled module. */
  isToolAvailable(type: string | null | undefined): boolean {
    const tool = this.getToolDescriptor(type);
    return Boolean(tool && (tool.moduleId === null || this.isEnabled(tool.moduleId)));
  }

  getCommands(): readonly RegisteredCommand[] {
    return this.memo('commands', () => {
      const commands: RegisteredCommand[] = [];
      for (const record of this.records.values()) {
        if (!this.isEnabled(record.manifest.id)) continue;
        record.commands.forEach((c) => commands.push({ ...c, moduleId: record.manifest.id }));
      }
      return commands;
    });
  }

  getKeybindings(): readonly RegisteredKeybinding[] {
    return this.memo('keybindings', () =>
      [...this.records.values()]
        .filter((r) => this.isEnabled(r.manifest.id))
        .flatMap((r) => (r.manifest.contributes.keybindings ?? []).map((b) => ({ ...b, moduleId: r.manifest.id }))),
    );
  }

  /** The native menu model: items of enabled modules, in registration order. */
  getMenuItems(): readonly ModuleMenuItem[] {
    return this.memo('menus', () => {
      const items: ModuleMenuItem[] = [];
      for (const record of this.records.values()) {
        if (!this.isEnabled(record.manifest.id)) continue;
        for (const path of MENU_PATHS) {
          for (const item of record.manifest.contributes.menus?.[path] ?? []) {
            const label = item.title ?? record.commands.get(item.command)!.title;
            items.push({ command: item.command, label: label.trim(), path });
          }
        }
      }
      return items;
    });
  }

  getInspectorModes(): readonly ModuleInspectorMode[] {
    return this.memo('inspectorModes', () => [
      ...CORE_INSPECTOR_MODES,
      ...[...this.records.values()]
        .filter((r) => this.isEnabled(r.manifest.id))
        .flatMap((r) => (r.manifest.contributes.inspectorModes ?? []).map((m) => ({ ...m, moduleId: r.manifest.id }))),
    ]);
  }

  getDockTabs(): readonly ModuleDockTab[] {
    return this.memo('dockTabs', () => [
      ...CORE_DOCK_TABS,
      ...[...this.records.values()]
        .filter((r) => this.isEnabled(r.manifest.id))
        .flatMap((r) => (r.manifest.contributes.dockTabs ?? []).map((t) => ({ ...t, moduleId: r.manifest.id }))),
    ]);
  }

  /** Manifest proposals for the top bar and startup tabs (stable modules only). */
  getProposals(): { pinned: string[]; openAtStartup: string[] } {
    const pinned: string[] = [];
    const openAtStartup: string[] = [];
    for (const record of this.records.values()) {
      record.workspaces.forEach((w) => {
        if (w.pinned) pinned.push(w.id);
        if (w.openAtStartup) openAtStartup.push(w.id);
      });
    }
    return { pinned, openAtStartup };
  }

  /**
   * Bridge modules to enable (`set_enabled_modules`): those whose UI module is
   * enabled. A bridge module without a UI manifest follows its stage default.
   */
  getEnabledBridgeModules(): string[] {
    return Object.entries(this.deps.bridgeModules)
      .filter(([id, descriptor]) =>
        this.records.has(id) ? this.isEnabled(id) : stageDefaultEnabled(descriptor.stage),
      )
      .map(([id]) => id);
  }

  hasBridgeSection(moduleId: string): boolean {
    return moduleId in this.deps.bridgeModules;
  }

  // ── shell, commands and activation ───────────────────────────────────────

  connectShell(shell: ShellBindings | null): void {
    this.shell = shell;
  }

  matchesWhen(when: WhenClause | undefined): boolean {
    if (!when?.workspace) return true;
    return this.shell?.activeWorkspaceType() === when.workspace;
  }

  /**
   * Run a command: activates its module first. Resolves false when the module
   * is off or the command's `when` does not hold.
   */
  async executeCommand(commandId: string): Promise<boolean> {
    const moduleId = this.commandOwner.get(commandId);
    if (!moduleId) throw new Error(`[modules] unknown command "${commandId}"`);
    if (!this.isEnabled(moduleId)) return false;
    const record = this.records.get(moduleId)!;
    if (!this.matchesWhen(record.commands.get(commandId)?.when)) return false;
    const active = await this.ensureActive(moduleId);
    const handler = active.handlers.get(commandId);
    if (!handler) throw new Error(`[modules] ${moduleId} registered no handler for "${commandId}"`);
    await handler();
    return true;
  }

  isActive(moduleId: string): boolean {
    return this.records.get(moduleId)?.activation.status === 'active';
  }

  /** The error of the module's last failed activation, or null. */
  activationError(moduleId: string): unknown {
    return this.records.get(moduleId)?.activationError ?? null;
  }

  /** Load the module's code and run `activate(ctx)` once. */
  ensureActive(moduleId: string): Promise<ActiveModule> {
    const record = this.records.get(moduleId);
    if (!record) return Promise.reject(new Error(`[modules] unknown module "${moduleId}"`));
    if (!this.isEnabled(moduleId)) return Promise.reject(new ModuleDisabledError(moduleId));
    const { activation } = record;
    if (activation.status === 'active') return Promise.resolve(activation.active);
    if (activation.status === 'activating') return activation.promise;

    const epoch = record.epoch;
    const active: ActiveModule = { handlers: new Map(), disposables: new DisposableSet() };
    const stale = () => record.epoch !== epoch;
    const promise = (async () => {
      await this.shell?.beforeActivate?.(moduleId);
      if (stale()) throw new ModuleDisabledError(moduleId);
      const loaded = await record.manifest.activate();
      if (stale()) throw new ModuleDisabledError(moduleId);
      try {
        await loaded.activate(createModuleContext(this.contextHost(record), active.disposables, active.handlers));
      } catch (error) {
        active.disposables.dispose();
        throw error;
      }
      // Switched off while activate() ran: undo what it registered.
      if (stale()) {
        active.disposables.dispose();
        throw new ModuleDisabledError(moduleId);
      }
      record.activation = { status: 'active', active };
      record.activationError = null;
      this.notify();
      return active;
    })();
    record.activation = { status: 'activating', promise, active };
    promise.catch((error) => {
      if (record.activation.status === 'activating' && record.activation.promise === promise) {
        record.activation = { status: 'inactive' };
      }
      // A stale activation (the module was switched off meanwhile) reports
      // nothing: a newer activation may already have succeeded.
      if (stale() || error instanceof ModuleDisabledError) return;
      console.error(`[modules] activating ${moduleId} failed:`, error);
      record.activationError = error;
      this.notify();
    });
    return promise;
  }

  /**
   * Dispose everything the module's context registered, including what an
   * activation still in flight has registered so far (its later
   * registrations are undone as they are made).
   */
  deactivate(moduleId: string): void {
    const record = this.records.get(moduleId);
    if (!record) return;
    record.epoch += 1;
    record.activationError = null;
    const { activation } = record;
    record.activation = { status: 'inactive' };
    if (activation.status !== 'inactive') activation.active.disposables.dispose();
  }

  /** What a module's context (and its keybindings) may know about it. */
  contextHostFor(moduleId: string): ContextHost | undefined {
    const record = this.records.get(moduleId);
    return record ? this.contextHost(record) : undefined;
  }

  private contextHost(record: ModuleRecord): ContextHost {
    const { manifest } = record;
    return {
      moduleId: manifest.id,
      moduleTitle: manifest.title,
      stage: manifest.stage,
      commands: new Map([...record.commands].map(([id, c]) => [id, c.title])),
      workspaces: new Set(record.workspaces.keys()),
      isEnabled: () => this.isEnabled(manifest.id),
      matchesWhen: (when) => this.matchesWhen(when),
      executeCommand: (id) => this.executeCommand(id),
      openWorkspace: (type) => this.shell?.openWorkspace(type) ?? Promise.resolve(null),
    };
  }
}

function defaultDeps(): RegistryDeps {
  return {
    overrides: () => useModuleSettingsStore.getState().enabled,
    subscribeOverrides: (listener) =>
      useModuleSettingsStore.subscribe((state, prev) => {
        if (state.enabled !== prev.enabled) listener();
      }),
    host: currentModuleHost,
    capabilities: currentHostCapabilities,
    bridgeModules: BRIDGE_MODULES,
  };
}

/** The app's registry, filled with the first-party modules at import. */
export const moduleRegistry = new ModuleRegistry(defaultDeps());
for (const manifest of FIRST_PARTY_MODULES) moduleRegistry.register(manifest);

/** Re-render when modules are switched on or off. */
export function useModuleRegistryVersion(): number {
  return useSyncExternalStore(moduleRegistry.subscribe, moduleRegistry.getVersion, moduleRegistry.getVersion);
}

/** Core tools and the tools of enabled modules (stable reference per change). */
export function useTools(): readonly ToolDescriptor[] {
  useModuleRegistryVersion();
  return moduleRegistry.getTools();
}

/** Commands of enabled modules (stable reference per change). */
export function useModuleCommands(): readonly RegisteredCommand[] {
  useModuleRegistryVersion();
  return moduleRegistry.getCommands();
}
