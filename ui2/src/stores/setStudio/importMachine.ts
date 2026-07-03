/**
 * Pure state machine for the Set Studio "NeuroTabs import" dialog.
 *
 * This module owns the entire import-dialog behaviour as a hand-rolled reducer:
 * `importReducer(context, event) -> { context, effects }`. It is intentionally
 * free of any zustand / transport / @tauri-apps imports so it can be exercised
 * with plain unit tests and reused from the store slice and the ingestion
 * service without pulling in runtime plumbing.
 *
 * The store persists the flat `StudioImportDialogState` (for UI selectors and
 * existing tests) plus a small `ImportRequestState` companion for the in-flight
 * request ids that the flat shape cannot represent. `fromDialogState` rehydrates
 * those two pieces into an `ImportContext`; `toDialogState` / `toRequestState`
 * project a context back onto them.
 */
import type {
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioDiscoveryRolePattern,
  StudioFeatureSummary,
  StudioFieldExpressionSummary,
  StudioFolderOntologySummary,
  StudioImportCandidate,
  StudioImportDialogState,
  StudioImportMode,
  StudioImportSource,
  StudioMaterializationStatus,
  StudioSelection,
  TsvColumnMapping,
  TsvWizardState,
  TsvWizardStep,
} from '@/types/studio';
import { canImportCandidate, isCompareReadyContract } from '@/services/studio/importContract';

// ---------------------------------------------------------------------------
// Shared defaults (moved verbatim from the previous importSlice implementation)
// ---------------------------------------------------------------------------

export const DEFAULT_TSV_WIZARD: TsvWizardState = {
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

// ---------------------------------------------------------------------------
// Pure helpers (moved verbatim from the previous importSlice implementation)
// ---------------------------------------------------------------------------

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function normalizeRole(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizePatterns(patterns: string[]): string[] {
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
export function autoDetectTsvColumns(headers: string[]): TsvColumnMapping {
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
export function parseTsvString(content: string): {
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

export function pickBestColumn(
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

export function parseDelimitedRows(
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

// ---------------------------------------------------------------------------
// Request id source. The public slice actions draw from this counter; the
// ingestion service reuses the same monotonic sequence so guarded results can
// never be confused across the two entry points.
// ---------------------------------------------------------------------------

let requestIdCounter = 0;

export function nextImportRequestId(): number {
  requestIdCounter += 1;
  return requestIdCounter;
}

// ---------------------------------------------------------------------------
// Context + phase model
// ---------------------------------------------------------------------------

/**
 * Async preview phase. `loaded` carries the flat `source`/`error` pair, which
 * covers both successful results and the "no candidates" / fallback outcomes
 * (the flat state renders them identically), so a dedicated error variant is
 * unnecessary.
 */
export type ImportPreviewPhase =
  | { status: 'idle' }
  | { status: 'loading'; requestId: number; mode: StudioImportMode }
  | { status: 'loaded'; source: StudioImportSource; error: string | null };

export type ImportOntologyPhase =
  | { status: 'idle' }
  | { status: 'scanning'; requestId: number; root: string }
  | { status: 'ready'; summary: StudioFolderOntologySummary }
  | { status: 'error'; message: string };

export interface ImportContext {
  isOpen: boolean;
  mode: StudioImportMode;
  selectedCandidateId: string | null;
  preview: ImportPreviewPhase;
  ontology: ImportOntologyPhase;
  manifestPath: string;
  discoveryRoot: string;
  filePattern: string;
  discoveryMaxDepth: string;
  discoveryMaxFiles: string;
  discoverySampleHeaders: boolean;
  discoveryRequiredRoles: string[];
  discoveryRolePatterns: StudioDiscoveryRolePattern[];
  discoveryCustomRole: string;
  tsvWizard: TsvWizardState;
  candidates: Record<string, StudioImportCandidate>;
}

/**
 * The slice of a context that the flat `StudioImportDialogState` cannot encode
 * (the in-flight request ids). Persisted alongside the flat dialog state so a
 * context can be rehydrated across dispatches.
 */
export interface ImportRequestState {
  preview: { requestId: number; mode: StudioImportMode } | null;
  ontology: { requestId: number; root: string } | null;
}

export function createInitialImportRequestState(): ImportRequestState {
  return { preview: null, ontology: null };
}

export function createInitialImportContext(): ImportContext {
  return {
    isOpen: false,
    mode: 'table',
    selectedCandidateId: null,
    preview: { status: 'idle' },
    ontology: { status: 'idle' },
    manifestPath: '/data/studyA/studyA.neurotabs.yaml',
    discoveryRoot: '.',
    filePattern: DEFAULT_DISCOVERY_FILE_PATTERN,
    discoveryMaxDepth: '4',
    discoveryMaxFiles: '500',
    discoverySampleHeaders: true,
    discoveryRequiredRoles: DEFAULT_DISCOVERY_REQUIRED_ROLES,
    discoveryRolePatterns: DEFAULT_DISCOVERY_ROLE_PATTERNS,
    discoveryCustomRole: '',
    tsvWizard: DEFAULT_TSV_WIZARD,
    candidates: {},
  };
}

// ---------------------------------------------------------------------------
// Projection between the flat store shape and the context
// ---------------------------------------------------------------------------

function derivePreview(preview: ImportPreviewPhase): {
  isLoading: boolean;
  source: StudioImportSource;
  error: string | null;
} {
  switch (preview.status) {
    case 'loading':
      return { isLoading: true, source: null, error: null };
    case 'loaded':
      return { isLoading: false, source: preview.source, error: preview.error };
    case 'idle':
    default:
      return { isLoading: false, source: null, error: null };
  }
}

function deriveOntology(ontology: ImportOntologyPhase): {
  ontologyPreview: StudioFolderOntologySummary | null;
  isOntologyLoading: boolean;
  ontologyError: string | null;
} {
  switch (ontology.status) {
    case 'scanning':
      return { ontologyPreview: null, isOntologyLoading: true, ontologyError: null };
    case 'ready':
      return { ontologyPreview: ontology.summary, isOntologyLoading: false, ontologyError: null };
    case 'error':
      return { ontologyPreview: null, isOntologyLoading: false, ontologyError: ontology.message };
    case 'idle':
    default:
      return { ontologyPreview: null, isOntologyLoading: false, ontologyError: null };
  }
}

export function toDialogState(context: ImportContext): StudioImportDialogState {
  const preview = derivePreview(context.preview);
  const ontology = deriveOntology(context.ontology);
  return {
    isOpen: context.isOpen,
    mode: context.mode,
    selectedCandidateId: context.selectedCandidateId,
    isLoading: preview.isLoading,
    error: preview.error,
    source: preview.source,
    manifestPath: context.manifestPath,
    discoveryRoot: context.discoveryRoot,
    filePattern: context.filePattern,
    discoveryMaxDepth: context.discoveryMaxDepth,
    discoveryMaxFiles: context.discoveryMaxFiles,
    discoverySampleHeaders: context.discoverySampleHeaders,
    discoveryRequiredRoles: context.discoveryRequiredRoles,
    discoveryRolePatterns: context.discoveryRolePatterns,
    discoveryCustomRole: context.discoveryCustomRole,
    ontologyPreview: ontology.ontologyPreview,
    isOntologyLoading: ontology.isOntologyLoading,
    ontologyError: ontology.ontologyError,
    tsvWizard: context.tsvWizard,
  };
}

export function toRequestState(context: ImportContext): ImportRequestState {
  return {
    preview:
      context.preview.status === 'loading'
        ? { requestId: context.preview.requestId, mode: context.preview.mode }
        : null,
    ontology:
      context.ontology.status === 'scanning'
        ? { requestId: context.ontology.requestId, root: context.ontology.root }
        : null,
  };
}

export function fromDialogState(
  dialog: StudioImportDialogState,
  candidates: Record<string, StudioImportCandidate>,
  requestState: ImportRequestState,
): ImportContext {
  let preview: ImportPreviewPhase;
  if (dialog.isLoading) {
    preview = {
      status: 'loading',
      requestId: requestState.preview?.requestId ?? -1,
      mode: requestState.preview?.mode ?? dialog.mode,
    };
  } else if (dialog.source === null && dialog.error === null) {
    preview = { status: 'idle' };
  } else {
    preview = { status: 'loaded', source: dialog.source, error: dialog.error };
  }

  let ontology: ImportOntologyPhase;
  if (dialog.isOntologyLoading) {
    ontology = {
      status: 'scanning',
      requestId: requestState.ontology?.requestId ?? -1,
      root: requestState.ontology?.root ?? dialog.discoveryRoot,
    };
  } else if (dialog.ontologyPreview) {
    ontology = { status: 'ready', summary: dialog.ontologyPreview };
  } else if (dialog.ontologyError) {
    ontology = { status: 'error', message: dialog.ontologyError };
  } else {
    ontology = { status: 'idle' };
  }

  return {
    isOpen: dialog.isOpen,
    mode: dialog.mode,
    selectedCandidateId: dialog.selectedCandidateId,
    preview,
    ontology,
    manifestPath: dialog.manifestPath,
    discoveryRoot: dialog.discoveryRoot,
    filePattern: dialog.filePattern,
    discoveryMaxDepth: dialog.discoveryMaxDepth,
    discoveryMaxFiles: dialog.discoveryMaxFiles,
    discoverySampleHeaders: dialog.discoverySampleHeaders,
    discoveryRequiredRoles: dialog.discoveryRequiredRoles,
    discoveryRolePatterns: dialog.discoveryRolePatterns,
    discoveryCustomRole: dialog.discoveryCustomRole,
    tsvWizard: dialog.tsvWizard,
    candidates,
  };
}

// ---------------------------------------------------------------------------
// Bootstrap payload (emitted as an effect on a successful confirm)
// ---------------------------------------------------------------------------

export interface StudioBootstrapPayload {
  set: SpatialFieldSetSummary;
  features: StudioFeatureSummary[];
  cohorts: StudioCohortSummary[];
  expressions: StudioFieldExpressionSummary[];
  selection?: Partial<StudioSelection>;
  materialization?: Partial<StudioMaterializationStatus>;
}

function bootstrapPayloadForCandidate(candidate: StudioImportCandidate): StudioBootstrapPayload {
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

  return {
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
  };
}

// ---------------------------------------------------------------------------
// TSV candidate construction (moved from buildTsvImportCandidate; `now` is now
// injected so the reducer stays deterministic)
// ---------------------------------------------------------------------------

export function buildTsvCandidate(
  context: ImportContext,
  options: { now: number },
): StudioImportCandidate | null {
  const wizard = context.tsvWizard;
  const { headers, rows, columnMapping } = wizard;

  if (!columnMapping.filePathColumn || !columnMapping.subjectIdColumn) {
    return null;
  }

  const fileColIdx = headers.indexOf(columnMapping.filePathColumn);
  const subjectColIdx = headers.indexOf(columnMapping.subjectIdColumn);
  if (fileColIdx < 0 || subjectColIdx < 0) {
    return null;
  }

  const designColumns = headers.filter(
    (h, i) => i !== fileColIdx && i !== subjectColIdx && !columnMapping.excludedColumns.includes(h),
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

  const candidateId = `candidate-table-${options.now}`;
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
      id: `table-import-${options.now}`,
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

  return candidate;
}

// ---------------------------------------------------------------------------
// Events + effects
// ---------------------------------------------------------------------------

export type ImportEvent =
  // Dialog / tabs
  | { type: 'OPEN_DIALOG'; mode: StudioImportMode }
  | { type: 'CLOSE_DIALOG' }
  // Preview lifecycle — guarded (dispatched by the ingestion service with a
  // request id so stale async results are dropped by the reducer)
  | { type: 'PREVIEW_REQUESTED'; mode: StudioImportMode; requestId: number }
  | {
      type: 'PREVIEW_SUCCEEDED';
      mode: StudioImportMode;
      requestId: number;
      candidates: StudioImportCandidate[];
      source: StudioImportSource;
    }
  | {
      type: 'PREVIEW_FAILED';
      mode: StudioImportMode;
      requestId: number;
      message: string;
      now: number;
    }
  // Preview lifecycle — unconditional (public slice actions used by tests/UI)
  | {
      type: 'PREVIEW_RESULT_APPLIED';
      mode: StudioImportMode;
      candidates: StudioImportCandidate[];
      source: StudioImportSource;
      error: string | null;
    }
  | { type: 'PREVIEW_CANDIDATES_SET'; mode: StudioImportMode; candidates: StudioImportCandidate[] }
  | { type: 'PREVIEW_ERROR_SET'; message: string }
  // Candidate selection + confirm
  | { type: 'CANDIDATE_SELECTED'; candidateId: string }
  | { type: 'CONFIRM_REQUESTED' }
  // Ontology lifecycle — guarded
  | { type: 'ONTOLOGY_REQUESTED'; root: string | null; requestId: number }
  | { type: 'ONTOLOGY_SUCCEEDED'; requestId: number; summary: StudioFolderOntologySummary }
  | { type: 'ONTOLOGY_FAILED'; requestId: number; message: string }
  // Ontology lifecycle — unconditional (public slice actions)
  | { type: 'ONTOLOGY_RESULT_SET'; summary: StudioFolderOntologySummary }
  | { type: 'ONTOLOGY_ERROR_SET'; message: string }
  | { type: 'ONTOLOGY_CANDIDATE_APPLIED'; candidateId: string }
  // Form inputs
  | { type: 'MANIFEST_PATH_SET'; path: string }
  | { type: 'DISCOVERY_ROOT_SET'; root: string }
  | { type: 'FILE_PATTERN_SET'; pattern: string }
  | { type: 'DISCOVERY_MAX_DEPTH_SET'; value: string }
  | { type: 'DISCOVERY_MAX_FILES_SET'; value: string }
  | { type: 'DISCOVERY_SAMPLE_HEADERS_SET'; enabled: boolean }
  | { type: 'DISCOVERY_ROLE_PATTERN_SET'; role: string; patterns: string[] }
  | { type: 'DISCOVERY_ROLE_REQUIRED_SET'; role: string; required: boolean }
  | { type: 'DISCOVERY_CUSTOM_ROLE_SET'; role: string }
  | { type: 'DISCOVERY_ROLE_ADDED'; role: string }
  | { type: 'DISCOVERY_ROLE_REMOVED'; role: string }
  // TSV wizard
  | { type: 'TSV_PATH_SET'; path: string }
  | { type: 'TSV_PARSED'; content: string }
  | { type: 'TSV_COLUMN_MAPPING_SET'; mapping: Partial<TsvColumnMapping> }
  | { type: 'TSV_WIZARD_STEP_SET'; step: TsvWizardStep }
  | { type: 'TSV_CANDIDATE_BUILT'; now: number };

export type ImportEffect =
  | { type: 'RUN_PREVIEW'; mode: StudioImportMode; requestId: number }
  | { type: 'RUN_ONTOLOGY_SCAN'; root: string | null; requestId: number }
  | { type: 'BOOTSTRAP_STUDIO'; payload: StudioBootstrapPayload };

export interface ImportReducerResult {
  context: ImportContext;
  effects: ImportEffect[];
}

// ---------------------------------------------------------------------------
// Context transforms shared between guarded + unconditional events
// ---------------------------------------------------------------------------

function applyPreviewResult(
  context: ImportContext,
  args: {
    mode: StudioImportMode;
    candidates: StudioImportCandidate[];
    source: StudioImportSource;
    error: string | null;
  },
): ImportContext {
  if (args.candidates.length === 0) {
    return {
      ...context,
      isOpen: true,
      mode: args.mode,
      selectedCandidateId: null,
      preview: {
        status: 'loaded',
        source: args.source,
        error: args.error ?? 'No preview candidates were found.',
      },
      candidates: withoutImportCandidatesForMode(context.candidates, args.mode),
    };
  }

  const nextCandidates = toRecord(args.candidates);
  return {
    ...context,
    isOpen: true,
    mode: args.mode,
    selectedCandidateId: args.candidates[0]?.id ?? null,
    preview: { status: 'loaded', source: args.source, error: args.error },
    candidates: { ...context.candidates, ...nextCandidates },
  };
}

function applyPreviewCandidatesSet(
  context: ImportContext,
  args: { mode: StudioImportMode; candidates: StudioImportCandidate[] },
): ImportContext {
  if (args.candidates.length === 0) {
    return context;
  }

  const nextCandidates = toRecord(args.candidates);
  return {
    ...context,
    mode: args.mode,
    selectedCandidateId: args.candidates[0]?.id ?? null,
    candidates: { ...context.candidates, ...nextCandidates },
  };
}

function applyPreviewError(context: ImportContext, message: string): ImportContext {
  const source = derivePreview(context.preview).source;
  return {
    ...context,
    preview: { status: 'loaded', source, error: message },
  };
}

function applyTsvCandidateBuild(context: ImportContext, now: number): ImportContext {
  const candidate = buildTsvCandidate(context, { now });
  if (!candidate) {
    return context;
  }

  const currentError = derivePreview(context.preview).error;
  return {
    ...context,
    selectedCandidateId: candidate.id,
    preview: { status: 'loaded', source: 'fallback', error: currentError },
    tsvWizard: { ...context.tsvWizard, step: 'preview' },
    candidates: { ...context.candidates, [candidate.id]: candidate },
  };
}

function applyOntologyResult(
  context: ImportContext,
  summary: StudioFolderOntologySummary,
): ImportContext {
  return {
    ...context,
    isOpen: true,
    mode: 'regex',
    ontology: { status: 'ready', summary },
    discoveryRoot: summary.root || context.discoveryRoot,
  };
}

function applyOntologyError(context: ImportContext, message: string): ImportContext {
  return {
    ...context,
    isOpen: true,
    mode: 'regex',
    ontology: { status: 'error', message },
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const NO_EFFECTS: ImportEffect[] = [];

function result(context: ImportContext, effects: ImportEffect[] = NO_EFFECTS): ImportReducerResult {
  return { context, effects };
}

export function importReducer(context: ImportContext, event: ImportEvent): ImportReducerResult {
  switch (event.type) {
    case 'OPEN_DIALOG': {
      const { mode } = event;
      const candidateForMode =
        (context.selectedCandidateId &&
        context.candidates[context.selectedCandidateId]?.mode === mode
          ? context.selectedCandidateId
          : Object.values(context.candidates).find((candidate) => candidate.mode === mode)?.id) ??
        null;
      return result({
        ...context,
        isOpen: true,
        mode,
        selectedCandidateId: candidateForMode,
        preview: { status: 'idle' },
      });
    }

    case 'CLOSE_DIALOG': {
      if (!context.isOpen) {
        return result(context);
      }
      return result({ ...context, isOpen: false });
    }

    case 'PREVIEW_REQUESTED': {
      return result(
        {
          ...context,
          isOpen: true,
          mode: event.mode,
          selectedCandidateId: null,
          preview: { status: 'loading', requestId: event.requestId, mode: event.mode },
          candidates: withoutImportCandidatesForMode(context.candidates, event.mode),
        },
        [{ type: 'RUN_PREVIEW', mode: event.mode, requestId: event.requestId }],
      );
    }

    case 'PREVIEW_SUCCEEDED': {
      if (!isCurrentPreview(context, event.requestId, event.mode)) {
        return result(context);
      }
      return result(
        applyPreviewResult(context, {
          mode: event.mode,
          candidates: event.candidates,
          source: event.source,
          error: null,
        }),
      );
    }

    case 'PREVIEW_FAILED': {
      if (!isCurrentPreview(context, event.requestId, event.mode)) {
        return result(context);
      }
      if (event.mode === 'table') {
        const withError = applyPreviewError(context, event.message);
        return result(applyTsvCandidateBuild(withError, event.now));
      }
      return result(
        applyPreviewResult(context, {
          mode: event.mode,
          candidates: [],
          source: 'fallback',
          error: event.message,
        }),
      );
    }

    case 'PREVIEW_RESULT_APPLIED': {
      return result(
        applyPreviewResult(context, {
          mode: event.mode,
          candidates: event.candidates,
          source: event.source,
          error: event.error,
        }),
      );
    }

    case 'PREVIEW_CANDIDATES_SET': {
      return result(
        applyPreviewCandidatesSet(context, { mode: event.mode, candidates: event.candidates }),
      );
    }

    case 'PREVIEW_ERROR_SET': {
      return result(applyPreviewError(context, event.message));
    }

    case 'CANDIDATE_SELECTED': {
      if (context.selectedCandidateId === event.candidateId) {
        return result(context);
      }
      return result({ ...context, selectedCandidateId: event.candidateId });
    }

    case 'CONFIRM_REQUESTED': {
      const candidate = context.selectedCandidateId
        ? (context.candidates[context.selectedCandidateId] ?? null)
        : null;
      if (!candidate || !canImportCandidate(candidate)) {
        return result(context);
      }
      return result({ ...context, isOpen: false }, [
        { type: 'BOOTSTRAP_STUDIO', payload: bootstrapPayloadForCandidate(candidate) },
      ]);
    }

    case 'ONTOLOGY_REQUESTED': {
      const discoveryRoot = event.root?.trim() || context.discoveryRoot;
      return result(
        {
          ...context,
          isOpen: true,
          mode: 'regex',
          selectedCandidateId: null,
          discoveryRoot,
          ontology: { status: 'scanning', requestId: event.requestId, root: discoveryRoot },
        },
        [{ type: 'RUN_ONTOLOGY_SCAN', root: event.root, requestId: event.requestId }],
      );
    }

    case 'ONTOLOGY_SUCCEEDED': {
      if (!isCurrentOntology(context, event.requestId)) {
        return result(context);
      }
      return result(applyOntologyResult(context, event.summary));
    }

    case 'ONTOLOGY_FAILED': {
      if (!isCurrentOntology(context, event.requestId)) {
        return result(context);
      }
      return result(applyOntologyError(context, event.message));
    }

    case 'ONTOLOGY_RESULT_SET': {
      return result(applyOntologyResult(context, event.summary));
    }

    case 'ONTOLOGY_ERROR_SET': {
      return result(applyOntologyError(context, event.message));
    }

    case 'ONTOLOGY_CANDIDATE_APPLIED': {
      if (context.ontology.status !== 'ready') {
        return result(context);
      }
      const candidate = context.ontology.summary.candidates.find(
        (entry) => entry.id === event.candidateId,
      );
      if (!candidate) {
        return result(context);
      }
      return result({
        ...context,
        mode: 'regex',
        filePattern: candidate.filePattern,
        discoveryRequiredRoles: candidate.requiredRoles,
        discoveryRolePatterns: candidate.rolePatterns,
        preview: clearPreviewError(context.preview),
      });
    }

    case 'MANIFEST_PATH_SET': {
      if (context.manifestPath === event.path) {
        return result(context);
      }
      return result({ ...context, manifestPath: event.path });
    }

    case 'DISCOVERY_ROOT_SET': {
      if (context.discoveryRoot === event.root) {
        return result(context);
      }
      // Match the legacy action: clear a settled ontology result, but leave an
      // in-flight scan alone (its eventual result is invalidated by the root
      // mismatch guard).
      const ontology: ImportOntologyPhase =
        context.ontology.status === 'scanning' ? context.ontology : { status: 'idle' };
      return result({ ...context, discoveryRoot: event.root, ontology });
    }

    case 'FILE_PATTERN_SET': {
      if (context.filePattern === event.pattern) {
        return result(context);
      }
      return result({ ...context, filePattern: event.pattern });
    }

    case 'DISCOVERY_MAX_DEPTH_SET': {
      if (context.discoveryMaxDepth === event.value) {
        return result(context);
      }
      return result({ ...context, discoveryMaxDepth: event.value });
    }

    case 'DISCOVERY_MAX_FILES_SET': {
      if (context.discoveryMaxFiles === event.value) {
        return result(context);
      }
      return result({ ...context, discoveryMaxFiles: event.value });
    }

    case 'DISCOVERY_SAMPLE_HEADERS_SET': {
      if (context.discoverySampleHeaders === event.enabled) {
        return result(context);
      }
      return result({ ...context, discoverySampleHeaders: event.enabled });
    }

    case 'DISCOVERY_ROLE_PATTERN_SET': {
      const normalizedRole = normalizeRole(event.role);
      if (!normalizedRole) {
        return result(context);
      }
      const normalizedPatterns = normalizePatterns(event.patterns);
      const existing = context.discoveryRolePatterns.find((entry) => entry.role === normalizedRole);
      if (existing && sameStringList(existing.patterns, normalizedPatterns)) {
        return result(context);
      }
      const nextPatterns = existing
        ? context.discoveryRolePatterns.map((entry) =>
            entry.role === normalizedRole ? { ...entry, patterns: normalizedPatterns } : entry,
          )
        : [
            ...context.discoveryRolePatterns,
            { role: normalizedRole, patterns: normalizedPatterns },
          ];
      return result({ ...context, discoveryRolePatterns: nextPatterns });
    }

    case 'DISCOVERY_ROLE_REQUIRED_SET': {
      const normalizedRole = normalizeRole(event.role);
      if (!normalizedRole) {
        return result(context);
      }
      const requiredSet = new Set(context.discoveryRequiredRoles);
      const wasRequired = requiredSet.has(normalizedRole);
      if (wasRequired === event.required) {
        return result(context);
      }
      if (event.required) {
        requiredSet.add(normalizedRole);
      } else {
        requiredSet.delete(normalizedRole);
      }
      return result({ ...context, discoveryRequiredRoles: Array.from(requiredSet) });
    }

    case 'DISCOVERY_CUSTOM_ROLE_SET': {
      if (context.discoveryCustomRole === event.role) {
        return result(context);
      }
      return result({ ...context, discoveryCustomRole: event.role });
    }

    case 'DISCOVERY_ROLE_ADDED': {
      const normalizedRole = normalizeRole(event.role);
      if (!normalizedRole) {
        return result(context);
      }
      if (context.discoveryRolePatterns.some((entry) => entry.role === normalizedRole)) {
        return result({ ...context, discoveryCustomRole: '' });
      }
      return result({
        ...context,
        discoveryRolePatterns: [
          ...context.discoveryRolePatterns,
          { role: normalizedRole, patterns: [normalizedRole] },
        ],
        discoveryRequiredRoles: [...context.discoveryRequiredRoles, normalizedRole],
        discoveryCustomRole: '',
      });
    }

    case 'DISCOVERY_ROLE_REMOVED': {
      const normalizedRole = normalizeRole(event.role);
      if (!normalizedRole) {
        return result(context);
      }
      if (!context.discoveryRolePatterns.some((entry) => entry.role === normalizedRole)) {
        return result(context);
      }
      return result({
        ...context,
        discoveryRolePatterns: context.discoveryRolePatterns.filter(
          (entry) => entry.role !== normalizedRole,
        ),
        discoveryRequiredRoles: context.discoveryRequiredRoles.filter(
          (entry) => entry !== normalizedRole,
        ),
      });
    }

    case 'TSV_PATH_SET': {
      return result({
        ...context,
        tsvWizard: { ...context.tsvWizard, tsvPath: event.path },
      });
    }

    case 'TSV_PARSED': {
      const { headers, rows, error } = parseTsvString(event.content);
      if (error) {
        return result({
          ...context,
          tsvWizard: {
            ...DEFAULT_TSV_WIZARD,
            tsvPath: context.tsvWizard.tsvPath,
            rawContent: event.content,
            parseError: error,
          },
        });
      }
      const columnMapping = autoDetectTsvColumns(headers);
      return result({
        ...context,
        tsvWizard: {
          ...context.tsvWizard,
          rawContent: event.content,
          headers,
          rows,
          columnMapping,
          parseError: null,
          step: 'map',
        },
      });
    }

    case 'TSV_COLUMN_MAPPING_SET': {
      return result({
        ...context,
        tsvWizard: {
          ...context.tsvWizard,
          columnMapping: { ...context.tsvWizard.columnMapping, ...event.mapping },
        },
      });
    }

    case 'TSV_WIZARD_STEP_SET': {
      return result({
        ...context,
        tsvWizard: { ...context.tsvWizard, step: event.step },
      });
    }

    case 'TSV_CANDIDATE_BUILT': {
      return result(applyTsvCandidateBuild(context, event.now));
    }

    default: {
      return result(context);
    }
  }
}

function isCurrentPreview(
  context: ImportContext,
  requestId: number,
  mode: StudioImportMode,
): boolean {
  return (
    context.preview.status === 'loading' &&
    context.preview.requestId === requestId &&
    context.preview.mode === mode
  );
}

function isCurrentOntology(context: ImportContext, requestId: number): boolean {
  return (
    context.mode === 'regex' &&
    context.ontology.status === 'scanning' &&
    context.ontology.requestId === requestId &&
    context.discoveryRoot === context.ontology.root
  );
}

function clearPreviewError(preview: ImportPreviewPhase): ImportPreviewPhase {
  if (preview.status === 'loaded' && preview.error !== null) {
    return { status: 'loaded', source: preview.source, error: null };
  }
  return preview;
}
