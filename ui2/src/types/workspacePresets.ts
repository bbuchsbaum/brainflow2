import type { WorkspaceConfig, WorkspaceType } from '@/types/workspace';

export type WorkspacePresetId = 'read' | 'explore' | 'analyze' | 'compare' | 'studio';

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
    id: 'read',
    label: 'Read',
    description: 'Locked orthogonal slices for focused image reading.',
    workspaceType: 'orthogonal-locked',
    shortcut: 'Cmd/Ctrl+1',
  },
  {
    id: 'explore',
    label: 'Explore',
    description: 'Linked orthogonal panels for interactive navigation.',
    workspaceType: 'orthogonal-flexible',
    shortcut: 'Cmd/Ctrl+2',
  },
  {
    id: 'analyze',
    label: 'Analyze',
    description: 'Mosaic slice grid for broad spatial inspection.',
    workspaceType: 'mosaic',
    workspaceConfig: {
      rows: 3,
      columns: 3,
      sliceOrientation: 'axial',
    },
    shortcut: 'Cmd/Ctrl+3',
  },
  {
    id: 'compare',
    label: 'Compare',
    description: 'Side-by-side panels for comparing layers independently.',
    workspaceType: 'comparison',
    shortcut: 'Cmd/Ctrl+4',
  },
  {
    id: 'studio',
    label: 'Set Studio',
    description: 'Design-aware field-table workspace for cohort browsing and comparison.',
    workspaceType: 'set-studio',
    shortcut: 'Cmd/Ctrl+5',
  },
];

export const WORKSPACE_PRESET_BY_ID: Record<WorkspacePresetId, WorkspacePreset> = {
  read: WORKSPACE_PRESETS[0],
  explore: WORKSPACE_PRESETS[1],
  analyze: WORKSPACE_PRESETS[2],
  compare: WORKSPACE_PRESETS[3],
  studio: WORKSPACE_PRESETS[4],
};

export function getWorkspacePresetById(id: WorkspacePresetId): WorkspacePreset {
  return WORKSPACE_PRESET_BY_ID[id];
}
