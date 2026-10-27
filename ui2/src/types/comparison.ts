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
  /**
   * Per-layer display overrides for this panel (P3.9 Linked Compare), keyed
   * by layer id. Applied only while the workspace's display is unlinked.
   */
  renderOverrides?: Record<string, LayerRenderOverride>;
}

/** Display properties a Compare panel may set for itself. */
export interface LayerRenderOverride {
  intensity?: [number, number];
  threshold?: [number, number];
  colormap?: string;
}

export type PanelOverrideField = keyof LayerRenderOverride;

/**
 * Which display properties the panels share (P3.9, v2 critics): "all"
 * (today's behaviour), only the window, only the threshold, or none. A field
 * that is not shared is set per panel (its override), others are shared.
 */
export type CompareLinkMode = 'all' | 'window' | 'threshold' | 'none';

export const LINKED_FIELDS: Record<CompareLinkMode, readonly PanelOverrideField[]> = {
  all: ['intensity', 'threshold', 'colormap'],
  window: ['intensity'],
  threshold: ['threshold'],
  none: [],
};

export const PANEL_OVERRIDE_FIELDS: readonly PanelOverrideField[] = ['intensity', 'threshold', 'colormap'];

/** Panel letters in grid order: A, B, … Z, then AA, AB … */
export function panelLetter(index: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return index < 26 ? letters[index] : `${letters[Math.floor(index / 26) - 1]}${letters[index % 26]}`;
}

export interface ComparisonWorkspaceConfig {
  panels: ComparisonPanelConfig[];
  layout: ComparisonLayout;
  globalViewType: 'axial' | 'sagittal' | 'coronal';
}
