export type StudioLensType = 'deck' | 'compare' | 'pivot-matrix' | 'atlas';
export type StudioImportMode = 'manifest' | 'regex' | 'table';
export type StudioImportSource = 'backend' | 'fallback' | null;
export type StudioSessionSourceKind = 'demo' | 'imported';

export type StudioSupportKind = 'volume' | 'surface' | 'mixed' | 'unknown';
export type StudioCohortOriginKind = 'imported' | 'saved_snapshot' | 'issue_focus';

export type StudioAlignmentClass =
  | 'same-grid'
  | 'same-space'
  | 'same-topology'
  | 'mixed'
  | 'unknown';

export type StudioExpressionKind = 'member' | 'reducer' | 'comparison';
export type StudioComparePaneStatus = 'live' | 'pending' | 'blocked';
export type StudioCompareBindingKind = 'member_source' | 'derived_field';
export type StudioCompareCacheStatus =
  | 'source'
  | 'hit'
  | 'miss'
  | 'stale'
  | 'forced'
  | 'synthetic'
  | 'unavailable'
  | 'failed';
export type StudioArtifactKind = 'member' | 'compare-pane';

export type StudioAuditSeverity = 'ok' | 'warning' | 'error';

export interface StudioFeatureSummary {
  id: string;
  label: string;
  kind: StudioSupportKind;
}

export interface StudioCohortSummary {
  id: string;
  label: string;
  memberCount: number;
  description: string;
  memberIds: string[];
  originKind: StudioCohortOriginKind;
  originLabel: string | null;
}

export interface StudioFieldExpressionSummary {
  id: string;
  label: string;
  kind: StudioExpressionKind;
  recipe: string;
  cohortId: string | null;
}

export interface StudioJoinAuditSummary {
  matchedRows: number;
  unmatchedRows: number;
  duplicateKeys: number;
  severity: StudioAuditSeverity;
  issueDetails: StudioJoinIssueDetail[];
}

export interface StudioJoinIssueDetail {
  message: string;
  memberIds: string[];
}

export interface StudioDesignFilter {
  column: string;
  value: string;
}

export interface StudioSupportAuditSummary {
  supportLabel: string;
  alignmentClass: StudioAlignmentClass;
  readyForCompare: boolean;
  severity: StudioAuditSeverity;
}

export interface StudioIngestAuditSummary {
  sourceLabel: string;
  join: StudioJoinAuditSummary;
  support: StudioSupportAuditSummary;
  notes: string[];
}

export interface StudioMemberSummary {
  id: string;
  sourcePath: string | null;
}

export interface StudioDesignRowPreview {
  id: string;
  cells: string[];
}

export interface StudioDesignTablePreview {
  columns: string[];
  rows: StudioDesignRowPreview[];
}

export interface SpatialFieldSetSummary {
  id: string;
  name: string;
  sourceKind?: StudioSessionSourceKind;
  memberCount: number;
  primaryFeatureId: string | null;
  supportKind: StudioSupportKind;
  supportLabel: string;
  alignmentClass: StudioAlignmentClass;
  designColumns: string[];
  designTablePreview: StudioDesignTablePreview | null;
  memberSummaries: StudioMemberSummary[];
  memberIds: string[];
  savedCohortIds: string[];
  ingestAudit: StudioIngestAuditSummary;
}

export interface StudioSelection {
  activeSetId: string | null;
  activeFeatureId: string | null;
  activeLens: StudioLensType;
  activeMemberId: string | null;
  compareCohortId: string | null;
  activeScopeCohortId: string | null;
  activeExpressionId: string | null;
}

export interface StudioMaterializationStatus {
  warm: number;
  preview: number;
  pending: number;
  failed: number;
}

export interface StudioImportCandidate {
  id: string;
  label: string;
  description: string;
  mode: StudioImportMode;
  sourceHint: string;
  set: SpatialFieldSetSummary;
  features: StudioFeatureSummary[];
  cohorts: StudioCohortSummary[];
  expressions: StudioFieldExpressionSummary[];
  materialization?: Partial<StudioMaterializationStatus>;
}

export type TsvWizardStep = 'load' | 'map' | 'preview';

export interface TsvColumnMapping {
  filePathColumn: string | null;
  subjectIdColumn: string | null;
  excludedColumns: string[];
}

export interface TsvWizardState {
  step: TsvWizardStep;
  tsvPath: string;
  rawContent: string | null;
  headers: string[];
  rows: string[][];
  columnMapping: TsvColumnMapping;
  parseError: string | null;
}

export interface StudioImportDialogState {
  isOpen: boolean;
  mode: StudioImportMode;
  selectedCandidateId: string | null;
  isLoading: boolean;
  error: string | null;
  source: StudioImportSource;
  manifestPath: string;
  discoveryRoot: string;
  filePattern: string;
  tsvWizard: TsvWizardState;
}

export interface StudioComparePaneSpec {
  id: 'current' | 'cohort-mean' | 'residual' | 'zscore';
  title: string;
  subtitle: string;
  status: StudioComparePaneStatus;
  reason: string;
  recipe: string | null;
  binding: StudioComparePaneBinding | null;
}

export interface StudioComparePaneBinding {
  kind: StudioCompareBindingKind;
  ready: boolean;
  sourcePath: string | null;
  materializationKey: string | null;
  materializedAtMs: number | null;
  cacheStatus: StudioCompareCacheStatus;
  cacheMessage: string | null;
  provenancePath: string | null;
}

export interface StudioCompareMaterializeRequest {
  supportLabel: string;
  compareReady: boolean;
  forceRematerialize: boolean;
  activeMemberId: string | null;
  activeMemberSourcePath: string | null;
  cohortMemberSourcePaths: string[];
  compareCohortId: string | null;
  compareCohortLabel: string | null;
  compareCohortMemberCount: number | null;
  activeExpressionLabel: string | null;
  activeExpressionRecipe: string | null;
}

export interface StudioArtifactSummary {
  id: string;
  kind: StudioArtifactKind;
  lens: StudioLensType;
  title: string;
  subtitle: string | null;
  recipe: string | null;
  sourcePath: string | null;
  materializationKey: string | null;
  materializedAtMs: number | null;
  cacheStatus: StudioCompareCacheStatus | null;
  cacheMessage: string | null;
  provenancePath: string | null;
  supportLabel: string | null;
  alignmentClass: StudioAlignmentClass | null;
  activeMemberId: string | null;
  cohortId: string | null;
  cohortLabel: string | null;
  cohortOriginKind: StudioCohortOriginKind | null;
  cohortOriginLabel: string | null;
  scopeCohortId: string | null;
  scopeCohortLabel: string | null;
  scopeCohortOriginKind: StudioCohortOriginKind | null;
  scopeCohortOriginLabel: string | null;
  activeExpressionId: string | null;
  paneId: StudioComparePaneSpec['id'] | null;
  bindingKind: StudioCompareBindingKind | null;
  status: StudioComparePaneStatus | null;
  capturedAtMs: number;
}

export interface StudioSavedRecipeSummary {
  id: string;
  title: string;
  subtitle: string | null;
  artifact: StudioArtifactSummary;
  scopeCohortLabel: string | null;
  scopeCohortOriginKind: StudioCohortOriginKind | null;
  scopeCohortOriginLabel: string | null;
  selectionSnapshot: Pick<
    StudioSelection,
    'activeLens' | 'activeMemberId' | 'compareCohortId' | 'activeScopeCohortId' | 'activeExpressionId'
  >;
  provenanceJson: string;
  savedAtMs: number;
}
