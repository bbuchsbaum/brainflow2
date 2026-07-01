import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioFeatureSummary,
  StudioFieldExpressionSummary,
  StudioImportCandidate,
  StudioImportDialogState,
  StudioImportMode,
  StudioMaterializationStatus,
  StudioSelection,
  StudioDiscoveryRolePattern,
  StudioFolderOntologySummary,
  TsvColumnMapping,
  TsvWizardState,
  TsvWizardStep,
} from '@/types/studio';
import { canImportCandidate, isCompareReadyContract } from '@/services/studio/importContract';

interface StudioBootstrapPayload {
  set: SpatialFieldSetSummary;
  features: StudioFeatureSummary[];
  cohorts: StudioCohortSummary[];
  expressions: StudioFieldExpressionSummary[];
  selection?: Partial<StudioSelection>;
  materialization?: Partial<StudioMaterializationStatus>;
}

interface SetStudioImportSliceHost {
  importCandidates: Record<string, StudioImportCandidate>;
  importDialog: StudioImportDialogState;
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
}

type ImportSliceStore = SetStudioImportSliceHost & SetStudioImportSlice;
type StoreSet = (partial: Partial<SetStudioImportSliceHost>, replace?: false) => void;

const DEFAULT_TSV_WIZARD: TsvWizardState = {
  step: 'load',
  tsvPath: '',
  rawContent: null,
  headers: [],
  rows: [],
  columnMapping: {
    filePathColumn: null,
    subjectIdColumn: null,
    excludedColumns: [],
  },
  parseError: null,
};

const DEFAULT_DISCOVERY_FILE_PATTERN = String.raw`(?P<subject>[^/]+)/maps/(?P<role>beta|tstat|se|pvalue|statmap)\.nii(\.gz)?$`;

const DEFAULT_DISCOVERY_ROLE_PATTERNS: StudioDiscoveryRolePattern[] = [
  { role: 'beta', patterns: ['beta', 'cope', 'effect'] },
  { role: 'tstat', patterns: ['tstat', 't', 'tmap'] },
  { role: 'se', patterns: ['se', 'stderr', 'standard_error'] },
  { role: 'pvalue', patterns: ['pvalue', 'pval', 'p'] },
  { role: 'statmap', patterns: ['statmap', 'zstat', 'zmap'] },
];

const DEFAULT_DISCOVERY_REQUIRED_ROLES = ['tstat'];

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizeRole(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizePatterns(patterns: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim();
    if (!pattern || seen.has(pattern)) {
      continue;
    }
    seen.add(pattern);
    normalized.push(pattern);
  }
  return normalized;
}

/** Auto-detect well-known column names for file path and subject ID. */
function autoDetectTsvColumns(headers: string[]): TsvColumnMapping {
  const normalizedHeaders = headers.map((header) => normalizeImportHeader(header));
  const filePathColumn = pickBestColumn(headers, normalizedHeaders, [
    ['file_path', 100],
    ['filepath', 100],
    ['image_path', 95],
    ['image_file', 95],
    ['nifti_file', 95],
    ['nifti_path', 95],
    ['source_path', 95],
    ['filename', 85],
    ['file', 80],
    ['path', 70],
    ['image', 60],
    ['source', 55],
    ['nifti', 55],
  ]);
  const subjectIdColumn = pickBestColumn(headers, normalizedHeaders, [
    ['subject_id', 100],
    ['participant_id', 100],
    ['subject', 95],
    ['participant', 90],
    ['subid', 85],
    ['sub', 75],
    ['id', 25],
  ]);

  return { filePathColumn, subjectIdColumn, excludedColumns: [] };
}

/** Parse a TSV/CSV string into headers and rows. */
function parseTsvString(content: string): {
  headers: string[];
  rows: string[][];
  error: string | null;
} {
  const normalizedContent = content.replace(/^\uFEFF/, '').trim();
  if (!normalizedContent) {
    return { headers: [], rows: [], error: 'File is empty.' };
  }

  const delimiter = detectDelimitedTableSeparator(normalizedContent);
  const parsedRows = parseDelimitedRows(normalizedContent, delimiter);
  if (parsedRows.error) {
    return { headers: [], rows: [], error: parsedRows.error };
  }

  if (parsedRows.rows.length < 2) {
    return {
      headers: [],
      rows: [],
      error: 'File must have a header row and at least one data row.',
    };
  }

  const headers = parsedRows.rows[0].map((h) => h.trim());
  if (headers.length < 2) {
    return {
      headers: [],
      rows: [],
      error: 'File must have at least two columns (file path + one design variable).',
    };
  }

  try {
    const rows = parsedRows.rows.slice(1).map((row, rowIndex) => {
      if (row.length > headers.length) {
        throw new Error(`Row ${rowIndex + 2} has more columns than the header.`);
      }
      return [
        ...row.map((cell) => cell.trim()),
        ...Array.from({ length: Math.max(headers.length - row.length, 0) }, () => ''),
      ];
    });
    return { headers, rows, error: null };
  } catch (error) {
    return {
      headers: [],
      rows: [],
      error: error instanceof Error ? error.message : 'Unable to parse table content.',
    };
  }
}

function normalizeImportHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pickBestColumn(
  headers: string[],
  normalizedHeaders: string[],
  patterns: Array<[string, number]>,
): string | null {
  let bestIndex = -1;
  let bestScore = -1;

  normalizedHeaders.forEach((normalizedHeader, index) => {
    for (const [pattern, score] of patterns) {
      if (normalizedHeader === pattern && score > bestScore) {
        bestIndex = index;
        bestScore = score;
        return;
      }
      if (normalizedHeader.endsWith(`_${pattern}`) && score - 5 > bestScore) {
        bestIndex = index;
        bestScore = score - 5;
      }
    }
  });

  return bestIndex >= 0 ? headers[bestIndex] : null;
}

function detectDelimitedTableSeparator(content: string): ',' | '\t' {
  const headerLine = content.split(/\r?\n/, 1)[0] ?? '';
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  return tabCount > commaCount ? '\t' : ',';
}

function parseDelimitedRows(
  content: string,
  delimiter: ',' | '\t',
): { rows: string[][]; error: string | null } {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === delimiter) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if (!inQuotes && (character === '\n' || character === '\r')) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }
      currentRow.push(currentCell);
      const isMeaningfulRow =
        currentRow.some((cell) => cell.trim().length > 0) || currentRow.length > 1;
      if (isMeaningfulRow) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += character;
  }

  if (inQuotes) {
    return {
      rows: [],
      error: 'Quoted field is not closed. Check for unmatched double quotes.',
    };
  }

  currentRow.push(currentCell);
  const isMeaningfulRow =
    currentRow.some((cell) => cell.trim().length > 0) || currentRow.length > 1;
  if (isMeaningfulRow) {
    rows.push(currentRow);
  }

  return { rows, error: null };
}

export function createInitialImportDialogState(): StudioImportDialogState {
  return {
    isOpen: false,
    mode: 'table',
    selectedCandidateId: null,
    isLoading: false,
    error: null,
    source: null,
    manifestPath: '/data/studyA/studyA.neurotabs.yaml',
    discoveryRoot: '.',
    filePattern: DEFAULT_DISCOVERY_FILE_PATTERN,
    discoveryMaxDepth: '4',
    discoveryMaxFiles: '500',
    discoverySampleHeaders: true,
    discoveryRequiredRoles: DEFAULT_DISCOVERY_REQUIRED_ROLES,
    discoveryRolePatterns: DEFAULT_DISCOVERY_ROLE_PATTERNS,
    discoveryCustomRole: '',
    ontologyPreview: null,
    isOntologyLoading: false,
    ontologyError: null,
    tsvWizard: DEFAULT_TSV_WIZARD,
  };
}

function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  return items.reduce<Record<string, T>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
}

function withoutImportCandidatesForMode(
  candidates: Record<string, StudioImportCandidate>,
  mode: StudioImportMode,
): Record<string, StudioImportCandidate> {
  return Object.fromEntries(
    Object.entries(candidates).filter(([, candidate]) => candidate.mode !== mode),
  );
}

export function createImportSlice<T extends ImportSliceStore>(
  set: StoreSet,
  get: () => T,
): SetStudioImportSlice {
  return {
    openImportDialog: (mode) => {
      const { importDialog, importCandidates } = get();
      const candidateForMode =
        (importDialog.selectedCandidateId &&
        importCandidates[importDialog.selectedCandidateId]?.mode === mode
          ? importDialog.selectedCandidateId
          : Object.values(importCandidates).find((candidate) => candidate.mode === mode)?.id) ??
        null;

      set({
        importDialog: {
          isOpen: true,
          mode,
          selectedCandidateId: candidateForMode,
          isLoading: false,
          error: null,
          source: null,
          manifestPath: importDialog.manifestPath,
          discoveryRoot: importDialog.discoveryRoot,
          filePattern: importDialog.filePattern,
          discoveryMaxDepth: importDialog.discoveryMaxDepth,
          discoveryMaxFiles: importDialog.discoveryMaxFiles,
          discoverySampleHeaders: importDialog.discoverySampleHeaders,
          discoveryRequiredRoles: importDialog.discoveryRequiredRoles,
          discoveryRolePatterns: importDialog.discoveryRolePatterns,
          discoveryCustomRole: importDialog.discoveryCustomRole,
          ontologyPreview: importDialog.ontologyPreview,
          isOntologyLoading: importDialog.isOntologyLoading,
          ontologyError: importDialog.ontologyError,
          tsvWizard: importDialog.tsvWizard,
        },
      });
    },

    closeImportDialog: () => {
      const { importDialog } = get();
      if (!importDialog.isOpen) {
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          isOpen: false,
        },
      });
    },

    beginImportPreview: (mode) => {
      const { importDialog, importCandidates } = get();
      const nextImportCandidates = withoutImportCandidatesForMode(importCandidates, mode);

      set({
        importCandidates: nextImportCandidates,
        importDialog: {
          ...importDialog,
          isOpen: true,
          mode,
          selectedCandidateId: null,
          isLoading: true,
          error: null,
          source: null,
          manifestPath: importDialog.manifestPath,
          discoveryRoot: importDialog.discoveryRoot,
          filePattern: importDialog.filePattern,
          discoveryMaxDepth: importDialog.discoveryMaxDepth,
          discoveryMaxFiles: importDialog.discoveryMaxFiles,
          discoverySampleHeaders: importDialog.discoverySampleHeaders,
          discoveryRequiredRoles: importDialog.discoveryRequiredRoles,
          discoveryRolePatterns: importDialog.discoveryRolePatterns,
          discoveryCustomRole: importDialog.discoveryCustomRole,
        },
      });
    },

    setImportCandidates: (mode, candidates) => {
      if (candidates.length === 0) {
        return;
      }

      const { importDialog, importCandidates } = get();
      const nextCandidates = toRecord(candidates);
      const selectedCandidateId = candidates[0]?.id ?? null;

      set({
        importCandidates: {
          ...importCandidates,
          ...nextCandidates,
        },
        importDialog: {
          ...importDialog,
          mode,
          selectedCandidateId,
          manifestPath: importDialog.manifestPath,
          discoveryRoot: importDialog.discoveryRoot,
          filePattern: importDialog.filePattern,
          discoveryMaxDepth: importDialog.discoveryMaxDepth,
          discoveryMaxFiles: importDialog.discoveryMaxFiles,
          discoverySampleHeaders: importDialog.discoverySampleHeaders,
          discoveryRequiredRoles: importDialog.discoveryRequiredRoles,
          discoveryRolePatterns: importDialog.discoveryRolePatterns,
          discoveryCustomRole: importDialog.discoveryCustomRole,
        },
      });
    },

    setImportPreviewResult: (mode, candidates, source, error = null) => {
      if (candidates.length === 0) {
        const { importDialog, importCandidates } = get();
        set({
          importCandidates: withoutImportCandidatesForMode(importCandidates, mode),
          importDialog: {
            ...importDialog,
            isOpen: true,
            mode,
            selectedCandidateId: null,
            isLoading: false,
            error: error ?? 'No preview candidates were found.',
            source,
          },
        });
        return;
      }

      const { importDialog, importCandidates } = get();
      const nextCandidates = toRecord(candidates);
      const selectedCandidateId = candidates[0]?.id ?? null;

      set({
        importCandidates: {
          ...importCandidates,
          ...nextCandidates,
        },
        importDialog: {
          ...importDialog,
          isOpen: true,
          mode,
          selectedCandidateId,
          isLoading: false,
          error,
          source,
          manifestPath: importDialog.manifestPath,
          discoveryRoot: importDialog.discoveryRoot,
          filePattern: importDialog.filePattern,
          discoveryMaxDepth: importDialog.discoveryMaxDepth,
          discoveryMaxFiles: importDialog.discoveryMaxFiles,
          discoverySampleHeaders: importDialog.discoverySampleHeaders,
          discoveryRequiredRoles: importDialog.discoveryRequiredRoles,
          discoveryRolePatterns: importDialog.discoveryRolePatterns,
          discoveryCustomRole: importDialog.discoveryCustomRole,
        },
      });
    },

    setImportPreviewError: (message) => {
      const { importDialog } = get();
      set({
        importDialog: {
          ...importDialog,
          isLoading: false,
          error: message,
        },
      });
    },

    selectImportCandidate: (candidateId) => {
      const { importDialog } = get();
      if (importDialog.selectedCandidateId === candidateId) {
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          selectedCandidateId: candidateId,
        },
      });
    },

    confirmImportCandidate: () => {
      const { importDialog, importCandidates } = get();
      const candidateId = importDialog.selectedCandidateId;
      const candidate = candidateId ? (importCandidates[candidateId] ?? null) : null;
      if (!candidate || !canImportCandidate(candidate)) {
        return;
      }

      const compareReady = isCompareReadyContract(candidate.contract);
      const activeLens = compareReady ? 'compare' : 'deck';
      const preferredExpressionId =
        activeLens === 'compare'
          ? (candidate.expressions.find((expression) => expression.kind === 'comparison')?.id ??
            candidate.expressions[0]?.id ??
            null)
          : (candidate.expressions.find((expression) => expression.kind === 'member')?.id ??
            candidate.expressions[0]?.id ??
            null);

      get().bootstrapStudio({
        set: {
          ...candidate.set,
          sourceKind: candidate.set.sourceKind ?? 'imported',
          importContract: candidate.contract,
        },
        features: candidate.features,
        cohorts: candidate.cohorts,
        expressions: candidate.expressions,
        selection: {
          activeLens,
          activeMemberId: candidate.set.memberIds[2] ?? candidate.set.memberIds[0] ?? null,
          compareCohortId: candidate.set.savedCohortIds[0] ?? null,
          activeExpressionId: preferredExpressionId,
        },
        materialization: candidate.materialization ?? undefined,
      });

      set({
        importDialog: {
          ...importDialog,
          isOpen: false,
        },
      });
    },

    setManifestPath: (path) => {
      const { importDialog } = get();
      if (importDialog.manifestPath === path) {
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          manifestPath: path,
        },
      });
    },

    setDiscoveryRoot: (root) => {
      const { importDialog } = get();
      if (importDialog.discoveryRoot === root) {
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          discoveryRoot: root,
          ontologyPreview: null,
          ontologyError: null,
        },
      });
    },

    setFilePattern: (pattern) => {
      const { importDialog } = get();
      if (importDialog.filePattern === pattern) {
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          filePattern: pattern,
        },
      });
    },

    setDiscoveryMaxDepth: (value) => {
      const { importDialog } = get();
      if (importDialog.discoveryMaxDepth === value) {
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          discoveryMaxDepth: value,
        },
      });
    },

    setDiscoveryMaxFiles: (value) => {
      const { importDialog } = get();
      if (importDialog.discoveryMaxFiles === value) {
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          discoveryMaxFiles: value,
        },
      });
    },

    setDiscoverySampleHeaders: (enabled) => {
      const { importDialog } = get();
      if (importDialog.discoverySampleHeaders === enabled) {
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          discoverySampleHeaders: enabled,
        },
      });
    },

    setDiscoveryRolePattern: (role, patterns) => {
      const normalizedRole = normalizeRole(role);
      if (!normalizedRole) {
        return;
      }
      const normalizedPatterns = normalizePatterns(patterns);
      const { importDialog } = get();
      const existing = importDialog.discoveryRolePatterns.find(
        (entry) => entry.role === normalizedRole,
      );
      if (existing && sameStringList(existing.patterns, normalizedPatterns)) {
        return;
      }
      const nextPatterns = existing
        ? importDialog.discoveryRolePatterns.map((entry) =>
            entry.role === normalizedRole ? { ...entry, patterns: normalizedPatterns } : entry,
          )
        : [
            ...importDialog.discoveryRolePatterns,
            { role: normalizedRole, patterns: normalizedPatterns },
          ];

      set({
        importDialog: {
          ...importDialog,
          discoveryRolePatterns: nextPatterns,
        },
      });
    },

    setDiscoveryRoleRequired: (role, required) => {
      const normalizedRole = normalizeRole(role);
      if (!normalizedRole) {
        return;
      }
      const { importDialog } = get();
      const requiredSet = new Set(importDialog.discoveryRequiredRoles);
      const wasRequired = requiredSet.has(normalizedRole);
      if (wasRequired === required) {
        return;
      }
      if (required) {
        requiredSet.add(normalizedRole);
      } else {
        requiredSet.delete(normalizedRole);
      }
      const discoveryRequiredRoles = Array.from(requiredSet);

      set({
        importDialog: {
          ...importDialog,
          discoveryRequiredRoles,
        },
      });
    },

    setDiscoveryCustomRole: (role) => {
      const { importDialog } = get();
      if (importDialog.discoveryCustomRole === role) {
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          discoveryCustomRole: role,
        },
      });
    },

    addDiscoveryRole: (role) => {
      const normalizedRole = normalizeRole(role);
      if (!normalizedRole) {
        return;
      }
      const { importDialog } = get();
      if (importDialog.discoveryRolePatterns.some((entry) => entry.role === normalizedRole)) {
        set({
          importDialog: {
            ...importDialog,
            discoveryCustomRole: '',
          },
        });
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          discoveryRolePatterns: [
            ...importDialog.discoveryRolePatterns,
            { role: normalizedRole, patterns: [normalizedRole] },
          ],
          discoveryRequiredRoles: [...importDialog.discoveryRequiredRoles, normalizedRole],
          discoveryCustomRole: '',
        },
      });
    },

    removeDiscoveryRole: (role) => {
      const normalizedRole = normalizeRole(role);
      if (!normalizedRole) {
        return;
      }
      const { importDialog } = get();
      if (!importDialog.discoveryRolePatterns.some((entry) => entry.role === normalizedRole)) {
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          discoveryRolePatterns: importDialog.discoveryRolePatterns.filter(
            (entry) => entry.role !== normalizedRole,
          ),
          discoveryRequiredRoles: importDialog.discoveryRequiredRoles.filter(
            (entry) => entry !== normalizedRole,
          ),
        },
      });
    },

    beginFolderOntologyPreview: (root = null) => {
      const { importDialog } = get();
      const discoveryRoot = root?.trim() || importDialog.discoveryRoot;

      set({
        importDialog: {
          ...importDialog,
          isOpen: true,
          mode: 'regex',
          selectedCandidateId: null,
          isOntologyLoading: true,
          ontologyError: null,
          ontologyPreview: null,
          discoveryRoot,
        },
      });
    },

    setFolderOntologyPreviewResult: (summary) => {
      const { importDialog } = get();

      set({
        importDialog: {
          ...importDialog,
          isOpen: true,
          mode: 'regex',
          isOntologyLoading: false,
          ontologyError: null,
          ontologyPreview: summary,
          discoveryRoot: summary.root || importDialog.discoveryRoot,
        },
      });
    },

    setFolderOntologyPreviewError: (message) => {
      const { importDialog } = get();

      set({
        importDialog: {
          ...importDialog,
          isOpen: true,
          mode: 'regex',
          isOntologyLoading: false,
          ontologyError: message,
          ontologyPreview: null,
        },
      });
    },

    applyFolderOntologyCandidate: (candidateId) => {
      const { importDialog } = get();
      const candidate = importDialog.ontologyPreview?.candidates.find(
        (candidate) => candidate.id === candidateId,
      );
      if (!candidate) {
        return;
      }

      set({
        importDialog: {
          ...importDialog,
          mode: 'regex',
          filePattern: candidate.filePattern,
          discoveryRequiredRoles: candidate.requiredRoles,
          discoveryRolePatterns: candidate.rolePatterns,
          error: null,
        },
      });
    },

    setTsvPath: (path) => {
      const { importDialog } = get();
      set({
        importDialog: {
          ...importDialog,
          tsvWizard: { ...importDialog.tsvWizard, tsvPath: path },
        },
      });
    },

    parseTsvContent: (content) => {
      const { importDialog } = get();
      const { headers, rows, error } = parseTsvString(content);
      if (error) {
        set({
          importDialog: {
            ...importDialog,
            tsvWizard: {
              ...DEFAULT_TSV_WIZARD,
              tsvPath: importDialog.tsvWizard.tsvPath,
              rawContent: content,
              parseError: error,
            },
          },
        });
        return;
      }

      const columnMapping = autoDetectTsvColumns(headers);
      set({
        importDialog: {
          ...importDialog,
          tsvWizard: {
            ...importDialog.tsvWizard,
            rawContent: content,
            headers,
            rows,
            columnMapping,
            parseError: null,
            step: 'map',
          },
        },
      });
    },

    setTsvColumnMapping: (partial) => {
      const { importDialog } = get();
      const wizard = importDialog.tsvWizard;
      set({
        importDialog: {
          ...importDialog,
          tsvWizard: {
            ...wizard,
            columnMapping: { ...wizard.columnMapping, ...partial },
          },
        },
      });
    },

    setTsvWizardStep: (step) => {
      const { importDialog } = get();
      set({
        importDialog: {
          ...importDialog,
          tsvWizard: { ...importDialog.tsvWizard, step },
        },
      });
    },

    buildTsvImportCandidate: () => {
      const { importDialog, importCandidates } = get();
      const wizard = importDialog.tsvWizard;
      const { headers, rows, columnMapping } = wizard;

      if (!columnMapping.filePathColumn || !columnMapping.subjectIdColumn) {
        return;
      }

      const fileColIdx = headers.indexOf(columnMapping.filePathColumn);
      const subjectColIdx = headers.indexOf(columnMapping.subjectIdColumn);
      if (fileColIdx < 0 || subjectColIdx < 0) {
        return;
      }

      const designColumns = headers.filter(
        (h, i) =>
          i !== fileColIdx && i !== subjectColIdx && !columnMapping.excludedColumns.includes(h),
      );

      const rowDetails = rows.map((row, rowIndex) => ({
        rowIndex,
        subjectId: (row[subjectColIdx] ?? '').trim(),
        sourcePath: (row[fileColIdx] ?? '').trim(),
        row,
      }));
      const subjectCounts = rowDetails.reduce<Map<string, number>>((acc, detail) => {
        if (detail.subjectId) {
          acc.set(detail.subjectId, (acc.get(detail.subjectId) ?? 0) + 1);
        }
        return acc;
      }, new Map());
      const duplicateSubjectIds = Array.from(subjectCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([subjectId]) => subjectId);
      const duplicateSubjectIdSet = new Set(duplicateSubjectIds);
      const duplicateRows = rowDetails.filter(
        (detail) => detail.subjectId && duplicateSubjectIdSet.has(detail.subjectId),
      );
      const missingSubjectRows = rowDetails.filter((detail) => !detail.subjectId);
      const missingPathRows = rowDetails.filter((detail) => detail.subjectId && !detail.sourcePath);
      const validRows = rowDetails.filter(
        (detail) =>
          detail.subjectId && detail.sourcePath && !duplicateSubjectIdSet.has(detail.subjectId),
      );
      const memberSummaries = validRows.map((detail) => ({
        id: detail.subjectId,
        sourcePath: detail.sourcePath,
      }));
      const memberIds = memberSummaries.map((m) => m.id);
      const duplicateKeys = duplicateRows.length;
      const unmatchedRows = rows.length - validRows.length;
      const issueDetails = [
        ...(missingSubjectRows.length > 0
          ? [
              {
                message: `${missingSubjectRows.length} row(s) are missing subject IDs.`,
                memberIds: [],
              },
            ]
          : []),
        ...(missingPathRows.length > 0
          ? [
              {
                message: `${missingPathRows.length} row(s) are missing file paths.`,
                memberIds: missingPathRows.map((detail) => detail.subjectId),
              },
            ]
          : []),
        ...(duplicateSubjectIds.length > 0
          ? [
              {
                message: `Duplicate subject IDs detected: ${duplicateSubjectIds.join(', ')}.`,
                memberIds: duplicateSubjectIds,
              },
            ]
          : []),
      ];
      const joinSeverity =
        validRows.length === 0 ? 'error' : issueDetails.length > 0 ? 'warning' : 'ok';

      const previewColumns = [
        headers[subjectColIdx],
        ...designColumns.filter((c) => c !== headers[subjectColIdx]).slice(0, 3),
      ];
      const previewRows = rows.slice(0, 5).map((row, rowIndex) => ({
        id: (row[subjectColIdx] ?? '').trim() || `row-${rowIndex + 1}`,
        cells: previewColumns.map((col) => {
          const idx = headers.indexOf(col);
          return idx >= 0 ? (row[idx] ?? '') : '';
        }),
      }));
      const generatedCohorts =
        memberIds.length > 0
          ? [
              {
                id: 'table-all-members',
                label: 'All members',
                memberCount: memberIds.length,
                description: 'All valid rows from the imported table.',
                memberIds,
                originKind: 'imported' as const,
                originLabel: wizard.tsvPath || 'Table import',
              },
            ]
          : [];

      const candidateId = `candidate-table-${Date.now()}`;
      const tableCanImport = memberIds.length > 0;
      const candidate: StudioImportCandidate = {
        id: candidateId,
        label: `Table import (${memberIds.length} subjects)`,
        description: `Imported from ${wizard.tsvPath || 'pasted table'} with ${designColumns.length} design columns.`,
        mode: 'table',
        sourceHint: wizard.tsvPath || 'pasted content',
        contract: {
          readiness: tableCanImport ? 'review_required' : 'blocked',
          provenanceKind: 'table',
          provenanceLabel: wizard.tsvPath || 'pasted content',
          canImport: tableCanImport,
          capabilities: tableCanImport ? ['import', 'deck'] : [],
          reason: tableCanImport
            ? 'Local table preview is importable for review; backend validation is still required for compare.'
            : 'Local table preview has no importable members.',
        },
        set: {
          id: `table-import-${Date.now()}`,
          name: wizard.tsvPath
            ? (wizard.tsvPath
                .split('/')
                .pop()
                ?.replace(/\.[^.]+$/, '') ?? 'Table Import')
            : 'Table Import',
          sourceKind: 'imported',
          memberCount: memberIds.length,
          primaryFeatureId: 'feature-statmap',
          supportKind: 'volume',
          supportLabel: 'unknown (pending validation)',
          alignmentClass: 'unknown',
          designColumns,
          designTablePreview: { columns: previewColumns, rows: previewRows },
          memberSummaries,
          memberIds,
          savedCohortIds: generatedCohorts.map((cohort) => cohort.id),
          ingestAudit: {
            sourceLabel: wizard.tsvPath || 'pasted table',
            join: {
              matchedRows: validRows.length,
              unmatchedRows,
              duplicateKeys,
              severity: joinSeverity,
              issueDetails,
            },
            support: {
              supportLabel: 'unknown (pending validation)',
              alignmentClass: 'unknown',
              readyForCompare: false,
              severity: 'warning',
            },
            notes: [
              validRows.length > 0
                ? 'File paths and NIfTI headers will be validated after import.'
                : 'No importable members were found. Fix subject IDs or file paths and retry.',
              `${designColumns.length} design column(s): ${designColumns.join(', ')}`,
            ],
          },
        },
        features: [{ id: 'feature-statmap', label: 'Stat Map', kind: 'volume' }],
        cohorts: generatedCohorts,
        expressions: [
          {
            id: 'table-deck-member',
            label: 'Active member',
            kind: 'member',
            recipe: 'member(current)',
            cohortId: null,
          },
        ],
      };

      set({
        importCandidates: {
          ...importCandidates,
          [candidateId]: candidate,
        },
        importDialog: {
          ...importDialog,
          selectedCandidateId: candidateId,
          isLoading: false,
          source: 'fallback',
          tsvWizard: { ...wizard, step: 'preview' },
        },
      });
    },
  };
}
