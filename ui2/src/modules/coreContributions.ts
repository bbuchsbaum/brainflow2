/**
 * Core entries of the shell's registries. They are not modules: they cannot
 * be switched off, and their components stay where they are (the router and
 * the Inspector render them directly). Registering them here lets the Tools
 * list, the top-bar pins, startup tabs, the Inspector modes and the dock tabs
 * treat core and module entries the same way.
 */

import { DOCK_TABS } from '@/components/layout/bottomWorkbenchDock.constants';
import type { ModuleStage } from './api';

/** A tool tab type the shell knows how to open (core or module). */
export interface ToolDescriptor {
  /** The workspace type of the tab. */
  type: string;
  /** Label in the Workspace menu, the Tools list and Settings › Top bar. */
  label: string;
  /** Label of the top-bar pin and the "In <tool>" pill. */
  shortLabel: string;
  /** Tab title. */
  title: string;
  /** Cmd/Ctrl+<digit> owned by the native menu (core tools only). */
  shortcutKey?: string;
  /** Owning module, or null for a core tool. */
  moduleId: string | null;
  /** Stage of the owning module (lists label preview tools); null for core. */
  stage: ModuleStage | null;
}

/** Set studio and BIDS, in menu order. ⌘5 / ⌘6 open them. */
export const CORE_TOOLS: readonly ToolDescriptor[] = [
  {
    type: 'set-studio',
    label: 'Set studio',
    shortLabel: 'Studio',
    title: 'Set studio',
    shortcutKey: '5',
    moduleId: null,
    stage: null,
  },
  {
    type: 'bids-explorer',
    label: 'BIDS',
    shortLabel: 'BIDS',
    title: 'BIDS Explorer',
    shortcutKey: '6',
    moduleId: null,
    stage: null,
  },
];

/** An Inspector mode (the `Inspect | Annotate` tabs). */
export interface InspectorModeDescriptor {
  id: string;
  title: string;
  /** Shown only with Settings › Experimental features on. */
  experimental?: boolean;
  tabTitle?: string;
  moduleId: string | null;
}

export const CORE_INSPECTOR_MODES: readonly InspectorModeDescriptor[] = [
  { id: 'inspector', title: 'Inspect', moduleId: null },
  {
    id: 'annotate',
    title: 'Annotate',
    tabTitle: 'Toggle annotate mode',
    experimental: true,
    moduleId: null,
  },
];

/** A bottom-dock tab. */
export interface DockTabDescriptor {
  id: string;
  title: string;
  moduleId: string | null;
}

/** Activity | Plot | Clusters | Log (Design.md §11.1, P3.5). */
export const CORE_DOCK_TABS: readonly DockTabDescriptor[] = DOCK_TABS.map(({ id, label }) => ({
  id,
  title: label,
  moduleId: null,
}));
