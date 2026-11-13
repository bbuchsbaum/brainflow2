import { getStudioDisplayService } from '@/services/studio/StudioDisplayService';

/** Why "Open in viewer" is unavailable for a member with no file. */
export const OPEN_IN_VIEWER_NO_SOURCE = 'This member has no source file to open.';
/** Why it is unavailable for a pane whose map has not been made yet. */
export const OPEN_IN_VIEWER_NOT_READY = 'This map has not been computed yet.';

/**
 * Open a Studio file in a new, empty viewer tab ("Orthogonal N") with the
 * Studio's display for it and its background as underlay, and bring that tab
 * to the front (`StudioDisplayService.openInViewerTab`). The file goes
 * through the app's file loader and its loading feedback.
 */
export function openStudioFileInViewer(path: string | null | undefined): boolean {
  const trimmed = path?.trim();
  if (!trimmed) return false;
  void getStudioDisplayService()
    .openInViewerTab(trimmed)
    .catch((error) => console.warn('[Studio] Could not open the file in a viewer tab:', error));
  return true;
}
