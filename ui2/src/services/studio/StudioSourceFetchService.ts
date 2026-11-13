import { getTransport } from '@/services/transport';
import { useAppModeStore } from '@/stores/appModeStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { generateTaskId, useProgressStore } from '@/stores/progressStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import {
  IDLE_STUDIO_SOURCE_FETCH,
  useStudioSourceFetchStore,
  type StudioSourceFetchState,
} from '@/stores/studioSourceFetchStore';
import type { FileTreeNode } from '@/types/filesystem';
import { safeListen, safeUnlisten, type Unlisten } from '@/utils/eventUtils';
import { formatTauriError, tauriErrorCode } from '@/utils/formatTauriError';
import { getEventBus } from '@/events/EventBus';
import { isRemoteConnectionLost } from '@/utils/remoteConnectionError';
import { findRemoteMountFor, noteRemoteConnectionFailure } from '../RemoteReconnectService';
import { plainStudioSourceError } from './studioSourceErrors';

export { plainStudioSourceError };

/** An image file a lens is about to read, and the member it belongs to. */
export interface StudioSource {
  path: string;
  label?: string | null;
}

interface FetchResult {
  status: 'ready' | 'needs_confirmation';
  mountLabel: string | null;
  remoteCount: number;
  fetchCount: number;
  fetchBytes: number;
  fetchedCount: number;
  /** Cached images the server could not be asked about (it is not connected). */
  unverifiedCount?: number;
}

interface FetchProgress {
  fetchId: string;
  done: number;
  total: number;
  mountLabel: string;
}

/** `list_remote_mounts`: the folders the backend has connected. */
interface BackendMount {
  mount_id: string;
  local_path: string;
  origin?: { host?: string | null; label?: string | null } | null;
}

const STOPPED_MESSAGE =
  'Some images of this set are not on this computer: fetching them from the remote folder was stopped. Open Population or Compare to continue.';
const CONFIRM_MESSAGE =
  'Some images of this set are not on this computer, and fetching them from the remote folder is a large download. Open Population or Compare to start it.';

/**
 * When `error` says the remote connection is down: an image among `paths`
 * that names the mount to reconnect (one a known remote folder owns, else the
 * first). The mount is marked disconnected for the Files panel. Null for any
 * other failure.
 */
function connectionLostPath(error: unknown, paths: Iterable<string>): string | null {
  if (!isRemoteConnectionLost(error)) return null;
  let first: string | null = null;
  let owned: string | null = null;
  for (const path of paths) {
    if (!path || path.startsWith('template:')) continue;
    first ??= path;
    if (findRemoteMountFor(path)) {
      owned = path;
      break;
    }
  }
  const path = owned ?? first;
  noteRemoteConnectionFailure(path, error);
  return path;
}

/** `fetch_studio_sources` refused because the fetch was cancelled. */
const CANCELLED_CODE = 8254;
/** A command refused a source: no connected folder serves it. */
const NOT_CONNECTED_CODE = 8252;
/** A command refused a source: it is on a connected folder but not fetched. */
const NOT_FETCHED_CODE = 8255;

/**
 * Why the images a lens needs are not local. `stopped` and `confirm` wait on
 * the user and are not failures; `failed` carries the reason in plain words.
 */
export class StudioSourceFetchError extends Error {
  readonly kind: 'stopped' | 'confirm' | 'failed';

  constructor(kind: 'stopped' | 'confirm' | 'failed', message: string) {
    super(message);
    this.kind = kind;
    this.name = 'StudioSourceFetchError';
  }
}

function abortError(): Error {
  const error = new Error('Image fetch cancelled.');
  error.name = 'AbortError';
  return error;
}

interface RemoteMount {
  id: string;
  root: string;
  host: string;
}

function remoteMounts(entries: readonly FileTreeNode[]): RemoteMount[] {
  return entries
    .filter((entry) => entry.mountSource?.kind === 'remote')
    .map((entry) => ({
      id: entry.mountSource?.mountId ?? entry.path,
      root: entry.path,
      host: entry.mountSource?.host ?? entry.mountSource?.label ?? 'the remote folder',
    }));
}

/** The mount whose folder holds `path`; `/` and `\` both separate. */
function mountOf(path: string, mounts: readonly RemoteMount[]): RemoteMount | null {
  return (
    mounts.find((mount) => {
      const root = mount.root.replace(/[\\/]+$/, '');
      if (path === mount.root || path === root) return true;
      const next = path.charAt(root.length);
      return path.startsWith(root) && (next === '/' || next === '\\');
    }) ?? null
  );
}

interface Run {
  id: string;
  sources: StudioSource[];
  paths: Set<string>;
  host: string;
  promise: Promise<void>;
  /** The backend has been asked. A run queued behind another has not. */
  started: boolean;
  /** How the run was ended early, if it was. An ended run is never joined. */
  ended: 'stopped' | 'superseded' | null;
  taskId: string | null;
}

/**
 * Brings the image files a Set studio lens reads into the local cache when
 * the set lives on a remote mount (Population and Compare read every member
 * by its local path; only what a view has opened is there).
 *
 * One fetch runs at a time and belongs to this service, not to the view that
 * asked: changing lens or member does not stop it, a second request for the
 * same images joins it, and a request for more is queued behind it (the file
 * in flight is not restarted). Changing set or leaving the Studio stops it;
 * the user stopping it holds until the user continues. A local set is never
 * touched: `pending` answers null without calling the backend.
 */
export class StudioSourceFetchService {
  /** Paths known to be in the cache, per mount id. */
  private known = new Map<string, Set<string>>();
  /**
   * Paths a command was refused for (not fetched, or folder not connected)
   * that no mount in the Files panel accounts for: the backend is asked.
   */
  private unresolved = new Set<string>();
  /** Connected folders the backend reported that the Files panel does not show. */
  private backendMounts: RemoteMount[] = [];
  /** The newest fetch: the one a request joins or is queued behind. */
  private run: Run | null = null;
  /** The fetch the backend is working on; `run`, or the one `run` waits for. */
  private active: Run | null = null;
  /** A fetch the user stopped or has not agreed to: not restarted by itself. */
  private held: { kind: 'stopped' | 'confirm'; paths: Set<string> } | null = null;
  /** The images of the large fetch the user agreed to. */
  private confirmed: Set<string> | null = null;
  /** Hosts already told that their cached images were not re-checked. */
  private notedOffline = new Set<string>();
  private listener: Promise<Unlisten> | null = null;
  private unsubscribe: Array<() => void> = [];

  constructor() {
    let setId = useSetStudioStore.getState().selection.activeSetId;
    this.unsubscribe.push(
      useSetStudioStore.subscribe((state) => {
        if (state.selection.activeSetId === setId) return;
        setId = state.selection.activeSetId;
        this.reset();
      }),
      useAppModeStore.subscribe((state, previous) => {
        if (previous.mode === 'studio' && state.mode !== 'studio') this.reset();
      }),
      // Cancelled from the task list: the same as Cancel in the lens.
      useProgressStore.subscribe((state) => {
        for (const run of this.live())
          if (run.taskId && !run.ended && state.tasks.get(run.taskId)?.status === 'cancelled') {
            this.stop();
            return;
          }
      }),
    );
  }

  dispose() {
    this.reset();
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.unsubscribe = [];
    void safeUnlisten(this.listener);
    this.listener = null;
  }

  /** The fetches that have not finished and were not ended. */
  private live(): Run[] {
    return [this.active, this.run].filter(
      (run, index, runs): run is Run => !!run && !run.ended && runs.indexOf(run) === index,
    );
  }

  /** Remote folders: those in the Files panel, then those only the backend named. */
  private mounts(): RemoteMount[] {
    const shown = remoteMounts(useFileBrowserStore.getState().entries);
    return [
      ...shown,
      ...this.backendMounts.filter(
        (mount) => !shown.some((other) => other.id === mount.id || other.root === mount.root),
      ),
    ].sort((a, b) => b.root.length - a.root.length);
  }

  /** Ask the backend which folders are connected (the Files panel may not show them). */
  private async refreshMounts() {
    try {
      const mounts = await getTransport().invoke<BackendMount[]>('list_remote_mounts');
      this.backendMounts = (Array.isArray(mounts) ? mounts : [])
        .filter((mount) => mount && typeof mount.local_path === 'string')
        .map((mount) => ({
          id: mount.mount_id,
          root: mount.local_path,
          host: mount.origin?.host ?? mount.origin?.label ?? 'the remote folder',
        }));
    } catch {
      // The fetch itself says what is wrong with the folder.
    }
  }

  /** The sources that are on a remote mount, or were refused, and not known local. */
  private needed(sources: readonly StudioSource[]): { sources: StudioSource[]; host: string } {
    const mounts = this.mounts();
    for (const id of [...this.known.keys()])
      if (!mounts.some((mount) => mount.id === id)) this.known.delete(id);
    const needed: StudioSource[] = [];
    const seen = new Set<string>();
    let host = '';
    if (!mounts.length && !this.unresolved.size) return { sources: needed, host };
    for (const source of sources) {
      const path = source.path?.trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const mount = mountOf(path, mounts);
      if (mount ? this.known.get(mount.id)?.has(path) : !this.unresolved.has(path)) continue;
      host ||= mount?.host ?? '';
      needed.push({ path, label: source.label ?? null });
    }
    return { sources: needed, host };
  }

  /** Whether every source can be read now: local, or already fetched. */
  isLocal(sources: readonly StudioSource[]): boolean {
    return this.needed(sources).sources.length === 0;
  }

  /**
   * Null when every source can be read now. Otherwise the fetch that makes
   * them local, which rejects with a {@link StudioSourceFetchError}, or an
   * `AbortError` when `signal` aborts (the fetch itself goes on).
   */
  pending(sources: readonly StudioSource[], signal?: AbortSignal): Promise<void> | null {
    const { sources: needed, host } = this.needed(sources);
    if (!needed.length) return null;
    if (signal?.aborted) return Promise.reject(abortError());
    const held = this.held;
    // A stop holds whatever is asked for next; an unconfirmed large fetch
    // holds the images it was about.
    if (held && (held.kind === 'stopped' || needed.every((source) => held.paths.has(source.path))))
      return Promise.reject(
        new StudioSourceFetchError(
          held.kind,
          held.kind === 'stopped' ? STOPPED_MESSAGE : CONFIRM_MESSAGE,
        ),
      );
    // `this.run` is never an ended run: `end` detaches it at once.
    let run = this.run;
    if (!run) run = this.start(needed, host, null);
    else if (!needed.every((source) => run!.paths.has(source.path))) {
      const extra = needed.filter((source) => !run!.paths.has(source.path));
      if (run.started) {
        // Asked for more than is being fetched. The fetch in flight goes on
        // (its current file is not restarted) and one for everything follows
        // it: what is cached by then is not fetched again.
        run = this.start([...run.sources, ...extra], run.host || host, run);
      } else {
        // Still queued: it simply asks for these too.
        run.sources.push(...extra);
        for (const source of extra) run.paths.add(source.path);
      }
    }
    return signal ? raceAbort(run.promise, signal) : run.promise;
  }

  /**
   * The user stops the fetch. What was fetched stays. Nothing is fetched
   * again, for these images or others of the set, until `resume`.
   */
  stop() {
    const shown = useStudioSourceFetchStore.getState();
    const paths = new Set<string>();
    let host = '';
    for (const run of this.live()) {
      for (const path of run.paths) paths.add(path);
      host ||= run.host;
      this.end(run, 'stopped');
    }
    this.run = null;
    this.held = { kind: 'stopped', paths };
    this.publish({
      ...IDLE_STUDIO_SOURCE_FETCH,
      phase: 'stopped',
      mountLabel: shown.mountLabel ?? (host || null),
      done: shown.done,
      total: shown.total || paths.size,
    });
  }

  /** Continue a stopped fetch, retry a failed one, or agree to a large one. */
  resume() {
    // The agreement is to fetch those images, not whatever is asked next.
    if (this.held?.kind === 'confirm') this.confirmed = this.held.paths;
    this.held = null;
    this.publish({ ...IDLE_STUDIO_SOURCE_FETCH });
    useStudioSourceFetchStore.setState((state) => ({ attempt: state.attempt + 1 }));
  }

  /** Stop and forget: the set changed or the Studio closed. */
  reset() {
    for (const run of this.live()) this.end(run, 'superseded');
    this.run = null;
    this.held = null;
    this.confirmed = null;
    this.unresolved.clear();
    this.backendMounts = [];
    const shown = useStudioSourceFetchStore.getState();
    if (shown.refused) useStudioSourceFetchStore.setState({ refused: false });
    if (shown.phase !== 'idle') this.publish({ ...IDLE_STUDIO_SOURCE_FETCH });
  }

  /**
   * A command was refused because a source is not fetched, or its folder is
   * not connected (the Files panel did not show it as remote, so nothing was
   * fetched first). The reason is shown with Retry, which asks the backend
   * about its folders and fetches. False for any other error.
   */
  refused(error: unknown, sources: readonly StudioSource[]): boolean {
    const code = tauriErrorCode(error);
    if (code !== NOT_FETCHED_CODE && code !== NOT_CONNECTED_CODE) return false;
    for (const source of sources) {
      const path = source.path?.trim();
      if (!path || path.startsWith('template:')) continue;
      this.unresolved.add(path);
      // Whatever was believed about it is out of date.
      for (const paths of this.known.values()) paths.delete(path);
    }
    if (!useStudioSourceFetchStore.getState().refused)
      useStudioSourceFetchStore.setState({ refused: true });
    // A fetch that is running or waiting on the user already says where it is.
    if (!this.live().length && !this.held)
      this.publish({
        ...IDLE_STUDIO_SOURCE_FETCH,
        phase: 'failed',
        message: formatTauriError(error),
        connectionLostPath: connectionLostPath(
          error,
          sources.map((source) => source.path?.trim() ?? ''),
        ),
      });
    return true;
  }

  private publish(next: Omit<StudioSourceFetchState, 'revision' | 'attempt' | 'refused'>) {
    useStudioSourceFetchStore.setState((state) => ({ ...next, revision: state.revision + 1 }));
  }

  /**
   * End a run early. It stops being the fetch a request can join at once,
   * not when the backend's refusal comes back: a request made in between
   * starts its own fetch.
   */
  private end(run: Run, how: 'stopped' | 'superseded') {
    if (run.ended) return;
    run.ended = how;
    if (this.run === run) this.run = null;
    if (run.taskId) useProgressStore.getState().cancelTask(run.taskId);
    if (run.started)
      void getTransport()
        .invoke('cancel_studio_source_fetch', { fetchId: run.id })
        .catch(() => undefined);
  }

  private endedError(run: Run): Error {
    return run.ended === 'stopped'
      ? new StudioSourceFetchError('stopped', STOPPED_MESSAGE)
      : abortError();
  }

  private listen(): Promise<Unlisten> {
    this.listener ??= safeListen<FetchProgress>('studio-source-fetch-progress', (event) => {
      const run = this.active;
      const progress = event.payload;
      if (!run || run.ended || progress?.fetchId !== run.id) return;
      this.publish({
        ...IDLE_STUDIO_SOURCE_FETCH,
        phase: 'fetching',
        mountLabel: progress.mountLabel,
        done: progress.done,
        total: progress.total,
      });
      const tasks = useProgressStore.getState();
      const percent = progress.total ? Math.round((100 * progress.done) / progress.total) : -1;
      const message = `${progress.done} of ${progress.total}`;
      if (run.taskId) tasks.updateTask(run.taskId, { progress: percent, message });
      else {
        run.taskId = generateTaskId('file-load');
        tasks.addTask({
          id: run.taskId,
          type: 'file-load',
          title: `Fetching images from ${progress.mountLabel}`,
          message,
          progress: percent,
          status: 'active',
          cancellable: true,
        });
      }
    });
    return this.listener;
  }

  /** Start a fetch, or queue one behind `after` (a fetch still in flight). */
  private start(sources: StudioSource[], host: string, after: Run | null): Run {
    const run: Run = {
      id: crypto.randomUUID(),
      sources: [...sources],
      paths: new Set(sources.map((source) => source.path)),
      host,
      promise: Promise.resolve(),
      started: false,
      ended: null,
      taskId: null,
    };
    this.held = null;
    this.run = run;
    if (after) {
      const settled = after.promise.then(
        () => undefined,
        () => undefined,
      );
      run.promise = settled.then(() => this.execute(run, true));
    } else {
      this.publish({ ...IDLE_STUDIO_SOURCE_FETCH, phase: 'checking', mountLabel: host || null });
      run.promise = this.execute(run, false);
    }
    // Joined by whoever asked; an unobserved rejection is not an app error.
    run.promise.catch(() => undefined);
    return run;
  }

  /** The images of `run` are local: remember that, and say so when unchecked. */
  private landed(run: Run, result: FetchResult) {
    // The answer is about the mounts as they are now.
    const mounts = this.mounts();
    for (const path of run.paths) {
      this.unresolved.delete(path);
      const mount = mountOf(path, mounts);
      if (!mount) continue;
      let paths = this.known.get(mount.id);
      if (!paths) this.known.set(mount.id, (paths = new Set()));
      paths.add(path);
    }
    const host = result.mountLabel ?? run.host;
    if (!host) return;
    if (!result.unverifiedCount) this.notedOffline.delete(host);
    else if (!this.notedOffline.has(host)) {
      // Said once per folder while it stays disconnected; not a failure.
      this.notedOffline.add(host);
      getEventBus().emit('ui.notification', {
        type: 'info',
        message: `${host} is not connected, so the images of this set were not re-checked against it. The copies already on this computer are used.`,
      });
    }
  }

  private async execute(run: Run, queued: boolean): Promise<void> {
    const tasks = useProgressStore.getState();
    const tail = () => this.run === run;
    try {
      if (run.ended) throw this.endedError(run);
      if (queued)
        this.publish({
          ...IDLE_STUDIO_SOURCE_FETCH,
          phase: 'checking',
          mountLabel: run.host || null,
        });
      await this.listen();
      // Sources no mount in the Files panel accounts for: ask the backend
      // which folders it has connected.
      const mounts = this.mounts();
      if ([...run.paths].some((path) => !mountOf(path, mounts))) await this.refreshMounts();
      if (run.ended) throw this.endedError(run);
      run.started = true;
      this.active = run;
      const confirmed = this.confirmed;
      // The agreement to a large fetch covers the images it was given for.
      const allowLarge = !!confirmed && [...run.paths].every((path) => confirmed.has(path));
      let result: FetchResult;
      try {
        result = await getTransport().invoke<FetchResult>('fetch_studio_sources', {
          request: { fetchId: run.id, sources: run.sources, allowLarge },
        });
      } catch (error) {
        if (run.ended) throw this.endedError(run);
        if (tauriErrorCode(error) === CANCELLED_CODE) {
          if (run.taskId) tasks.cancelTask(run.taskId);
          if (tail()) {
            this.run = null;
            this.publish({ ...IDLE_STUDIO_SOURCE_FETCH });
          }
          throw abortError();
        }
        // The fetch's own errors are already in plain words, with the member
        // and the host: shown as they are.
        const message = formatTauriError(error);
        const shown = useStudioSourceFetchStore.getState();
        // A dropped connection: the Files header says so, and the notice
        // offers Reconnect for the mount this image is on.
        const lostPath = connectionLostPath(error, run.paths);
        if (run.taskId) tasks.completeTask(run.taskId, new Error(message));
        if (tail()) {
          this.run = null;
          this.publish({
            ...IDLE_STUDIO_SOURCE_FETCH,
            phase: 'failed',
            mountLabel: shown.mountLabel ?? (run.host || null),
            done: shown.done,
            total: shown.total,
            message,
            connectionLostPath: lostPath,
          });
        }
        throw new StudioSourceFetchError('failed', message);
      }
      if (result.status === 'ready') this.landed(run, result);
      if (run.ended) throw this.endedError(run);
      if (result.status === 'needs_confirmation') {
        if (tail()) {
          this.run = null;
          this.held = { kind: 'confirm', paths: run.paths };
          this.publish({
            ...IDLE_STUDIO_SOURCE_FETCH,
            phase: 'confirm',
            mountLabel: result.mountLabel ?? (run.host || null),
            total: result.fetchCount,
            bytes: result.fetchBytes,
          });
        }
        throw new StudioSourceFetchError('confirm', CONFIRM_MESSAGE);
      }
      if (allowLarge) this.confirmed = null;
      if (run.taskId) tasks.completeTask(run.taskId);
      // With a wider fetch queued behind, that one says where things are.
      if (tail()) {
        this.run = null;
        this.publish({ ...IDLE_STUDIO_SOURCE_FETCH });
      }
    } finally {
      if (this.active === run) this.active = null;
    }
  }
}

function raceAbort(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * The image files a population request reads, from the request as it is
 * sent: `members[].sourcePath`, the mask, a region's label file
 * (`region.labelSource.path`) and a user-chosen underlay. These are the
 * paths the backend reads by their local path.
 */
export function requestSources(request: unknown): StudioSource[] {
  if (!request || typeof request !== 'object') return [];
  const { members, mask, region, underlay } = request as Record<string, unknown>;
  const sources: StudioSource[] = [];
  if (Array.isArray(members))
    for (const member of members) {
      const { sourcePath, memberId } = (member ?? {}) as Record<string, unknown>;
      if (typeof sourcePath === 'string')
        sources.push({ path: sourcePath, label: typeof memberId === 'string' ? memberId : null });
    }
  const maskPath = (mask as { sourcePath?: unknown } | null | undefined)?.sourcePath;
  if (typeof maskPath === 'string') sources.push({ path: maskPath, label: 'Mask' });
  const labels = (region as { labelSource?: { type?: unknown; path?: unknown } } | null | undefined)
    ?.labelSource;
  if (labels?.type === 'path' && typeof labels.path === 'string')
    sources.push({ path: labels.path, label: 'Region labels' });
  // A template underlay is the template service's to fetch.
  const underlayPath = (underlay as { sourcePath?: unknown } | null | undefined)?.sourcePath;
  if (typeof underlayPath === 'string' && !underlayPath.startsWith('template:'))
    sources.push({ path: underlayPath, label: 'Underlay' });
  return sources;
}

/**
 * Before a population command is sent: wait for the images it reads when the
 * set is on a remote mount. Nothing is awaited for a local set. The wait is
 * outside the command's two-minute ticket.
 */
export function awaitRequestSources(request: unknown, signal?: AbortSignal): Promise<void> | null {
  const sources = requestSources(request);
  return sources.length ? getStudioSourceFetchService().pending(sources, signal) : null;
}

/**
 * After a population command failed: when the backend refused one of its
 * images as not fetched, or its folder as not connected, hand the request's
 * images to the fetch so the lens offers Retry. The caller still reports
 * the error as it does any other.
 */
export function noteRequestRefusal(error: unknown, request: unknown): void {
  const code = tauriErrorCode(error);
  if (code !== NOT_FETCHED_CODE && code !== NOT_CONNECTED_CODE) return;
  if (useAppModeStore.getState().mode !== 'studio') return;
  getStudioSourceFetchService().refused(error, requestSources(request));
}

let instance: StudioSourceFetchService | null = null;

export function getStudioSourceFetchService(): StudioSourceFetchService {
  instance ??= new StudioSourceFetchService();
  return instance;
}

/** Test seam: drop the singleton and its subscriptions. */
export function resetStudioSourceFetchService() {
  instance?.dispose();
  instance = null;
  useStudioSourceFetchStore.setState({
    ...IDLE_STUDIO_SOURCE_FETCH,
    revision: 0,
    attempt: 0,
    refused: false,
  });
}
