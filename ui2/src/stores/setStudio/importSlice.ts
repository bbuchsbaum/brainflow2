import type {
  StudioImportCandidate,
  StudioImportDialogState,
  StudioImportMode,
  StudioFolderOntologySummary,
  TsvColumnMapping,
  TsvWizardStep,
} from '@/types/studio';
import {
  createInitialImportContext,
  fromDialogState,
  importReducer,
  nextImportRequestId,
  toDialogState,
  toRequestState,
} from './importMachine';
import type {
  ImportEffect,
  ImportEvent,
  ImportRequestState,
  StudioBootstrapPayload,
} from './importMachine';

// Re-export the pure helpers/adapters so existing importers keep resolving them
// through the slice module even though they now live in importMachine.
export {
  autoDetectTsvColumns,
  buildTsvCandidate,
  createInitialImportContext,
  createInitialImportRequestState,
  fromDialogState,
  importReducer,
  normalizePatterns,
  normalizeRole,
  parseDelimitedRows,
  parseTsvString,
  pickBestColumn,
  toDialogState,
  toRequestState,
} from './importMachine';
export type {
  ImportContext,
  ImportEffect,
  ImportEvent,
  ImportOntologyPhase,
  ImportPreviewPhase,
  ImportRequestState,
} from './importMachine';

interface SetStudioImportSliceHost {
  importCandidates: Record<string, StudioImportCandidate>;
  importDialog: StudioImportDialogState;
  importRequestState: ImportRequestState;
  bootstrapStudio: (payload: StudioBootstrapPayload) => void;
}

export interface SetStudioImportSlice {
  openImportDialog: (mode: StudioImportMode) => void;
  closeImportDialog: () => void;
  beginImportPreview: (mode: StudioImportMode) => void;
  setImportCandidates: (mode: StudioImportMode, candidates: StudioImportCandidate[]) => void;
  setImportPreviewResult: (
    mode: StudioImportMode,
    candidates: StudioImportCandidate[],
    source: 'backend' | 'fallback',
    error?: string | null,
  ) => void;
  setImportPreviewError: (message: string) => void;
  selectImportCandidate: (candidateId: string) => void;
  confirmImportCandidate: () => void;
  setManifestPath: (path: string) => void;
  setDiscoveryRoot: (root: string) => void;
  setFilePattern: (pattern: string) => void;
  setDiscoveryMaxDepth: (value: string) => void;
  setDiscoveryMaxFiles: (value: string) => void;
  setDiscoverySampleHeaders: (enabled: boolean) => void;
  setDiscoveryRolePattern: (role: string, patterns: string[]) => void;
  setDiscoveryRoleRequired: (role: string, required: boolean) => void;
  setDiscoveryCustomRole: (role: string) => void;
  addDiscoveryRole: (role: string) => void;
  removeDiscoveryRole: (role: string) => void;
  beginFolderOntologyPreview: (root?: string | null) => void;
  setFolderOntologyPreviewResult: (summary: StudioFolderOntologySummary) => void;
  setFolderOntologyPreviewError: (message: string) => void;
  applyFolderOntologyCandidate: (candidateId: string) => void;
  setTsvPath: (path: string) => void;
  parseTsvContent: (content: string) => void;
  setTsvColumnMapping: (mapping: Partial<TsvColumnMapping>) => void;
  setTsvWizardStep: (step: TsvWizardStep) => void;
  buildTsvImportCandidate: () => void;
  /**
   * Effect-interpreter entry point used by SetIngestionService to drive the
   * guarded preview/ontology lifecycle events (which carry request ids). Not
   * used by UI components — they call the named actions above.
   */
  dispatchImportEvent: (event: ImportEvent) => void;
}

type ImportSliceStore = SetStudioImportSliceHost & SetStudioImportSlice;
type StoreSet = (partial: Partial<SetStudioImportSliceHost>, replace?: false) => void;

/** Initial flat dialog state — derived from the canonical initial context. */
export function createInitialImportDialogState(): StudioImportDialogState {
  return toDialogState(createInitialImportContext());
}

export function createImportSlice<T extends ImportSliceStore>(
  set: StoreSet,
  get: () => T,
): SetStudioImportSlice {
  /**
   * Rehydrate a context from the flat store, run the reducer, project the next
   * context back onto the store, and run the effects that the slice owns
   * (`BOOTSTRAP_STUDIO`). `RUN_PREVIEW` / `RUN_ONTOLOGY_SCAN` are declarative
   * markers for the ingestion service; the slice ignores them so the service
   * stays the sole owner of backend invocation.
   */
  const dispatch = (event: ImportEvent): ImportEffect[] => {
    const state = get();
    const context = fromDialogState(
      state.importDialog,
      state.importCandidates,
      state.importRequestState,
    );
    const next = importReducer(context, event);

    if (next.context !== context) {
      const partial: Partial<SetStudioImportSliceHost> = {
        importDialog: toDialogState(next.context),
        importRequestState: toRequestState(next.context),
      };
      if (next.context.candidates !== context.candidates) {
        partial.importCandidates = next.context.candidates;
      }
      set(partial);
    }

    for (const effect of next.effects) {
      if (effect.type === 'BOOTSTRAP_STUDIO') {
        get().bootstrapStudio(effect.payload);
      }
    }

    return next.effects;
  };

  return {
    openImportDialog: (mode) => dispatch({ type: 'OPEN_DIALOG', mode }),
    closeImportDialog: () => dispatch({ type: 'CLOSE_DIALOG' }),
    beginImportPreview: (mode) =>
      dispatch({ type: 'PREVIEW_REQUESTED', mode, requestId: nextImportRequestId() }),
    setImportCandidates: (mode, candidates) =>
      dispatch({ type: 'PREVIEW_CANDIDATES_SET', mode, candidates }),
    setImportPreviewResult: (mode, candidates, source, error = null) =>
      dispatch({ type: 'PREVIEW_RESULT_APPLIED', mode, candidates, source, error }),
    setImportPreviewError: (message) => dispatch({ type: 'PREVIEW_ERROR_SET', message }),
    selectImportCandidate: (candidateId) => dispatch({ type: 'CANDIDATE_SELECTED', candidateId }),
    confirmImportCandidate: () => dispatch({ type: 'CONFIRM_REQUESTED' }),
    setManifestPath: (path) => dispatch({ type: 'MANIFEST_PATH_SET', path }),
    setDiscoveryRoot: (root) => dispatch({ type: 'DISCOVERY_ROOT_SET', root }),
    setFilePattern: (pattern) => dispatch({ type: 'FILE_PATTERN_SET', pattern }),
    setDiscoveryMaxDepth: (value) => dispatch({ type: 'DISCOVERY_MAX_DEPTH_SET', value }),
    setDiscoveryMaxFiles: (value) => dispatch({ type: 'DISCOVERY_MAX_FILES_SET', value }),
    setDiscoverySampleHeaders: (enabled) =>
      dispatch({ type: 'DISCOVERY_SAMPLE_HEADERS_SET', enabled }),
    setDiscoveryRolePattern: (role, patterns) =>
      dispatch({ type: 'DISCOVERY_ROLE_PATTERN_SET', role, patterns }),
    setDiscoveryRoleRequired: (role, required) =>
      dispatch({ type: 'DISCOVERY_ROLE_REQUIRED_SET', role, required }),
    setDiscoveryCustomRole: (role) => dispatch({ type: 'DISCOVERY_CUSTOM_ROLE_SET', role }),
    addDiscoveryRole: (role) => dispatch({ type: 'DISCOVERY_ROLE_ADDED', role }),
    removeDiscoveryRole: (role) => dispatch({ type: 'DISCOVERY_ROLE_REMOVED', role }),
    beginFolderOntologyPreview: (root = null) =>
      dispatch({ type: 'ONTOLOGY_REQUESTED', root, requestId: nextImportRequestId() }),
    setFolderOntologyPreviewResult: (summary) => dispatch({ type: 'ONTOLOGY_RESULT_SET', summary }),
    setFolderOntologyPreviewError: (message) => dispatch({ type: 'ONTOLOGY_ERROR_SET', message }),
    applyFolderOntologyCandidate: (candidateId) =>
      dispatch({ type: 'ONTOLOGY_CANDIDATE_APPLIED', candidateId }),
    setTsvPath: (path) => dispatch({ type: 'TSV_PATH_SET', path }),
    parseTsvContent: (content) => dispatch({ type: 'TSV_PARSED', content }),
    setTsvColumnMapping: (mapping) => dispatch({ type: 'TSV_COLUMN_MAPPING_SET', mapping }),
    setTsvWizardStep: (step) => dispatch({ type: 'TSV_WIZARD_STEP_SET', step }),
    buildTsvImportCandidate: () => dispatch({ type: 'TSV_CANDIDATE_BUILT', now: Date.now() }),
    dispatchImportEvent: (event) => dispatch(event),
  };
}
