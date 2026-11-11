import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetCard, DatasetMarker, SidecarCard } from '@brainflow/api';
import {
  CARD_ERROR_COUNTS,
  CARD_ERROR_DISCONNECTED,
  CARD_ERROR_NOT_CONNECTED,
  CARD_ERROR_TIMED_OUT,
  CARD_ERROR_UNREADABLE,
  DatasetCardService,
  MARKER_BATCH_LIMIT,
  MARKER_DEBOUNCE_MS,
  MARKER_RETRY_AFTER_FAILURE_MS,
  MARKER_TTL_MS,
  describeCardError,
} from '../DatasetCardService';
import { getEventBus } from '@/events/EventBus';
import { countsPending, markerKey, useDatasetCardStore } from '@/stores/datasetCardStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import type { FileTreeNode } from '@/types/filesystem';

const studio = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@/services/studio/SetStudioService', () => ({
  getSetStudioService: () => ({ openFolderOntologyInStudio: studio.open }),
}));

const ROOT = '/data/pcmri';

function marker(path: string, patch: Partial<DatasetMarker> = {}): DatasetMarker {
  return {
    path,
    hasDescription: true,
    analysisCount: null,
    analysisCountTruncated: false,
    summary: { name: null, datasetType: null, generatedBy: null },
    issue: null,
    ...patch,
  };
}

function datasetCard(path: string, patch: Partial<DatasetCard> = {}): DatasetCard {
  return {
    // A whole card, as the backend answers either phase once it holds one.
    phase: 'full',
    path,
    folderName: path.split('/').pop() ?? path,
    hasDescription: false,
    description: null,
    descriptionIssue: null,
    descriptionPath: null,
    descriptionRaw: null,
    descriptionRawTruncated: false,
    readme: null,
    contents: {
      subjectCount: 0,
      sessionCount: 0,
      tasks: [],
      spaces: [],
      imageCount: 0,
      hasGroupLevel: false,
      groupImageCount: 0,
      imageKinds: [],
      imageKindCount: 0,
      truncated: false,
      truncatedReason: null,
    },
    analyses: [],
    analysesPath: null,
    analysesTruncated: false,
    sourcePaths: [],
    ...patch,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Call = { cmd: string; args: Record<string, unknown> };

function harness() {
  const calls: Call[] = [];
  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    probe_dataset_markers: (args) => (args.paths as string[]).map((path) => marker(path)),
    cancel_population_sample: () => undefined,
  };
  const invoke = vi.fn(async (cmd: string, args?: unknown) => {
    const record = (args ?? {}) as Record<string, unknown>;
    calls.push({ cmd, args: record });
    const handler = handlers[cmd];
    if (!handler) throw new Error(`unexpected command ${cmd}`);
    return handler(record);
  });
  let now = 1_000_000;
  const service = new DatasetCardService({ invoke } as never, () => now);
  return {
    service,
    calls,
    handlers,
    of: (cmd: string) => calls.filter((call) => call.cmd === cmd),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const flushDebounce = () => vi.advanceTimersByTimeAsync(MARKER_DEBOUNCE_MS + 1);
const card = () => useDatasetCardStore.getState().card;

beforeEach(() => {
  vi.useFakeTimers();
  useDatasetCardStore.setState({ markers: {}, card: null });
  studio.open.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('marker probing', () => {
  it('sends the asks of one window as a single de-duplicated probe with the browse root', async () => {
    const h = harness();
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    h.service.requestMarkers(ROOT, [`${ROOT}/b`, `${ROOT}/a`]);
    h.service.requestMarkers(ROOT, [`${ROOT}/b`]);
    expect(h.of('probe_dataset_markers')).toHaveLength(0);
    await flushDebounce();
    expect(h.of('probe_dataset_markers')).toEqual([
      { cmd: 'probe_dataset_markers', args: { paths: [`${ROOT}/a`, `${ROOT}/b`], rootPath: ROOT } },
    ]);
    const { markers } = useDatasetCardStore.getState();
    expect(markers[markerKey(ROOT, `${ROOT}/a`)].marker.hasDescription).toBe(true);
    expect(markers[markerKey(ROOT, `${ROOT}/b`)].marker.path).toBe(`${ROOT}/b`);
  });

  it('never sends more than 128 paths in one call', async () => {
    const h = harness();
    const paths = Array.from({ length: 300 }, (_, i) => `${ROOT}/sub-${i}`);
    h.service.requestMarkers(ROOT, paths);
    await flushDebounce();
    const sizes = h.of('probe_dataset_markers').map((call) => (call.args.paths as string[]).length);
    expect(sizes).toEqual([MARKER_BATCH_LIMIT, MARKER_BATCH_LIMIT, 300 - 2 * MARKER_BATCH_LIMIT]);
    expect(h.of('probe_dataset_markers').flatMap((call) => call.args.paths as string[])).toEqual(
      paths,
    );
  });

  it('keeps one probe per browse root', async () => {
    const h = harness();
    h.service.requestMarkers('/a', ['/a/x']);
    h.service.requestMarkers('/b', ['/b/x']);
    await flushDebounce();
    expect(h.of('probe_dataset_markers').map((call) => call.args.rootPath)).toEqual(['/a', '/b']);
  });

  it('does not ask again within the TTL, and asks again after it', async () => {
    const h = harness();
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    await flushDebounce();
    h.advance(MARKER_TTL_MS - 1);
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    await flushDebounce();
    expect(h.of('probe_dataset_markers')).toHaveLength(1);
    h.advance(2);
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    await flushDebounce();
    expect(h.of('probe_dataset_markers')).toHaveLength(2);
  });

  it('does not ask for a path whose probe is still in flight', async () => {
    const h = harness();
    const pending = deferred<DatasetMarker[]>();
    h.handlers.probe_dataset_markers = () => pending.promise;
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    await flushDebounce();
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    await flushDebounce();
    expect(h.of('probe_dataset_markers')).toHaveLength(1);
    pending.resolve([marker(`${ROOT}/a`)]);
    await flushDebounce();
  });

  it('keeps the same marker object when a later probe answers the same', async () => {
    const h = harness();
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    await flushDebounce();
    const first = useDatasetCardStore.getState().markers[markerKey(ROOT, `${ROOT}/a`)].marker;
    h.advance(MARKER_TTL_MS + 1);
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    await flushDebounce();
    expect(useDatasetCardStore.getState().markers[markerKey(ROOT, `${ROOT}/a`)].marker).toBe(first);
  });

  it('leaves a failed probe alone for a while, then tries again', async () => {
    const h = harness();
    h.handlers.probe_dataset_markers = () => {
      throw { Io: { code: 8263, details: 'unreadable' } };
    };
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    await flushDebounce();
    expect(useDatasetCardStore.getState().markers).toEqual({});
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    await flushDebounce();
    expect(h.of('probe_dataset_markers')).toHaveLength(1);
    h.advance(MARKER_RETRY_AFTER_FAILURE_MS + 1);
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    await flushDebounce();
    expect(h.of('probe_dataset_markers')).toHaveLength(2);
  });

  it('drops an answer that arrives after the markers were forgotten', async () => {
    const h = harness();
    const pending = deferred<DatasetMarker[]>();
    h.handlers.probe_dataset_markers = () => pending.promise;
    h.service.requestMarkers(ROOT, [`${ROOT}/a`]);
    await flushDebounce();
    h.service.forgetMarkers(ROOT);
    pending.resolve([marker(`${ROOT}/a`)]);
    await flushDebounce();
    expect(useDatasetCardStore.getState().markers).toEqual({});
  });
});

describe('markers of rows that stay on screen', () => {
  const A = `${ROOT}/a`;
  const failing = () => {
    throw { Io: { code: 8263, details: 'unreadable' } };
  };
  const afterBackOff = () => vi.advanceTimersByTimeAsync(MARKER_RETRY_AFTER_FAILURE_MS + 1);

  it('asks once more after a failed probe, for a row that is still rendered', async () => {
    const h = harness();
    const working = h.handlers.probe_dataset_markers;
    h.handlers.probe_dataset_markers = failing;
    h.service.retainMarker(ROOT, A);
    await flushDebounce();
    expect(h.of('probe_dataset_markers')).toHaveLength(1);
    expect(useDatasetCardStore.getState().markers).toEqual({});

    h.handlers.probe_dataset_markers = working;
    await afterBackOff();
    await flushDebounce();
    expect(h.of('probe_dataset_markers')).toHaveLength(2);
    expect(useDatasetCardStore.getState().markers[markerKey(ROOT, A)].marker.path).toBe(A);
  });

  it('does not ask again for a row that went away, and retries a broken folder only once', async () => {
    const h = harness();
    h.handlers.probe_dataset_markers = failing;
    const release = h.service.retainMarker(ROOT, A);
    h.service.retainMarker(ROOT, `${ROOT}/b`);
    await flushDebounce();
    release();
    await afterBackOff();
    await flushDebounce();
    expect(h.of('probe_dataset_markers').map((call) => call.args.paths)).toEqual([
      [A, `${ROOT}/b`],
      [`${ROOT}/b`],
    ]);
    // The retry failed too: the folder is left alone until its row returns.
    await afterBackOff();
    await afterBackOff();
    expect(h.of('probe_dataset_markers')).toHaveLength(2);
  });

  it('asks afresh for a rendered row whose answer was voided by a forget', async () => {
    const h = harness();
    const first = deferred<DatasetMarker[]>();
    const answers = [first.promise];
    h.handlers.probe_dataset_markers = (args) =>
      answers.shift() ?? (args.paths as string[]).map((path) => marker(path, { issue: 'new' }));
    h.service.retainMarker(ROOT, A);
    await flushDebounce();
    h.service.forgetMarkers(ROOT);
    first.resolve([marker(A, { issue: 'old' })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(useDatasetCardStore.getState().markers).toEqual({});
    await flushDebounce();
    expect(h.of('probe_dataset_markers')).toHaveLength(2);
    expect(useDatasetCardStore.getState().markers[markerKey(ROOT, A)].marker.issue).toBe('new');
  });

  it('forgetting one root leaves another root’s probe standing', async () => {
    const h = harness();
    const pending = deferred<DatasetMarker[]>();
    h.handlers.probe_dataset_markers = () => pending.promise;
    h.service.requestMarkers('/other', ['/other/x']);
    await flushDebounce();
    h.service.forgetMarkers(ROOT);
    pending.resolve([marker('/other/x')]);
    await flushDebounce();
    expect(useDatasetCardStore.getState().markers[markerKey('/other', '/other/x')]).toBeDefined();
  });

  it('discards an answer whose length does not match the paths asked', async () => {
    const h = harness();
    h.handlers.probe_dataset_markers = () => [marker(`${ROOT}/b`)];
    h.service.requestMarkers(ROOT, [A, `${ROOT}/b`]);
    await flushDebounce();
    // Matched by position, the one answer would have been filed under `a`.
    expect(useDatasetCardStore.getState().markers).toEqual({});
  });

  it('writes the store only when a marker changed', async () => {
    const h = harness();
    h.service.requestMarkers(ROOT, [A]);
    await flushDebounce();
    let writes = 0;
    const unsubscribe = useDatasetCardStore.subscribe(() => {
      writes += 1;
    });
    h.advance(MARKER_TTL_MS + 1);
    h.service.requestMarkers(ROOT, [A]);
    await flushDebounce();
    expect(h.of('probe_dataset_markers')).toHaveLength(2);
    expect(writes).toBe(0);
    // The unchanged answer still renews the marker: no third probe yet.
    h.advance(MARKER_TTL_MS - 1);
    h.service.requestMarkers(ROOT, [A]);
    await flushDebounce();
    expect(h.of('probe_dataset_markers')).toHaveLength(2);

    h.handlers.probe_dataset_markers = () => [marker(A, { issue: 'changed' })];
    h.advance(2);
    h.service.requestMarkers(ROOT, [A]);
    await flushDebounce();
    expect(writes).toBe(1);
    unsubscribe();
  });

  it('refresh keeps the marker on show until the new probe answers', async () => {
    const h = harness();
    h.handlers.get_dataset_card = (args) => datasetCard(args.path as string);
    h.service.requestMarkers(ROOT, [A]);
    await flushDebounce();
    const before = useDatasetCardStore.getState().markers[markerKey(ROOT, A)].marker;
    h.service.openDatasetCard({ rootPath: ROOT, path: A });
    await vi.advanceTimersByTimeAsync(0);

    const pending = deferred<DatasetMarker[]>();
    h.handlers.probe_dataset_markers = () => pending.promise;
    h.service.refresh();
    expect(useDatasetCardStore.getState().markers[markerKey(ROOT, A)].marker).toBe(before);
    await flushDebounce();
    // Asked although the marker is fresh, and still shown while that is out.
    expect(h.of('probe_dataset_markers')).toHaveLength(2);
    expect(useDatasetCardStore.getState().markers[markerKey(ROOT, A)].marker).toBe(before);
    pending.resolve([marker(A, { analysisCount: 3 })]);
    await flushDebounce();
    expect(useDatasetCardStore.getState().markers[markerKey(ROOT, A)].marker.analysisCount).toBe(3);
  });
});

describe('card loading', () => {
  it('loads a dataset card under a ticket and passes the browse root', async () => {
    const h = harness();
    h.handlers.get_dataset_card = (args) => datasetCard(args.path as string);
    h.service.openDatasetCard({ rootPath: ROOT, path: `${ROOT}/derivatives/glm` });
    expect(card()).toMatchObject({ status: 'loading', kind: 'dataset' });
    await vi.advanceTimersByTimeAsync(0);
    const [call] = h.of('get_dataset_card');
    expect(call.args).toMatchObject({
      path: `${ROOT}/derivatives/glm`,
      rootPath: ROOT,
      refresh: false,
      phase: 'descriptions',
    });
    const ticket = call.args.ticket as { id: string; expiresAtMs: number };
    expect(ticket.id).toEqual(expect.any(String));
    expect(ticket.expiresAtMs).toBe(1_000_000 + 120_000);
    expect(card()).toMatchObject({ status: 'ready', path: `${ROOT}/derivatives/glm` });
    expect(h.of('cancel_population_sample')).toHaveLength(0);
  });

  it('latest wins: a superseded load is cancelled by its ticket and its answer is dropped', async () => {
    const h = harness();
    const first = deferred<DatasetCard>();
    const second = deferred<DatasetCard>();
    h.handlers.get_dataset_card = (args) =>
      args.path === `${ROOT}/a` ? first.promise : second.promise;
    h.service.openDatasetCard({ rootPath: ROOT, path: `${ROOT}/a` });
    await vi.advanceTimersByTimeAsync(0);
    const firstTicket = h.of('get_dataset_card')[0].args.ticket;
    h.service.openDatasetCard({ rootPath: ROOT, path: `${ROOT}/b` });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.of('cancel_population_sample').map((call) => call.args.ticket)).toEqual([firstTicket]);

    // The late answer of the first load must not replace the second card.
    first.resolve(datasetCard(`${ROOT}/a`));
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toMatchObject({ path: `${ROOT}/b`, status: 'loading' });

    second.resolve(datasetCard(`${ROOT}/b`));
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toMatchObject({ path: `${ROOT}/b`, status: 'ready' });
    expect(card()?.dataset?.path).toBe(`${ROOT}/b`);
  });

  it('closing cancels the load, and its late answer or cancellation error shows nothing', async () => {
    const h = harness();
    const pending = deferred<DatasetCard>();
    h.handlers.get_dataset_card = () => pending.promise;
    h.service.openDatasetCard({ rootPath: ROOT, path: `${ROOT}/a` });
    await vi.advanceTimersByTimeAsync(0);
    h.service.close();
    expect(h.of('cancel_population_sample')).toHaveLength(1);
    expect(card()).toBeNull();
    pending.reject({ Input: { code: 2026, details: 'Population sampling canceled or expired.' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toBeNull();
  });

  it.each([
    [8232, CARD_ERROR_NOT_CONNECTED],
    [8262, CARD_ERROR_DISCONNECTED],
    [8263, CARD_ERROR_UNREADABLE],
  ])('shows bridge error %i inside the card', async (code, message) => {
    const h = harness();
    h.handlers.get_dataset_card = () => {
      throw { Io: { code, details: 'backend wording with /local/cache/path' } };
    };
    h.service.openDatasetCard({ rootPath: ROOT, path: `${ROOT}/a` });
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toMatchObject({ status: 'error', error: message, path: `${ROOT}/a` });
  });

  it('reports a ticket the backend ended at its deadline as a timeout, not as silence', async () => {
    const h = harness();
    h.handlers.get_dataset_card = () => {
      throw { Input: { code: 2026, details: 'Population sampling canceled or expired.' } };
    };
    h.service.openDatasetCard({ rootPath: ROOT, path: `${ROOT}/a` });
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toMatchObject({ status: 'error', error: CARD_ERROR_TIMED_OUT });
  });

  it('maps a cancellation to no message', () => {
    expect(describeCardError({ Input: { code: 2026, details: 'x' } })).toBeNull();
  });

  it('retry reads the same card again; refresh asks for a recount and a new marker', async () => {
    const h = harness();
    let fail = true;
    h.handlers.get_dataset_card = (args) => {
      if (fail) throw { Io: { code: 8263, details: 'x' } };
      return datasetCard(args.path as string);
    };
    h.service.openDatasetCard({ rootPath: ROOT, path: `${ROOT}/a` });
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.status).toBe('error');
    fail = false;
    h.service.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.status).toBe('ready');
    expect(h.of('get_dataset_card')[1].args.refresh).toBe(false);

    h.service.refresh();
    await flushDebounce();
    expect(h.of('get_dataset_card')[2].args).toMatchObject({ path: `${ROOT}/a`, refresh: true });
    expect(h.of('probe_dataset_markers')).toEqual([
      { cmd: 'probe_dataset_markers', args: { paths: [`${ROOT}/a`], rootPath: ROOT } },
    ]);
  });

  it('details moves the card to an analysis; back restores the collection without reading', async () => {
    const h = harness();
    h.handlers.get_dataset_card = (args) => datasetCard(args.path as string);
    h.service.openDatasetCard({ rootPath: ROOT, path: ROOT });
    await vi.advanceTimersByTimeAsync(0);
    const collection = card()?.dataset;
    h.service.showAnalysis(`${ROOT}/derivatives/glm`);
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toMatchObject({
      path: `${ROOT}/derivatives/glm`,
      originPath: ROOT,
      rootPath: ROOT,
      status: 'ready',
    });
    expect(card()?.backStack.map((entry) => entry.path)).toEqual([ROOT]);
    h.service.back();
    expect(card()).toMatchObject({ path: ROOT, status: 'ready', backStack: [] });
    expect(card()?.dataset).toBe(collection);
    expect(h.of('get_dataset_card')).toHaveLength(2);
  });

  it('going back while the analysis is still loading cancels that load', async () => {
    const h = harness();
    const pending = deferred<DatasetCard>();
    h.handlers.get_dataset_card = (args) =>
      args.path === ROOT ? datasetCard(ROOT) : pending.promise;
    h.service.openDatasetCard({ rootPath: ROOT, path: ROOT });
    await vi.advanceTimersByTimeAsync(0);
    h.service.showAnalysis(`${ROOT}/derivatives/glm`);
    await vi.advanceTimersByTimeAsync(0);
    h.service.back();
    expect(h.of('cancel_population_sample')).toHaveLength(1);
    pending.resolve(datasetCard(`${ROOT}/derivatives/glm`));
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toMatchObject({ path: ROOT, status: 'ready' });
  });

  it('loads a sidecar card, and Space on the same row closes it again', async () => {
    const h = harness();
    const sidecar: SidecarCard = {
      path: `${ROOT}/sub-01/func/sub-01_task-x_bold.nii.gz`,
      fileName: 'sub-01_task-x_bold.nii.gz',
      header: null,
      headerIssue: null,
      datasetRoot: ROOT,
      entityNamed: true,
      entries: [],
      sidecarPaths: [],
      issues: [],
      truncated: false,
    };
    h.handlers.get_sidecar_card = () => sidecar;
    const request = { rootPath: ROOT, path: sidecar.path };
    h.service.toggleCard('sidecar', request);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.of('get_sidecar_card')[0].args).toMatchObject({ path: sidecar.path, rootPath: ROOT });
    expect(card()).toMatchObject({ kind: 'sidecar', status: 'ready', sidecar });
    h.service.toggleCard('sidecar', request);
    expect(card()).toBeNull();
  });
});

describe('progressive loading', () => {
  const GLM = `${ROOT}/derivatives/glm`;
  const outline = (path: string, patch: Partial<DatasetCard> = {}) =>
    datasetCard(path, { phase: 'descriptions', ...patch });
  const whole = (path: string, patch: Partial<DatasetCard> = {}) =>
    datasetCard(path, {
      contents: { ...datasetCard(path).contents, subjectCount: 35, imageCount: 105 },
      ...patch,
    });
  /** One deferred answer per (path, phase). */
  function phased(h: ReturnType<typeof harness>) {
    const answers = new Map<string, Deferred<DatasetCard>>();
    const of = (path: string, phase: string) => {
      const key = `${phase}:${path}`;
      let answer = answers.get(key);
      if (!answer) answers.set(key, (answer = deferred<DatasetCard>()));
      return answer;
    };
    h.handlers.get_dataset_card = (args) => of(args.path as string, args.phase as string).promise;
    return of;
  }
  const phases = (h: ReturnType<typeof harness>) =>
    h.of('get_dataset_card').map((call) => `${call.args.phase}:${call.args.refresh}`);

  it('shows the descriptions as soon as they arrive, then fills in the counts', async () => {
    const h = harness();
    const answer = phased(h);
    h.service.openDatasetCard({ rootPath: ROOT, path: GLM });
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toMatchObject({ status: 'loading' });
    expect(phases(h)).toEqual(['descriptions:false']);

    answer(GLM, 'descriptions').resolve(outline(GLM, { hasDescription: true }));
    await vi.advanceTimersByTimeAsync(0);
    // Usable now: the card is ready, and its counts are known to be pending.
    expect(card()).toMatchObject({ status: 'ready', countsError: null });
    expect(card()?.dataset?.phase).toBe('descriptions');
    expect(countsPending(card())).toBe(true);
    expect(phases(h)).toEqual(['descriptions:false', 'full:false']);
    // Each phase runs under a ticket of its own.
    const [first, second] = h.of('get_dataset_card').map((call) => call.args.ticket);
    expect((first as { id: string }).id).not.toBe((second as { id: string }).id);

    answer(GLM, 'full').resolve(whole(GLM));
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.dataset).toMatchObject({ phase: 'full', contents: { subjectCount: 35 } });
    expect(countsPending(card())).toBe(false);
    expect(h.of('cancel_population_sample')).toHaveLength(0);
  });

  it('asks for nothing more when the first answer is already the whole card', async () => {
    const h = harness();
    h.handlers.get_dataset_card = (args) => whole(args.path as string);
    h.service.openDatasetCard({ rootPath: ROOT, path: GLM });
    await vi.advanceTimersByTimeAsync(0);
    expect(phases(h)).toEqual(['descriptions:false']);
    expect(countsPending(card())).toBe(false);
    expect(card()?.dataset?.contents.subjectCount).toBe(35);
  });

  it('closing during the count cancels the walk by its ticket, and a late count shows nothing', async () => {
    const h = harness();
    const answer = phased(h);
    h.service.openDatasetCard({ rootPath: ROOT, path: GLM });
    await vi.advanceTimersByTimeAsync(0);
    answer(GLM, 'descriptions').resolve(outline(GLM));
    await vi.advanceTimersByTimeAsync(0);
    const walk = h.of('get_dataset_card')[1].args.ticket;
    h.service.close();
    expect(h.of('cancel_population_sample').map((call) => call.args.ticket)).toEqual([walk]);
    answer(GLM, 'full').resolve(whole(GLM));
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toBeNull();
  });

  it('latest wins across phases: another card stops the count of the one it replaced', async () => {
    const h = harness();
    const answer = phased(h);
    h.service.openDatasetCard({ rootPath: ROOT, path: `${ROOT}/a` });
    await vi.advanceTimersByTimeAsync(0);
    answer(`${ROOT}/a`, 'descriptions').resolve(outline(`${ROOT}/a`));
    await vi.advanceTimersByTimeAsync(0);
    const walk = h.of('get_dataset_card')[1].args.ticket;

    h.service.openDatasetCard({ rootPath: ROOT, path: `${ROOT}/b` });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.of('cancel_population_sample').map((call) => call.args.ticket)).toEqual([walk]);
    // Neither the late count nor its cancellation error touches the new card.
    answer(`${ROOT}/a`, 'full').resolve(whole(`${ROOT}/a`));
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toMatchObject({ path: `${ROOT}/b`, status: 'loading' });
    answer(`${ROOT}/b`, 'descriptions').resolve(outline(`${ROOT}/b`));
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.dataset).toMatchObject({ path: `${ROOT}/b`, phase: 'descriptions' });
  });

  it('a superseded descriptions phase does not start its count', async () => {
    const h = harness();
    const answer = phased(h);
    h.service.openDatasetCard({ rootPath: ROOT, path: `${ROOT}/a` });
    await vi.advanceTimersByTimeAsync(0);
    h.service.close();
    answer(`${ROOT}/a`, 'descriptions').resolve(outline(`${ROOT}/a`));
    await vi.advanceTimersByTimeAsync(0);
    expect(phases(h)).toEqual(['descriptions:false']);
    expect(card()).toBeNull();
  });

  it('keeps the descriptions when the count fails, and retry counts again', async () => {
    const h = harness();
    let failCount = true;
    h.handlers.get_dataset_card = (args) => {
      if (args.phase === 'descriptions') return outline(args.path as string);
      if (failCount) throw { Io: { code: 8262, details: 'x' } };
      return whole(args.path as string);
    };
    h.service.openDatasetCard({ rootPath: ROOT, path: GLM });
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toMatchObject({ status: 'ready', countsError: CARD_ERROR_DISCONNECTED });
    expect(card()?.dataset?.phase).toBe('descriptions');
    expect(countsPending(card())).toBe(false);

    failCount = false;
    h.service.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).toMatchObject({ status: 'ready', countsError: null });
    expect(card()?.dataset?.phase).toBe('full');
  });

  it('counts again without reading the descriptions again or unmounting what is shown', async () => {
    const h = harness();
    let failCount = true;
    h.handlers.get_dataset_card = (args) => {
      if (args.phase === 'descriptions') return outline(args.path as string);
      if (failCount) throw { Io: { code: 8263, details: 'x' } };
      return whole(args.path as string);
    };
    h.service.openDatasetCard({ rootPath: ROOT, path: GLM });
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.countsError).not.toBeNull();
    const shown = card()?.dataset;
    expect(phases(h)).toEqual(['descriptions:false', 'full:false']);

    // Every state the card passes through on the way to its counts.
    const seen: Array<string | undefined> = [];
    const stop = useDatasetCardStore.subscribe((state) => seen.push(state.card?.status));
    failCount = false;
    h.service.retry();
    // At once, and with the very descriptions that were on show: the view
    // stays mounted, so its filter, sort and raw JSON survive.
    expect(card()).toMatchObject({ status: 'ready', countsError: null });
    expect(card()?.dataset).toBe(shown);
    expect(countsPending(card())).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(card()?.dataset?.phase).toBe('full');
    // Only the count was asked for again.
    expect(phases(h)).toEqual(['descriptions:false', 'full:false', 'full:false']);
    expect(seen.every((status) => status === 'ready')).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('says the count failed when the backend ended it without a reason to show', async () => {
    const h = harness();
    h.handlers.get_dataset_card = (args) => {
      if (args.phase === 'descriptions') return outline(args.path as string);
      throw { Input: { code: 2026, details: 'x' } };
    };
    h.service.openDatasetCard({ rootPath: ROOT, path: GLM });
    await vi.advanceTimersByTimeAsync(0);
    // The ticket's deadline, not our abort: it is a timeout, said as one.
    expect(card()?.countsError).toBe(CARD_ERROR_TIMED_OUT);
    expect(CARD_ERROR_COUNTS).toMatch(/could not be counted/);
  });

  it('refresh travels with the first phase only', async () => {
    const h = harness();
    h.handlers.get_dataset_card = (args) =>
      args.phase === 'descriptions' ? outline(args.path as string) : whole(args.path as string);
    h.service.openDatasetCard({ rootPath: ROOT, path: GLM });
    await vi.advanceTimersByTimeAsync(0);
    h.service.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(phases(h)).toEqual([
      'descriptions:false',
      'full:false',
      'descriptions:true',
      'full:false',
    ]);
  });

  it('opening an analysis before the collection is counted, then going back, resumes the count', async () => {
    const h = harness();
    const answer = phased(h);
    h.service.openDatasetCard({ rootPath: ROOT, path: ROOT });
    await vi.advanceTimersByTimeAsync(0);
    answer(ROOT, 'descriptions').resolve(outline(ROOT));
    await vi.advanceTimersByTimeAsync(0);
    const firstWalk = h.of('get_dataset_card')[1].args.ticket;

    h.service.showAnalysis(GLM);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.of('cancel_population_sample').map((call) => call.args.ticket)).toEqual([firstWalk]);
    expect(card()?.backStack[0].data.phase).toBe('descriptions');

    h.service.back();
    // Shown again at once, from what was read; only the count is asked for.
    expect(card()).toMatchObject({ path: ROOT, status: 'ready', backStack: [] });
    expect(countsPending(card())).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(phases(h)).toEqual([
      'descriptions:false',
      'full:false',
      'descriptions:false',
      'full:false',
    ]);
    expect(h.of('get_dataset_card')[3].args.path).toBe(ROOT);
    // The first walk was cancelled, so the answer comes from the second.
    answer(ROOT, 'full').resolve(whole(ROOT));
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.dataset?.phase).toBe('full');
  });
});

describe('open as set', () => {
  const root: FileTreeNode = {
    id: ROOT,
    name: 'pcmri',
    path: ROOT,
    type: 'directory',
    depth: 0,
    mountSource: { kind: 'local' },
  };

  it('hands the folder to the Set studio folder review and closes the card', async () => {
    useFileBrowserStore.setState({ entries: [root] });
    const h = harness();
    h.handlers.get_dataset_card = (args) => datasetCard(args.path as string);
    h.service.openDatasetCard({ rootPath: ROOT, path: `${ROOT}/derivatives/glm` });
    await vi.advanceTimersByTimeAsync(0);
    await h.service.openAsSet(`${ROOT}/derivatives/glm`);
    expect(studio.open).toHaveBeenCalledWith({ discoveryRoot: `${ROOT}/derivatives/glm` });
    expect(card()).toBeNull();
  });

  it('reports a folder review that could not be opened instead of rejecting', async () => {
    useFileBrowserStore.setState({ entries: [root] });
    const emit = vi.spyOn(getEventBus(), 'emit');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    studio.open.mockRejectedValue(new Error('no workspace'));
    const h = harness();
    await expect(h.service.openAsSet(`${ROOT}/derivatives/glm`)).resolves.toBeUndefined();
    expect(emit).toHaveBeenCalledWith(
      'ui.notification',
      expect.objectContaining({ type: 'error', message: 'Could not open glm as a set.' }),
    );
    emit.mockRestore();
    logged.mockRestore();
  });

  it('does nothing for a folder that is under no mounted root', async () => {
    useFileBrowserStore.setState({ entries: [root] });
    const h = harness();
    await h.service.openAsSet('/elsewhere/glm');
    expect(studio.open).not.toHaveBeenCalled();
  });
});
