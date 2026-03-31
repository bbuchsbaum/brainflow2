import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { enableMapSet } from 'immer';
import { getTransport } from '@/services/transport';

enableMapSet();

// Bridge types — these match the Rust BidsDatasetSummary and related types.
// When ts-bindings are regenerated, replace with imports from @brainflow/api.
export interface BidsDatasetSummary {
  path: string;
  name: string;
  bids_version: string;
  license: string | null;
  authors: string[];
  subject_count: number;
  session_ids: string[];
  task_ids: string[];
  modalities: string[];
  total_file_count: number;
  total_size_bytes: number;
  coverage: BidsCoverageMatrix;
  participants: BidsParticipantRow[];
  participant_columns: string[];
  task_designs: BidsTaskDesign[];
  validation: BidsValidationResult;
  storage_by_modality: Record<string, number>;
}

export interface BidsCoverageMatrix {
  subjects: string[];
  columns: BidsCoverageColumn[];
  cells: BidsCoverageCell[][];
}

export interface BidsCoverageColumn {
  session: string | null;
  modality: string;
  suffix: string;
  task: string | null;
  label: string;
}

export interface BidsCoverageCell {
  present: boolean;
  run_count: number;
  size_bytes: number;
  file_paths: string[];
}

export interface BidsParticipantRow {
  participant_id: string;
  values: Record<string, string>;
}

export interface BidsTaskDesign {
  task: string;
  trial_types: string[];
  avg_duration_secs: number;
  total_runs: number;
  events_per_type: Record<string, number>;
}

export interface BidsEventRow {
  onset: number;
  duration: number;
  trial_type: string;
  additional: Record<string, string>;
}

export interface BidsValidationResult {
  passed: boolean;
  critical_count: number;
  warning_count: number;
  issues: BidsValidationIssue[];
}

export interface BidsValidationIssue {
  severity: string;
  description: string;
  file: string | null;
  rule: string;
}

// UI-only types
export type BidsDetailTab = 'events' | 'validation';

export interface BidsSelection {
  subjectId: string | null;
  sessionId: string | null;
  modality: string | null;
}

// Store interface
interface BidsState {
  datasetPath: string | null;
  summary: BidsDatasetSummary | null;
  scanStatus: 'idle' | 'scanning' | 'ready' | 'error';
  scanError: string | null;
  eventsCache: Map<string, BidsEventRow[]>;
  selection: BidsSelection;
  hoveredCell: { row: number; col: number } | null;
  activeDetailTab: BidsDetailTab;
}

interface BidsActions {
  scanDataset: (path: string) => Promise<void>;
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
  summary: null,
  scanStatus: 'idle',
  scanError: null,
  eventsCache: new Map(),
  selection: { subjectId: null, sessionId: null, modality: null },
  hoveredCell: null,
  activeDetailTab: 'validation',
};

export const useBidsStore = create<BidsStore>()(
  subscribeWithSelector(
    immer((set, get) => ({
      ...initialState,

      scanDataset: async (path: string) => {
        set((state) => {
          state.scanStatus = 'scanning';
          state.scanError = null;
          state.datasetPath = path;
        });
        try {
          const transport = getTransport();
          const summary = await transport.invoke<BidsDatasetSummary>(
            'scan_bids_dataset',
            { datasetPath: path }
          );
          set((state) => {
            state.summary = summary;
            state.scanStatus = 'ready';
          });
        } catch (error) {
          set((state) => {
            state.scanStatus = 'error';
            state.scanError = error instanceof Error ? error.message : String(error);
          });
        }
      },

      loadEvents: async (subject: string, task: string, session?: string, run?: string) => {
        const cacheKey = [subject, task, session ?? '', run ?? ''].join('|');
        const cached = get().eventsCache.get(cacheKey);
        if (cached) return cached;

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
          set((state) => {
            state.eventsCache.set(cacheKey, events);
          });
          return events;
        } catch {
          return [];
        }
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
        set(() => ({ ...initialState, eventsCache: new Map() }));
      },
    }))
  )
);
