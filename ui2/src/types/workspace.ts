/**
 * Workspace Types
 * Defines workspace-level view configurations and state management
 */

import type { LayoutConfig } from 'golden-layout';
import type { ViewType } from './coordinates';
import type { WorkspacePresetId } from './workspacePresets';

/**
 * Categories for organizing workspaces
 */
export type WorkspaceCategory = 'visualization' | 'analysis' | 'tool';

/**
 * Workspace types represent different view configurations
 */
export type WorkspaceType = 
  | 'orthogonal-locked' 
  | 'orthogonal-flexible' 
  | 'mosaic' 
  | 'lightbox'
  | 'roi-stats'
  | 'coordinate-converter';

/**
 * Represents a complete workspace with its layout and state
 */
export interface Workspace {
  id: string;                    // Unique workspace ID (e.g., 'mosaic-1234567890')
  type: WorkspaceType;          // Type of view configuration
  title: string;                // Display name for tab
  presetId?: WorkspacePresetId | null; // Optional preset origin for reusable workflows
  timestamp: number;            // Creation timestamp
  isActive: boolean;            // Currently visible workspace
  layoutConfig: LayoutConfig;   // Golden Layout configuration
  panelStates: Map<string, PanelState>; // Track individual panel states
}

/**
 * State of an individual panel within a workspace
 */
export interface PanelState {
  id: string;                   // Panel identifier (e.g., 'axial', 'sagittal')
  type: string;                 // Component type
  isVisible: boolean;           // Whether panel is currently shown
  lastPosition?: {              // Last known position for recovery
    type: 'row' | 'column' | 'stack';
    index: number;
    width?: number;
    height?: number;
  };
}

/**
 * Configuration options for creating new workspaces
 */
export interface WorkspaceConfig {
  // Mosaic-specific options
  rows?: number;                // Grid rows (default: 3)
  columns?: number;             // Grid columns (default: 3)
  
  // Common options
  sliceOrientation?: ViewType;  // Which anatomical plane (default: 'axial')
  
  // Lightbox-specific options
  thumbnailSize?: number;       // Size of each thumbnail (default: 128)
  
  // Mosaic navigation options
  sliceRange?: {
    start: number;              // Starting slice index
    end: number;                // Ending slice index
    step: number;               // Step between slices
  };
}

/**
 * Workspace metadata including category
 */
export const WORKSPACE_METADATA: Record<WorkspaceType, { category: WorkspaceCategory; name: string; singleton?: boolean }> = {
  'orthogonal-locked': { category: 'visualization', name: 'Orthogonal (Locked)' },
  'orthogonal-flexible': { category: 'visualization', name: 'Orthogonal (Flexible)' },
  'mosaic': { category: 'visualization', name: 'Mosaic View' },
  'lightbox': { category: 'visualization', name: 'Lightbox View' },
  'roi-stats': { category: 'analysis', name: 'ROI Statistics', singleton: true },
  'coordinate-converter': { category: 'tool', name: 'Coordinate Converter', singleton: true }
};

/**
 * Default configurations for different workspace types
 */
export const DEFAULT_WORKSPACE_CONFIGS: Record<WorkspaceType, Partial<WorkspaceConfig>> = {
  'orthogonal-locked': {},
  'orthogonal-flexible': {},
  'mosaic': {
    rows: 3,
    columns: 3,
    sliceOrientation: 'axial'
  },
  'lightbox': {
    sliceOrientation: 'axial',
    thumbnailSize: 128
  },
  'roi-stats': {},
  'coordinate-converter': {}
};

/**
 * Menu action events from Tauri
 */
export interface MenuActionEvent {
  action: 'new-workspace' | 'close-workspace' | 'recover-panel' | 'switch-workspace';
  payload: {
    type?: WorkspaceType;
    config?: WorkspaceConfig;
    workspaceId?: string;
    panelId?: string;
  };
}

/**
 * Menu state for dynamic menu updates
 */
export interface MenuState {
  activeWorkspaceId: string | null;
  activeWorkspaceType: WorkspaceType | null;
  workspaces: Array<{
    id: string;
    title: string;
    type: WorkspaceType;
  }>;
  recoverablePanels: Array<{
    id: string;
    title: string;
  }>;
}
