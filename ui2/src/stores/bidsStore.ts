import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { enableMapSet } from 'immer';
import type {
  BidsBrowserIndex,
  BidsDatasetSummary,
  BidsEventRow,
  BidsExclusion,
  BidsExclusionContext,
  BidsExclusionKey,
  BidsExclusionWrite,
  BidsFinding,
  BidsRunDetail,
  BidsRunRecord,
  BidsScanProgress,
} from '@brainflow/api';
import { getTransport } from '@/services/transport';
import { copyToClipboard } from '@/utils/copyToClipboard';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';
import {
  DEFAULT_FD_THRESHOLD_MM,
  buildLensExport,
  deriveBidsModel,
  lensExportLabel,
  naturalCompare,
  nextRunId,
  type BidsCensorCriterion,
  type BidsLens,
  type BidsLensMode,
  type BidsModel,
  type BidsMoveDirection,
} from './bidsModel';

enableMapSet();

export type {
  BidsBrowserIndex,
  BidsCoverageCell,
  BidsCoverageColumn,
  BidsCoverageMatrix,
  BidsDatasetSummary,
  BidsEventRow,
  BidsParticipantRow,
  BidsTaskDesign,
  BidsValidationIssue,
  BidsValidationResult,
} from '@brainflow/api';

// UI-only types
export type BidsDetailTab = 'events' | 'validation';
export type BidsActiveView = 'coverage' | 'images';
export type BidsScanStatus = 'idle' | 'scanning' | 'ready' | 'error';

export interface BidsSelection {
  subjectId: string | null;
  sessionId: string | null;
  modality: string | null;
}

/** What the keyboard asked for that a later step's dialogs and panels carry out. */
export type BidsActionRequestKind = 'quick-look' | 'compare' | 'exclude' | 'go-to';
export interface BidsActionRequest {
  kind: BidsActionRequestKind;
  runId: string | null;
  nonce: number;
}

export interface BidsUndoEntry {
  id: number;
  /** Rows this write added, as the writer reported them. */
  added: BidsExclusion[];
}

interface BidsState {
  datasetPath: string | null;
  /** While scanning: what has arrived so far, `complete: false`. */
  index: BidsBrowserIndex | null;
  scanId: string | null;
  scanStatus: BidsScanStatus;
  scanError: string | null;
  scanProgress: BidsScanProgress | null;
  selectedRunId: string | null;
  activeView: BidsActiveView;
  fdThreshold: number;
  censor: BidsCensorCriterion | null;
  groupBy: string | null | undefined;
  lens: BidsLens | null;
  lensMode: BidsLensMode;
  savedLenses: BidsLens[];
  exclusions: BidsExclusion[];
  /** `exclusions` reflects the disk. Nothing may be excluded before it does. */
  exclusionsLoaded: boolean;
  undoStack: BidsUndoEntry[];
  runDetails: Record<string, BidsRunDetail>;
  actionRequest: BidsActionRequest | null;
  /** The Inspector shows the selected run beside the dataset median. */
  compareWithModal: boolean;
  /** A write this session: `dataset_description.json` exists from here on. */
  exclusionsWritten: boolean;

  // v1: `summary`, `hoveredCell` and `activeDetailTab` are read only by the
  // retired components (BidsCoverageMatrix, BidsDetailTabs, BidsEventsTimeline,
  // BidsSummaryStrip, BidsValidationPanel). Remove them together.
  summary: BidsDatasetSummary | null;
  eventsCache: Map<string, BidsEventRow[]>;
  selection: BidsSelection;
  hoveredCell: { row: number; col: number } | null;
  activeDetailTab: BidsDetailTab;
}

interface BidsActions {
  /** Start a streaming scan of `path`, superseding any scan in flight. */
  scanDataset: (path: string) => Promise<void>;
  /** Pause: the scan keeps its partial results and the index stays `complete: false`. */
  cancelScan: () => Promise<void>;
  selectRun: (runId: string | null) => void;
  moveSelection: (direction: BidsMoveDirection) => void;
  setActiveView: (view: BidsActiveView) => void;
  setFdThreshold: (mm: number) => void;
  setCensor: (criterion: BidsCensorCriterion | null) => void;
  setGroupBy: (column: string | null) => void;
  setLens: (lens: BidsLens | null) => void;
  setLensMode: (mode: BidsLensMode) => void;
  /** `name` labels the saved copy; the lens keeps its own label without one. */
  saveLens: (name?: string) => void;
  deleteSavedLens: (id: string) => void;
  loadRunDetail: (runId: string) => Promise<BidsRunDetail | null>;
  /** `expectedDatasetPath` is the dataset the rows were made from: a write to any other throws. */
  writeExclusions: (
    rows: BidsExclusion[],
    context: BidsExclusionContext,
    expectedDatasetPath: string | null,
  ) => Promise<void>;
  revertExclusions: (keys: BidsExclusionKey[]) => Promise<void>;
  /**
   * The events table of a run, inherited or its own. `datasetPath` pins it to
   * the dataset the run came from; run ids repeat across datasets.
   */
  loadRunEvents: (runId: string, datasetPath?: string | null) => Promise<BidsEventRow[]>;
  undoExclusion: () => Promise<void>;
  /** Seam for the Findings, Inspector and dialog step. */
  requestAction: (kind: BidsActionRequestKind) => void;
  clearActionRequest: () => void;
  toggleCompare: () => void;

  loadEvents: (subject: string, task: string, session?: string, run?: string) => Promise<BidsEventRow[]>;
  selectSubject: (id: string | null) => void;
  selectCell: (subjectId: string, sessionId: string | null, modality: string) => void;
  setHoveredCell: (cell: { row: number; col: number } | null) => void;
  setDetailTab: (tab: BidsDetailTab) => void;
  reset: () => void;
}

interface BidsStore extends BidsState, BidsActions {}

const initialState: BidsState = {
  datasetPath: null,
  index: null,
  scanId: null,
  scanStatus: 'idle',
  scanError: null,
  scanProgress: null,
  selectedRunId: null,
  activeView: 'coverage',
  fdThreshold: DEFAULT_FD_THRESHOLD_MM,
  censor: null,
  groupBy: undefined,
  lens: null,
  lensMode: 'highlight',
  savedLenses: [],
  exclusions: [],
  exclusionsLoaded: false,
  undoStack: [],
  runDetails: {},
  actionRequest: null,
  compareWithModal: false,
  exclusionsWritten: false,
  summary: null,
  eventsCache: new Map(),
  selection: { subjectId: null, sessionId: null, modality: null },
  hoveredCell: null,
  activeDetailTab: 'validation',
};

/**
 * Identity of the current scan and dataset. A dataset switch, rescan or reset
 * bumps it; anything that started under an older value drops its result.
 */
let scanGeneration = 0;
let scanCounter = 0;
let undoCounter = 0;
let actionNonce = 0;
/**
 * Moves when a write or revert starts and when it lands: rows read across
 * either of those may predate it, and must not replace what it wrote.
 */
let exclusionRevision = 0;
const detailRequests = new Map<string, Promise<BidsRunDetail | null>>();

/** Progress events arrive per subject; rendering them is coalesced to this. */
export const BIDS_PROGRESS_FLUSH_MS = 120;

const LAST_DATASET_KEY = 'brainflow.bids.lastDataset';

/** The dataset last opened, for the empty state: a restored tab has no scan. */
export function lastBidsDataset(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_DATASET_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The bridge's words for a mirror path no mount answers for. */
const MIRROR_WITHOUT_MOUNT = 'is a cached copy of a remote dataset';

function rememberDataset(path: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_DATASET_KEY, path);
  } catch {
    // Storage unavailable: the tab just will not offer it next time.
  }
}

/** A mirror is not a dataset to reopen: without its mount it cannot be scanned. */
function forgetDataset(path: string): void {
  try {
    if (lastBidsDataset() === path) globalThis.localStorage?.removeItem(LAST_DATASET_KEY);
  } catch {
    // Storage unavailable: nothing was offered from it either.
  }
}

const lensStorageKey = (path: string) => `brainflow.bids.lenses:${path}`;

function isStoredLens(value: unknown): value is BidsLens {
  if (typeof value !== 'object' || value === null) return false;
  const lens = value as Partial<BidsLens>;
  return (
    typeof lens.id === 'string' &&
    typeof lens.label === 'string' &&
    typeof lens.predicate === 'object' &&
    lens.predicate !== null
  );
}

function readSavedLenses(path: string): BidsLens[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(lensStorageKey(path)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isStoredLens) : [];
  } catch {
    return [];
  }
}

function writeSavedLenses(path: string | null, lenses: BidsLens[]): void {
  if (!path) return;
  try {
    globalThis.localStorage?.setItem(lensStorageKey(path), JSON.stringify(lenses));
  } catch {
    // Storage full or unavailable: the lens still applies for this session.
  }
}

function emptyIndex(
  path: string,
  scanId: string,
  previous: BidsBrowserIndex | null,
): BidsBrowserIndex {
  // A rescan keeps what only the final index carries, such as participants.tsv.
  if (previous) {
    return { ...previous, scan_id: scanId, complete: false, subjects: [], runs: [], findings: [], variants: [] };
  }
  return {
    scan_id: scanId,
    dataset_path: path,
    name: path.split('/').filter(Boolean).pop() ?? path,
    bids_version: '',
    dataset_version: null,
    doi: null,
    license: null,
    authors: [],
    scanner: null,
    is_remote: false,
    listing_complete: true,
    complete: false,
    default_author: '',
    previous_scan_at: null,
    new_subjects: [],
    total_file_count: 0,
    total_size_bytes: 0,
    files_read: 0,
    files_opened: 0,
    session_order: [],
    participants: [],
    participant_columns: [],
    subjects: [],
    runs: [],
    series_modal: [],
    variants: [],
    findings: [],
    derivatives: [],
    derivative_status: [],
    exclusions: [],
    exclusions_described: false,
  };
}

/** The cache's key for a run's events. */
export const runEventsKey = (datasetPath: string | null, runId: string) => `${datasetPath ?? ''}\n${runId}`;

const keyOf = ({ entity, criterion }: BidsExclusion): BidsExclusionKey => ({ entity, criterion });
const sameKey = (a: BidsExclusionKey, b: BidsExclusionKey) =>
  a.entity === b.entity && a.criterion === b.criterion;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useBidsStore = create<BidsStore>()(
  subscribeWithSelector(
    immer((set, get) => ({
      ...initialState,

      scanDataset: async (path: string) => {
        const generation = ++scanGeneration;
        const before = get();
        if (before.scanStatus === 'scanning' && before.scanId) {
          void getTransport()
            .invoke('cancel_bids_scan', { scanId: before.scanId })
            .catch(() => undefined);
        }
        const scanId = `bids-scan-${Date.now()}-${++scanCounter}`;
        const sameDataset = before.datasetPath === path;
        const previous = sameDataset ? before.index : null;
        detailRequests.clear();
        set({
          datasetPath: path,
          scanId,
          scanStatus: 'scanning',
          scanError: null,
          scanProgress: null,
          runDetails: {},
          // A rescan keeps the rows on screen until new ones arrive.
          ...(sameDataset
            ? {}
            : {
                index: null,
                selectedRunId: null,
                lens: null,
                lensMode: 'highlight' as const,
                exclusions: [],
                exclusionsLoaded: false,
                undoStack: [],
                actionRequest: null,
                exclusionsWritten: false,
                eventsCache: new Map(),
                savedLenses: readSavedLenses(path),
                fdThreshold: DEFAULT_FD_THRESHOLD_MM,
                censor: null,
                groupBy: undefined,
                compareWithModal: false,
              }),
        });

        // Rows stream at once and can be excluded: the disk's rows come first.
        const revision = exclusionRevision;
        let finished = false;
        void getTransport()
          .invoke<BidsExclusion[]>('read_bids_exclusions', { datasetPath: path })
          .then((rows) => {
            // The scan's own rows are the newer read, and a remote one's are the server's.
            const stale =
              generation !== scanGeneration || revision !== exclusionRevision || finished;
            if (stale || !Array.isArray(rows)) return;
            set({ exclusions: rows, exclusionsLoaded: true });
          })
          .catch(() => undefined);

        // Runs and findings stay in arrival order, keyed, until the final index.
        const runs = new Map<string, BidsRunRecord>();
        const findings = new Map<string, BidsFinding>();
        const subjects = new Set<string>();
        const shell = emptyIndex(path, scanId, previous);
        let latest: BidsScanProgress | null = null;
        // A rescan starts from what the last one found; the bridge says from its first event.
        let source = { is_remote: shell.is_remote, listing_complete: shell.listing_complete };
        let remembered = false;
        let queued = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const flush = () => {
          timer = null;
          if (generation !== scanGeneration || !queued || finished) return;
          queued = false;
          set({
            scanProgress: latest,
            index: {
              ...shell,
              ...source,
              subjects: [...subjects].sort(naturalCompare),
              runs: [...runs.values()],
              findings: [...findings.values()],
            },
          });
        };
        const onProgress = (progress: BidsScanProgress) => {
          if (generation !== scanGeneration || progress.scan_id !== scanId || finished) return;
          latest = progress;
          source = { is_remote: progress.is_remote, listing_complete: progress.listing_complete };
          if (!progress.is_remote && !remembered) {
            remembered = true;
            rememberDataset(path);
          }
          if (progress.subject) subjects.add(progress.subject);
          for (const run of progress.runs) runs.set(run.id, run);
          for (const finding of progress.findings) findings.set(finding.id, finding);
          queued = true;
          timer ??= setTimeout(flush, BIDS_PROGRESS_FLUSH_MS);
        };

        const unlisten = await safeListen<BidsScanProgress>('bids-scan-progress', (event) => {
          if (event?.payload) onProgress(event.payload as BidsScanProgress);
        });
        try {
          if (generation !== scanGeneration) return;
          const result = await getTransport().invoke<BidsBrowserIndex>('scan_bids_browser', {
            datasetPath: path,
            scanId,
          });
          finished = true;
          if (generation !== scanGeneration) return;
          if (result.is_remote) forgetDataset(path);
          else rememberDataset(path);
          const { selectedRunId: selected, exclusions, exclusionsLoaded } = get();
          // A plain partial: an updater would make immer deep-freeze the index.
          set({
            index: result,
            // A write during the scan is newer than what the scan read.
            exclusions:
              revision !== exclusionRevision && exclusionsLoaded ? exclusions : result.exclusions,
            exclusionsLoaded: true,
            scanStatus: 'ready',
            scanProgress: null,
            selectedRunId: result.runs.some((run) => run.id === selected) ? selected : null,
          });
        } catch (error) {
          if (messageOf(error).includes(MIRROR_WITHOUT_MOUNT)) forgetDataset(path);
          if (generation !== scanGeneration) return;
          // Rows that arrived stay usable; the workspace reports the failure.
          flush();
          set({ scanStatus: 'error', scanError: messageOf(error), scanProgress: null });
        } finally {
          if (timer !== null) clearTimeout(timer);
          await safeUnlisten(unlisten);
        }
      },

      cancelScan: async () => {
        const { scanId, scanStatus } = get();
        if (scanStatus !== 'scanning' || !scanId) return;
        await getTransport().invoke('cancel_bids_scan', { scanId });
      },

      selectRun: (runId) => {
        if (get().selectedRunId !== runId) set({ selectedRunId: runId });
      },

      moveSelection: (direction) => {
        const next = nextRunId(selectBidsModel(get()), get().selectedRunId, direction);
        if (next !== get().selectedRunId) set({ selectedRunId: next });
      },

      setActiveView: (view) => {
        if (get().activeView !== view) set({ activeView: view });
      },

      setFdThreshold: (mm) => {
        if (Number.isFinite(mm) && mm > 0 && mm !== get().fdThreshold) set({ fdThreshold: mm });
      },

      setCensor: (criterion) => set({ censor: criterion }),

      setGroupBy: (column) => set({ groupBy: column }),

      setLens: (lens) => {
        set({ lens, lensMode: 'highlight' });
        if (!lens) return;
        // Selection and lens never disagree: the Inspector follows into the lens.
        const { runs, bold } = selectBidsModel(get()).lens;
        const selected = get().selectedRunId;
        if (runs.some((facts) => facts.run.id === selected)) return;
        const first = bold[0] ?? runs[0];
        if (first) get().selectRun(first.run.id);
      },

      setLensMode: (mode) => {
        if (get().lensMode !== mode) set({ lensMode: mode });
      },

      saveLens: (name) => {
        const { lens, savedLenses, datasetPath } = get();
        if (!lens || savedLenses.some((saved) => saved.id === lens.id)) return;
        const label = name?.trim() || lens.label;
        const next = [...savedLenses, { ...lens, label }];
        set({ savedLenses: next });
        writeSavedLenses(datasetPath, next);
      },

      deleteSavedLens: (id) => {
        const { savedLenses, datasetPath } = get();
        const next = savedLenses.filter((saved) => saved.id !== id);
        set({ savedLenses: next });
        writeSavedLenses(datasetPath, next);
      },

      loadRunDetail: (runId) => {
        const cached = get().runDetails[runId];
        if (cached) return Promise.resolve(cached);
        const inFlight = detailRequests.get(runId);
        if (inFlight) return inFlight;
        const generation = scanGeneration;
        const datasetPath = get().datasetPath;
        if (!datasetPath) return Promise.resolve(null);
        const request = getTransport()
          .invoke<BidsRunDetail>('get_bids_run_detail', { datasetPath, runId })
          .then((detail) => {
            if (generation !== scanGeneration) return null;
            set({ runDetails: { ...get().runDetails, [runId]: detail } });
            return detail;
          })
          .finally(() => {
            if (detailRequests.get(runId) === request) detailRequests.delete(runId);
          });
        detailRequests.set(runId, request);
        return request;
      },

      writeExclusions: async (rows, context, expectedDatasetPath) => {
        const { datasetPath, exclusionsLoaded } = get();
        if (datasetPath !== expectedDatasetPath) {
          throw new Error(`the dataset changed; these rows belong to ${expectedDatasetPath}.`);
        }
        if (!datasetPath) return;
        if (!exclusionsLoaded) throw new Error('Existing exclusions have not been read yet.');
        exclusionRevision += 1;
        const write = await getTransport().invoke<BidsExclusionWrite>('write_bids_exclusions', {
          datasetPath,
          rows,
          context,
        });
        // A rescan of this dataset does not disown the write: the rows are on disk.
        if (get().datasetPath !== datasetPath) return;
        exclusionRevision += 1;
        const undoStack = get().undoStack;
        set({
          exclusions: write.all,
          exclusionsWritten: true,
          undoStack: write.added.length
            ? [...undoStack, { id: ++undoCounter, added: write.added }]
            : undoStack,
        });
      },

      revertExclusions: async (keys) => {
        const { datasetPath } = get();
        if (!datasetPath) return;
        exclusionRevision += 1;
        const next = await getTransport().invoke<BidsExclusion[]>('revert_bids_exclusions', {
          datasetPath,
          keys,
        });
        if (get().datasetPath !== datasetPath) return;
        exclusionRevision += 1;
        set({
          exclusions: next,
          undoStack: get().undoStack.filter(
            (entry) => !entry.added.some((row) => keys.some((key) => sameKey(key, keyOf(row)))),
          ),
        });
      },

      undoExclusion: async () => {
        const { datasetPath, undoStack } = get();
        const entry = undoStack[undoStack.length - 1];
        if (!datasetPath || !entry) return;
        exclusionRevision += 1;
        // One rewrite of exactly the rows this write added.
        const next = await getTransport().invoke<BidsExclusion[]>('revert_bids_exclusions', {
          datasetPath,
          keys: entry.added.map(keyOf),
        });
        if (get().datasetPath !== datasetPath) return;
        exclusionRevision += 1;
        set({
          exclusions: next,
          undoStack: get().undoStack.filter((item) => item.id !== entry.id),
        });
      },

      requestAction: (kind) => {
        if (kind === 'exclude' && !get().exclusionsLoaded) return;
        set({ actionRequest: { kind, runId: get().selectedRunId, nonce: ++actionNonce } });
      },

      clearActionRequest: () => set({ actionRequest: null }),

      toggleCompare: () => set({ compareWithModal: !get().compareWithModal }),

      loadEvents: async (subject: string, task: string, session?: string, run?: string) => {
        const cacheKey = [subject, task, session ?? '', run ?? ''].join('|');
        const cached = get().eventsCache.get(cacheKey);
        if (cached) return cached;
        const generation = scanGeneration;

        try {
          const transport = getTransport();
          const events = await transport.invoke<BidsEventRow[]>(
            'get_bids_events',
            {
              datasetPath: get().datasetPath,
              subject,
              task,
              session: session ?? null,
              run: run ?? null,
            }
          );
          if (generation !== scanGeneration) return events;
          set((state) => {
            state.eventsCache.set(cacheKey, events);
          });
          return events;
        } catch {
          return [];
        }
      },

      loadRunEvents: async (runId, datasetPath = get().datasetPath) => {
        const cacheKey = runEventsKey(datasetPath, runId);
        const cached = get().eventsCache.get(cacheKey);
        if (cached) return cached;
        const generation = scanGeneration;
        const events = await getTransport().invoke<BidsEventRow[]>('get_bids_run_events', {
          datasetPath,
          runId,
        });
        if (generation !== scanGeneration || get().datasetPath !== datasetPath) return events;
        set((state) => {
          state.eventsCache.set(cacheKey, events);
        });
        return events;
      },

      selectSubject: (id: string | null) => {
        set((state) => {
          state.selection.subjectId = id;
        });
      },

      selectCell: (subjectId: string, sessionId: string | null, modality: string) => {
        set((state) => {
          state.selection = { subjectId, sessionId, modality };
        });
      },

      setHoveredCell: (cell: { row: number; col: number } | null) => {
        set((state) => {
          state.hoveredCell = cell;
        });
      },

      setDetailTab: (tab: BidsDetailTab) => {
        set((state) => {
          state.activeDetailTab = tab;
        });
      },

      reset: () => {
        const { scanId, scanStatus } = get();
        scanGeneration += 1;
        detailRequests.clear();
        if (scanStatus === 'scanning' && scanId) {
          void getTransport()
            .invoke('cancel_bids_scan', { scanId })
            .catch(() => undefined);
        }
        set(() => ({ ...initialState, eventsCache: new Map() }));
      },
    }))
  )
);

// ---------------------------------------------------------------------------
// Derived model
// ---------------------------------------------------------------------------

type ModelInputs = Pick<
  BidsState,
  | 'index'
  | 'fdThreshold'
  | 'exclusions'
  | 'lens'
  | 'lensMode'
  | 'groupBy'
  | 'savedLenses'
  | 'censor'
  | 'scanProgress'
>;

let lastInputs: ModelInputs | null = null;
let lastModel: BidsModel | null = null;

/** Stable while its inputs are: selecting a run does not re-derive anything. */
export function selectBidsModel(state: ModelInputs): BidsModel {
  if (
    lastModel &&
    lastInputs &&
    lastInputs.index === state.index &&
    lastInputs.fdThreshold === state.fdThreshold &&
    lastInputs.exclusions === state.exclusions &&
    lastInputs.lens === state.lens &&
    lastInputs.lensMode === state.lensMode &&
    lastInputs.groupBy === state.groupBy &&
    lastInputs.savedLenses === state.savedLenses &&
    lastInputs.censor === state.censor &&
    lastInputs.scanProgress === state.scanProgress
  ) {
    return lastModel;
  }
  lastInputs = {
    index: state.index,
    fdThreshold: state.fdThreshold,
    exclusions: state.exclusions,
    lens: state.lens,
    lensMode: state.lensMode,
    groupBy: state.groupBy,
    savedLenses: state.savedLenses,
    censor: state.censor,
    scanProgress: state.scanProgress,
  };
  lastModel = deriveBidsModel(state.index, {
    fdThreshold: state.fdThreshold,
    exclusions: state.exclusions,
    lens: state.lens,
    lensMode: state.lensMode,
    groupBy: state.groupBy,
    savedLenses: state.savedLenses,
    censor: state.censor,
    progress: state.scanProgress,
  });
  return lastModel;
}

export const useBidsModel = (): BidsModel => useBidsStore(selectBidsModel);

/** Copies the lens as a TSV, and says how much of it is not in the dock's list. */
export function copyLensList(): void {
  const model = selectBidsModel(useBidsStore.getState());
  void copyToClipboard(buildLensExport(model), lensExportLabel(model));
}
