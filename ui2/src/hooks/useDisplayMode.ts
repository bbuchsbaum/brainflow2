import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { WorkspaceType } from '@/types/workspace';

export type DisplayMode =
  | 'orthogonal'
  | 'surface'
  | 'integrated'
  | 'mosaic'
  | 'compare'
  | 'set-studio'
  | 'bids'
  | 'analysis'
  | 'unknown';

export interface DisplayModeInfo {
  mode: DisplayMode;
  /** Human-facing label, e.g. used in `Active view: <label>` subtitle. */
  label: string;
  /** Underlying workspace type (or null when no workspace is active). */
  workspaceType: WorkspaceType | null;
}

const WORKSPACE_TYPE_TO_MODE: Record<WorkspaceType, DisplayMode> = {
  'orthogonal-locked': 'orthogonal',
  'orthogonal-flexible': 'orthogonal',
  mosaic: 'mosaic',
  comparison: 'compare',
  integrated: 'integrated',
  'set-studio': 'set-studio',
  'bids-explorer': 'bids',
  'analysis-workbench': 'analysis',
};

const MODE_LABELS: Record<DisplayMode, string> = {
  orthogonal: 'Orthogonal',
  surface: 'Surface',
  integrated: 'Integrated',
  mosaic: 'Mosaic',
  compare: 'Compare',
  'set-studio': 'Set Studio',
  bids: 'BIDS',
  analysis: 'Analysis',
  unknown: '—',
};

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

  const mode: DisplayMode = workspaceType
    ? WORKSPACE_TYPE_TO_MODE[workspaceType]
    : 'unknown';

  return {
    mode,
    label: MODE_LABELS[mode],
    workspaceType,
  };
}
