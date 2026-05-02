import type { WorkspaceType } from '@/types/workspace';

export type DisplayMode =
  | 'orthogonal'
  | 'surface'
  | 'integrated'
  | 'mosaic'
  | 'compare';

export interface DisplayModeMetadata {
  id: DisplayMode;
  label: string;
  description: string;
  defaultWorkspaceType: WorkspaceType | null;
  featureFlag?: 'integratedWorkspaceV1';
}

export const DISPLAY_MODES: Record<DisplayMode, DisplayModeMetadata> = {
  orthogonal: {
    id: 'orthogonal',
    label: 'Orthogonal',
    description: 'Volume-focused orthogonal slice display.',
    defaultWorkspaceType: 'orthogonal-locked',
  },
  surface: {
    id: 'surface',
    label: 'Surface',
    description: 'Surface-focused display.',
    defaultWorkspaceType: null,
  },
  integrated: {
    id: 'integrated',
    label: 'Integrated',
    description: 'Orthogonal slices plus surface context and bottom dock.',
    defaultWorkspaceType: 'integrated',
    featureFlag: 'integratedWorkspaceV1',
  },
  mosaic: {
    id: 'mosaic',
    label: 'Mosaic',
    description: 'Tiled slice display.',
    defaultWorkspaceType: 'mosaic',
  },
  compare: {
    id: 'compare',
    label: 'Compare',
    description: 'Comparison-oriented display.',
    defaultWorkspaceType: 'comparison',
  },
};

export const DISPLAY_MODE_LIST: readonly DisplayModeMetadata[] = [
  DISPLAY_MODES.orthogonal,
  DISPLAY_MODES.surface,
  DISPLAY_MODES.integrated,
  DISPLAY_MODES.mosaic,
  DISPLAY_MODES.compare,
];

export function getDisplayMode(id: DisplayMode): DisplayModeMetadata {
  return DISPLAY_MODES[id];
}
