/**
 * Dataset cards: which folders have a description (the browser's markers),
 * and the one pinned card. Independent of the view that asks: a row hands in
 * its browse root and path, and reads the answer from `datasetCardStore`.
 *
 * - Markers are probed in batches: rows ask as they are rendered, the asks of
 *   one short window are de-duplicated and sent at most 128 paths per call,
 *   and an answer stands for {@link MARKER_TTL_MS}. Hovering never probes.
 * - A dataset card loads in two phases of `get_dataset_card`: `descriptions`
 *   (shown as soon as it answers) and then `full`, whose counts replace the
 *   pending areas. A whole card the backend still holds answers the first
 *   phase, and the second is skipped.
 * - A card load owns one abort controller across its phases, and each phase
 *   its own cancellation ticket. Opening another card, going back, or
 *   closing cancels whichever phase is running, and a late answer is dropped
 *   (latest wins).
 */
import type { DatasetCard, DatasetMarker, SidecarCard } from '@brainflow/api';
import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import { invokeWithSampleTicket, TicketExpiredError, TICKET_ENDED_CODE } from './sampleTicket';
import { getSetStudioService } from '@/services/studio/SetStudioService';
import { findOwningRoot } from '@/stores/fileBrowserSearch';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import {
  markerKey,
  useDatasetCardStore,
  type DatasetMarkerEntry,
  type PinnedCard,
} from '@/stores/datasetCardStore';
import type { FileTreeNode } from '@/types/filesystem';
import { getEventBus } from '@/events/EventBus';
import { tauriErrorCode } from '@/utils/formatTauriError';
import { isRemoteConnectionLost } from '@/utils/remoteConnectionError';
import { noteRemoteConnectionFailure } from './RemoteReconnectService';

/** The backend refuses a probe of more paths than this. */
export const MARKER_BATCH_LIMIT = 128;
/** Asks arriving within this window travel in one probe. */
export const MARKER_DEBOUNCE_MS = 60;
/** How long a marker stands before a rendered row asks again. */
export const MARKER_TTL_MS = 30_000;
/** How long a failed probe is left alone, so a broken mount is not hammered. */
export const MARKER_RETRY_AFTER_FAILURE_MS = 10_000;

export const CARD_ERROR_NOT_CONNECTED =
  'This remote folder is not connected. Reconnect it, then try again.';
export const CARD_ERROR_DISCONNECTED =
  'The remote folder was disconnected while it was being read. Reconnect it, then try again.';
export const CARD_ERROR_UNREADABLE = 'This could not be read. It may have moved or been deleted.';
export const CARD_ERROR_OUTSIDE = 'This path is outside the folder being browsed.';
export const CARD_ERROR_TIMED_OUT =
  'Reading took longer than two minutes and was stopped. Try again.';
export const CARD_ERROR_GENERIC = 'The description could not be loaded.';
export const CARD_ERROR_COUNTS = 'The folder could not be counted.';

/**
 * What a failed card load shows, or null for a failure that shows nothing
 * (2026: the load was cancelled because the user moved on).
 */
export function describeCardError(error: unknown): string | null {
  if (error instanceof TicketExpiredError) return CARD_ERROR_TIMED_OUT;
  switch (tauriErrorCode(error)) {
    case TICKET_ENDED_CODE:
      return null;
    case 8232:
      return CARD_ERROR_NOT_CONNECTED;
    case 8262:
      return CARD_ERROR_DISCONNECTED;
    case 8263:
      return CARD_ERROR_UNREADABLE;
    case 8260:
    case 8261:
      return CARD_ERROR_OUTSIDE;
    default:
      // A dropped SSH session carries the code of the read that failed.
      return isRemoteConnectionLost(error) ? CARD_ERROR_DISCONNECTED : CARD_ERROR_GENERIC;
  }
}

/** "Open as set" needs the folder to sit under a mounted root (remote info comes from it). */
export function canOpenFolderAsSet(entries: FileTreeNode[], path: string): boolean {
  return findOwningRoot(entries, path) !== null;
}

function sameMarker(a: DatasetMarker, b: DatasetMarker): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1);
}

interface OpenRequest {
  rootPath: string;
  path: string;
  /** Element to focus again when the card closes (the row that opened it). */
  returnFocus?: HTMLElement | null;
}

export class DatasetCardService {
  private readonly pending = new Map<string, Set<string>>();
  private readonly inFlight = new Set<string>();
  private readonly failedAtMs = new Map<string, number>();
  /**
   * When a key's marker was last confirmed. Kept here, not in the store: an
   * answer that repeats what is known must not write the store.
   */
  private readonly confirmedAtMs = new Map<string, number>();
  /** Rows on screen that show a key's marker (see {@link retainMarker}). */
  private readonly wanted = new Map<string, number>();
  /** Keys whose one automatic retry after a failure has been spent. */
  private readonly retried = new Set<string>();
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by {@link forgetMarkers}: answers from before it are void. */
  private allEpoch = 0;
  private readonly rootEpoch = new Map<string, number>();

  private loadSeq = 0;
  private activeLoad: AbortController | null = null;
  private returnFocus: HTMLElement | null = null;

  private readonly transportOverride: BackendTransport | null;
  private readonly now: () => number;

  constructor(transport: BackendTransport | null = null, now: () => number = Date.now) {
    this.transportOverride = transport;
    this.now = now;
  }

  private get transport(): BackendTransport {
    return this.transportOverride ?? getTransport();
  }

  // ── markers ────────────────────────────────────────────────────────────

  /** Ask for the markers of folder rows that are on screen. Cheap to repeat. */
  requestMarkers(rootPath: string, paths: readonly string[]): void {
    this.queueMarkers(rootPath, paths, false);
  }

  /**
   * A row that shows a folder's marker, for as long as it is rendered: asks
   * for the marker now, and keeps the folder among those asked again after a
   * probe that failed or was voided. Call the result when the row goes away.
   */
  retainMarker(rootPath: string, path: string): () => void {
    if (!rootPath) return () => {};
    const key = markerKey(rootPath, path);
    const count = this.wanted.get(key) ?? 0;
    this.wanted.set(key, count + 1);
    // A row that came back gets its own retry.
    if (count === 0) this.retried.delete(key);
    this.queueMarkers(rootPath, [path], false);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.wanted.get(key) ?? 1) - 1;
      if (left > 0) this.wanted.set(key, left);
      else this.wanted.delete(key);
    };
  }

  /** `force` asks again although the marker is fresh (its folder was recounted). */
  private queueMarkers(rootPath: string, paths: readonly string[], force: boolean): void {
    if (!rootPath) return;
    const known = useDatasetCardStore.getState().markers;
    const now = this.now();
    let queued = false;
    for (const path of paths) {
      const key = markerKey(rootPath, path);
      if (this.inFlight.has(key)) continue;
      if (!force) {
        const entry = known[key];
        const confirmedAt = entry
          ? Math.max(entry.fetchedAtMs, this.confirmedAtMs.get(key) ?? entry.fetchedAtMs)
          : undefined;
        if (confirmedAt !== undefined && now - confirmedAt < MARKER_TTL_MS) continue;
        const failed = this.failedAtMs.get(key);
        if (failed !== undefined && now - failed < MARKER_RETRY_AFTER_FAILURE_MS) continue;
      }
      let set = this.pending.get(rootPath);
      if (!set) this.pending.set(rootPath, (set = new Set()));
      set.add(path);
      queued = true;
    }
    if (queued && this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushMarkers();
      }, MARKER_DEBOUNCE_MS);
    }
  }

  /**
   * Drop what is known about markers (all of them, or one root's). The file
   * browser calls this when a root is unmounted.
   */
  forgetMarkers(rootPath?: string): void {
    const prefix = rootPath === undefined ? '' : `${rootPath}\n`;
    if (rootPath === undefined) {
      this.allEpoch += 1;
      this.pending.clear();
    } else {
      this.rootEpoch.set(rootPath, (this.rootEpoch.get(rootPath) ?? 0) + 1);
      this.pending.delete(rootPath);
    }
    for (const memo of [this.failedAtMs, this.confirmedAtMs, this.retried]) {
      for (const key of [...memo.keys()]) {
        if (key.startsWith(prefix)) memo.delete(key);
      }
    }
    const { markers } = useDatasetCardStore.getState();
    const kept: Record<string, DatasetMarkerEntry> = {};
    if (rootPath !== undefined) {
      for (const [key, entry] of Object.entries(markers)) {
        if (!key.startsWith(prefix)) kept[key] = entry;
      }
    }
    if (Object.keys(kept).length !== Object.keys(markers).length) {
      useDatasetCardStore.setState({ markers: kept });
    }
  }

  /** Stop the timers of a service that is being replaced (tests). */
  dispose(): void {
    this.close();
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
    this.pending.clear();
    this.wanted.clear();
  }

  private markerEpoch(rootPath: string): string {
    return `${this.allEpoch}:${this.rootEpoch.get(rootPath) ?? 0}`;
  }

  private stillWanted(rootPath: string, paths: readonly string[]): string[] {
    return paths.filter((path) => this.wanted.has(markerKey(rootPath, path)));
  }

  private flushMarkers(): void {
    const batches: Array<{ rootPath: string; paths: string[] }> = [];
    for (const [rootPath, set] of this.pending) {
      const paths = [...set];
      for (let i = 0; i < paths.length; i += MARKER_BATCH_LIMIT) {
        batches.push({ rootPath, paths: paths.slice(i, i + MARKER_BATCH_LIMIT) });
      }
    }
    this.pending.clear();
    for (const batch of batches) void this.probe(batch.rootPath, batch.paths);
  }

  private async probe(rootPath: string, paths: string[]): Promise<void> {
    const epoch = this.markerEpoch(rootPath);
    const keys = paths.map((path) => markerKey(rootPath, path));
    for (const key of keys) this.inFlight.add(key);
    let outcome: 'answered' | 'failed' | 'voided' = 'failed';
    try {
      const markers = await this.transport.invoke<DatasetMarker[]>('probe_dataset_markers', {
        paths,
        rootPath,
      });
      if (epoch !== this.markerEpoch(rootPath)) {
        outcome = 'voided';
        return;
      }
      // One per path, in order; trust the position, not the echoed path. An
      // answer of another length cannot be matched to the paths: discard it.
      if (!Array.isArray(markers) || markers.length !== paths.length) return;
      outcome = 'answered';
      const confirmedAt = this.now();
      const current = useDatasetCardStore.getState().markers;
      const changed: Record<string, DatasetMarkerEntry> = {};
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const marker = markers[index];
        if (!marker) continue;
        this.confirmedAtMs.set(key, confirmedAt);
        this.failedAtMs.delete(key);
        this.retried.delete(key);
        // An unchanged answer writes nothing, so no row re-renders.
        const previous = current[key]?.marker;
        if (previous && sameMarker(previous, marker)) continue;
        changed[key] = { marker, fetchedAtMs: confirmedAt };
      }
      if (Object.keys(changed).length > 0) {
        useDatasetCardStore.setState({
          markers: { ...useDatasetCardStore.getState().markers, ...changed },
        });
      }
    } catch {
      // A row without a marker is the whole consequence; say nothing.
      if (epoch !== this.markerEpoch(rootPath)) outcome = 'voided';
    } finally {
      for (const key of keys) this.inFlight.delete(key);
      if (outcome === 'voided') {
        // Forgotten while in flight: rows that are still there ask afresh.
        this.queueMarkers(rootPath, this.stillWanted(rootPath, paths), false);
      } else if (outcome === 'failed') {
        this.markFailed(rootPath, paths);
      }
    }
  }

  /**
   * Back off after a failed probe, and ask once more afterwards for the
   * folders whose rows are still on screen: a row asks only when it mounts,
   * so without this it would stay unmarked for as long as it is rendered.
   */
  private markFailed(rootPath: string, paths: readonly string[]): void {
    const failedAt = this.now();
    const retry: string[] = [];
    for (const path of paths) {
      const key = markerKey(rootPath, path);
      this.failedAtMs.set(key, failedAt);
      if (this.retried.has(key)) continue;
      this.retried.add(key);
      retry.push(path);
    }
    if (retry.length === 0) return;
    const epoch = this.markerEpoch(rootPath);
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      if (epoch !== this.markerEpoch(rootPath)) return;
      const again = this.stillWanted(rootPath, retry);
      // The back-off has passed by the timer; do not let the clock veto it.
      for (const path of again) this.failedAtMs.delete(markerKey(rootPath, path));
      this.queueMarkers(rootPath, again, false);
    }, MARKER_RETRY_AFTER_FAILURE_MS);
    this.retryTimers.add(timer);
  }

  // ── the pinned card ────────────────────────────────────────────────────

  openDatasetCard(request: OpenRequest): void {
    this.returnFocus = request.returnFocus ?? null;
    void this.load({
      kind: 'dataset',
      rootPath: request.rootPath,
      path: request.path,
      originPath: request.path,
      backStack: [],
    });
  }

  openSidecarCard(request: OpenRequest): void {
    this.returnFocus = request.returnFocus ?? null;
    void this.load({
      kind: 'sidecar',
      rootPath: request.rootPath,
      path: request.path,
      originPath: request.path,
      backStack: [],
    });
  }

  /** Space on a row: open its card, or close it when it is the one showing. */
  toggleCard(kind: PinnedCard['kind'], request: OpenRequest): void {
    const card = useDatasetCardStore.getState().card;
    if (
      card &&
      card.kind === kind &&
      card.originPath === request.path &&
      card.rootPath === request.rootPath
    ) {
      this.close();
      return;
    }
    if (kind === 'dataset') this.openDatasetCard(request);
    else this.openSidecarCard(request);
  }

  /** An analysis row of a collection: the same card moves to that analysis. */
  showAnalysis(path: string): void {
    const card = useDatasetCardStore.getState().card;
    if (!card || card.kind !== 'dataset' || card.status !== 'ready' || !card.dataset) return;
    void this.load({
      kind: 'dataset',
      rootPath: card.rootPath,
      path,
      originPath: card.originPath,
      backStack: [...card.backStack, { path: card.path, data: card.dataset }],
    });
  }

  /**
   * Back to the collection an analysis was opened from. What was shown is
   * shown again at once; if the collection was left before its counts
   * arrived, they are asked for again (the descriptions are not).
   */
  back(): void {
    const card = useDatasetCardStore.getState().card;
    const previous = card?.backStack[card.backStack.length - 1];
    if (!card || !previous) return;
    const target = {
      kind: 'dataset' as const,
      rootPath: card.rootPath,
      path: previous.path,
      originPath: card.originPath,
      backStack: card.backStack.slice(0, -1),
    };
    if (previous.data.phase === 'descriptions') {
      void this.load(target, false, previous.data);
      return;
    }
    this.cancelActiveLoad();
    useDatasetCardStore.setState({
      card: {
        ...target,
        status: 'ready',
        dataset: previous.data,
        sidecar: null,
        error: null,
        countsError: null,
      },
    });
  }

  /** Read the showing card again; a dataset card recounts its folder. */
  refresh(): void {
    this.reload(true);
  }

  /**
   * Try a failed load again. When only the counts failed, only the counts
   * are read again: the descriptions stay as they are shown, so the view
   * keeps its filter, its sort and its open raw JSON.
   */
  retry(): void {
    const card = useDatasetCardStore.getState().card;
    if (
      card &&
      card.kind === 'dataset' &&
      card.status === 'ready' &&
      card.dataset &&
      card.countsError !== null
    ) {
      void this.load(
        {
          kind: card.kind,
          rootPath: card.rootPath,
          path: card.path,
          originPath: card.originPath,
          backStack: card.backStack,
        },
        false,
        card.dataset,
      );
      return;
    }
    this.reload(false);
  }

  close(): void {
    this.cancelActiveLoad();
    if (useDatasetCardStore.getState().card !== null) {
      useDatasetCardStore.setState({ card: null });
    }
  }

  /** The element that opened the card, once; the host focuses it on close. */
  takeReturnFocus(): HTMLElement | null {
    const element = this.returnFocus;
    this.returnFocus = null;
    return element;
  }

  /**
   * Hand a folder to the Set studio's folder review, the same entry the file
   * browser's "Open in Set studio…" uses (it reads the remote source from the
   * mounted roots). The card closes: the studio workspace takes over.
   */
  async openAsSet(path: string): Promise<void> {
    if (!canOpenFolderAsSet(useFileBrowserStore.getState().entries, path)) return;
    this.close();
    try {
      await getSetStudioService().openFolderOntologyInStudio({ discoveryRoot: path });
    } catch (error) {
      console.error('[DatasetCardService] Could not open the folder as a set:', error);
      getEventBus().emit('ui.notification', {
        type: 'error',
        message: `Could not open ${folderName(path)} as a set.`,
        subject: folderName(path),
      });
    }
  }

  private reload(refresh: boolean): void {
    const card = useDatasetCardStore.getState().card;
    if (!card) return;
    if (refresh && card.kind === 'dataset') {
      // The marker of a recounted folder may have changed with it. The one
      // on show stays until the new answer arrives.
      this.queueMarkers(card.rootPath, [card.path], true);
    }
    void this.load(
      {
        kind: card.kind,
        rootPath: card.rootPath,
        path: card.path,
        originPath: card.originPath,
        backStack: card.backStack,
      },
      refresh,
    );
  }

  private cancelActiveLoad(): void {
    this.loadSeq += 1;
    this.activeLoad?.abort();
    this.activeLoad = null;
  }

  /**
   * Load a card. A dataset card is published when its descriptions arrive
   * and again when its counts do. `shown` is a descriptions-phase card that
   * is already known: it is published at once and only the counts are read.
   */
  private async load(
    target: Pick<PinnedCard, 'kind' | 'rootPath' | 'path' | 'originPath' | 'backStack'>,
    refresh = false,
    shown: DatasetCard | null = null,
  ): Promise<void> {
    this.cancelActiveLoad();
    // Identity is captured before any I/O; only this load may publish.
    const seq = this.loadSeq;
    const controller = new AbortController();
    this.activeLoad = controller;
    const blank = {
      dataset: null,
      sidecar: null,
      error: null,
      countsError: null,
      connectionLost: false,
      countsConnectionLost: false,
    };
    const publish = (card: Omit<PinnedCard, keyof typeof target>) => {
      useDatasetCardStore.setState({ card: { ...target, ...card } });
    };
    publish(
      shown ? { ...blank, status: 'ready', dataset: shown } : { ...blank, status: 'loading' },
    );
    const isCurrent = () => seq === this.loadSeq && !controller.signal.aborted;
    const readDataset = (phase: 'descriptions' | 'full', recount: boolean) =>
      invokeWithSampleTicket<DatasetCard>(
        this.transport,
        'get_dataset_card',
        { path: target.path, rootPath: target.rootPath, refresh: recount, phase },
        controller,
        this.now,
      );
    try {
      if (target.kind === 'dataset') {
        let dataset = shown;
        if (!dataset) {
          // A refresh forgets both phases in the backend, so it travels
          // with the first one only.
          dataset = await readDataset('descriptions', refresh);
          if (!isCurrent()) return;
          publish({ ...blank, status: 'ready', dataset });
        }
        if (dataset.phase !== 'full') {
          try {
            const whole = await readDataset('full', false);
            if (!isCurrent()) return;
            publish({ ...blank, status: 'ready', dataset: whole });
          } catch (error) {
            if (!isCurrent()) return;
            // The descriptions stay on show; only the counts are missing.
            publish({
              ...blank,
              status: 'ready',
              dataset,
              countsError: describeCardError(error) ?? CARD_ERROR_COUNTS,
              countsConnectionLost: noteRemoteConnectionFailure(target.path, error),
            });
          }
        }
      } else {
        const sidecar = await invokeWithSampleTicket<SidecarCard>(
          this.transport,
          'get_sidecar_card',
          { path: target.path, rootPath: target.rootPath },
          controller,
          this.now,
        );
        if (!isCurrent()) return;
        publish({ ...blank, status: 'ready', sidecar });
      }
    } catch (error) {
      if (!isCurrent()) return;
      const message = describeCardError(error);
      // 2026 without our abort: the backend dropped the ticket. Nothing to
      // show beyond the chance to try again.
      publish({
        ...blank,
        status: 'error',
        error: message ?? CARD_ERROR_GENERIC,
        // 8232, 8262 or a dropped session: Reconnect is the way on.
        connectionLost: noteRemoteConnectionFailure(target.path, error),
      });
    } finally {
      if (this.activeLoad === controller) this.activeLoad = null;
    }
  }
}

let instance: DatasetCardService | null = null;

export function getDatasetCardService(): DatasetCardService {
  if (!instance) instance = new DatasetCardService();
  return instance;
}

/** Tests only: a fresh service and an empty store. */
export function resetDatasetCardServiceForTests(): void {
  instance?.dispose();
  instance = null;
  useDatasetCardStore.setState({ markers: {}, card: null });
}
