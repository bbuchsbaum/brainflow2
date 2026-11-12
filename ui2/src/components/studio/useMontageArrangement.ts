import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { usePopulationViewStore } from '@/stores/populationViewStore';
import { buildPopulationSource } from '@/services/studio/PopulationProbeController';
import {
  populationRelationshipService,
  relationshipFittedIds,
  type PopulationRelationshipService,
} from '@/services/studio/PopulationRelationshipService';
import {
  meanDistanceKey,
  StudioMeanDistanceService,
} from '@/services/studio/StudioMeanDistanceService';
import {
  isOutlierGroup,
  isUnassignedGroup,
  partitionPopulation,
} from '@/services/studio/populationGroups';
import { studioMetadata } from '@/services/studio/studioMetadata';
import type { PopulationOrder } from '@/types/population';
import {
  MONTAGE_GROUP_NONE,
  MONTAGE_GROUP_RESTORE,
  MONTAGE_GROUP_SIMILARITY,
  MONTAGE_GROUP_TWO_FACTORS,
  MONTAGE_SIMILARITY_GROUPS,
  groupableColumnsOf,
  montageGroupOptions,
  montageGroupValue,
  montageSortOptions,
  DEFAULT_SIMILARITY_MEASURE,
  correlationRefusal,
  similarityDescription,
  similarityMeasureOf,
  similarityValue,
  type SimilarityMeasure,
  orderByColumn,
  orderByDistance,
  sortColumn,
  type MontageSort,
} from './montageModel';

type Studio = ReturnType<typeof useSetStudioStore.getState>;
const fileName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
/** An order or grouping asked for before what it needs has been computed. */
type Intent = 'sort-similarity' | 'group-similarity' | 'sort-crosshair' | 'sort-witnesses';
/** `store`: the order lives in the shared presentation (similarity, value at crosshair, source). */
type LocalSort = 'store' | 'distance' | `column:${string}`;

export interface MontageArrangementInput {
  /** The montage is showing; nothing is computed for a hidden one. */
  active: boolean;
  /**
   * The Summary is showing: Group works there too (a grouping shows the
   * groups' means). Sort and its computations stay the montage's.
   */
  summary?: boolean;
  studio: Studio;
  workspaceId: string;
  contextIds: readonly string[];
  /** The order in force outside the lens (the shared order, else the source order). */
  sharedOrder: readonly string[];
  /** The shared presentation's order, when it applies to this feature and context. */
  savedOrder: PopulationOrder | null;
  /** A value-at-crosshair order held by the values table. */
  hasResponseOrder: boolean;
  /** That order shows twelve subjects across the range (witnesses). */
  responseWitnesses?: boolean;
  /** The values table is sampling, so a value at the probe can be read. */
  responseAvailable: boolean;
  /**
   * Values for the probe in force (the pin, else the pointer while the Values
   * tab follows it) are ready to order by.
   */
  responseReady: boolean;
  responseError: string | null;
  applyResponseOrder: (mode: 'all' | 'witnesses') => void;
  clearOrder: () => void;
  relationship?: PopulationRelationshipService;
  /** Computes distances from the mean; the montage's own by default. */
  distanceService?: StudioMeanDistanceService;
  /** How long a value-at-crosshair order waits for its values before giving up. */
  responseTimeoutMs?: number;
}

export const MONTAGE_RESPONSE_TIMEOUT_MS = 8000;

/**
 * The montage's Sort and Group choices, wired to what already computes them:
 * the similarity fit (order and groups), the values table (value at the
 * crosshair), distance to the group mean, and the set's design columns. A
 * choice that needs a computation asks for it and applies itself when the
 * result arrives; the request is the owning service's and stays cancellable.
 */
export function useMontageArrangement({
  active: montageActive,
  summary = false,
  studio,
  workspaceId,
  contextIds,
  sharedOrder,
  savedOrder,
  hasResponseOrder,
  responseWitnesses = false,
  responseAvailable,
  responseReady,
  responseError,
  applyResponseOrder,
  clearOrder,
  relationship = populationRelationshipService,
  distanceService,
  responseTimeoutMs = MONTAGE_RESPONSE_TIMEOUT_MS,
}: MontageArrangementInput) {
  // Group works in either view; Sort, distances and values are the montage's.
  const active = montageActive || summary;
  // The Values tab follows the pointer: an unpinned probe moves with it (a pin takes precedence).
  const followHover = usePopulationViewStore((state) => state.followHover);
  const [local, setLocal] = useState<LocalSort>('store');
  const [reversed, setReversed] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The similarity choice that failed or was cancelled, so the strip that
  // asked for it can say so (and stays open to say it).
  const [similarityIssue, setSimilarityIssue] = useState<string | null>(null);
  // The group count was chosen with the stepper: the fit's suggestion no longer applies.
  const countChosen = useRef(false);
  // The distance a similarity order or grouping is asked for: correlation by
  // default, and one choice shared with the Spatial relationships panel.
  const measure: SimilarityMeasure =
    studio.population.similarityMeasure ?? DEFAULT_SIMILARITY_MEASURE;
  const setMeasure = (next: SimilarityMeasure) =>
    useSetStudioStore.getState().setPopulationSimilarityMeasure(next);
  // Groups a similarity grouping is cut into, until a grouping says otherwise.
  const [wantedGroups, setWantedGroups] = useState(MONTAGE_SIMILARITY_GROUPS);
  // What failed under correlation, so the same choice can be offered by amplitude.
  const [refused, setRefused] = useState<{ kind: 'sort' | 'group'; message: string } | null>(
    null,
  );
  const fits = useSyncExternalStore(relationship.subscribe, relationship.getSnapshot);
  const fitMeasures = useRef(new Map<string, SimilarityMeasure>());
  /** What each fit seen this session was computed on, by fit. */
  const fitRequests = useRef(
    new Map<
      string,
      {
        measure: SimilarityMeasure;
        maskName: string | null;
        region: boolean;
        sharedVoxels: number | null;
      }
    >(),
  );
  const [distances] = useState(() => distanceService ?? new StudioMeanDistanceService());
  const distance = useSyncExternalStore(distances.subscribe, distances.getSnapshot);
  useEffect(() => () => distances.clear(), [distances]);

  const setId = studio.selection.activeSetId;
  const featureId = studio.selection.activeFeatureId;
  const set = setId ? studio.sets[setId] : null;
  const partition = studio.population.partition;
  const metadata = useMemo(() => (set ? studioMetadata(set, contextIds) : null), [set, contextIds]);
  const columns = useMemo(() => (metadata && !metadata.issue ? metadata.columns : []), [metadata]);
  // Columns that make groups over the whole set (not only the subjects in
  // view, so filtering never changes the menu): not one value for all, not
  // one per subject (an ID column such as "member"). The subjects in view
  // decide only when the set's own metadata cannot be read.
  const groupableColumns = useMemo(() => {
    if (!set || !metadata || metadata.issue) return new Set<string>();
    const whole = studioMetadata(set);
    return whole.issue
      ? groupableColumnsOf(columns, contextIds, metadata.rows)
      : groupableColumnsOf(columns, set.memberIds, whole.rows);
  }, [set, metadata, columns, contextIds]);

  // Another set, feature or session starts from the shared order again.
  const scope = `${studio.population.sessionRevision}:${setId}:${featureId}`;
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current === scope) return;
    lastScope.current = scope;
    setLocal('store');
    setReversed(false);
    setIntent(null);
    setError(null);
    setSimilarityIssue(null);
    setRefused(null);
    countChosen.current = false;
  }, [scope]);

  // An order made elsewhere (the relationship panel, the values table) is the
  // one in force: it replaces a lens-only order.
  const storeOrder = savedOrder
    ? `${savedOrder.rule}:${savedOrder.fitId ?? ''}:${savedOrder.label}`
    : hasResponseOrder
      ? 'response'
      : 'none';
  const lastStoreOrder = useRef(storeOrder);
  useEffect(() => {
    if (lastStoreOrder.current === storeOrder) return;
    lastStoreOrder.current = storeOrder;
    if (storeOrder !== 'none') setLocal('store');
  }, [storeOrder]);

  // A grouping made in the montage keeps it; in the Summary the store shows
  // the groups' means (or the Summary again when the grouping is cleared).
  const keepMontage = () => {
    if (!montageActive) return;
    const state = useSetStudioStore.getState();
    state.setPopulationPresentation({
      ...state.population.presentation,
      arrangement: 'montage',
      contributorsGroupId: undefined,
    });
  };
  // Where similarity is compared (Analysis setup): the support, or the pinned region.
  const regional =
    studio.population.similarityRegion === 'probe' &&
    (studio.population.pinnedProbe?.radiusMm ?? 0) > 0;
  /** The session's fit, when it is current and was made with this distance and region. */
  const fitFor = (wanted: SimilarityMeasure, kind: 'sort' | 'group' = 'sort') => {
    const fit = relationship.usableFit();
    return fit &&
      fit.request.distance === wanted &&
      !!fit.request.region === regional &&
      // A grouping asks for a grouping fit; an older fit still orders.
      (kind === 'sort' || !!fit.request.grouping)
      ? fit
      : null;
  };
  const orderBySimilarity = () => {
    const fit = relationship.usableFit();
    if (!fit) return;
    if (!fit.geometry.orderable) {
      setError('These maps have no single direction to order along.');
      return;
    }
    relationship.order();
    if (useSetStudioStore.getState().population.presentation.order?.fitId !== fit.fitId)
      setError('The similarity order does not match the subjects shown.');
  };
  const groupBySimilarity = () => {
    const fit = relationship.usableFit();
    if (!fit) return;
    // The fit's suggested count until the stepper says otherwise.
    const suggested = fit.geometry.grouping?.bestGroups ?? null;
    const wanted =
      !countChosen.current && suggested !== null && suggested >= 2 ? suggested : latestWanted.current;
    try {
      const cuts = fit.geometry.grouping?.cuts.map((cut) => cut.groups) ?? [];
      const most = cuts.length ? Math.max(...cuts) : relationshipFittedIds(fit).length;
      relationship.group(Math.max(2, Math.min(wanted, most)));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return;
    }
    if (useSetStudioStore.getState().population.partition?.fitId !== fit.fitId) {
      setError('The similarity groups do not match the subjects shown.');
      return;
    }
    keepMontage();
  };

  const latestWanted = useRef(wantedGroups);
  latestWanted.current = wantedGroups;
  // A similarity order or grouping waits for the fit it asked for.
  const latest = useRef({ orderBySimilarity, groupBySimilarity, applyResponseOrder });
  latest.current = { orderBySimilarity, groupBySimilarity, applyResponseOrder };
  // Leaving the montage withdraws what it was waiting for: a result that
  // arrives later must not regroup, reorder or bring the montage back.
  useEffect(() => {
    if (!active) setIntent(null);
  }, [active]);
  useEffect(() => {
    if (!active || !intent || intent === 'sort-crosshair' || intent === 'sort-witnesses' || fits.pending)
      return;
    setIntent(null);
    const fit = relationship.usableFit();
    if (fit && fit.request.distance === measure) {
      if (intent === 'sort-similarity') latest.current.orderBySimilarity();
      else latest.current.groupBySimilarity();
    } else if (fits.error) {
      // Correlation is undefined for a map that is constant on the shared
      // voxels, where amplitude is not: say so plainly and offer amplitude.
      const refusal = measure === 'pattern-shape' ? correlationRefusal(fits.error) : null;
      const message = refusal ?? `Similarity could not be computed: ${fits.error}`;
      setError(message);
      setSimilarityIssue(message);
      setRefused(
        refusal ? { kind: intent === 'sort-similarity' ? 'sort' : 'group', message: refusal } : null,
      );
    } else {
      setError('The similarity calculation was cancelled.');
      setSimilarityIssue('The similarity calculation was cancelled.');
    }
  }, [active, intent, fits, relationship, measure]);
  useEffect(() => {
    if (!active || (intent !== 'sort-crosshair' && intent !== 'sort-witnesses')) return;
    if (responseReady) {
      setIntent(null);
      latest.current.applyResponseOrder(intent === 'sort-witnesses' ? 'witnesses' : 'all');
      return;
    }
    if (responseError) {
      setIntent(null);
      setError(responseError);
      return;
    }
    // The values come from the values table; without it nothing will arrive.
    const timer = setTimeout(() => {
      setIntent(null);
      setError('No values arrived for the pinned point. Pin it again in the Values tab.');
    }, responseTimeoutMs);
    return () => clearTimeout(timer);
  }, [active, intent, responseReady, responseError, responseTimeoutMs]);

  // Distance from the mean, computed natively for the subjects in context.
  const wantsDistance = active && local === 'distance';
  const distanceSource = useMemo(
    () => (wantsDistance ? buildPopulationSource(studio, workspaceId) : null),
    [wantsDistance, studio, workspaceId],
  );
  const distanceKey = distanceSource?.source
    ? meanDistanceKey(
        setId,
        featureId,
        distanceSource.source.mask?.sourcePath,
        distanceSource.source.members.map((member) => member.memberId),
      )
    : null;
  const distanceIssue = distanceSource && !distanceSource.source ? distanceSource.issue : null;
  const sourceRef = useRef(distanceSource);
  sourceRef.current = distanceSource;
  useEffect(() => {
    const source = sourceRef.current?.source;
    if (!distanceKey || !source) return;
    distances.request({
      listKey: distanceKey,
      listSize: source.members.length,
      key: distanceKey,
      members: source.members,
      mask: source.mask ?? null,
    });
  }, [distances, distanceKey]);
  // Another sort (or leaving the montage) abandons a calculation in flight.
  useEffect(() => {
    if (!wantsDistance) distances.clear();
  }, [distances, wantsDistance]);
  const distanceCurrent = distanceKey !== null && distance.key === distanceKey;
  const distanceReady = distanceCurrent && distance.status === 'ready';
  const distanceFailure =
    local !== 'distance'
      ? null
      : (distanceIssue ??
        (distanceCurrent && distance.status === 'failed'
          ? (distance.error ?? 'The distances could not be computed.')
          : null));

  const sort: MontageSort =
    local !== 'store'
      ? local
      : intent === 'sort-similarity'
        ? 'similarity'
        : intent === 'sort-crosshair'
          ? 'crosshair'
          : intent === 'sort-witnesses'
            ? 'witnesses'
            : savedOrder
              ? savedOrder.rule === 'similarity'
                ? 'similarity'
                : responseWitnesses
                  ? 'witnesses'
                  : 'crosshair'
              : hasResponseOrder
                ? responseWitnesses
                  ? 'witnesses'
                  : 'crosshair'
                : 'source';

  // The distance behind the order and the grouping on screen: the fit that
  // made them says, else the order's own label, else what was last asked for.
  const record = studio.population.relationship;
  // Each fit seen this session keeps its distance, so an order or grouping
  // still names its own after a fit by the other distance replaces it.
  if (fits.fit) {
    fitMeasures.current.set(fits.fit.fitId, fits.fit.request.distance);
    fitRequests.current.set(fits.fit.fitId, {
      measure: fits.fit.request.distance,
      maskName: fits.fit.request.mask ? fileName(fits.fit.request.mask.sourcePath) : null,
      region: !!fits.fit.request.region,
      sharedVoxels: fits.fit.commonVoxels ?? null,
    });
  }
  const sortMeasure: SimilarityMeasure =
    intent === 'sort-similarity' || savedOrder?.rule !== 'similarity'
      ? measure
      : savedOrder.fitId && fitMeasures.current.has(savedOrder.fitId)
        ? fitMeasures.current.get(savedOrder.fitId)!
        : record && record.fitId === savedOrder.fitId
          ? record.distance
          : savedOrder.label.includes('pattern-shape')
          ? 'pattern-shape'
          : savedOrder.label.includes('effect')
            ? 'effect'
            : measure;
  const similarityGrouping = partition?.origin === 'map-derived' ? partition : null;
  const groupMeasure: SimilarityMeasure =
    intent !== 'group-similarity' && similarityGrouping
      ? (fitMeasures.current.get(similarityGrouping.fitId ?? '') ??
        (record && record.fitId === similarityGrouping.fitId ? record.distance : measure))
      : measure;
  const requestSimilarity = (kind: 'sort' | 'group', wanted: SimilarityMeasure) => {
    setMeasure(wanted);
    setRefused(null);
    setSimilarityIssue(null);
    // One fit serves both the order and the groups for as long as its inputs
    // and its distance stand; only another distance computes again.
    if (fitFor(wanted, kind)) {
      if (kind === 'sort') orderBySimilarity();
      else groupBySimilarity();
      return;
    }
    setIntent(kind === 'sort' ? 'sort-similarity' : 'group-similarity');
    // A grouping fit (its linkage and silhouette-scored cuts) serves the
    // order too. A fit by this distance made earlier this session is
    // reinstalled, not recomputed.
    void relationship.fit(wanted, regional, { reuse: true, grouping: true });
  };

  const chooseSort = (value: string) => {
    setError(null);
    setRefused(null);
    setSimilarityIssue(null);
    setIntent(null);
    if (value === 'distance' || sortColumn(value as MontageSort)) {
      setLocal(value as LocalSort);
      return;
    }
    setLocal('store');
    if (value === 'source') clearOrder();
    else if (similarityMeasureOf(value)) requestSimilarity('sort', similarityMeasureOf(value)!);
    else if (value === 'crosshair' || value === 'witnesses') {
      const mode = value === 'witnesses' ? 'witnesses' : 'all';
      // The value is read at the pinned point, or at the pointer while the
      // Values tab follows it; nothing is pinned silently.
      const probes = useSetStudioStore.getState().population;
      if (
        !probes.pinnedProbe &&
        !(usePopulationViewStore.getState().followHover && probes.hoverProbe)
      ) {
        setError('Pin a point first: in the Values tab, or by clicking a map in Summary.');
        return;
      }
      if (responseReady) applyResponseOrder(mode);
      else if (responseAvailable) setIntent(value === 'witnesses' ? 'sort-witnesses' : 'sort-crosshair');
    }
  };

  const chooseGroup = (value: string) => {
    setError(null);
    setRefused(null);
    setSimilarityIssue(null);
    if (intent === 'group-similarity') setIntent(null);
    const state = useSetStudioStore.getState();
    if (value === MONTAGE_GROUP_RESTORE) {
      // The grouping before this one (the store's own history).
      state.undoPopulationPartition();
      keepMontage();
    } else if (value.startsWith(MONTAGE_GROUP_TWO_FACTORS) && set) {
      const [first, second] = JSON.parse(value.slice(MONTAGE_GROUP_TWO_FACTORS.length)) as [
        string,
        string,
      ];
      try {
        const result = state.setPopulationPartition(
          partitionPopulation(set, contextIds, first, second),
        );
        if (!result.ok) setError(result.reason);
        else keepMontage();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } else if (value === MONTAGE_GROUP_NONE) {
      state.setPopulationPartition(null);
      keepMontage();
    } else if (similarityMeasureOf(value)) {
      requestSimilarity('group', similarityMeasureOf(value)!);
    } else if (value.startsWith('factor:') && set) {
      try {
        const result = state.setPopulationPartition(
          partitionPopulation(set, contextIds, value.slice('factor:'.length)),
        );
        if (!result.ok) setError(result.reason);
        else keepMontage();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    }
  };

  // The montage's order: the shared order, or the lens's own over the context.
  const column = sortColumn(sort);
  const rows = metadata && !metadata.issue ? metadata.rows : null;
  const measured = local === 'distance' && distanceReady ? distance.byMember : null;
  const order = useMemo(() => {
    const ordered = measured
      ? orderByDistance(contextIds, measured)
      : column && rows
        ? orderByColumn(contextIds, rows, column)
        : sharedOrder;
    return reversed ? [...ordered].reverse() : ordered;
  }, [measured, column, rows, contextIds, sharedOrder, reversed]);

  /** Stop what the montage is waiting for; the order and groups stay as they are. */
  const cancelPending = () => {
    if (intent === 'sort-similarity' || intent === 'group-similarity') {
      // Withdrawn first, so the fit ending is not reported as a failure.
      setIntent(null);
      relationship.cancel();
    } else if (intent === 'sort-crosshair' || intent === 'sort-witnesses') setIntent(null);
    else if (local === 'distance') setLocal('store');
  };

  // The number of clusters the similarity tree is cut into: the grouping's
  // own when there is one (its groups, and each outlier alone).
  const groupCount = similarityGrouping
    ? similarityGrouping.groups
        .filter((group) => !isUnassignedGroup(similarityGrouping, group))
        .reduce(
          (n, group) =>
            n + (isOutlierGroup(similarityGrouping, group) ? group.memberIds.length : 1),
          0,
        )
    : wantedGroups;
  // The range, the suggestion and the cuts come from the fit that made the
  // grouping on screen (one fit per view), not from whichever fit is current:
  // an order by the other measure replaces the current fit but not the groups.
  const groupingFit = similarityGrouping
    ? relationship.fitById(similarityGrouping.fitId ?? null)
    : fits.fit;
  const fittedCount = groupingFit ? relationshipFittedIds(groupingFit).length : contextIds.length;
  // A grouping fit scores cuts of 2 up to min(8, n − 1) clusters; outliers are
  // only known within them, so the count stays inside that range.
  const scoredCuts = groupingFit?.geometry.grouping?.cuts.map((cut) => cut.groups) ?? null;
  const groupCountMax =
    scoredCuts && scoredCuts.length ? Math.max(...scoredCuts) : Math.max(2, fittedCount);
  // The count is the fit's own suggestion (its best-scoring cut) until the
  // stepper is used: the toolbar then says "auto".
  const suggestedGroups = groupingFit?.geometry.grouping?.bestGroups ?? null;
  const groupCountAuto =
    !countChosen.current && suggestedGroups !== null && suggestedGroups === groupCount;
  // What each cut yields for the user: groups, and outliers apart.
  const groupCountCuts =
    groupingFit?.geometry.grouping?.cuts.map((cut) => ({
      count: cut.groups,
      groups: cut.groups - cut.singletons.length,
      outliers: cut.singletons.length,
    })) ?? null;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const applyGroupCount = (count: number, chosen: boolean) => {
    if (!Number.isInteger(count) || count < 2 || count > groupCountMax) return;
    setWantedGroups(count);
    latestWanted.current = count;
    countChosen.current = chosen;
    // "auto" is read from the ref: say it even when the count is unchanged.
    rerender();
    if (!similarityGrouping || count === groupCount) return;
    setError(null);
    // The same fit, cut into another number of groups: nothing is computed again.
    if (fitFor(groupMeasure, 'group')) groupBySimilarity();
    else requestSimilarity('group', groupMeasure);
  };
  const chooseGroupCount = (count: number) => applyGroupCount(count, true);
  /** Back to the fit's suggested count: the stepper's choice no longer applies. */
  const chooseAutoGroupCount = () => {
    if (suggestedGroups === null) return;
    applyGroupCount(Math.max(2, Math.min(suggestedGroups, groupCountMax)), false);
  };
  // What the similarity on screen was computed from, when its fit is the session's.
  // A fit no longer in force (replaced by another, or restored with a saved
  // order) is described from what was seen of it this session, else from
  // what the order or grouping itself keeps: its mask, never "whole volume"
  // for a masked one.
  const describe = (
    fitId: string | undefined,
    wanted: SimilarityMeasure,
    keptMask: { sourcePath: string } | null | undefined,
  ) => {
    const seen = fitId ? fitRequests.current.get(fitId) : undefined;
    return similarityDescription({
      measure: seen?.measure ?? wanted,
      maskName: seen ? seen.maskName : keptMask ? fileName(keptMask.sourcePath) : null,
      region: seen?.region ?? false,
      sharedVoxels: seen?.sharedVoxels ?? null,
    });
  };

  const sortBusy =
    intent === 'sort-similarity' ||
    intent === 'sort-crosshair' ||
    intent === 'sort-witnesses' ||
    (wantsDistance && !distanceReady && !distanceFailure);
  const groupBusy = intent === 'group-similarity';
  const groupOptions = montageGroupOptions(columns, partition, {
    canRestore: studio.population.partitionPast.length > 0,
    groupable: (column) => groupableColumns.has(column),
  });
  return {
    sort,
    reversed,
    toggleReversed: () => setReversed((current) => !current),
    /** The Sort select's value: a similarity order names its distance. */
    sortValue: sort === 'similarity' ? similarityValue(sortMeasure) : sort,
    sortOptions: montageSortOptions({
      columns,
      // A pinned point, or the pointer while the Values tab follows it.
      crosshairAvailable:
        responseAvailable &&
        (!!studio.population.pinnedProbe || (followHover && !!studio.population.hoverProbe)),
    }),
    sortBusy,
    chooseSort,
    group:
      groupBusy || montageGroupValue(partition, columns) === MONTAGE_GROUP_SIMILARITY
        ? similarityValue(groupMeasure)
        : montageGroupValue(partition, columns),
    /** The grouping is by similarity (or one is being computed). */
    groupedBySimilarity: groupBusy || !!similarityGrouping,
    groupCount,
    groupCountMax,
    /** The count is the fit's suggested one, not a number the user chose. */
    groupCountAuto,
    /** The fit's suggested count (its best-scoring cut), when known. */
    groupCountSuggested: suggestedGroups,
    /** What the stepper's range is. */
    groupCountTitle: scoredCuts
      ? `Number of groups: up to ${groupCountMax} groups (the fit scores 2 to ${groupCountMax})`
      : 'Number of groups',
    chooseGroupCount,
    /** What each cut of the grouping's fit yields: groups and outliers apart. */
    groupCountCuts,
    /** Back to the fit's suggested count ("Auto (n)"). */
    chooseAutoGroupCount,
    /** "correlation distance · whole volume, unthresholded · 9,919 shared voxels". */
    sortSimilarity:
      sort === 'similarity' ? describe(savedOrder?.fitId, sortMeasure, savedOrder?.mask) : null,
    groupSimilarity: similarityGrouping
      ? describe(similarityGrouping.fitId, groupMeasure, studio.population.mask)
      : null,
    /** Correlation was refused: the same choice by amplitude. */
    // Offered only while the refusal is the message on screen.
    retryWithAmplitude:
      refused && error === refused.message
      ? () => {
          const kind = refused.kind;
          setError(null);
          requestSimilarity(kind, 'effect');
        }
      : null,
    groupOptions,
    groupBusy,
    chooseGroup,
    cancelPending,
    order,
    /** What is being computed for the choice, for the footer. */
    computing:
      intent === 'sort-similarity' || intent === 'group-similarity'
        ? 'similarity'
        : intent === 'sort-crosshair' || intent === 'sort-witnesses'
          ? 'values at the crosshair'
          : wantsDistance && !distanceReady && !distanceFailure
            ? 'distances from the mean'
            : null,
    error: error ?? distanceFailure,
    /** Sort or Group is a similarity choice (or one just failed): the strip shows. */
    similarityShown:
      sort === 'similarity' || groupBusy || !!similarityGrouping || similarityIssue !== null,
    /** Similarity is being computed for the choice. */
    similarityBusy: intent === 'sort-similarity' || intent === 'group-similarity',
    /** Why the similarity choice failed, while that is the message on screen. */
    similarityError: similarityIssue !== null && error === similarityIssue ? similarityIssue : null,
    /** The montage's measure (the one store field). */
    measure,
    /** Similarity is compared within the pinned region. */
    regional,
    /** Compute the fit again for the choice on screen (inputs changed). */
    refit: () => {
      const kind: 'sort' | 'group' = similarityGrouping || groupBusy ? 'group' : 'sort';
      setIntent(kind === 'sort' ? 'sort-similarity' : 'group-similarity');
      setError(null);
      setSimilarityIssue(null);
      void relationship.fit(measure, regional, { grouping: true });
    },
  };
}
