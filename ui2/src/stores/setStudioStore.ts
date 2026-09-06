import type { PopulationState } from '@/types/population';
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
  StudioLensType,
  StudioMaterializationStatus,
  StudioMaterializationCacheSummary,
  StudioMaterializationJobSummary,
  StudioSavedRecipeSummary,
  StudioSelection,
  StudioDesignFilter,
} from '@/types/studio';
import {
  createImportSlice,
  createInitialImportDialogState,
  createInitialImportRequestState,
} from './setStudio/importSlice';
import type { ImportRequestState, SetStudioImportSlice } from './setStudio/importSlice';
import { createMaterializationSlice } from './setStudio/materializationSlice';
import type { SetStudioMaterializationSlice } from './setStudio/materializationSlice';
import {
  createPopulationSlice,
  initialPopulationState,
  type PopulationSlice,
} from './setStudio/populationSlice';

interface StudioBootstrapPayload {
  population?: Partial<Omit<PopulationState, 'sessionRevision'>>;
  set: SpatialFieldSetSummary;
  features: StudioFeatureSummary[];
  cohorts: StudioCohortSummary[];
  expressions: StudioFieldExpressionSummary[];
  selection?: Partial<StudioSelection>;
  materialization?: Partial<StudioMaterializationStatus>;
}

interface SetStudioStoreState
  extends SetStudioImportSlice,
    SetStudioMaterializationSlice,
    PopulationSlice {
  sets: Record<string, SpatialFieldSetSummary>;
  features: Record<string, StudioFeatureSummary>;
  cohorts: Record<string, StudioCohortSummary>;
  expressions: Record<string, StudioFieldExpressionSummary>;
  setExpressionIds: Record<string, string[]>;
  importCandidates: Record<string, StudioImportCandidate>;
  importDialog: StudioImportDialogState;
  importRequestState: ImportRequestState;
  selection: StudioSelection;
  materialization: StudioMaterializationStatus;
  comparePaneSpecs: StudioComparePaneSpec[];
  comparePaneLoading: boolean;
  compareRefreshingPaneIds: string[];
  activeMaterializationJobId: string | null;
  materializationJobs: Record<string, StudioMaterializationJobSummary>;
  materializationJobIds: string[];
  materializationCache: Record<string, StudioMaterializationCacheSummary>;
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
  setActiveMember: (memberId: string | null) => void;
  setCompareCohort: (cohortId: string | null) => void;
  setActiveScopeCohort: (cohortId: string | null) => void;
  drillToCohort: (cohortId: string | null) => void;
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
      | 'activeLens'
      | 'activeMemberId'
      | 'compareCohortId'
      | 'activeScopeCohortId'
      | 'activeExpressionId'
    >,
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
  importContract: {
    readiness: 'compare_ready',
    provenanceKind: 'demo',
    provenanceLabel: 'Seeded demo import',
    canImport: true,
    capabilities: ['import', 'deck', 'compare', 'materialize_compare'],
    reason: 'Seeded demo set is bundled as compare-ready sample data.',
  },
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

const DEMO_FEATURES: StudioFeatureSummary[] = [
  {
    id: 'statmap',
    label: 'Stat Map',
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
  cohortId?: string | null,
): string | null {
  const availableExpressions = expressionIds.map((id) => expressions[id]).filter(Boolean);

  const exactMatch = availableExpressions.find(
    (expression) =>
      expression.kind === kind && (cohortId === undefined || expression.cohortId === cohortId),
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
  cohort: StudioCohortSummary,
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
  importCandidates: {},
  importDialog: createInitialImportDialogState(),
  importRequestState: createInitialImportRequestState(),
  selection: DEFAULT_SELECTION,
  population: initialPopulationState(),
  materialization: DEFAULT_MATERIALIZATION,
  comparePaneSpecs: [],
  comparePaneLoading: false,
  compareRefreshingPaneIds: [],
  activeMaterializationJobId: null,
  materializationJobs: {},
  materializationJobIds: [],
  materializationCache: {},
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
      payload.selection?.activeFeatureId ??
      payload.set.primaryFeatureId ??
      payload.features[0]?.id ??
      null;

    set({
      population: {
        ...initialPopulationState(get().population.sessionRevision + 1),
        ...structuredClone(payload.population ?? {}),
        sessionRevision: get().population.sessionRevision + 1,
      },
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
          payload.selection?.activeMemberId !== undefined
            ? payload.selection.activeMemberId
            : (payload.set.memberIds[2] ?? payload.set.memberIds[0] ?? null),
        compareCohortId:
          payload.selection?.compareCohortId ?? payload.set.savedCohortIds[0] ?? null,
        activeScopeCohortId: payload.selection?.activeScopeCohortId ?? null,
        activeExpressionId:
          payload.selection?.activeExpressionId ?? payload.expressions[0]?.id ?? null,
      },
      materialization: {
        ...DEFAULT_MATERIALIZATION,
        ...payload.materialization,
      },
      comparePaneSpecs: [],
      comparePaneLoading: false,
      compareRefreshingPaneIds: [],
      activeMaterializationJobId: null,
      materializationJobs: {},
      materializationJobIds: [],
      materializationCache: {},
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
      ? (setExpressionIds[selection.activeSetId] ?? [])
      : [];
    const nextExpressionId =
      lens === 'compare'
        ? getPreferredExpressionId(
            expressionIds,
            expressions,
            'comparison',
            selection.compareCohortId,
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
    const { selection, sets } = get();
    const activeSet = selection.activeSetId ? sets[selection.activeSetId] : null;
    if (memberId !== null && !activeSet?.memberIds.includes(memberId)) return;
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
    const { selection, expressions, setExpressionIds, cohorts, population } = get();
    if (selection.compareCohortId === cohortId && population.referenceMode === 'cohort') {
      return;
    }

    const expressionIds = selection.activeSetId
      ? (setExpressionIds[selection.activeSetId] ?? [])
      : [];
    const exactComparisonExpressionId = cohortId
      ? (expressionIds
          .map((expressionId) => expressions[expressionId])
          .filter(Boolean)
          .find(
            (expression) => expression.kind === 'comparison' && expression.cohortId === cohortId,
          )?.id ?? null)
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
      population: { ...population, referenceMode: 'cohort' },
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
    const cohort = cohortId ? (cohorts[cohortId] ?? null) : null;
    const scopedMemberIds =
      cohort?.memberIds.filter((memberId) => activeSet?.memberIds.includes(memberId)) ?? [];
    const nextActiveMemberId =
      scopedMemberIds[0] ??
      (selection.activeMemberId && activeSet?.memberIds.includes(selection.activeMemberId)
        ? selection.activeMemberId
        : (activeSet?.memberIds[0] ?? null));
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

  ...createImportSlice(set, get),
  ...createMaterializationSlice(set, get),
  ...createPopulationSlice(set, get),

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
        (entry) => entry.column === filter.column && entry.value === filter.value,
      );
      return {
        activeDesignFilters: exists
          ? state.activeDesignFilters.filter(
              (entry) => !(entry.column === filter.column && entry.value === filter.value),
            )
          : [...state.activeDesignFilters, filter],
      };
    });
  },

  removeDesignFilter: (filter) => {
    set((state) => ({
      activeDesignFilters: state.activeDesignFilters.filter(
        (entry) => !(entry.column === filter.column && entry.value === filter.value),
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
        [activeSet.id]: [...(setExpressionIds[activeSet.id] ?? []), nextExpression.id],
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
    const dynamicExpressionId = selection.activeSetId
      ? dynamicCompareExpressionId(selection.activeSetId, cohortId)
      : null;
    if (dynamicExpressionId && nextExpressions[dynamicExpressionId]) {
      nextExpressions[dynamicExpressionId] = dynamicCompareExpression(
        selection.activeSetId!,
        updatedCohort,
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
      (expressionId) => expressionId !== dynamicExpressionId,
    );
    const nextCompareCohortId =
      selection.compareCohortId === cohortId ? null : selection.compareCohortId;
    const nextScopeCohortId =
      selection.activeScopeCohortId === cohortId ? null : selection.activeScopeCohortId;
    const nextActiveExpressionId =
      selection.activeExpressionId === dynamicExpressionId
        ? getPreferredExpressionId(
            nextExpressionIds,
            nextExpressions,
            selection.activeLens === 'compare' ? 'comparison' : 'member',
            nextCompareCohortId,
          )
        : selection.activeExpressionId;

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
      ? [
          stampedArtifact,
          ...get().artifactHistory.filter((entry) => entry.id !== stampedArtifact.id),
        ].slice(0, 8)
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
      savedRecipes: [
        savedRecipe,
        ...get().savedRecipes.filter((entry) => entry.title !== savedRecipe.title),
      ].slice(0, 12),
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
          : recipe,
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
