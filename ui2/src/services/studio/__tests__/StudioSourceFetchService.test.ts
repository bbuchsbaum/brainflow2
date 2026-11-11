import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEventBus } from '@/events/EventBus';
import { setTransport, type BackendTransport } from '@/services/transport';
import { useAppModeStore } from '@/stores/appModeStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useProgressStore } from '@/stores/progressStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useStudioSourceFetchStore } from '@/stores/studioSourceFetchStore';
import type { FileTreeNode } from '@/types/filesystem';
import {
  awaitRequestSources,
  getStudioSourceFetchService,
  noteRequestRefusal,
  plainStudioSourceError,
  requestSources,
  resetStudioSourceFetchService,
  StudioSourceFetchError,
  type StudioSource,
} from '../StudioSourceFetchService';
import { StudioCompareService, presentComparePaneSpecs } from '../StudioCompareService';
import { folderCandidate } from './studioFixtures';

const MOUNT = '/cache/mount-a';
const HOST = 'trillium.alliancecan.ca';

function remoteMount(mountId = 'mount-1'): FileTreeNode {
  return {
    id: MOUNT,
    name: 'dsets',
    path: MOUNT,
    type: 'directory',
    depth: 0,
    mountSource: {
      kind: 'remote',
      label: `brad@${HOST}:/scratch/brad/dsets`,
      mountId,
      host: HOST,
      remotePath: '/scratch/brad/dsets',
    },
  } as FileTreeNode;
}

const members = Array.from({ length: 35 }, (_, index) => `sub-${1001 + index}`);
const sources: StudioSource[] = members.map((id) => ({
  path: `${MOUNT}/pcmri/derivatives/enc_rep_rsa/${id}/enc_rep/maps/same_item.nii.gz`,
  label: id,
}));

type Harness = typeof window & {
  __harnessEvents?: { listen: (event: string, handler: (event: { payload: unknown }) => void) => () => void };
};
interface FetchArgs {
  fetchId?: string;
  request: { fetchId: string; allowLarge: boolean; sources: { path: string; label: string }[] };
}
interface Call {
  cmd: string;
  args: FetchArgs;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

let calls: Call[];
let emit: (payload: unknown) => void;

function fetchCalls() {
  return calls.filter((call) => call.cmd === 'fetch_studio_sources');
}
function cancelCalls() {
  return calls.filter((call) => call.cmd === 'cancel_studio_source_fetch');
}
const ready = (fetched = 0) => ({
  status: 'ready',
  mountLabel: HOST,
  remoteCount: 35,
  fetchCount: fetched,
  fetchBytes: fetched * 1_000_000,
  fetchedCount: fetched,
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  calls = [];
  const handlers: Array<(event: { payload: unknown }) => void> = [];
  emit = (payload) => handlers.forEach((handler) => handler({ payload }));
  (window as Harness).__harnessEvents = {
    listen: (event: string, handler: (event: { payload: unknown }) => void) => {
      if (event === 'studio-source-fetch-progress') handlers.push(handler);
      return () => {};
    },
  };
  setTransport({
    invoke: vi.fn(
      (cmd: string, args: unknown) =>
        new Promise((resolve, reject) => {
          if (cmd === 'cancel_studio_source_fetch') {
            calls.push({ cmd, args: args as FetchArgs, resolve, reject });
            resolve(true);
            return;
          }
          calls.push({ cmd, args: args as FetchArgs, resolve, reject });
        }),
    ),
  } as unknown as BackendTransport);
  useSetStudioStore.setState(useSetStudioStore.getInitialState());
  useFileBrowserStore.setState({ entries: [remoteMount()] });
  useProgressStore.setState({ tasks: new Map() });
  resetStudioSourceFetchService();
});
afterEach(() => {
  resetStudioSourceFetchService();
  useFileBrowserStore.setState({ entries: [] });
  delete (window as Harness).__harnessEvents;
});

describe('a set in a local folder', () => {
  it('has no fetch step: nothing is pending and the backend is not asked', () => {
    useFileBrowserStore.setState({ entries: [] });
    const service = getStudioSourceFetchService();
    const local = [{ path: '/data/study/sub-01/stat.nii.gz', label: 'sub-01' }];
    expect(service.isLocal(local)).toBe(true);
    expect(service.pending(local)).toBeNull();
    expect(awaitRequestSources({ members: [{ memberId: 'sub-01', sourcePath: local[0].path }] }))
      .toBeNull();
    expect(calls).toEqual([]);
    expect(useStudioSourceFetchStore.getState().phase).toBe('idle');
  });

  it('is not held up by a remote mount that does not hold its files', () => {
    const service = getStudioSourceFetchService();
    expect(service.pending([{ path: '/data/study/sub-01/stat.nii.gz' }])).toBeNull();
    expect(service.pending([{ path: 'template:MNI152NLin2009cAsym_T1w_2mm' }])).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('a set on a remote mount', () => {
  it('fetches the images asked for, shows the count, and is then local', async () => {
    const service = getStudioSourceFetchService();
    expect(service.isLocal(sources)).toBe(false);
    const pending = service.pending(sources)!;
    // A second lens asking for the same images joins the one fetch.
    const joined = service.pending(sources.slice(0, 10))!;
    expect(useStudioSourceFetchStore.getState()).toMatchObject({
      phase: 'checking',
      mountLabel: HOST,
    });
    await flush();
    expect(fetchCalls()).toHaveLength(1);
    const { request } = fetchCalls()[0].args;
    expect(request.allowLarge).toBe(false);
    expect(request.sources).toHaveLength(35);
    expect(request.sources[13]).toEqual({ path: sources[13].path, label: 'sub-1014' });

    emit({ fetchId: request.fetchId, done: 12, total: 35, mountLabel: HOST });
    expect(useStudioSourceFetchStore.getState()).toMatchObject({
      phase: 'fetching',
      done: 12,
      total: 35,
      mountLabel: HOST,
    });
    const task = [...useProgressStore.getState().tasks.values()][0];
    expect(task).toMatchObject({
      title: `Fetching images from ${HOST}`,
      message: '12 of 35',
      status: 'active',
      progress: 34,
    });
    // Progress of a fetch that is not this one is ignored.
    emit({ fetchId: 'another', done: 30, total: 35, mountLabel: HOST });
    expect(useStudioSourceFetchStore.getState().done).toBe(12);

    fetchCalls()[0].resolve(ready(35));
    await expect(pending).resolves.toBeUndefined();
    await expect(joined).resolves.toBeUndefined();
    expect(useStudioSourceFetchStore.getState().phase).toBe('idle');
    expect([...useProgressStore.getState().tasks.values()][0].status).toBe('completed');
    expect(service.isLocal(sources)).toBe(true);
    // Known to be here: asked again, nothing is pending and nothing is sent.
    expect(service.pending(sources)).toBeNull();
    expect(fetchCalls()).toHaveLength(1);
  });

  it('widens the fetch when more images are asked for, without failing who asked first', async () => {
    const service = getStudioSourceFetchService();
    const first = service.pending(sources.slice(0, 3))!;
    await flush();
    const mask = { path: `${MOUNT}/masks/brain.nii.gz`, label: 'Mask' };
    const wider = service.pending([...sources.slice(0, 3), mask])!;
    // And more again while that one is still queued: one fetch for all of it.
    const widest = service.pending([...sources.slice(0, 4), mask])!;
    await flush();
    // The fetch in flight is not cancelled (its current file is not
    // restarted); the wider one waits behind it.
    expect(fetchCalls()).toHaveLength(1);
    expect(cancelCalls()).toEqual([]);
    const { fetchId } = fetchCalls()[0].args.request;
    emit({ fetchId, done: 1, total: 3, mountLabel: HOST });
    expect(useStudioSourceFetchStore.getState()).toMatchObject({ phase: 'fetching', done: 1 });

    fetchCalls()[0].resolve(ready(3));
    await expect(first).resolves.toBeUndefined();
    await flush();
    expect(fetchCalls()).toHaveLength(2);
    expect(cancelCalls()).toEqual([]);
    expect(fetchCalls()[1].args.request.sources).toEqual([...sources.slice(0, 3), mask, sources[3]]);
    expect(useStudioSourceFetchStore.getState().phase).toBe('checking');
    expect(service.isLocal(sources.slice(0, 3))).toBe(true);
    expect(service.isLocal([mask])).toBe(false);
    fetchCalls()[1].resolve(ready(2));
    await expect(wider).resolves.toBeUndefined();
    await expect(widest).resolves.toBeUndefined();
    expect(service.isLocal([...sources.slice(0, 4), mask])).toBe(true);
    expect(useStudioSourceFetchStore.getState().phase).toBe('idle');
  });

  it('asks again after the folder is reconnected as another mount', async () => {
    const service = getStudioSourceFetchService();
    const pending = service.pending(sources)!;
    await flush();
    fetchCalls()[0].resolve(ready());
    await pending;
    useFileBrowserStore.setState({ entries: [remoteMount('mount-2')] });
    expect(service.isLocal(sources)).toBe(false);
  });

  it('stops when the user cancels, keeps the count, and continues on request', async () => {
    const service = getStudioSourceFetchService();
    const pending = service.pending(sources)!;
    await flush();
    const { fetchId } = fetchCalls()[0].args.request;
    emit({ fetchId, done: 12, total: 35, mountLabel: HOST });

    service.stop();
    expect(cancelCalls().map((call) => call.args)).toEqual([{ fetchId }]);
    fetchCalls()[0].reject({ Input: { code: 8254, details: 'Image fetch cancelled.' } });
    const error = await pending.catch((reason) => reason);
    expect(error).toBeInstanceOf(StudioSourceFetchError);
    expect(error.kind).toBe('stopped');
    expect(useStudioSourceFetchStore.getState()).toMatchObject({
      phase: 'stopped',
      done: 12,
      total: 35,
    });
    expect([...useProgressStore.getState().tasks.values()][0].status).toBe('cancelled');

    // A stopped fetch is not restarted by a lens asking again.
    await expect(service.pending(sources)).rejects.toMatchObject({ kind: 'stopped' });
    expect(fetchCalls()).toHaveLength(1);

    const attempt = useStudioSourceFetchStore.getState().attempt;
    service.resume();
    expect(useStudioSourceFetchStore.getState()).toMatchObject({
      phase: 'idle',
      attempt: attempt + 1,
    });
    const again = service.pending(sources)!;
    await flush();
    expect(fetchCalls()).toHaveLength(2);
    fetchCalls()[1].resolve(ready(23));
    await expect(again).resolves.toBeUndefined();
  });

  it('asks before a large fetch and sends the agreement with the next request', async () => {
    const service = getStudioSourceFetchService();
    const pending = service.pending(sources)!;
    await flush();
    fetchCalls()[0].resolve({
      status: 'needs_confirmation',
      mountLabel: HOST,
      remoteCount: 35,
      fetchCount: 35,
      fetchBytes: 3 * 1024 ** 3,
      fetchedCount: 0,
    });
    await expect(pending).rejects.toMatchObject({ kind: 'confirm' });
    expect(useStudioSourceFetchStore.getState()).toMatchObject({
      phase: 'confirm',
      total: 35,
      bytes: 3 * 1024 ** 3,
      mountLabel: HOST,
    });
    // Nothing is downloaded until the user agrees.
    await expect(service.pending(sources)).rejects.toMatchObject({ kind: 'confirm' });
    expect(fetchCalls()).toHaveLength(1);
    expect(useProgressStore.getState().tasks.size).toBe(0);

    service.resume();
    const confirmed = service.pending(sources)!;
    await flush();
    expect(fetchCalls()[1].args.request.allowLarge).toBe(true);
    fetchCalls()[1].resolve(ready(35));
    await expect(confirmed).resolves.toBeUndefined();
    // The agreement was for that fetch only.
    useFileBrowserStore.setState({ entries: [remoteMount('mount-2')] });
    void service.pending(sources)!.catch(() => undefined);
    await flush();
    expect(fetchCalls()[2].args.request.allowLarge).toBe(false);
  });

  it('says in plain words which image is missing, or that the folder is not connected', async () => {
    const service = getStudioSourceFetchService();
    const pending = service.pending(sources)!;
    await flush();
    fetchCalls()[0].reject({
      Io: { code: 8251, details: `sub-1014: same_item.nii.gz is not on ${HOST}.` },
    });
    await expect(pending).rejects.toMatchObject({
      kind: 'failed',
      message: `sub-1014: same_item.nii.gz is not on ${HOST}.`,
    });
    expect(useStudioSourceFetchStore.getState()).toMatchObject({
      phase: 'failed',
      message: `sub-1014: same_item.nii.gz is not on ${HOST}.`,
    });

    // A failed fetch is tried again when asked.
    const again = service.pending(sources)!;
    await flush();
    fetchCalls()[1].reject({
      Io: { code: 8252, details: 'The remote folder is not connected. Reconnect to continue.' },
    });
    await expect(again).rejects.toMatchObject({
      message: 'The remote folder is not connected. Reconnect to continue.',
    });
  });

  it('outlives the view that asked, and stops when the set changes', async () => {
    const service = getStudioSourceFetchService();
    const view = new AbortController();
    const pending = service.pending(sources, view.signal)!;
    await flush();
    view.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelCalls()).toHaveLength(0);
    expect(useStudioSourceFetchStore.getState().phase).toBe('checking');

    const { fetchId } = fetchCalls()[0].args.request;
    useSetStudioStore.setState((state) => ({
      selection: { ...state.selection, activeSetId: 'another-set' },
    }));
    expect(cancelCalls().map((call) => call.args)).toEqual([{ fetchId }]);
    expect(useStudioSourceFetchStore.getState().phase).toBe('idle');
    fetchCalls()[0].reject({ Input: { code: 8254, details: 'Image fetch cancelled.' } });
    await flush();
    // Not an error, and not a stopped fetch waiting on the user.
    expect(useStudioSourceFetchStore.getState().phase).toBe('idle');
    expect(service.isLocal(sources)).toBe(false);
  });

  it('waits for the images a population request reads, before its ticket', async () => {
    const request = {
      members: members
        .slice(0, 3)
        .map((memberId, index) => ({ memberId, sourcePath: sources[index].path })),
      mask: { sourcePath: `${MOUNT}/masks/brain.nii.gz` },
    };
    const waiting = awaitRequestSources(request)!;
    await flush();
    expect(fetchCalls()[0].args.request.sources).toEqual([
      ...sources.slice(0, 3),
      { path: `${MOUNT}/masks/brain.nii.gz`, label: 'Mask' },
    ]);
    fetchCalls()[0].resolve(ready(4));
    await expect(waiting).resolves.toBeUndefined();
    expect(awaitRequestSources(request)).toBeNull();
  });
});

describe('a fetch that was ended', () => {
  const OTHER = `${MOUNT}/other-study`;
  const otherSources: StudioSource[] = ['sub-01', 'sub-02'].map((id) => ({
    path: `${OTHER}/${id}/stat.nii.gz`,
    label: id,
  }));
  const cancelled = { Input: { code: 8254, details: 'Image fetch cancelled.' } };

  it('is not joined or widened by the next set: its files are not fetched again', async () => {
    const service = getStudioSourceFetchService();
    const old = service.pending(sources)!;
    await flush();
    const { fetchId } = fetchCalls()[0].args.request;
    useSetStudioStore.setState((state) => ({
      selection: { ...state.selection, activeSetId: 'another-set' },
    }));
    expect(cancelCalls().map((call) => call.args)).toEqual([{ fetchId }]);

    // The new set asks before the backend has answered the cancellation.
    const next = service.pending(otherSources)!;
    await flush();
    expect(fetchCalls()).toHaveLength(2);
    expect(fetchCalls()[1].args.request.sources).toEqual(otherSources);
    expect(useStudioSourceFetchStore.getState().phase).toBe('checking');

    // The old fetch's late progress and refusal change nothing.
    emit({ fetchId, done: 30, total: 35, mountLabel: HOST });
    expect(useStudioSourceFetchStore.getState().phase).toBe('checking');
    fetchCalls()[0].reject(cancelled);
    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(useStudioSourceFetchStore.getState().phase).toBe('checking');
    expect(cancelCalls()).toHaveLength(1);

    fetchCalls()[1].resolve({ ...ready(2), remoteCount: 2 });
    await expect(next).resolves.toBeUndefined();
    expect(service.isLocal(otherSources)).toBe(true);
    expect(service.isLocal(sources)).toBe(false);
  });

  it('stays stopped for a request for more, until the user continues', async () => {
    const service = getStudioSourceFetchService();
    const pending = service.pending(sources)!;
    await flush();
    service.stop();
    // Stopped at once, before the backend answers.
    expect(useStudioSourceFetchStore.getState().phase).toBe('stopped');
    const mask = { path: `${MOUNT}/masks/brain.nii.gz`, label: 'Mask' };
    await expect(service.pending([...sources, mask])).rejects.toMatchObject({ kind: 'stopped' });
    await expect(service.pending(otherSources)).rejects.toMatchObject({ kind: 'stopped' });
    await flush();
    expect(fetchCalls()).toHaveLength(1);
    fetchCalls()[0].reject(cancelled);
    await expect(pending).rejects.toMatchObject({ kind: 'stopped' });
    expect(useStudioSourceFetchStore.getState().phase).toBe('stopped');
    await expect(service.pending([...sources, mask])).rejects.toMatchObject({ kind: 'stopped' });
    expect(fetchCalls()).toHaveLength(1);

    service.resume();
    void service.pending([...sources, mask])!.catch(() => undefined);
    await flush();
    expect(fetchCalls()).toHaveLength(2);
    expect(fetchCalls()[1].args.request.sources).toEqual([...sources, mask]);
  });

  it('can be stopped while nothing is in flight, and that holds too', async () => {
    const service = getStudioSourceFetchService();
    service.stop();
    expect(useStudioSourceFetchStore.getState().phase).toBe('stopped');
    await expect(service.pending(sources)).rejects.toMatchObject({ kind: 'stopped' });
    expect(fetchCalls()).toHaveLength(0);
    service.resume();
    void service.pending(sources)!.catch(() => undefined);
    await flush();
    expect(fetchCalls()).toHaveLength(1);
  });

  it('keeps the agreement to a large fetch for the images it was given for', async () => {
    const service = getStudioSourceFetchService();
    const pending = service.pending(sources)!;
    await flush();
    fetchCalls()[0].resolve({
      status: 'needs_confirmation',
      mountLabel: HOST,
      remoteCount: 35,
      fetchCount: 35,
      fetchBytes: 3 * 1024 ** 3,
      fetchedCount: 0,
    });
    await expect(pending).rejects.toMatchObject({ kind: 'confirm' });
    service.resume();

    // Something else is asked for first: it was not agreed to.
    const other = service.pending(otherSources)!;
    await flush();
    expect(fetchCalls()[1].args.request.sources).toEqual(otherSources);
    expect(fetchCalls()[1].args.request.allowLarge).toBe(false);
    fetchCalls()[1].resolve({ ...ready(2), remoteCount: 2 });
    await other;

    // Part of what was agreed to carries the agreement; more than it does not.
    const mask = { path: `${MOUNT}/masks/brain.nii.gz`, label: 'Mask' };
    const more = service.pending([...sources, mask])!;
    await flush();
    expect(fetchCalls()[2].args.request.allowLarge).toBe(false);
    fetchCalls()[2].reject({ Io: { code: 8256, details: 'stop here' } });
    await more.catch(() => undefined);
    const part = service.pending(sources.slice(0, 20))!;
    await flush();
    expect(fetchCalls()[3].args.request.allowLarge).toBe(true);
    fetchCalls()[3].resolve(ready(20));
    await part;
  });
});

describe('what the fetch reports', () => {
  it('shows the backend’s own words for a failed fetch, with the member and the host', async () => {
    const service = getStudioSourceFetchService();
    const pending = service.pending(sources)!;
    await flush();
    const details = `sub-1014: same_item.nii.gz could not be fetched from ${HOST}: No such file or directory (os error 2)`;
    fetchCalls()[0].reject({ Io: { code: 8256, details } });
    await expect(pending).rejects.toMatchObject({ kind: 'failed', message: details });
    expect(useStudioSourceFetchStore.getState()).toMatchObject({ phase: 'failed', message: details });
  });

  it('names the mount to reconnect when the fetch failed on a dropped connection', async () => {
    const { resetRemoteConnectionStore, useRemoteConnectionStore } = await import(
      '@/stores/remoteConnectionStore'
    );
    resetRemoteConnectionStore();
    useFileBrowserStore.setState({ recents: [], pinned: [] });
    const service = getStudioSourceFetchService();
    const pending = service.pending(sources)!;
    await flush();
    fetchCalls()[0].reject({
      Io: { code: 8252, details: 'The remote folder is not connected. Reconnect to continue.' },
    });
    await expect(pending).rejects.toMatchObject({ kind: 'failed' });
    expect(useStudioSourceFetchStore.getState()).toMatchObject({
      phase: 'failed',
      connectionLostPath: sources[0].path,
    });
    // The Files header says Disconnected for that mount.
    expect(useRemoteConnectionStore.getState().down).toEqual({ [MOUNT]: true });

    // Retry clears it; a failure of another kind names no mount.
    service.resume();
    expect(useStudioSourceFetchStore.getState().connectionLostPath).toBeNull();
    resetRemoteConnectionStore();
    const again = service.pending(sources)!;
    await flush();
    fetchCalls()[1].reject({
      Io: { code: 8251, details: `sub-1014: same_item.nii.gz is not on ${HOST}.` },
    });
    await expect(again).rejects.toMatchObject({ kind: 'failed' });
    expect(useStudioSourceFetchStore.getState()).toMatchObject({
      phase: 'failed',
      connectionLostPath: null,
    });
    expect(useRemoteConnectionStore.getState().down).toEqual({});

    // A dropped session met by the transfer itself (8266).
    service.resume();
    const third = service.pending(sources)!;
    await flush();
    fetchCalls()[2].reject({
      Io: { code: 8266, details: 'SSH error: SSH session disconnected' },
    });
    await expect(third).rejects.toMatchObject({ kind: 'failed' });
    expect(useStudioSourceFetchStore.getState().connectionLostPath).toBe(sources[0].path);
    expect(useRemoteConnectionStore.getState().down).toEqual({ [MOUNT]: true });
    resetRemoteConnectionStore();
  });

  it('says once, as information, that cached images were not re-checked offline', async () => {
    const notify = vi.spyOn(getEventBus(), 'emit');
    const service = getStudioSourceFetchService();
    const offline = { ...ready(0), unverifiedCount: 35 };
    const pending = service.pending(sources)!;
    await flush();
    fetchCalls()[0].resolve(offline);
    await pending;
    expect(service.isLocal(sources)).toBe(true);
    expect(useStudioSourceFetchStore.getState().phase).toBe('idle');
    const notes = () => notify.mock.calls.filter(([event]) => event === 'ui.notification');
    expect(notes()).toEqual([
      [
        'ui.notification',
        {
          type: 'info',
          message: `${HOST} is not connected, so the images of this set were not re-checked against it. The copies already on this computer are used.`,
        },
      ],
    ]);
    // Asked again while it is still offline: not said again.
    useFileBrowserStore.setState({ entries: [remoteMount('mount-2')] });
    const again = service.pending(sources)!;
    await flush();
    fetchCalls()[1].resolve(offline);
    await again;
    expect(notes()).toHaveLength(1);
    notify.mockRestore();
  });
});

describe('a cache path with Windows separators', () => {
  const ROOT = 'C:\\Users\\brad\\AppData\\Local\\Brainflow\\remote_mounts\\cache-ab12';
  it('is recognised as on its mount', async () => {
    useFileBrowserStore.setState({ entries: [{ ...remoteMount(), id: ROOT, path: ROOT }] });
    const service = getStudioSourceFetchService();
    const image = [{ path: `${ROOT}\\sub-01\\stat.nii.gz`, label: 'sub-01' }];
    expect(service.isLocal(image)).toBe(false);
    // A sibling folder that only shares the prefix is not on the mount.
    expect(service.isLocal([{ path: `${ROOT}-other\\sub-01\\stat.nii.gz` }])).toBe(true);
    const pending = service.pending(image)!;
    await flush();
    expect(fetchCalls()[0].args.request.sources).toEqual(image);
    fetchCalls()[0].resolve({ ...ready(1), remoteCount: 1 });
    await pending;
    expect(service.isLocal(image)).toBe(true);
  });
});

describe('an image the backend refuses though Files shows no remote folder for it', () => {
  const notFetched = {
    Io: { code: 8255, details: `same_item.nii.gz has not been fetched from ${HOST} yet.` },
  };
  const request = {
    members: sources.slice(0, 3).map((source) => ({ memberId: source.label, sourcePath: source.path })),
  };

  beforeEach(() => {
    useFileBrowserStore.setState({ entries: [] });
    useAppModeStore.setState({ mode: 'studio' });
  });
  afterEach(() => useAppModeStore.setState({ mode: 'imaging' }));

  it('shows the backend’s message with a Retry that asks the backend and fetches', async () => {
    const service = getStudioSourceFetchService();
    // Nothing says the set is remote, so nothing is fetched first.
    expect(awaitRequestSources(request)).toBeNull();
    noteRequestRefusal(notFetched, request);
    expect(useStudioSourceFetchStore.getState()).toMatchObject({
      phase: 'failed',
      message: `same_item.nii.gz has not been fetched from ${HOST} yet.`,
      refused: true,
    });
    expect(service.isLocal(sources.slice(0, 3))).toBe(false);
    expect(calls).toEqual([]);

    // Retry.
    service.resume();
    const retried = awaitRequestSources(request)!;
    await flush();
    expect(calls.map((call) => call.cmd)).toEqual(['list_remote_mounts']);
    calls[0].resolve([
      { mount_id: 'mount-9', local_path: MOUNT, display_name: 'dsets', origin: { host: HOST } },
    ]);
    await flush();
    expect(fetchCalls()).toHaveLength(1);
    expect(fetchCalls()[0].args.request.sources).toEqual(sources.slice(0, 3));
    fetchCalls()[0].resolve({ ...ready(3), remoteCount: 3 });
    await expect(retried).resolves.toBeUndefined();
    expect(service.isLocal(sources.slice(0, 3))).toBe(true);
    expect(awaitRequestSources(request)).toBeNull();
    expect(useStudioSourceFetchStore.getState().phase).toBe('idle');
  });

  it('says to reconnect when the folder is not connected, and Retry asks again', async () => {
    const service = getStudioSourceFetchService();
    const notConnected = {
      Io: { code: 8252, details: 'The remote folder is not connected. Reconnect to continue.' },
    };
    expect(service.refused(notConnected, sources.slice(0, 3))).toBe(true);
    expect(useStudioSourceFetchStore.getState().message).toBe(
      'The remote folder is not connected. Reconnect to continue.',
    );
    service.resume();
    const retried = service.pending(sources.slice(0, 3))!;
    await flush();
    calls[0].resolve([]);
    await flush();
    fetchCalls()[0].reject(notConnected);
    await expect(retried).rejects.toMatchObject({
      kind: 'failed',
      message: 'The remote folder is not connected. Reconnect to continue.',
    });
    // Still not local, and Retry is still there to ask again.
    expect(service.isLocal(sources.slice(0, 3))).toBe(false);
    expect(useStudioSourceFetchStore.getState().phase).toBe('failed');
  });

  it('leaves any other failure to whoever asked', () => {
    const service = getStudioSourceFetchService();
    expect(service.refused({ Input: { code: 2027, details: 'A frozen population query…' } }, sources)).toBe(false);
    noteRequestRefusal(new Error('Population sampling canceled or expired.'), request);
    expect(useStudioSourceFetchStore.getState()).toMatchObject({ phase: 'idle', refused: false });
    expect(service.isLocal(sources)).toBe(true);
  });
});

describe('requestSources', () => {
  it('lists every file the backend reads by its path', () => {
    const request = {
      members: [{ memberId: 'sub-01', sourcePath: `${MOUNT}/sub-01/stat.nii.gz` }],
      mask: { sourcePath: `${MOUNT}/masks/brain.nii.gz` },
      region: { labelSource: { type: 'path', path: `${MOUNT}/atlas/labels.nii.gz` }, labelIds: [3] },
      underlay: { sourcePath: `${MOUNT}/anat/mean_T1w.nii.gz` },
    };
    expect(requestSources(request)).toEqual([
      { path: `${MOUNT}/sub-01/stat.nii.gz`, label: 'sub-01' },
      { path: `${MOUNT}/masks/brain.nii.gz`, label: 'Mask' },
      { path: `${MOUNT}/atlas/labels.nii.gz`, label: 'Region labels' },
      { path: `${MOUNT}/anat/mean_T1w.nii.gz`, label: 'Underlay' },
    ]);
    // A layer region and a template underlay are not files on the mount.
    expect(
      requestSources({
        members: [],
        region: { labelSource: { type: 'layer', layerId: 'atlas' }, labelIds: [3] },
        underlay: { sourcePath: 'template:MNI152NLin2009cAsym_T1w_2mm' },
      }),
    ).toEqual([]);
  });

  it('fetches the region label file and the underlay with the members', async () => {
    const request = {
      members: [{ memberId: 'sub-1001', sourcePath: sources[0].path }],
      region: { labelSource: { type: 'path', path: `${MOUNT}/atlas/labels.nii.gz` }, labelIds: [3] },
      underlay: { sourcePath: `${MOUNT}/anat/mean_T1w.nii.gz` },
    };
    void awaitRequestSources(request)!.catch(() => undefined);
    await flush();
    expect(fetchCalls()[0].args.request.sources.map((source) => source.label)).toEqual([
      'sub-1001',
      'Region labels',
      'Underlay',
    ]);
  });
});

describe('Compare on a remote set', () => {
  const candidate = folderCandidate({ checked: true });
  const activeSet = { ...candidate.set, importContract: candidate.contract };
  const activeMember = activeSet.memberSummaries[0];
  const compareCohort = {
    id: 'all-members',
    label: 'All members',
    memberCount: 3,
    description: '',
    memberIds: activeSet.memberIds,
    originKind: 'imported' as const,
    originLabel: null,
  };
  const args = { activeSet, activeMember, compareCohort, activeExpression: null };

  it('fetches the group’s images before computing, and only those', async () => {
    const panes = new StudioCompareService().materializeComparePanes(args);
    await flush();
    expect(calls.map((call) => call.cmd)).toEqual(['fetch_studio_sources']);
    const requested = fetchCalls()[0].args.request.sources;
    expect(requested.map((source: StudioSource) => source.label)).toEqual(activeSet.memberIds);
    expect(
      requested.every((source: StudioSource) => source.path.endsWith('same_item.nii.gz')),
    ).toBe(true);
    fetchCalls()[0].resolve(ready(3));
    await flush();
    expect(calls.map((call) => call.cmd)).toEqual([
      'fetch_studio_sources',
      'start_set_studio_compare_materialization',
    ]);
    calls[1].reject(new Error('stop here'));
    await flush();
    calls.at(-1)!.reject(new Error('stop here'));
    await panes;
  });

  it('shows a failed fetch as the reason, in plain words, and computes nothing', async () => {
    const panes = new StudioCompareService().materializeComparePanes(args);
    await flush();
    fetchCalls()[0].reject({
      Io: { code: 8251, details: `sub-1007: same_item.nii.gz is not on ${HOST}.` },
    });
    const specs = await panes;
    const mean = specs.find((pane) => pane.id === 'cohort-mean')!;
    expect(mean.status).toBe('blocked');
    expect(mean.notReady).toBeNull();
    expect(mean.reason).toBe(
      `The mean could not be computed: sub-1007: same_item.nii.gz is not on ${HOST}.`,
    );
    expect(specs.find((pane) => pane.id === 'residual')!.notReady?.kind).toBe('no-mean');
    expect(calls.map((call) => call.cmd)).toEqual(['fetch_studio_sources']);
  });

  it('shows a stopped fetch as waiting, not as a failure', async () => {
    const service = getStudioSourceFetchService();
    const panes = new StudioCompareService().materializeComparePanes(args);
    await flush();
    service.stop();
    fetchCalls()[0].reject({ Input: { code: 8254, details: 'Image fetch cancelled.' } });
    const specs = await panes;
    for (const id of ['cohort-mean', 'residual'])
      expect(specs.find((pane) => pane.id === id)!.notReady).toEqual({
        kind: 'fetch',
        message: 'Needs images that have not been fetched from the remote folder yet.',
      });
    expect(specs.find((pane) => pane.id === 'current')!.notReady).toBeNull();
  });

  it('goes straight to the computation for a local set', async () => {
    useFileBrowserStore.setState({ entries: [] });
    const panes = new StudioCompareService().materializeComparePanes(args);
    // No fetch step and no tick spent on one.
    expect(calls.map((call) => call.cmd)).toEqual(['start_set_studio_compare_materialization']);
    calls[0].reject(new Error('stop here'));
    await flush();
    calls.at(-1)!.reject(new Error('stop here'));
    await panes;
    expect(fetchCalls()).toHaveLength(0);
  });

  it('names a missing image instead of showing the decoder’s nested error', () => {
    const path = activeSet.memberSummaries[1].sourcePath!;
    const specs = presentComparePaneSpecs(args, [
      {
        id: 'cohort-mean',
        title: 'All members',
        subtitle: '3 members',
        status: 'blocked',
        reason: `Cohort mean materialization failed: Failed to load ${path}: ScalingError: Could not load file with any supported data type: NeuroIM error: I/O error: No such file or directory (os error 2)`,
        recipe: null,
        binding: null,
      },
    ]);
    expect(specs[0].reason).toBe(
      'The mean could not be computed: sub-1007: same_item.nii.gz could not be found. It may have been moved or deleted.',
    );
    expect(specs[0].notReady).toBeNull();
  });
});

describe('plainStudioSourceError', () => {
  it('never shows a raw "os error 2"', () => {
    expect(plainStudioSourceError('No such file or directory (os error 2)')).toBe(
      'An image file of this set could not be found. It may have been moved or deleted, or its remote folder is not connected.',
    );
    expect(
      plainStudioSourceError(
        'Failed to load /Users/x/Library/Caches/org.Brainflow.Brainflow/remote_mounts/cache-ab12/sub-1014/same_item.nii.gz: ScalingError: Could not load file with any supported data type: NeuroIM error: I/O error: No such file or directory (os error 2)',
        () => 'sub-1014: same_item.nii.gz',
      ),
    ).toBe('sub-1014: same_item.nii.gz has not been fetched from the remote folder.');
  });

  it('leaves every other failure as it was reported', () => {
    for (const message of [
      'Population inputs have different world affines; explicit resampling is required.',
      'Population sampling canceled or expired.',
      'The remote folder is not connected. Reconnect to continue.',
    ])
      expect(plainStudioSourceError(message)).toBe(message);
  });
});
