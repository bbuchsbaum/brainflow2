/**
 * Comparison View Types
 * Defines types for multi-panel side-by-side comparison workspace
 */

export type ComparisonLayout = 'row' | 'grid';

export interface ComparisonPanelConfig {
  id: string;                       // e.g., "compare-panel-0"
  label: string;                    // User-visible name
  visibleLayerIds: Set<string>;     // Which layers this panel shows
  viewType: 'axial' | 'sagittal' | 'coronal';
}

export interface ComparisonWorkspaceConfig {
  panels: ComparisonPanelConfig[];
  layout: ComparisonLayout;
  globalViewType: 'axial' | 'sagittal' | 'coronal';
}
