/**
 * Workspace type lookups for core and module types.
 *
 * `WorkspaceType` is the core ids plus the tool tabs that modules register
 * (`modules/registry.ts`). The core types keep their static tables in
 * `types/workspace.ts`; everything that must also answer for module types
 * (metadata, tab names, restore, routing) asks here.
 */

import {
  CORE_WORKSPACE_TYPES,
  WORKSPACE_METADATA,
  type CoreWorkspaceType,
  type WorkspaceMetadata,
  type WorkspaceType,
} from '@/types/workspace';
import { moduleRegistry } from '@/modules/registry';

const CORE = new Set<string>(CORE_WORKSPACE_TYPES);

export function isCoreWorkspaceType(type: WorkspaceType | null | undefined): type is CoreWorkspaceType {
  return Boolean(type && CORE.has(type));
}

/** A tool tab type (core or module, whether or not its module is on). */
export function isToolWorkspaceType(type: WorkspaceType | null | undefined): boolean {
  return Boolean(moduleRegistry.getToolDescriptor(type));
}

/** A type this build knows: core, or a registered module tool (on or off). */
export function isKnownWorkspaceType(type: WorkspaceType | null | undefined): boolean {
  return isCoreWorkspaceType(type) || isToolWorkspaceType(type);
}

/** A type that can be shown now: core, or the tool of an enabled module. */
export function isWorkspaceTypeAvailable(type: WorkspaceType | null | undefined): boolean {
  if (!type) return false;
  if (isCoreWorkspaceType(type)) return true;
  return moduleRegistry.isToolAvailable(type);
}

/**
 * The module that owns a workspace type (null for core or unknown types). Tabs
 * of a module that is off are parked, not shown.
 */
export function workspaceTypeModule(type: WorkspaceType | null | undefined): string | null {
  return moduleRegistry.workspaceModule(type);
}

export function getWorkspaceMetadata(type: WorkspaceType | null | undefined): WorkspaceMetadata | undefined {
  if (!type) return undefined;
  const tool = moduleRegistry.getToolDescriptor(type);
  if (tool) return { category: 'tool', name: tool.title, singleton: true };
  return isCoreWorkspaceType(type) ? WORKSPACE_METADATA[type] : undefined;
}

/**
 * Base title of a new tab. The view types share a neutral "View" (the mode
 * pills say which layout); tools keep their descriptive name.
 */
export function workspaceBaseName(type: WorkspaceType): string {
  const metadata = getWorkspaceMetadata(type);
  if (!metadata) return type;
  return metadata.category === 'tool' ? metadata.name : 'View';
}
