import { create } from 'zustand';
import type {
  StudioArtifactSummary,
  SpatialFieldSetSummary,
  StudioCohortSummary,
  StudioCohortOriginKind,
  StudioComparePaneSpec,
  StudioFeatureSummary,
  StudioFieldExpressionSummary,
  StudioImportCandidate,
  StudioImportDialogState,
  StudioJoinIssueDetail,
  StudioImportMode,
  StudioLensType,
  StudioMaterializationStatus,
  StudioSavedRecipeSummary,
  StudioSelection,
  StudioDesignFilter,
  TsvColumnMapping,
  TsvWizardState,
  TsvWizardStep,
} from '@/types/studio';

interface StudioBootstrapPayload {
  set: SpatialFieldSetSummary;
  features: StudioFeatureSummary[];
  cohorts: StudioCohortSummary[];
  expressions: StudioFieldExpressionSummary[];
  selection?: Partial<StudioSelection>;
  materialization?: Partial<StudioMaterializationStatus>;
}

interface SetStudioStoreState {
  sets: Record<string, SpatialFieldSetSummary>;
  features: Record<string, StudioFeatureSummary>;
  cohorts: Record<string, StudioCohortSummary>;
  expressions: Record<string, StudioFieldExpressionSummary>;
  setExpressionIds: Record<string, string[]>;
  importCandidates: Record<string, StudioImportCandidate>;
  importDialog: StudioImportDialogState;
  selection: StudioSelection;
  materialization: StudioMaterializationStatus;
  comparePaneSpecs: StudioComparePaneSpec[];
  comparePaneLoading: boolean;
  compareRefreshingPaneIds: string[];
  activeIssueMemberIds: string[];
  activeIssueLabel: string | null;
  designSearch: string;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  activeDesignFilters: StudioDesignFilter[];
  activeArtifact: StudioArtifactSummary | null;
  artifactHistory: StudioArtifactSummary[];
  savedRecipes: StudioSavedRecipeSummary[];
  bootstrapStudio: (payload: StudioBootstrapPayload) => void;
  loadDemoSession: () => void;
  setActiveLens: (lens: StudioLensType) => void;
  setActiveMember: (memberId: string) => void;
  setCompareCohort: (cohortId: string | null) => void;
  setActiveScopeCohort: (cohortId: string | null) => void;
  drillToCohort: (cohortId: string | null) => void;
  openImportDialog: (mode: StudioImportMode) => void;
  closeImportDialog: () => void;
  beginImportPreview: (mode: StudioImportMode) => void;
  setImportCandidates: (mode: StudioImportMode, candidates: StudioImportCandidate[]) => void;
  setImportPreviewResult: (
    mode: StudioImportMode,
    candidates: StudioImportCandidate[],
    source: 'backend' | 'fallback',
    error?: string | null
  ) => void;
  setImportPreviewError: (message: string) => void;
  selectImportCandidate: (candidateId: string) => void;
  confirmImportCandidate: () => void;
  setManifestPath: (path: string) => void;
  setDiscoveryRoot: (root: string) => void;
  setFilePattern: (pattern: string) => void;
  setTsvPath: (path: string) => void;
  parseTsvContent: (content: string) => void;
  setTsvColumnMapping: (mapping: Partial<TsvColumnMapping>) => void;
  setTsvWizardStep: (step: TsvWizardStep) => void;
  buildTsvImportCandidate: () => void;
  setComparePaneSpecs: (specs: StudioComparePaneSpec[]) => void;
  setComparePaneLoading: (loading: boolean) => void;
  setCompareRefreshingPaneIds: (paneIds: string[]) => void;
  setDesignSearch: (value: string) => void;
  setSortColumn: (value: string | null) => void;
  toggleSortDirection: () => void;
  toggleDesignFilter: (filter: StudioDesignFilter) => void;
  removeDesignFilter: (filter: StudioDesignFilter) => void;
  clearDesignFilters: () => void;
  clearSubsetNarrowing: () => void;
  setActiveIssueFocus: (issue: StudioJoinIssueDetail) => void;
  clearActiveIssueFocus: () => void;
  createSavedCohort: (args: {
    memberIds: string[];
    label?: string | null;
    description?: string | null;
    originKind?: StudioCohortOriginKind;
    originLabel?: string | null;
  }) => string | null;
  renameSavedCohort: (cohortId: string, label: string) => void;
  deleteSavedCohort: (cohortId: string) => void;
  setActiveArtifact: (artifact: StudioArtifactSummary | null) => void;
  saveRecipeSnapshot: (recipe: Omit<StudioSavedRecipeSummary, 'id' | 'savedAtMs'>) => string;
  renameSavedRecipe: (recipeId: string, title: string) => void;
  deleteSavedRecipe: (recipeId: string) => void;
  restoreSelectionSnapshot: (
    snapshot: Pick<
      StudioSelection,
      'activeLens' | 'activeMemberId' | 'compareCohortId' | 'activeScopeCohortId' | 'activeExpressionId'
    >
  ) => void;
}

const demoTemplateSource = (templateId: string) => `template:${templateId}`;

const DEMO_MEMBER_SOURCE_PATHS = {
  sub001: demoTemplateSource('MNI152NLin2009cAsym_T1w_2mm'),
  sub002: demoTemplateSource('MNI152NLin2009cAsym_T2w_2mm'),
  sub003: demoTemplateSource('MNI152NLin2009cAsym_brain_2mm'),
  sub004: demoTemplateSource('MNI152NLin2009cAsym_T1w_2mm'),
  sub005: demoTemplateSource('MNI152NLin2009cAsym_T2w_2mm'),
  sub006: demoTemplateSource('MNI152NLin2009cAsym_brain_2mm'),
} as const;

const DEMO_SET: SpatialFieldSetSummary = {
  id: 'study-a',
  name: 'Study A',
  sourceKind: 'demo',
  memberCount: 42,
  primaryFeatureId: 'statmap',
  supportKind: 'volume',
  supportLabel: 'MNI152 2mm template',
  alignmentClass: 'same-grid',
  designColumns: ['subject', 'diagnosis', 'sex', 'age', 'site'],
  designTablePreview: {
    columns: ['subject', 'diagnosis', 'sex', 'age'],
    rows: [
      { id: 'sub001', cells: ['sub001', 'control', 'F', '22'] },
      { id: 'sub002', cells: ['sub002', 'control', 'M', '27'] },
      { id: 'sub003', cells: ['sub003', 'control', 'F', '29'] },
      { id: 'sub004', cells: ['sub004', 'case', 'F', '31'] },
    ],
  },
  memberSummaries: [
    { id: 'sub001', sourcePath: DEMO_MEMBER_SOURCE_PATHS.sub001 },
    { id: 'sub002', sourcePath: DEMO_MEMBER_SOURCE_PATHS.sub002 },
    { id: 'sub003', sourcePath: DEMO_MEMBER_SOURCE_PATHS.sub003 },
    { id: 'sub004', sourcePath: DEMO_MEMBER_SOURCE_PATHS.sub004 },
    { id: 'sub005', sourcePath: DEMO_MEMBER_SOURCE_PATHS.sub005 },
    { id: 'sub006', sourcePath: DEMO_MEMBER_SOURCE_PATHS.sub006 },
  ],
  memberIds: ['sub001', 'sub002', 'sub003', 'sub004', 'sub005', 'sub006'],
  savedCohortIds: ['matched-ctl-site-a', 'young-controls', 'cases-site-b'],
  ingestAudit: {
    sourceLabel: 'NeuroTabs manifest',
    join: {
      matchedRows: 42,
      unmatchedRows: 1,
      duplicateKeys: 0,
      severity: 'warning',
      issueDetails: [
        {
          message: 'One preview row could not be matched to a bindable member source.',
          memberIds: ['sub006'],
        },
      ],
    },
    support: {
      supportLabel: 'MNI152 2mm template',
      alignmentClass: 'same-grid',
      readyForCompare: true,
      severity: 'ok',
    },
    notes: [
      'One design-table row did not match a loaded member.',
      'All loaded members are compare-safe on the canonical support.',
    ],
  },
};

const MANIFEST_IMPORT_SET: SpatialFieldSetSummary = {
  id: 'study-manifest-preview',
  name: 'Faces Task / Manifest Import',
  sourceKind: 'imported',
  memberCount: 36,
  primaryFeatureId: 'tstat',
  supportKind: 'volume',
  supportLabel: 'MNI152 2mm template',
  alignmentClass: 'same-grid',
  designColumns: ['subject', 'diagnosis', 'sex', 'age_band', 'site'],
  designTablePreview: {
    columns: ['subject', 'diagnosis', 'sex', 'age_band'],
    rows: [
      { id: 'sub101', cells: ['sub101', 'control', 'F', '20-29'] },
      { id: 'sub102', cells: ['sub102', 'control', 'M', '30-39'] },
      { id: 'sub103', cells: ['sub103', 'case', 'F', '20-29'] },
      { id: 'sub104', cells: ['sub104', 'case', 'M', '30-39'] },
    ],
  },
  memberSummaries: [
    { id: 'sub101', sourcePath: null },
    { id: 'sub102', sourcePath: null },
    { id: 'sub103', sourcePath: null },
    { id: 'sub104', sourcePath: null },
    { id: 'sub105', sourcePath: null },
    { id: 'sub106', sourcePath: null },
  ],
  memberIds: ['sub101', 'sub102', 'sub103', 'sub104', 'sub105', 'sub106'],
  savedCohortIds: ['controls-site-a', 'cases-site-a'],
  ingestAudit: {
    sourceLabel: 'NeuroTabs manifest',
    join: {
      matchedRows: 36,
      unmatchedRows: 0,
      duplicateKeys: 0,
      severity: 'ok',
      issueDetails: [],
    },
    support: {
      supportLabel: 'MNI152 2mm template',
      alignmentClass: 'same-grid',
      readyForCompare: true,
      severity: 'ok',
    },
    notes: [
      'All manifest rows resolved to members.',
      'All members share the canonical support and are compare-safe.',
    ],
  },
};

const REGEX_IMPORT_SET: SpatialFieldSetSummary = {
  id: 'study-regex-preview',
  name: 'Discovery Import / Site B',
  sourceKind: 'imported',
  memberCount: 28,
  primaryFeatureId: 'statmap',
  supportKind: 'volume',
  supportLabel: 'MNI152 3mm template',
  alignmentClass: 'same-space',
  designColumns: ['subject', 'diagnosis', 'session', 'site'],
  designTablePreview: {
    columns: ['subject', 'diagnosis', 'session', 'site'],
    rows: [
      { id: 'sub201', cells: ['sub201', 'control', 'ses-01', 'site-b'] },
      { id: 'sub202', cells: ['sub202', 'case', 'ses-01', 'site-b'] },
      { id: 'sub203', cells: ['sub203', 'control', 'ses-02', 'site-b'] },
      { id: 'sub204', cells: ['sub204', 'case', 'ses-02', 'site-b'] },
    ],
  },
  memberSummaries: [
    { id: 'sub201', sourcePath: null },
    { id: 'sub202', sourcePath: null },
    { id: 'sub203', sourcePath: null },
    { id: 'sub204', sourcePath: null },
    { id: 'sub205', sourcePath: null },
    { id: 'sub206', sourcePath: null },
  ],
  memberIds: ['sub201', 'sub202', 'sub203', 'sub204', 'sub205', 'sub206'],
  savedCohortIds: ['controls-site-b'],
  ingestAudit: {
    sourceLabel: 'Regex discovery',
    join: {
      matchedRows: 28,
      unmatchedRows: 3,
      duplicateKeys: 1,
      severity: 'warning',
      issueDetails: [
        {
          message: 'Three discovered files did not resolve to a clean row binding.',
          memberIds: ['sub201', 'sub203', 'sub205'],
        },
        {
          message: 'One duplicate subject-session key was detected during discovery.',
          memberIds: ['sub203', 'sub205'],
        },
      ],
    },
    support: {
      supportLabel: 'MNI152 3mm template',
      alignmentClass: 'same-space',
      readyForCompare: false,
      severity: 'warning',
    },
    notes: [
      'Three discovered files were not joined to design rows.',
      'One duplicate subject-session key needs resolution before compare-safe workflows.',
    ],
  },
};

const DEMO_FEATURES: StudioFeatureSummary[] = [
  {
    id: 'statmap',
    label: 'Stat Map',
    kind: 'volume',
  },
];

const MANIFEST_FEATURES: StudioFeatureSummary[] = [
  {
    id: 'tstat',
    label: 'T Statistic',
    kind: 'volume',
  },
];

const DEMO_COHORTS: StudioCohortSummary[] = [
  {
    id: 'matched-ctl-site-a',
    label: 'Matched controls / Site A',
    memberCount: 42,
    description: 'Site-matched control cohort for comparator views.',
    memberIds: ['sub001', 'sub002', 'sub003'],
    originKind: 'imported',
    originLabel: 'Seeded demo import',
  },
  {
    id: 'young-controls',
    label: 'Young controls',
    memberCount: 17,
    description: 'Control subjects age 20-30.',
    memberIds: ['sub001', 'sub003'],
    originKind: 'imported',
    originLabel: 'Seeded demo import',
  },
  {
    id: 'cases-site-b',
    label: 'Cases / Site B',
    memberCount: 18,
    description: 'Case cohort restricted to Site B.',
    memberIds: ['sub004', 'sub005', 'sub006'],
    originKind: 'imported',
    originLabel: 'Seeded demo import',
  },
];

const DEMO_EXPRESSIONS: StudioFieldExpressionSummary[] = [
  {
    id: 'deck-member',
    label: 'Current member',
    kind: 'member',
    recipe: 'member(sub003)',
    cohortId: null,
  },
  {
    id: 'compare-zscore',
    label: 'Z-score vs matched controls',
    kind: 'comparison',
    recipe: 'zscore(current, cohort:matched-ctl-site-a)',
    cohortId: 'matched-ctl-site-a',
  },
];

const MANIFEST_EXPRESSIONS: StudioFieldExpressionSummary[] = [
  {
    id: 'manifest-member',
    label: 'Current member',
    kind: 'member',
    recipe: 'member(sub103)',
    cohortId: null,
  },
  {
    id: 'manifest-compare-zscore',
    label: 'Z-score vs controls',
    kind: 'comparison',
    recipe: 'zscore(current, cohort:controls-site-a)',
    cohortId: 'controls-site-a',
  },
];

const REGEX_EXPRESSIONS: StudioFieldExpressionSummary[] = [
  {
    id: 'regex-member',
    label: 'Current member',
    kind: 'member',
    recipe: 'member(sub203)',
    cohortId: null,
  },
];

const MANIFEST_COHORTS: StudioCohortSummary[] = [
  {
    id: 'controls-site-a',
    label: 'Controls / Site A',
    memberCount: 18,
    description: 'Manifest-backed control cohort.',
    memberIds: ['sub101', 'sub102', 'sub105'],
    originKind: 'imported',
    originLabel: 'Manifest preview',
  },
  {
    id: 'cases-site-a',
    label: 'Cases / Site A',
    memberCount: 18,
    description: 'Manifest-backed case cohort.',
    memberIds: ['sub103', 'sub104', 'sub106'],
    originKind: 'imported',
    originLabel: 'Manifest preview',
  },
];

const REGEX_COHORTS: StudioCohortSummary[] = [
  {
    id: 'controls-site-b',
    label: 'Controls / Site B',
    memberCount: 14,
    description: 'Discovery-backed control cohort with unresolved join warnings.',
    memberIds: ['sub201', 'sub203', 'sub205'],
    originKind: 'imported',
    originLabel: 'Regex discovery preview',
  },
];

const DEFAULT_SELECTION: StudioSelection = {
  activeSetId: null,
  activeFeatureId: null,
  activeLens: 'deck',
  activeMemberId: null,
  compareCohortId: null,
  activeScopeCohortId: null,
  activeExpressionId: null,
};

const DEFAULT_MATERIALIZATION: StudioMaterializationStatus = {
  warm: 0,
  preview: 0,
  pending: 0,
  failed: 0,
};

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

/** Auto-detect well-known column names for file path and subject ID. */
function autoDetectTsvColumns(headers: string[]): TsvColumnMapping {
  const normalizedHeaders = headers.map((header) => normalizeImportHeader(header));
  const filePathColumn = pickBestColumn(
    headers,
    normalizedHeaders,
    [
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
    ]
  );
  const subjectIdColumn = pickBestColumn(
    headers,
    normalizedHeaders,
    [
      ['subject_id', 100],
      ['participant_id', 100],
      ['subject', 95],
      ['participant', 90],
      ['subid', 85],
      ['sub', 75],
      ['id', 25],
    ]
  );

  return { filePathColumn, subjectIdColumn, excludedColumns: [] };
}

/** Parse a TSV/CSV string into headers and rows. */
function parseTsvString(content: string): { headers: string[]; rows: string[][]; error: string | null } {
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
    return { headers: [], rows: [], error: 'File must have a header row and at least one data row.' };
  }

  const headers = parsedRows.rows[0].map((h) => h.trim());
  if (headers.length < 2) {
    return { headers: [], rows: [], error: 'File must have at least two columns (file path + one design variable).' };
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
  patterns: Array<[string, number]>
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
      if (
        normalizedHeader.endsWith(`_${pattern}`) &&
        score - 5 > bestScore
      ) {
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
  delimiter: ',' | '\t'
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

const IMPORT_CANDIDATES: StudioImportCandidate[] = [
  {
    id: 'candidate-manifest-a',
    label: 'NeuroTabs manifest preview',
    description: 'Prepared manifest import with a clean join and compare-safe support.',
    mode: 'manifest',
    sourceHint: '/data/studyA/studyA.neurotabs.yaml',
    set: MANIFEST_IMPORT_SET,
    features: MANIFEST_FEATURES,
    cohorts: MANIFEST_COHORTS,
    expressions: MANIFEST_EXPRESSIONS,
    materialization: {
      warm: 2,
      preview: 1,
    },
  },
  {
    id: 'candidate-regex-b',
    label: 'Regex discovery preview',
    description: 'Discovered files with unresolved join warnings and same-space alignment.',
    mode: 'regex',
    sourceHint: 'glob: derivatives/**/*_statmap.nii.gz',
    set: REGEX_IMPORT_SET,
    features: DEMO_FEATURES,
    cohorts: REGEX_COHORTS,
    expressions: REGEX_EXPRESSIONS,
    materialization: {
      warm: 1,
      preview: 2,
    },
  },
];

function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  return items.reduce<Record<string, T>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
}

function getPreferredExpressionId(
  expressionIds: string[],
  expressions: Record<string, StudioFieldExpressionSummary>,
  kind: StudioFieldExpressionSummary['kind'],
  cohortId?: string | null
): string | null {
  const availableExpressions = expressionIds
    .map((id) => expressions[id])
    .filter(Boolean);

  const exactMatch = availableExpressions.find(
    (expression) =>
      expression.kind === kind &&
      (cohortId === undefined || expression.cohortId === cohortId)
  );
  if (exactMatch) {
    return exactMatch.id;
  }

  const kindMatch = availableExpressions.find((expression) => expression.kind === kind);
  return kindMatch?.id ?? availableExpressions[0]?.id ?? null;
}

function cohortMatchesMembers(cohort: StudioCohortSummary, memberIds: string[]): boolean {
  if (cohort.memberIds.length !== memberIds.length) {
    return false;
  }

  const existing = [...cohort.memberIds].sort();
  const next = [...memberIds].sort();
  return existing.every((memberId, index) => memberId === next[index]);
}

function dynamicCompareExpressionId(setId: string, cohortId: string): string {
  return `dynamic-compare:${setId}:${cohortId}`;
}

function dynamicCompareExpression(
  setId: string,
  cohort: StudioCohortSummary
): StudioFieldExpressionSummary {
  return {
    id: dynamicCompareExpressionId(setId, cohort.id),
    label: `Z-score vs ${cohort.label}`,
    kind: 'comparison',
    recipe: `zscore(current, cohort:${cohort.id})`,
    cohortId: cohort.id,
  };
}

export const useSetStudioStore = create<SetStudioStoreState>((set, get) => ({
  sets: {},
  features: {},
  cohorts: {},
  expressions: {},
  setExpressionIds: {},
  importCandidates: toRecord(IMPORT_CANDIDATES),
  importDialog: {
    isOpen: false,
    mode: 'table',
    selectedCandidateId: 'candidate-manifest-a',
    isLoading: false,
    error: null,
    source: null,
    manifestPath: '/data/studyA/studyA.neurotabs.yaml',
    discoveryRoot: '.',
    filePattern: String.raw`.*_statmap\.nii(\.gz)?$`,
    tsvWizard: DEFAULT_TSV_WIZARD,
  },
  selection: DEFAULT_SELECTION,
  materialization: DEFAULT_MATERIALIZATION,
  comparePaneSpecs: [],
  comparePaneLoading: false,
  compareRefreshingPaneIds: [],
  activeIssueMemberIds: [],
  activeIssueLabel: null,
  designSearch: '',
  sortColumn: null,
  sortDirection: 'asc',
  activeDesignFilters: [],
  activeArtifact: null,
  artifactHistory: [],
  savedRecipes: [],

  bootstrapStudio: (payload) => {
    const features = toRecord(payload.features);
    const cohorts = toRecord(payload.cohorts);
    const expressions = toRecord(payload.expressions);
    const activeFeatureId =
      payload.selection?.activeFeatureId ?? payload.set.primaryFeatureId ?? payload.features[0]?.id ?? null;

    set({
      sets: {
        ...get().sets,
        [payload.set.id]: payload.set,
      },
      features: {
        ...get().features,
        ...features,
      },
      cohorts: {
        ...get().cohorts,
        ...cohorts,
      },
      expressions: {
        ...get().expressions,
        ...expressions,
      },
      setExpressionIds: {
        ...get().setExpressionIds,
        [payload.set.id]: payload.expressions.map((expression) => expression.id),
      },
      selection: {
        activeSetId: payload.set.id,
        activeFeatureId,
        activeLens: payload.selection?.activeLens ?? 'deck',
        activeMemberId:
          payload.selection?.activeMemberId ?? payload.set.memberIds[2] ?? payload.set.memberIds[0] ?? null,
        compareCohortId:
          payload.selection?.compareCohortId ?? payload.set.savedCohortIds[0] ?? null,
        activeScopeCohortId: payload.selection?.activeScopeCohortId ?? null,
        activeExpressionId: payload.selection?.activeExpressionId ?? payload.expressions[0]?.id ?? null,
      },
      materialization: {
        ...DEFAULT_MATERIALIZATION,
        ...payload.materialization,
      },
      comparePaneSpecs: [],
      comparePaneLoading: false,
      compareRefreshingPaneIds: [],
      activeIssueMemberIds: [],
      activeIssueLabel: null,
      designSearch: '',
      sortColumn: null,
      sortDirection: 'asc',
      activeDesignFilters: [],
      activeArtifact: null,
      artifactHistory: [],
      savedRecipes: [],
    });
  },

  loadDemoSession: () => {
    get().bootstrapStudio({
      set: DEMO_SET,
      features: DEMO_FEATURES,
      cohorts: DEMO_COHORTS,
      expressions: DEMO_EXPRESSIONS,
      selection: {
        activeLens: 'deck',
        activeMemberId: 'sub003',
        compareCohortId: 'matched-ctl-site-a',
        activeExpressionId: 'deck-member',
      },
      materialization: {
        warm: 5,
        preview: 2,
        pending: 0,
        failed: 0,
      },
    });
  },

  setActiveLens: (lens) => {
    const { selection, expressions, setExpressionIds } = get();
    if (selection.activeLens === lens) {
      return;
    }

    const expressionIds = selection.activeSetId
      ? setExpressionIds[selection.activeSetId] ?? []
      : [];
    const nextExpressionId =
      lens === 'compare'
        ? getPreferredExpressionId(
            expressionIds,
            expressions,
            'comparison',
            selection.compareCohortId
          )
        : getPreferredExpressionId(expressionIds, expressions, 'member');

    set({
      selection: {
        ...selection,
        activeLens: lens,
        activeExpressionId: nextExpressionId,
      },
    });
  },

  setActiveMember: (memberId) => {
    const { selection } = get();
    if (selection.activeMemberId === memberId) {
      return;
    }

    set({
      selection: {
        ...selection,
        activeMemberId: memberId,
      },
    });
  },

  setCompareCohort: (cohortId) => {
    const { selection, expressions, setExpressionIds, cohorts } = get();
    if (selection.compareCohortId === cohortId) {
      return;
    }

    const expressionIds = selection.activeSetId
      ? setExpressionIds[selection.activeSetId] ?? []
      : [];
    const exactComparisonExpressionId = cohortId
      ? expressionIds
          .map((expressionId) => expressions[expressionId])
          .filter(Boolean)
          .find(
            (expression) =>
              expression.kind === 'comparison' && expression.cohortId === cohortId
          )?.id ?? null
      : null;
    let nextExpressions = expressions;
    let nextSetExpressionIds = setExpressionIds;
    let nextExpressionId = cohortId ? exactComparisonExpressionId : selection.activeExpressionId;

    if (cohortId && selection.activeSetId && !nextExpressionId) {
      const cohort = cohorts[cohortId] ?? null;
      if (cohort) {
        const expression = dynamicCompareExpression(selection.activeSetId, cohort);
        nextExpressions = {
          ...expressions,
          [expression.id]: expression,
        };
        nextSetExpressionIds = {
          ...setExpressionIds,
          [selection.activeSetId]: [...expressionIds, expression.id],
        };
        nextExpressionId = expression.id;
      }
    }

    set({
      expressions: nextExpressions,
      setExpressionIds: nextSetExpressionIds,
      selection: {
        ...selection,
        compareCohortId: cohortId,
        activeExpressionId: nextExpressionId,
      },
    });
  },

  setActiveScopeCohort: (cohortId) => {
    const { selection } = get();
    if (selection.activeScopeCohortId === cohortId) {
      return;
    }
    set({
      selection: {
        ...selection,
        activeScopeCohortId: cohortId,
      },
    });
  },

  drillToCohort: (cohortId) => {
    const { selection, cohorts, sets, expressions, setExpressionIds } = get();
    if (!selection.activeSetId) {
      return;
    }
    const activeSet = sets[selection.activeSetId];
    const cohort = cohortId ? cohorts[cohortId] ?? null : null;
    const scopedMemberIds =
      cohort?.memberIds.filter((memberId) => activeSet?.memberIds.includes(memberId)) ?? [];
    const nextActiveMemberId =
      scopedMemberIds[0] ??
      (selection.activeMemberId && activeSet?.memberIds.includes(selection.activeMemberId)
        ? selection.activeMemberId
        : activeSet?.memberIds[0] ?? null);
    const expressionIds = setExpressionIds[selection.activeSetId] ?? [];
    const nextExpressionId = getPreferredExpressionId(expressionIds, expressions, 'member');

    set({
      selection: {
        ...selection,
        activeLens: 'deck',
        activeScopeCohortId: cohortId,
        activeMemberId: nextActiveMemberId,
        activeExpressionId: nextExpressionId,
      },
    });
  },

  openImportDialog: (mode) => {
    const { importDialog, importCandidates } = get();
    const candidateForMode =
      (importDialog.selectedCandidateId &&
      importCandidates[importDialog.selectedCandidateId]?.mode === mode
        ? importDialog.selectedCandidateId
        : Object.values(importCandidates).find((candidate) => candidate.mode === mode)?.id) ?? null;

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
    const candidateForMode =
      Object.values(importCandidates).find((candidate) => candidate.mode === mode)?.id ?? null;

    set({
      importDialog: {
        ...importDialog,
        isOpen: true,
        mode,
        selectedCandidateId: candidateForMode,
        isLoading: true,
        error: null,
        source: null,
        manifestPath: importDialog.manifestPath,
        discoveryRoot: importDialog.discoveryRoot,
        filePattern: importDialog.filePattern,
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
      },
    });
  },

  setImportPreviewResult: (mode, candidates, source, error = null) => {
    if (candidates.length === 0) {
      const { importDialog } = get();
      set({
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
    const candidate = candidateId ? importCandidates[candidateId] ?? null : null;
    if (!candidate) {
      return;
    }

    const compareReady =
      candidate.set.ingestAudit.support.readyForCompare &&
      candidate.set.ingestAudit.join.unmatchedRows === 0 &&
      candidate.set.ingestAudit.join.duplicateKeys === 0;
    const activeLens = compareReady ? 'compare' : 'deck';
    const preferredExpressionId =
      activeLens === 'compare'
        ? candidate.expressions.find((expression) => expression.kind === 'comparison')?.id ??
          candidate.expressions[0]?.id ??
          null
        : candidate.expressions.find((expression) => expression.kind === 'member')?.id ??
          candidate.expressions[0]?.id ??
          null;

    get().bootstrapStudio({
      set: {
        ...candidate.set,
        sourceKind: candidate.set.sourceKind ?? 'imported',
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
      materialization: candidate.materialization,
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
        i !== fileColIdx &&
        i !== subjectColIdx &&
        !columnMapping.excludedColumns.includes(h)
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
      (detail) => detail.subjectId && duplicateSubjectIdSet.has(detail.subjectId)
    );
    const missingSubjectRows = rowDetails.filter((detail) => !detail.subjectId);
    const missingPathRows = rowDetails.filter(
      (detail) => detail.subjectId && !detail.sourcePath
    );
    const validRows = rowDetails.filter(
      (detail) =>
        detail.subjectId &&
        detail.sourcePath &&
        !duplicateSubjectIdSet.has(detail.subjectId)
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
      validRows.length === 0
        ? 'error'
        : issueDetails.length > 0
          ? 'warning'
          : 'ok';

    const previewColumns = [
      headers[subjectColIdx],
      ...designColumns.filter((c) => c !== headers[subjectColIdx]).slice(0, 3),
    ];
    const previewRows = rows.slice(0, 5).map((row, rowIndex) => ({
      id: (row[subjectColIdx] ?? '').trim() || `row-${rowIndex + 1}`,
      cells: previewColumns.map((col) => {
        const idx = headers.indexOf(col);
        return idx >= 0 ? row[idx] ?? '' : '';
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
    const candidate: StudioImportCandidate = {
      id: candidateId,
      label: `Table import (${memberIds.length} subjects)`,
      description: `Imported from ${wizard.tsvPath || 'pasted table'} with ${designColumns.length} design columns.`,
      mode: 'table',
      sourceHint: wizard.tsvPath || 'pasted content',
      set: {
        id: `table-import-${Date.now()}`,
        name: wizard.tsvPath ? wizard.tsvPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Table Import' : 'Table Import',
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
        { id: 'table-deck-member', label: 'Active member', kind: 'member', recipe: 'member(current)', cohortId: null },
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

  setComparePaneSpecs: (specs) => {
    set({
      comparePaneSpecs: specs,
    });
  },

  setComparePaneLoading: (loading) => {
    set({
      comparePaneLoading: loading,
    });
  },

  setCompareRefreshingPaneIds: (paneIds) => {
    set({
      compareRefreshingPaneIds: paneIds,
    });
  },

  setDesignSearch: (value) => {
    if (get().designSearch === value) {
      return;
    }
    set({ designSearch: value });
  },

  setSortColumn: (value) => {
    if (get().sortColumn === value) {
      return;
    }
    set({ sortColumn: value });
  },

  toggleSortDirection: () => {
    set(({ sortDirection }) => ({
      sortDirection: sortDirection === 'asc' ? 'desc' : 'asc',
    }));
  },

  toggleDesignFilter: (filter) => {
    set((state) => {
      const exists = state.activeDesignFilters.some(
        (entry) => entry.column === filter.column && entry.value === filter.value
      );
      return {
        activeDesignFilters: exists
          ? state.activeDesignFilters.filter(
              (entry) => !(entry.column === filter.column && entry.value === filter.value)
            )
          : [...state.activeDesignFilters, filter],
      };
    });
  },

  removeDesignFilter: (filter) => {
    set((state) => ({
      activeDesignFilters: state.activeDesignFilters.filter(
        (entry) => !(entry.column === filter.column && entry.value === filter.value)
      ),
    }));
  },

  clearDesignFilters: () => {
    if (get().activeDesignFilters.length === 0) {
      return;
    }
    set({ activeDesignFilters: [] });
  },

  clearSubsetNarrowing: () => {
    const { designSearch, activeDesignFilters } = get();
    if (!designSearch && activeDesignFilters.length === 0) {
      return;
    }
    set({
      designSearch: '',
      activeDesignFilters: [],
    });
  },

  setActiveIssueFocus: (issue) => {
    set({
      activeIssueMemberIds: issue.memberIds,
      activeIssueLabel: issue.message,
    });
  },

  clearActiveIssueFocus: () => {
    const { activeIssueMemberIds, activeIssueLabel } = get();
    if (activeIssueMemberIds.length === 0 && !activeIssueLabel) {
      return;
    }
    set({
      activeIssueMemberIds: [],
      activeIssueLabel: null,
    });
  },

  createSavedCohort: ({ memberIds, label, description, originKind, originLabel }) => {
    const { selection, sets, cohorts, expressions, setExpressionIds } = get();
    if (!selection.activeSetId) {
      return null;
    }

    const activeSet = sets[selection.activeSetId];
    if (!activeSet) {
      return null;
    }

    const filteredMemberIds = memberIds.filter((memberId, index) => {
      return activeSet.memberIds.includes(memberId) && memberIds.indexOf(memberId) === index;
    });
    if (filteredMemberIds.length === 0) {
      return null;
    }

    const existingCohort = activeSet.savedCohortIds
      .map((cohortId) => cohorts[cohortId])
      .filter(Boolean)
      .find((cohort) => cohortMatchesMembers(cohort, filteredMemberIds));
    if (existingCohort) {
      return existingCohort.id;
    }

    const nextIndex = activeSet.savedCohortIds.length + 1;
    const cohortId = `saved-${activeSet.id}-${nextIndex}`;
    const cohortLabel = label?.trim() || `Saved Cohort ${nextIndex}`;
    const cohortDescription =
      description?.trim() || `Saved from the current visible Studio members.`;
    const nextCohort: StudioCohortSummary = {
      id: cohortId,
      label: cohortLabel,
      memberCount: filteredMemberIds.length,
      description: cohortDescription,
      memberIds: filteredMemberIds,
      originKind: originKind ?? 'saved_snapshot',
      originLabel: originLabel?.trim() || 'Current Studio view',
    };
    const nextExpression = dynamicCompareExpression(activeSet.id, nextCohort);

    set({
      cohorts: {
        ...cohorts,
        [cohortId]: nextCohort,
      },
      expressions: {
        ...expressions,
        [nextExpression.id]: nextExpression,
      },
      setExpressionIds: {
        ...setExpressionIds,
        [activeSet.id]: [
          ...(setExpressionIds[activeSet.id] ?? []),
          nextExpression.id,
        ],
      },
      sets: {
        ...sets,
        [activeSet.id]: {
          ...activeSet,
          savedCohortIds: [...activeSet.savedCohortIds, cohortId],
        },
      },
    });

    return cohortId;
  },

  renameSavedCohort: (cohortId, label) => {
    const { selection, cohorts, expressions } = get();
    const cohort = cohorts[cohortId];
    const nextLabel = label.trim();
    if (!cohort || !nextLabel || cohort.label === nextLabel) {
      return;
    }

    const updatedCohort: StudioCohortSummary = {
      ...cohort,
      label: nextLabel,
    };
    const nextExpressions = { ...expressions };
    const dynamicExpressionId =
      selection.activeSetId ? dynamicCompareExpressionId(selection.activeSetId, cohortId) : null;
    if (dynamicExpressionId && nextExpressions[dynamicExpressionId]) {
      nextExpressions[dynamicExpressionId] = dynamicCompareExpression(
        selection.activeSetId!,
        updatedCohort
      );
    }

    set({
      cohorts: {
        ...cohorts,
        [cohortId]: updatedCohort,
      },
      expressions: nextExpressions,
    });
  },

  deleteSavedCohort: (cohortId) => {
    const { selection, sets, cohorts, expressions, setExpressionIds } = get();
    if (!selection.activeSetId || !cohorts[cohortId]) {
      return;
    }

    const activeSet = sets[selection.activeSetId];
    if (!activeSet || !activeSet.savedCohortIds.includes(cohortId)) {
      return;
    }

    const nextCohorts = { ...cohorts };
    delete nextCohorts[cohortId];

    const dynamicExpressionId = dynamicCompareExpressionId(activeSet.id, cohortId);
    const nextExpressions = { ...expressions };
    delete nextExpressions[dynamicExpressionId];
    const nextExpressionIds = (setExpressionIds[activeSet.id] ?? []).filter(
      (expressionId) => expressionId !== dynamicExpressionId
    );
    const nextCompareCohortId =
      selection.compareCohortId === cohortId ? null : selection.compareCohortId;
    const nextScopeCohortId =
      selection.activeScopeCohortId === cohortId ? null : selection.activeScopeCohortId;
    const nextActiveExpressionId =
      selection.activeExpressionId === dynamicExpressionId ? getPreferredExpressionId(
        nextExpressionIds,
        nextExpressions,
        selection.activeLens === 'compare' ? 'comparison' : 'member',
        nextCompareCohortId
      ) : selection.activeExpressionId;

    set({
      cohorts: nextCohorts,
      expressions: nextExpressions,
      setExpressionIds: {
        ...setExpressionIds,
        [activeSet.id]: nextExpressionIds,
      },
      sets: {
        ...sets,
        [activeSet.id]: {
          ...activeSet,
          savedCohortIds: activeSet.savedCohortIds.filter((id) => id !== cohortId),
        },
      },
      selection: {
        ...selection,
        compareCohortId: nextCompareCohortId,
        activeScopeCohortId: nextScopeCohortId,
        activeExpressionId: nextActiveExpressionId,
      },
    });
  },

  setActiveArtifact: (artifact) => {
    const currentArtifact = get().activeArtifact;
    if (
      currentArtifact?.id === artifact?.id &&
      currentArtifact?.sourcePath === artifact?.sourcePath &&
      currentArtifact?.recipe === artifact?.recipe &&
      currentArtifact?.materializationKey === artifact?.materializationKey &&
      currentArtifact?.materializedAtMs === artifact?.materializedAtMs &&
      currentArtifact?.cacheStatus === artifact?.cacheStatus &&
      currentArtifact?.cacheMessage === artifact?.cacheMessage &&
      currentArtifact?.provenancePath === artifact?.provenancePath
    ) {
      return;
    }

    const stampedArtifact = artifact
      ? {
          ...artifact,
          capturedAtMs: Date.now(),
        }
      : null;

    const nextHistory = stampedArtifact
      ? [stampedArtifact, ...get().artifactHistory.filter((entry) => entry.id !== stampedArtifact.id)].slice(0, 8)
      : get().artifactHistory;

    set({
      activeArtifact: stampedArtifact,
      artifactHistory: nextHistory,
    });
  },

  saveRecipeSnapshot: (recipe) => {
    const savedRecipe: StudioSavedRecipeSummary = {
      ...recipe,
      id: `recipe:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      savedAtMs: Date.now(),
    };

    set({
      savedRecipes: [savedRecipe, ...get().savedRecipes.filter((entry) => entry.title !== savedRecipe.title)].slice(
        0,
        12
      ),
    });

    return savedRecipe.id;
  },

  renameSavedRecipe: (recipeId, title) => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      return;
    }

    set({
      savedRecipes: get().savedRecipes.map((recipe) =>
        recipe.id === recipeId
          ? {
              ...recipe,
              title: nextTitle,
            }
          : recipe
      ),
    });
  },

  deleteSavedRecipe: (recipeId) => {
    set({
      savedRecipes: get().savedRecipes.filter((recipe) => recipe.id !== recipeId),
    });
  },

  restoreSelectionSnapshot: (snapshot) => {
    const { selection } = get();
    set({
      selection: {
        ...selection,
        ...snapshot,
      },
    });
  },
}));
