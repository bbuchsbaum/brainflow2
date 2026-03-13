/**
 * Typed load intent layer.
 *
 * Separates WHAT is being dragged/opened from HOW the target should handle it.
 */

/** What the user is dragging or opening */
export interface DraggedResource {
  kind: 'filesystem-file' | 'loaded-layer';
  /** Absolute file path (for filesystem-file) */
  path?: string;
  /** File extension, e.g. '.nii.gz' */
  extension?: string;
  /** Layer ID (for loaded-layer) */
  layerId?: string;
}

/** How the drop target / action should handle the resource */
export type DisplayOpenIntent =
  | 'default'          // Let the orchestrator decide (current behavior)
  | 'add-layer'        // Add as overlay to the current layer stack
  | 'new-workspace'    // Open in a new workspace tab
  | 'comparison';      // Open side-by-side in comparison workspace

export interface DisplayOpenIntentEvent {
  path: string;
  intent?: DisplayOpenIntent;
}

export function resolveDropOpenIntent(modifiers: {
  altKey?: boolean;
  shiftKey?: boolean;
}): DisplayOpenIntent {
  if (modifiers.shiftKey) {
    return 'comparison';
  }

  if (modifiers.altKey) {
    return 'new-workspace';
  }

  return 'add-layer';
}
