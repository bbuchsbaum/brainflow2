import type { WorkspaceConfig, WorkspaceType } from '@/types/workspace';

/**
 * Named launches for tool workspaces. The former view presets (Read, Explore,
 * Analyze, Compare) were retired on 2026-10-30: layouts now apply to the
 * current tab (pills, ⌘1–⌘4), so a preset that opened a separate tab in a
 * layout duplicated the pills under other names
 * (docs/plans/qa-design-decisions-2026-10-30.md §1).
 */
export type WorkspacePresetId = 'studio' | 'bids';

/** Named launches, plus marks a service puts on a tab it owns. */
export type WorkspaceOriginId = WorkspacePresetId | 'bids-run-viewer';

export interface WorkspacePreset {
  id: WorkspacePresetId;
  label: string;
  description: string;
  workspaceType: WorkspaceType;
  workspaceConfig?: WorkspaceConfig;
  shortcut: string;
}

export const WORKSPACE_PRESETS: WorkspacePreset[] = [
  {
    id: 'studio',
    label: 'Set studio',
    description: 'Design-aware field-table workspace for cohort browsing and comparison.',
    workspaceType: 'set-studio',
    shortcut: 'Cmd/Ctrl+5',
  },
  {
    id: 'bids',
    label: 'BIDS',
    description: 'Explore BIDS datasets.',
    workspaceType: 'bids-explorer',
    shortcut: 'Cmd/Ctrl+6',
  },
];

export const WORKSPACE_PRESET_BY_ID: Record<WorkspacePresetId, WorkspacePreset> = {
  studio: WORKSPACE_PRESETS[0],
  bids: WORKSPACE_PRESETS[1],
};

export function getWorkspacePresetById(id: WorkspacePresetId): WorkspacePreset {
  return WORKSPACE_PRESET_BY_ID[id];
}
