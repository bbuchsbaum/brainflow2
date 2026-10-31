/**
 * The module API: manifest, contribution and context types
 * (docs/plans/module-architecture.md, "Anatomy of a module").
 *
 * A manifest is static data. The shell reads it before the module's code
 * loads (menus, palette, shortcuts, Settings › Modules, tab restore), and
 * `activate` is a dynamic import that runs on first use.
 */

import type { ComponentType } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { ModuleStage } from '@brainflow/api';

export type { ModuleStage };

/** Where the app runs: the Tauri desktop shell or the browser viewer. */
export type ModuleHostKind = 'desktop' | 'browser';

/** Host capabilities a module may require (`getHostCapabilities()`). */
export type HostCapability = 'nativePaths' | 'remoteMounts' | 'externalProcesses';

/** A lazily loaded component, e.g. `() => import('./X').then((m) => ({ default: m.X }))`. */
export type LazyComponent<P = object> = () => Promise<{ default: ComponentType<P> }>;

/** When a contribution applies. An omitted field always matches. */
export interface WhenClause {
  /** The type of the active workspace tab, e.g. `'analysis-workbench'`. */
  workspace?: string;
}

/** A command: shown in the command palette, the target of menus and keybindings. */
export interface CommandContribution {
  /** `<module>.<name>`. */
  id: string;
  title: string;
  subtitle?: string;
  /** Command palette group. */
  group?: string;
  keywords?: readonly string[];
  when?: WhenClause;
}

export interface KeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  alt?: boolean;
}

/**
 * A shortcut for one of the module's commands (KeyboardShortcutService). Only
 * stable modules may bind global keys; other stages must scope the binding
 * with `when`.
 */
export interface KeybindingContribution {
  command: string;
  key: string;
  modifiers?: KeyModifiers;
  when?: WhenClause;
  /** Also fire while a text field has focus. */
  allowInInputs?: boolean;
}

/** Native menu locations a module can add items to. */
export type MenuPath = 'view/workspace';

/** A native menu item that runs one of the module's commands. */
export interface MenuItemContribution {
  command: string;
  /** Menu label; defaults to the command title. */
  title?: string;
}

export interface WorkspaceComponentProps {
  workspaceId: string;
}

/**
 * A tool tab. Tools open once and are refocused when opened again; the tab's
 * type is the contribution id.
 */
export interface WorkspaceContribution {
  /** `<module>.<name>`, or a persisted unnamespaced id with `legacyId: true`. */
  id: string;
  /**
   * The id predates modules and is stored in saved workspaces
   * (`brainflow2-workspace`), so it keeps its unnamespaced form.
   */
  legacyId?: boolean;
  /** Tab title, e.g. "Analysis Workbench". */
  title: string;
  /** Label in the Workspace menu, the Tools list and Settings › Top bar. */
  label: string;
  /** Label of the top-bar pin and the "In <tool>" pill; defaults to `label`. */
  shortLabel?: string;
  /** Wrap the tab in the shared bottom dock (Activity, Plot, Clusters, Log). */
  bottomDock?: boolean;
  component: LazyComponent<WorkspaceComponentProps>;
  /** Inspector body while the tab is in front. */
  inspector?: LazyComponent;
  /** Proposed default: pin the tool in the top bar (stable modules only). */
  pinned?: boolean;
  /** Proposed default: open at startup when tabs are fixed (stable modules only). */
  openAtStartup?: boolean;
}

/** A top-level Inspector mode, beside Inspect. */
export interface InspectorModeContribution {
  id: string;
  title: string;
  component: LazyComponent;
}

/** A bottom-dock tab, after the core tabs. */
export interface DockTabContribution {
  id: string;
  title: string;
  component: LazyComponent;
}

export interface ModuleContributions {
  commands?: readonly CommandContribution[];
  keybindings?: readonly KeybindingContribution[];
  menus?: Partial<Record<MenuPath, readonly MenuItemContribution[]>>;
  workspaces?: readonly WorkspaceContribution[];
  inspectorModes?: readonly InspectorModeContribution[];
  dockTabs?: readonly DockTabContribution[];
}

export interface ModuleManifest {
  /** Lowercase id, e.g. `analysis`. A bridge module of the same id is switched with it. */
  id: string;
  title: string;
  /** One sentence for Settings › Modules. */
  description: string;
  version: string;
  stage: ModuleStage;
  hosts: readonly ModuleHostKind[];
  requires?: { hostCapabilities?: readonly HostCapability[] };
  contributes: ModuleContributions;
  /** Loaded on first use: `() => import('./activate')`. */
  activate: () => Promise<ModuleActivation>;
}

export interface ModuleActivation {
  activate(ctx: ModuleContext): void | Promise<void>;
}

/** Undo a registration. Calling it twice is harmless. */
export type DisposeFn = () => void;

export type CommandHandler = () => void | Promise<void>;

export interface AppStateOptions<T> {
  version: number;
  initial: T;
  /** Turn a payload written at an older `version` into the current shape. */
  migrate?: (persisted: unknown, version: number) => T;
}

export type ModuleAppStore<T> = UseBoundStore<StoreApi<T>>;

/**
 * Everything `activate(ctx)` may use. Registrations made through it are
 * disposed when the module is switched off.
 */
export interface ModuleContext {
  readonly moduleId: string;
  readonly commands: {
    /** Handle a command the manifest declares. */
    register(id: string, handler: CommandHandler): DisposeFn;
  };
  readonly keybindings: {
    /** Bind a key to a declared command at runtime (same rules as manifest keybindings). */
    register(binding: KeybindingContribution): DisposeFn;
  };
  readonly events: {
    /** Listen to a native (Tauri) event; unlistened through `safeUnlisten`. */
    listen<T>(event: string, handler: (payload: T) => void): DisposeFn;
  };
  readonly workspaces: {
    /** Open one of the module's tool tabs, or focus it. `null` when it cannot open. */
    open(id: string): Promise<string | null>;
  };
  readonly state: {
    /**
     * A persisted app-wide store, `brainflow-module:<module>:<name>`. The data
     * stays when the module is switched off.
     */
    app<T extends object>(name: string, options: AppStateOptions<T>): ModuleAppStore<T>;
  };
  readonly disposables: {
    /** Run on deactivate, in reverse order of registration. */
    add(dispose: DisposeFn): void;
  };
}
