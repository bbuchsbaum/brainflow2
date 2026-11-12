import type { PopulationMemberSource } from './population';
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
  StudioFolderOntologyCandidate,
  StudioFolderOntologySummary,
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
  StudioFolderOntologyCandidate,
  StudioFolderOntologySummary,
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

export type StudioLensType = 'population' | 'deck' | 'compare' | 'pivot-matrix' | 'atlas';
export type StudioImportSource = 'backend' | 'fallback' | null;
export type StudioSessionSourceKind = 'demo' | 'imported';
export type StudioArtifactKind = 'member' | 'compare-pane';

export interface StudioDesignFilter {
  column: string;
  value: string;
}

export type SpatialFieldSetSummary = BackendSpatialFieldSetSummary & {
  /** Native verified saved inputs; deliberately unavailable to legacy compare materialization. */
  savedPopulation?: {
    featureId: string;
    recordPath: string;
    recordSha256: string;
    members: PopulationMemberSource[];
    notices: string[];
  };
  sourceKind?: StudioSessionSourceKind;
  importContract?: StudioImportContract | null;
  /** How a folder-opened set was found, kept so its image grids can be checked later. */
  discoveryRequest?: StudioSetDiscoveryRequest;
  /**
   * Where a folder-opened set lives, as the user knows it: the connection
   * (a remote mount's label) and the folder's path there. The set's `name`
   * is the folder's own name; this is its secondary text and tooltip.
   */
  sourceLocation?: { label?: string; path: string };
};

export interface StudioSetDiscoveryRequest {
  root: string;
  filePattern: string;
  includePatterns: string[];
  excludePatterns: string[];
  rolePatterns: StudioDiscoveryRolePattern[];
  requiredRoles: string[];
  maxDepth: number | null;
  maxFiles: number;
}

/** An in-place check of the active set's image grids (not part of the import dialog). */
export interface StudioGridCheckState {
  status: 'idle' | 'checking' | 'failed';
  message: string | null;
  /**
   * A failed check that was stopped part-way and whose headers the backend
   * kept: asking again continues it (a remote mount whose check timed out).
   */
  resumable?: boolean;
  /**
   * The check failed because the remote connection is down: a path on that
   * mount (the set's folder), so the notice can offer Reconnect and the check
   * runs again when the mount is back.
   */
  connectionLostPath?: string;
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
  folderReview?: boolean;
  folderSource?: { root: string; displayPath: string; label?: string };
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
  ontologyPreview: StudioFolderOntologySummary | null;
  isOntologyLoading: boolean;
  ontologyError: string | null;
  tsvWizard: TsvWizardState;
}

export type StudioComparePaneId = 'current' | 'cohort-mean' | 'residual' | 'zscore' | string;

export type StudioComparePaneBinding = Omit<BackendStudioComparePaneBinding, 'materializedAtMs'> & {
  materializedAtMs: number | null;
};

/**
 * What a Compare pane is still waiting for. Nothing has failed: an input is
 * not available yet (`grid-check`, `no-member`, `no-group`, `no-comparison`,
 * `no-mean`) or the set cannot provide it (`different-grids`, `not-confirmed`).
 */
export type StudioComparePaneNotReadyKind =
  | 'grid-check'
  | 'different-grids'
  | 'not-confirmed'
  | 'no-group'
  | 'no-member'
  | 'no-comparison'
  | 'no-mean'
  /** A remote set's images are not on this computer yet. */
  | 'fetch';

export type StudioComparePaneSpec = Omit<BackendStudioComparePaneSpec, 'id' | 'binding'> & {
  id: StudioComparePaneId;
  binding: StudioComparePaneBinding | null;
  /**
   * Set when the pane has nothing to show because an input is missing, as
   * opposed to a computation that failed (`status: 'blocked'` without it).
   */
  notReady?: { kind: StudioComparePaneNotReadyKind; message: string } | null;
};

/** One line saying how a folder was opened as a set without the review. */
export interface StudioOpenNotice {
  setId: string;
  message: string;
  /** The folder, so "Review…" can bring its review up. */
  root: string;
  /**
   * The notice asks the reader to do something (review needed, an error):
   * it then stays until dismissed. Without it the notice is information and
   * goes away by itself.
   */
  requiresAction?: boolean;
}

/** Why a folder asked to be opened in one step stopped at its review. */
export interface StudioFolderReviewReason {
  root: string;
  /** A sentence: "More than one organisation fits this folder." */
  reason: string;
}

export type StudioMaterializationJobKind = 'compare-panes';
export type StudioMaterializationJobState =
  'running' | 'completed' | 'failed' | 'cancelled' | 'stale';

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
