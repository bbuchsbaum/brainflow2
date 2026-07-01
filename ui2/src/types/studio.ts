import type {
  SpatialFieldSetSummary as BackendSpatialFieldSetSummary,
  StudioAlignmentClass,
  StudioAuditSeverity,
  StudioCohortOriginKind,
  StudioCohortSummary,
  StudioCompareBindingKind,
  StudioCompareCacheStatus,
  StudioCompareMaterializeRequest,
  StudioComparePaneBinding as BackendStudioComparePaneBinding,
  StudioComparePaneSpec as BackendStudioComparePaneSpec,
  StudioComparePaneStatus,
  StudioDesignRowPreview,
  StudioDesignTablePreview,
  StudioDiscoveryMemberGroup,
  StudioDiscoveryPromotionRequest,
  StudioDiscoveryPromotionResult,
  StudioDiscoveryPreviewSummary,
  StudioDiscoveryRolePattern,
  StudioExpressionKind,
  StudioFeatureSummary,
  StudioFieldBindingAvailability,
  StudioFieldBindingSummary,
  StudioFieldExpressionSummary,
  StudioImportCapability,
  StudioImportCandidate as BackendStudioImportCandidate,
  StudioImportContract,
  StudioImportMode,
  StudioImportProvenanceKind,
  StudioImportReadiness,
  StudioIngestAuditSummary,
  StudioJoinAuditSummary,
  StudioJoinIssueDetail,
  StudioMaterializationStatus,
  StudioMemberSummary,
  StudioReducerKind,
  StudioReducerSpec,
  StudioRoleBindingInput,
  StudioSupportAuditSummary,
  StudioSupportKind,
} from '@brainflow/api';

export type {
  StudioAlignmentClass,
  StudioAuditSeverity,
  StudioCohortOriginKind,
  StudioCohortSummary,
  StudioCompareBindingKind,
  StudioCompareCacheStatus,
  StudioCompareMaterializeRequest,
  StudioComparePaneStatus,
  StudioDesignRowPreview,
  StudioDesignTablePreview,
  StudioDiscoveryMemberGroup,
  StudioDiscoveryPromotionRequest,
  StudioDiscoveryPromotionResult,
  StudioDiscoveryPreviewSummary,
  StudioDiscoveryRolePattern,
  StudioExpressionKind,
  StudioFeatureSummary,
  StudioFieldBindingAvailability,
  StudioFieldBindingSummary,
  StudioFieldExpressionSummary,
  StudioImportCapability,
  StudioImportContract,
  StudioImportMode,
  StudioImportProvenanceKind,
  StudioImportReadiness,
  StudioIngestAuditSummary,
  StudioJoinAuditSummary,
  StudioJoinIssueDetail,
  StudioMaterializationStatus,
  StudioMemberSummary,
  StudioReducerKind,
  StudioReducerSpec,
  StudioRoleBindingInput,
  StudioSupportAuditSummary,
  StudioSupportKind,
};

export type StudioLensType = 'deck' | 'compare' | 'pivot-matrix' | 'atlas';
export type StudioImportSource = 'backend' | 'fallback' | null;
export type StudioSessionSourceKind = 'demo' | 'imported';
export type StudioArtifactKind = 'member' | 'compare-pane';

export interface StudioDesignFilter {
  column: string;
  value: string;
}

export type SpatialFieldSetSummary = BackendSpatialFieldSetSummary & {
  sourceKind?: StudioSessionSourceKind;
  importContract?: StudioImportContract | null;
};

export interface StudioSelection {
  activeSetId: string | null;
  activeFeatureId: string | null;
  activeLens: StudioLensType;
  activeMemberId: string | null;
  compareCohortId: string | null;
  activeScopeCohortId: string | null;
  activeExpressionId: string | null;
}

export type StudioImportCandidate = Omit<
  BackendStudioImportCandidate,
  'set' | 'materialization'
> & {
  set: SpatialFieldSetSummary;
  materialization?: Partial<StudioMaterializationStatus> | null;
};

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
  discoveryMaxDepth: string;
  discoveryMaxFiles: string;
  discoverySampleHeaders: boolean;
  discoveryRequiredRoles: string[];
  discoveryRolePatterns: StudioDiscoveryRolePattern[];
  discoveryCustomRole: string;
  tsvWizard: TsvWizardState;
}

export type StudioComparePaneId = 'current' | 'cohort-mean' | 'residual' | 'zscore' | string;

export type StudioComparePaneBinding = Omit<BackendStudioComparePaneBinding, 'materializedAtMs'> & {
  materializedAtMs: number | null;
};

export type StudioComparePaneSpec = Omit<BackendStudioComparePaneSpec, 'id' | 'binding'> & {
  id: StudioComparePaneId;
  binding: StudioComparePaneBinding | null;
};

export type StudioMaterializationJobKind = 'compare-panes';
export type StudioMaterializationJobState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale';

export interface StudioMaterializationJobDescriptor {
  id: string;
  kind: StudioMaterializationJobKind;
  label: string;
  requestKey: string;
  setId: string | null;
  memberId: string | null;
  cohortId: string | null;
  expressionId: string | null;
  paneIds: string[];
  forceRematerialize: boolean;
}

export interface StudioMaterializationJobSummary extends StudioMaterializationJobDescriptor {
  status: StudioMaterializationJobState;
  progress: number;
  startedAtMs: number;
  finishedAtMs: number | null;
  errorMessage: string | null;
  cacheKeys: string[];
}

export interface StudioMaterializationCacheSummary {
  key: string;
  paneId: StudioComparePaneId;
  status: StudioCompareCacheStatus;
  message: string | null;
  sourcePath: string | null;
  materializedAtMs: number | null;
  provenancePath: string | null;
  jobId: string;
  updatedAtMs: number;
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
    | 'activeLens'
    | 'activeMemberId'
    | 'compareCohortId'
    | 'activeScopeCohortId'
    | 'activeExpressionId'
  >;
  provenanceJson: string;
  savedAtMs: number;
}
