import {
  populationRelationshipService,
  validRelationshipFit,
  sameRelationshipBindings,
} from './PopulationRelationshipService';
import type {
  PopulationState,
  PopulationProbe,
  PopulationOrder,
  PopulationPartition,
} from '@/types/population';
import { validatePopulationPartition } from './populationGroups';
import type { StudioCohortSummary, SpatialFieldSetSummary } from '@/types/studio';
import type { PopulationSliceRequest } from './PopulationSliceService';
import { invokeCancelable } from './PopulationExportService';
import { getTransport } from '@/services/transport';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';

export interface OpenedPopulationCalculation {
  recordPath: string;
  recordSha256: string;
  calculation: PopulationSliceRequest;
  context: unknown;
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const label = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value : fallback;
const positive = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/** Only native-verified calculation operands define the restored estimand.
 * Descriptive context contributes labels/metadata, never membership or weighting. */
export function preparePopulationRestore(
  opened: OpenedPopulationCalculation,
  workspaceId: string,
  revision: number,
) {
  const query = opened.calculation;
  const ids = query.members.map((member) => member.memberId);
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    !/^[a-f0-9]{64}$/i.test(opened.recordSha256) ||
    query.members.some(
      (member) =>
        !member.sourcePath?.trim() || !/^[a-f0-9]{64}$/i.test(member.expectedSha256 ?? ''),
    ) ||
    query.workingMemberIds.some((id) => !ids.includes(id))
  )
    throw new Error('The saved calculation has incomplete verified source identities.');
  const id = `population-${crypto.randomUUID()}`;
  const featureId = `${id}:feature`;
  const context = object(opened.context);
  const selection = object(context.selectionContext);
  const scale = object(context.displayScale);
  const metadata = object(context.metadata);
  const notices = [
    'Original source files remain external. Their saved hashes are checked on every read.',
  ];
  if (selection.compareCohortId && !object(context.exploration).version && !query.reference)
    notices.push(
      'The saved reference cohort is not included in this bundle. Choose a reference before comparing populations.',
    );
  if (
    query.aggregation &&
    query.aggregation.groups.flatMap((group) => group.memberIds).length < ids.length
  )
    notices.push(
      'Participant identities are available for the saved working selection. Other observations remain inspectable; configure their identities before including them in participant summaries.',
    );
  const columns = [
    ...new Set(Object.values(metadata).flatMap((row) => Object.keys(object(row)))),
  ].sort();
  const rows = new Map<string, Record<string, string>>();
  for (const memberId of ids) {
    const row = object(metadata[memberId]);
    if (
      columns.length &&
      Object.keys(row).length === columns.length &&
      columns.every((column) => typeof row[column] === 'string')
    )
      rows.set(memberId, row as Record<string, string>);
  }
  if (rows.size < ids.length)
    notices.push(
      'Metadata was not saved for every observation. Filters requiring missing metadata remain unavailable.',
    );
  const set: SpatialFieldSetSummary = {
    id,
    name: label(context.datasetName, 'Saved population'),
    memberCount: ids.length,
    primaryFeatureId: featureId,
    supportKind: 'volume',
    supportLabel: 'Verified saved native grid',
    alignmentClass: 'same-grid',
    designColumns: columns,
    designTablePreview: null,
    // Do not expose these paths to legacy file materialization: it does not honor
    // frozen hashes or explicit 4D frame selectors. Population owns these bindings.
    memberSummaries: ids.map((memberId) => ({
      id: memberId,
      sourcePath: null,
      designValues: rows.get(memberId) ?? null,
    })),
    memberIds: ids,
    savedCohortIds: [],
    savedPopulation: {
      featureId,
      recordPath: opened.recordPath,
      recordSha256: opened.recordSha256,
      members: query.members.map((member) => ({
        memberId: member.memberId,
        sourcePath: member.sourcePath,
        expectedSha256: member.expectedSha256!,
        ...(member.stackIndex == null ? {} : { stackIndex: member.stackIndex }),
      })),
      notices,
    },
    ingestAudit: {
      sourceLabel: opened.recordPath,
      join: {
        matchedRows: ids.length,
        unmatchedRows: 0,
        duplicateKeys: 0,
        severity: 'ok',
        issueDetails: [],
      },
      support: {
        supportLabel: 'Verified saved native grid',
        alignmentClass: 'same-grid',
        readyForCompare: false,
        severity: 'ok',
      },
      notes: notices,
    },
  };
  let pinnedProbe: PopulationProbe | null = null;
  const probe = object(selection.pinnedProbe);
  if (
    Array.isArray(probe.worldMm) &&
    probe.worldMm.length === 3 &&
    probe.worldMm.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    typeof probe.radiusMm === 'number' &&
    Number.isFinite(probe.radiusMm) &&
    probe.radiusMm >= 0 &&
    ['mean', 'median', 'min', 'max', 'sum'].includes(String(probe.reduce))
  )
    pinnedProbe = {
      supportKey: JSON.stringify([workspaceId, revision, id]),
      worldMm: probe.worldMm as [number, number, number],
      radiusMm: probe.radiusMm,
      reduce: probe.reduce as PopulationProbe['reduce'],
    };
  const presentation = object(context.presentation);
  const order = object(presentation.order);
  let restoredOrder: PopulationOrder | null = null;
  if (presentation.order != null) {
    const ordered = order.orderedIds;
    const unavailable = order.unavailableIds;
    const bindings = order.bindings;
    const fitProbe = object(order.probe);
    const matching =
      Array.isArray(bindings) &&
      bindings.length === ids.length &&
      bindings.every((binding) => {
        const source = object(binding);
        const actual = query.members.find((m) => m.memberId === source.memberId);
        return (
          actual &&
          actual.sourcePath === source.sourcePath &&
          (actual.stackIndex ?? null) === (source.stackIndex ?? null) &&
          actual.expectedSha256 === source.expectedSha256
        );
      }) &&
      new Set(bindings.map((binding) => object(binding).memberId)).size === ids.length;
    const fitMask = object(order.mask);
    const maskMatches = query.mask
      ? fitMask.sourcePath === query.mask.sourcePath &&
        fitMask.expectedSha256 === query.mask.expectedSha256
      : order.mask === null;
    const savedFit = validRelationshipFit(context.orderRelationship)
      ? context.orderRelationship
      : context.relationship;
    const similarityMatches =
      order.rule === 'similarity' &&
      validRelationshipFit(savedFit) &&
      savedFit.fitId === order.fitId &&
      sameRelationshipBindings(
        savedFit.request,
        { members: query.members, mask: query.mask ?? null },
        true,
      ) &&
      savedFit.geometry.orderable;
    if (
      similarityMatches &&
      order.tieRule === 'source' &&
      matching &&
      maskMatches &&
      Array.isArray(unavailable) &&
      unavailable.length === 0 &&
      Array.isArray(ordered) &&
      ordered.length === ids.length &&
      new Set(ordered).size === ids.length &&
      ordered.every((id) => ids.includes(id))
    ) {
      restoredOrder = {
        ...(order as unknown as PopulationOrder),
        featureId,
        label: label(order.label, 'Saved spatial similarity order'),
        probe: null,
      };
    } else if (
      order.rule === 'response' &&
      order.tieRule === 'source' &&
      matching &&
      maskMatches &&
      Array.isArray(ordered) &&
      ordered.length === ids.length &&
      new Set(ordered).size === ids.length &&
      ordered.every((id) => ids.includes(id)) &&
      Array.isArray(unavailable) &&
      new Set(unavailable).size === unavailable.length &&
      unavailable.every((id) => ids.includes(id)) &&
      Array.isArray(fitProbe.worldMm) &&
      fitProbe.worldMm.length === 3 &&
      fitProbe.worldMm.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
      typeof fitProbe.radiusMm === 'number' &&
      Number.isFinite(fitProbe.radiusMm) &&
      fitProbe.radiusMm >= 0 &&
      ['mean', 'median', 'min', 'max', 'sum'].includes(String(fitProbe.reduce))
    ) {
      restoredOrder = {
        ...(order as unknown as PopulationOrder),
        featureId,
        label: label(order.label, 'Saved response order'),
        probe: {
          ...(fitProbe as unknown as PopulationProbe),
          supportKey: JSON.stringify([workspaceId, revision, id]),
        },
      };
    } else
      set.savedPopulation!.notices.push(
        'Saved order could not be verified against the frozen inputs; using source order.',
      );
  }
  const exploration = object(context.exploration);
  const cohorts: StudioCohortSummary[] = [];
  const cohortIds = new Map<string, string>();
  if (exploration.version === 1 && Array.isArray(exploration.cohorts)) {
    for (const value of exploration.cohorts) {
      const c = object(value);
      if (
        typeof c.id !== 'string' ||
        cohortIds.has(c.id) ||
        !Array.isArray(c.memberIds) ||
        !c.memberIds.length ||
        new Set(c.memberIds).size !== c.memberIds.length ||
        c.memberIds.some((id) => !ids.includes(id))
      )
        continue;
      const cohortId = `${id}:cohort:${cohorts.length}`;
      cohortIds.set(c.id, cohortId);
      cohorts.push({
        id: cohortId,
        label: label(c.label, 'Saved set'),
        memberIds: [...c.memberIds],
        memberCount: c.memberIds.length,
        description: label(c.description, 'Frozen saved membership'),
        originKind: 'saved_snapshot',
        originLabel: label(c.originLabel, 'Saved population'),
      });
    }
  }
  let compareCohortId =
    typeof selection.compareCohortId === 'string'
      ? (cohortIds.get(selection.compareCohortId) ?? null)
      : null;
  // Executable B always wins over descriptive cohort metadata.
  if (query.reference) {
    compareCohortId = `${id}:reference`;
    cohorts.push({
      id: compareCohortId,
      label: 'Saved reference B',
      description: 'Frozen executable reference',
      memberIds: [...query.reference.memberIds],
      memberCount: query.reference.memberIds.length,
      originKind: 'saved_snapshot',
      originLabel: 'Verified calculation',
    });
  }
  set.savedCohortIds = cohorts.map((c) => c.id);
  const restorePartition = (value: unknown): PopulationPartition | null => {
    if (!value || typeof value !== 'object') return null;
    const candidate = { ...value, setId: id } as PopulationPartition;
    return validatePopulationPartition(candidate, id, ids) ? null : structuredClone(candidate);
  };
  const partition = exploration.version === 1 ? restorePartition(exploration.partition) : null;
  if (exploration.partition && !partition)
    notices.push('Saved grouping does not partition the restored context; regroup explicitly.');
  const partitionPast =
    exploration.version === 1 && Array.isArray(exploration.partitionPast)
      ? exploration.partitionPast.slice(-20).map(restorePartition)
      : [];
  let participantGroups = query.aggregation?.groups;
  if (query.aggregation && query.reference?.aggregation) {
    const mapping = new Map(
      query.aggregation.groups.flatMap((g) =>
        g.memberIds.map((memberId) => [memberId, g.participantId] as const),
      ),
    );
    query.reference.aggregation.groups.forEach((g) =>
      g.memberIds.forEach((memberId) => mapping.set(memberId, g.participantId)),
    );
    const groups = new Map<string, string[]>();
    mapping.forEach((person, member) =>
      groups.set(person, [...(groups.get(person) ?? []), member]),
    );
    participantGroups = [...groups].map(([participantId, memberIds]) => ({
      participantId,
      memberIds,
    }));
  }
  if (
    query.aggregation &&
    exploration.version === 1 &&
    Array.isArray(exploration.participantGroups)
  ) {
    const mapping = new Map<string, string>();
    let valid = true;
    const names = new Set<string>();
    for (const raw of exploration.participantGroups) {
      const g = object(raw);
      if (
        typeof g.participantId !== 'string' ||
        !g.participantId.trim() ||
        g.participantId.trim() !== g.participantId ||
        names.has(g.participantId) ||
        !Array.isArray(g.memberIds) ||
        !g.memberIds.length
      ) {
        valid = false;
        break;
      }
      names.add(g.participantId);
      for (const member of g.memberIds) {
        if (typeof member !== 'string' || !ids.includes(member) || mapping.has(member))
          valid = false;
        else mapping.set(member, g.participantId);
      }
    }
    if (
      valid &&
      mapping.size === ids.length &&
      participantGroups?.every((g) =>
        g.memberIds.every((member) => mapping.get(member) === g.participantId),
      )
    )
      participantGroups = structuredClone(exploration.participantGroups) as NonNullable<
        typeof participantGroups
      >;
  }
  if (participantGroups?.flatMap((g) => g.memberIds).length === ids.length) {
    const index = notices.findIndex((n) =>
      n.startsWith('Participant identities are available for the saved working selection.'),
    );
    if (index >= 0) notices.splice(index, 1);
  }
  const origin = query.inference?.selectionOrigin ?? object(selection.working).origin;
  const population: Partial<Omit<PopulationState, 'sessionRevision'>> = {
    partition,
    partitionPast,
    presentation: {
      arrangement: query.inference
        ? 'inspect'
        : query.reference
          ? query.difference
            ? 'difference'
            : 'comparison'
          : presentation.arrangement === 'groups' && partition
            ? 'groups'
            : presentation.arrangement === 'montage'
              ? 'montage'
              : 'inspect',
      contributorsGroupId:
        typeof presentation.contributorsGroupId === 'string' &&
        partition?.groups.some((g) => g.id === presentation.contributorsGroupId)
          ? presentation.contributorsGroupId
          : undefined,
      montageScope: presentation.montageScope === 'plane' ? 'plane' : 'probe',
      order: restoredOrder,
    },
    working: {
      kind: 'members',
      memberIds: [...query.workingMemberIds],
      origin: origin === 'map-derived' || origin === 'metadata' ? origin : 'manual',
      label: 'Saved working selection',
    },
    participants: query.aggregation
      ? {
          setId: id,
          identity: { kind: 'saved', groups: structuredClone(participantGroups!) },
          reduction: query.aggregation.within,
        }
      : null,
    inference: query.inference ? { ...query.inference, setId: id, featureId } : null,
    mask: query.mask ? { ...query.mask, setId: id } : null,
    referenceMode:
      selection.referenceMode === 'complement' &&
      (!query.reference ||
        (query.reference.memberIds.length === ids.length - query.workingMemberIds.length &&
          query.reference.memberIds.every((member) => !query.workingMemberIds.includes(member))))
        ? 'complement'
        : 'cohort',
    pinnedProbe,
    restoredView: {
      orientation: query.orientation,
      summary: query.summary,
      zoom: query.zoom,
      effectLimit: positive(scale.effectLimit),
      summaryLimit: positive(scale.summaryLimit),
    },
  };
  return {
    set,
    features: [
      {
        id: featureId,
        label: label(context.featureLabel, 'Saved feature'),
        kind: 'volume' as const,
      },
    ],
    cohorts,
    expressions: [],
    population,
    selection: {
      activeSetId: id,
      activeFeatureId: featureId,
      activeLens: 'population' as const,
      activeMemberId: query.focusMemberId,
      compareCohortId,
      activeScopeCohortId: null,
      activeExpressionId: null,
    },
  };
}

export const populationRestoreService = {
  async chooseAndOpen(signal: AbortSignal): Promise<boolean> {
    const before = useSetStudioStore.getState();
    const revision = before.population.sessionRevision;
    const setId = before.selection.activeSetId;
    const workspaceId = useViewStateStore.getState().activeWorkspaceKey;
    const provenancePath = await getTransport().invoke<string | null>('plugin:dialog|open', {
      options: {
        multiple: false,
        directory: false,
        title: 'Open a saved population calculation',
        filters: [{ name: 'Population calculation record', extensions: ['json'] }],
      },
    });
    if (!provenancePath || signal.aborted) return false;
    const opened = await invokeCancelable<OpenedPopulationCalculation>(
      'open_population_summary',
      { provenancePath },
      signal,
    );
    signal.throwIfAborted();
    const state = useSetStudioStore.getState();
    if (
      state.population.sessionRevision !== revision ||
      state.selection.activeSetId !== setId ||
      useViewStateStore.getState().activeWorkspaceKey !== workspaceId
    )
      throw new Error(
        'The destination workspace or dataset changed while opening. Open the saved calculation again in the intended workspace.',
      );
    const payload = preparePopulationRestore(opened, workspaceId, revision + 1);
    useViewStateStore.getState().setViewState((view) => {
      view.crosshair.world_mm = [...opened.calculation.crosshairMm];
    }, workspaceId);
    state.bootstrapStudio(payload);
    populationRelationshipService.restore(
      object(opened.context).relationship,
      object(opened.context).orderRelationship,
    );
    return true;
  },
};
