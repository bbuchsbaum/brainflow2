/**
 * Pure helpers for `DisplayModeSelector` (Phase 7 of the integrated workspace
 * refactor). Lives in its own file so the React component file can satisfy the
 * `react-refresh/only-export-components` invariant and so the click-resolution
 * logic can be unit-tested without rendering.
 */

import { DISPLAY_MODES, type DisplayMode } from '@/types/displayModes';
import type { WorkspaceType } from '@/types/workspace';

/**
 * Reverse map from `WorkspaceType` to the display mode it satisfies.
 *
 * Multiple workspace types may resolve to the same display mode (e.g. both
 * `orthogonal-locked` and `orthogonal-flexible` belong to `'orthogonal'`).
 * Workspaces with no display-mode pill (`set-studio`, `bids-explorer`,
 * `analysis-workbench`) are intentionally absent — they are reached through
 * the command palette / preset selector, not the mode pills.
 */
export const WORKSPACE_TYPE_TO_DISPLAY_MODE: Readonly<Partial<Record<WorkspaceType, DisplayMode>>> = {
  'orthogonal-locked': 'orthogonal',
  'orthogonal-flexible': 'orthogonal',
  mosaic: 'mosaic',
  comparison: 'compare',
  integrated: 'integrated',
};

/** Returns the display mode that the given workspace type belongs to, or `null`. */
export function resolveActiveDisplayMode(workspaceType: WorkspaceType | null | undefined): DisplayMode | null {
  if (!workspaceType) return null;
  return WORKSPACE_TYPE_TO_DISPLAY_MODE[workspaceType] ?? null;
}

/**
 * The display modes shown as selector pills, in render order. Surface stays
 * in the list so the UI matches the mockup, but its `defaultWorkspaceType`
 * is `null` — `DisplayModeSelector` renders it as disabled until a Surface
 * workspace type is added.
 */
export const DISPLAY_MODE_PILL_ORDER: readonly DisplayMode[] = [
  'orthogonal',
  'surface',
  'integrated',
  'mosaic',
  'compare',
];

/** Returns the metadata entries in pill render order. */
export function getDisplayModePillMetadata() {
  return DISPLAY_MODE_PILL_ORDER.map((id) => DISPLAY_MODES[id]);
}
