/**
 * View Layout Types
 * Defines the different layout modes for orthogonal views
 */

export type ViewLayoutMode = 'locked' | 'flexible';

export interface ViewLayoutState {
  mode: ViewLayoutMode;
  // Future: could add layout-specific settings here
  // e.g., rememberedPositions for flexible mode
}

export const DEFAULT_VIEW_LAYOUT_STATE: ViewLayoutState = {
  mode: 'locked'
};

// Storage key for persisting layout preference
export const VIEW_LAYOUT_STORAGE_KEY = 'brainflow2-view-layout-mode';