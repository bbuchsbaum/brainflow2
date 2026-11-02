/**
 * Workspace Types
 * Defines workspace-level view configurations and state management
 */

import type { LayoutConfig } from 'golden-layout';
import type { ViewType } from './coordinates';
import type { WorkspaceOriginId } from './workspacePresets';

/**
 * Categories for organizing workspaces: views take a slice layout; tools open
 * once and are refocused afterwards.
 */
export type WorkspaceCategory = 'visualization' | 'tool';

/**
 * The workspace types the shell itself provides: the views and the core tools.
 */
export const CORE_WORKSPACE_TYPES = [
  'orthogonal-locked',
  'orthogonal-flexible',
  'mosaic',
  'comparison',
  'integrated',
  'set-studio',
  'bids-explorer',
] as const;

export type CoreWorkspaceType = (typeof CORE_WORKSPACE_TYPES)[number];

/**
 * A workspace (tab) type: a core type, or the tool tab of a module registered
 * in `modules/registry.ts` (`<module>.<name>`, or a grandfathered persisted id).
 * Look non-core types up through `services/workspaceTypes.ts`.
 */
export type WorkspaceType = CoreWorkspaceType | (string & {});

/**
 * Represents a complete workspace with its layout and state
 */
export interface Workspace {
  id: string;                    // Unique workspace ID (e.g., 'mosaic-1234567890')
  type: WorkspaceType;          // Type of view configuration
  title: string;                // Display name for tab
  presetId?: WorkspaceOriginId | null; // Optional preset origin for reusable workflows
  timestamp: number;            // Creation timestamp
  /**
   * The label the tab last showed ("Orthogonal 2"). Kept so a tab's name
   * changes only when its own layout does (workspaceTabLabels).
   */
  tabLabel?: string;
  /**
   * The orthogonal variant (locked grid / panels) this tab last used, so ⌘1
   * after a switch to another layout returns to it.
   */
  orthogonalVariant?: WorkspaceType;
  /**
   * Created by the app, not the user: the default view of a cold start or
   * the one that replaces the last closed tab. Until the user changes its
   * layout, restoring only this tab is not a restored session (QA 2026-10-31
   * N4: the first screen never came back).
   */
  defaultView?: boolean;
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
export interface WorkspaceMetadata {
  category: WorkspaceCategory;
  name: string;
  singleton?: boolean;
}

/** Metadata of the core types. Module tools: `getWorkspaceMetadata()`. */
export const WORKSPACE_METADATA: Record<CoreWorkspaceType, WorkspaceMetadata> = {
  'orthogonal-locked': { category: 'visualization', name: 'Orthogonal (Locked)' },
  'orthogonal-flexible': { category: 'visualization', name: 'Orthogonal Panels' },
  'mosaic': { category: 'visualization', name: 'Mosaic View' },
  'comparison': { category: 'visualization', name: 'Comparison View' },
  'integrated': { category: 'visualization', name: 'Integrated Workspace' },
  'set-studio': { category: 'tool', name: 'Set studio', singleton: true },
  'bids-explorer': { category: 'tool', name: 'BIDS Explorer', singleton: true },
};

/**
 * Default configurations for different workspace types
 */
export const DEFAULT_WORKSPACE_CONFIGS: Record<CoreWorkspaceType, Partial<WorkspaceConfig>> = {
  'orthogonal-locked': {},
  'orthogonal-flexible': {},
  'mosaic': {
    rows: 3,
    columns: 3,
    sliceOrientation: 'axial'
  },
  'comparison': {},
  'integrated': {},
  'set-studio': {},
  'bids-explorer': {},
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
