import { useWorkspaceStore } from '@/stores/workspaceStore';
import { isCoreWorkspaceType } from '@/services/workspaceTypes';
import { moduleRegistry, useModuleRegistryVersion } from '@/modules/registry';
import type { CoreWorkspaceType, WorkspaceType } from '@/types/workspace';

export type DisplayMode =
  | 'orthogonal'
  | 'surface'
  | 'integrated'
  | 'mosaic'
  | 'compare'
  | 'set-studio'
  | 'bids'
  | 'analysis'
  /** The tool tab of a module (its Inspector body comes from the registry). */
  | 'module-tool'
  | 'unknown';

export interface DisplayModeInfo {
  mode: DisplayMode;
  /** Human-facing label, e.g. used in `Active view: <label>` subtitle. */
  label: string;
  /** Underlying workspace type (or null when no workspace is active). */
  workspaceType: WorkspaceType | null;
}

const WORKSPACE_TYPE_TO_MODE: Record<CoreWorkspaceType, DisplayMode> = {
  'orthogonal-locked': 'orthogonal',
  'orthogonal-flexible': 'orthogonal',
  mosaic: 'mosaic',
  comparison: 'compare',
  integrated: 'integrated',
  'set-studio': 'set-studio',
  'bids-explorer': 'bids',
  'analysis-workbench': 'analysis',
};

const MODE_LABELS: Record<Exclude<DisplayMode, 'module-tool'>, string> = {
  orthogonal: 'Orthogonal',
  surface: 'Surface',
  integrated: 'Integrated',
  mosaic: 'Mosaic',
  compare: 'Compare',
  'set-studio': 'Set studio',
  bids: 'BIDS',
  analysis: 'Analysis',
  unknown: '—',
};

/** Display mode and label of a workspace type (pure; exported for tests). */
export function displayModeOf(workspaceType: WorkspaceType | null): Omit<DisplayModeInfo, 'workspaceType'> {
  if (!workspaceType) return { mode: 'unknown', label: MODE_LABELS.unknown };
  if (isCoreWorkspaceType(workspaceType)) {
    const mode = WORKSPACE_TYPE_TO_MODE[workspaceType];
    return { mode, label: MODE_LABELS[mode as Exclude<DisplayMode, 'module-tool'>] };
  }
  const tool = moduleRegistry.getModuleTool(workspaceType);
  return tool
    ? { mode: 'module-tool', label: tool.label }
    : { mode: 'unknown', label: MODE_LABELS.unknown };
}

/**
 * Derive the active display mode from the active workspace's type.
 *
 * Used by the right Inspector to pick the correct body (`InspectorRouter`)
 * and to render the `Active view: <label>` subtitle in the header.
 */
export function useDisplayMode(): DisplayModeInfo {
  const workspaceType = useWorkspaceStore((state) => {
    if (!state.activeWorkspaceId) return null;
    return state.workspaces.get(state.activeWorkspaceId)?.type ?? null;
  });
  useModuleRegistryVersion();

  return { ...displayModeOf(workspaceType), workspaceType };
}
