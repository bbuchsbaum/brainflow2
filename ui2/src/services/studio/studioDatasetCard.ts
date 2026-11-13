import { getDatasetCardService } from '@/services/DatasetCardService';
import { getLayoutService } from '@/services/layoutService';
import { findOwningRoot } from '@/stores/fileBrowserSearch';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import type { SpatialFieldSetSummary } from '@/types/studio';

/** Where the dataset card of a set's source folder opens from, or why it cannot. */
export type StudioDatasetCardTarget =
  | { available: true; rootPath: string; path: string }
  | { available: false; reason: string };

export const NO_SOURCE_FOLDER = 'This set was not opened from a folder.';
export const FOLDER_NOT_BROWSED =
  'Its folder is not open in the Files panel (the connection may not be active).';

/**
 * The card describes a folder under a root the Files panel is browsing. A set
 * opened from a folder remembers that folder; a set imported from a table or
 * a manifest has none, and a folder whose mount has gone has no root.
 */
export function studioDatasetCardTarget(
  set: Pick<SpatialFieldSetSummary, 'discoveryRequest'> | null | undefined,
  roots: readonly { path: string }[],
): StudioDatasetCardTarget {
  const path = set?.discoveryRequest?.root?.trim();
  if (!path) return { available: false, reason: NO_SOURCE_FOLDER };
  const root = findOwningRoot(roots, path);
  if (!root) return { available: false, reason: FOLDER_NOT_BROWSED };
  return { available: true, rootPath: root.path, path };
}

/**
 * Open the card of the set's source folder. The one card host lives in the
 * Files panel and shows its card beside that panel, so the panel is brought
 * to the front first; focus returns to `returnFocus` when the card closes.
 */
export function openStudioDatasetCard(
  set: Pick<SpatialFieldSetSummary, 'discoveryRequest'> | null | undefined,
  returnFocus?: HTMLElement | null,
): StudioDatasetCardTarget {
  const target = studioDatasetCardTarget(set, useFileBrowserStore.getState().entries);
  if (!target.available) return target;
  getLayoutService().showPanel('FileBrowser');
  getDatasetCardService().openDatasetCard({
    rootPath: target.rootPath,
    path: target.path,
    returnFocus: returnFocus ?? null,
  });
  return target;
}
