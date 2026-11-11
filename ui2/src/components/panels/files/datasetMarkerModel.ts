/** What a browser row needs to know about dataset cards (no components here). */
import { useEffect } from 'react';
import { getDatasetCardService } from '@/services/DatasetCardService';
import { markerOffersCard, selectMarker, useDatasetCardStore } from '@/stores/datasetCardStore';
import { inferFileType, type FileKind } from './shared/inferFileType';

/** The browse root of a tree row: its top-level ancestor's path. */
export function browseRootOf(node: {
  level: number;
  data: { path: string };
  parent?: unknown;
}): string {
  let current = node;
  while (current.level > 0 && current.parent) current = current.parent as typeof node;
  return current.data.path;
}

const SIDECAR_KINDS: ReadonlySet<FileKind> = new Set([
  'nii',
  'niiGz',
  'fourDNii',
  'gii',
  'surfGii',
  'funcGii',
]);

/** Image files whose metadata a sidecar card can show (BIDS data files). */
export function isSidecarCandidate(path: string): boolean {
  return SIDECAR_KINDS.has(inferFileType(path, false).kind);
}

/**
 * The marker of one folder row. Asking is tied to the row being rendered
 * (mount, or a new path), never to the pointer: hovering reads what is here.
 * While the row is rendered the service counts it among the rows to ask for
 * again after a probe that failed.
 */
export function useDatasetMarker(rootPath: string | null, path: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !rootPath) return undefined;
    return getDatasetCardService().retainMarker(rootPath, path);
  }, [enabled, rootPath, path]);
  const marker = useDatasetCardStore(selectMarker(enabled ? rootPath : null, path));
  return markerOffersCard(marker) ? marker : undefined;
}
