/**
 * Dataset card state: the folder markers the file browser shows and the one
 * pinned card (a dataset, a folder of analyses, or an image's sidecar
 * metadata). Shared across panels, so it lives here; only
 * `DatasetCardService` writes it.
 */
import { create } from 'zustand';
import type { DatasetCard, DatasetMarker, SidecarCard } from '@brainflow/api';

export interface DatasetMarkerEntry {
  marker: DatasetMarker;
  fetchedAtMs: number;
}

/** A card the user can go back to (the collection a "Details" came from). */
export interface DatasetCardBackEntry {
  path: string;
  data: DatasetCard;
}

export type PinnedCardStatus = 'loading' | 'ready' | 'error';

export interface PinnedCard {
  kind: 'dataset' | 'sidecar';
  /** Browse root of the tree the row belongs to. */
  rootPath: string;
  /** The folder or file the card describes now. */
  path: string;
  /** The browser row that opened the card; focus returns there on close. */
  originPath: string;
  status: PinnedCardStatus;
  dataset: DatasetCard | null;
  sidecar: SidecarCard | null;
  error: string | null;
  /**
   * The load failed because the remote connection is down (`error` says so):
   * the card offers Reconnect and loads again when the mount is back.
   */
  connectionLost?: boolean;
  /**
   * Why the counts of a dataset card did not arrive, when its descriptions
   * did. With `dataset.phase === 'descriptions'` and no error here, the
   * counts are still on their way (see {@link countsPending}).
   */
  countsError: string | null;
  /** The counts failed because the remote connection is down: Reconnect is offered. */
  countsConnectionLost?: boolean;
  backStack: DatasetCardBackEntry[];
}

interface DatasetCardState {
  /** Keyed by {@link markerKey}. */
  markers: Record<string, DatasetMarkerEntry>;
  card: PinnedCard | null;
}

export const useDatasetCardStore = create<DatasetCardState>()(() => ({
  markers: {},
  card: null,
}));

/** A dataset card that shows its descriptions while its folder is still being counted. */
export function countsPending(card: PinnedCard | null): boolean {
  return Boolean(
    card &&
      card.status === 'ready' &&
      card.dataset?.phase === 'descriptions' &&
      card.countsError === null,
  );
}

/** Key of one folder's marker: a path is only meaningful within its browse root. */
export function markerKey(rootPath: string, path: string): string {
  return `${rootPath}\n${path}`;
}

/** The marker of one folder, or undefined before its probe answered. */
export function selectMarker(rootPath: string | null, path: string) {
  return (state: DatasetCardState): DatasetMarker | undefined =>
    rootPath === null ? undefined : state.markers[markerKey(rootPath, path)]?.marker;
}

/** A marker that offers a card: a description file, or child analyses. */
export function markerOffersCard(marker: DatasetMarker | undefined): boolean {
  return Boolean(marker && (marker.hasDescription || marker.analysisCount !== null));
}
