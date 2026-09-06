import type { PopulationState, PopulationProbe } from '@/types/population';
import type { SpatialFieldSetSummary } from '@/types/studio';
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
  if (selection.compareCohortId)
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
  const origin = object(selection.working).origin;
  const population: Partial<Omit<PopulationState, 'sessionRevision'>> = {
    working: {
      kind: 'members',
      memberIds: [...query.workingMemberIds],
      origin: origin === 'map-derived' || origin === 'metadata' ? origin : 'manual',
      label: 'Saved working selection',
    },
    participants: query.aggregation
      ? {
          setId: id,
          identity: { kind: 'saved', groups: structuredClone(query.aggregation.groups) },
          reduction: query.aggregation.within,
        }
      : null,
    mask: query.mask ? { ...query.mask, setId: id } : null,
    referenceMode: selection.referenceMode === 'complement' ? 'complement' : 'cohort',
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
    cohorts: [],
    expressions: [],
    population,
    selection: {
      activeSetId: id,
      activeFeatureId: featureId,
      activeLens: 'population' as const,
      activeMemberId: query.focusMemberId,
      compareCohortId: null,
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
    return true;
  },
};
