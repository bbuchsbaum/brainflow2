import { buildPopulationSource } from './PopulationProbeController';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { PopulationSliceDisplay } from './PopulationSliceService';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { studioMetadata } from './studioMetadata';
import { getTransport } from '@/services/transport';

export interface PopulationExportResult {
  directory: string;
  summaryPath: string;
  coveragePath: string;
  provenancePath: string;
}
/** Freeze completed display operands before any asynchronous chooser or export work. */
export function freezePopulationExport(display: PopulationSliceDisplay) {
  const state = useSetStudioStore.getState();
  const set = state.sets[state.selection.activeSetId ?? ''];
  const feature = state.features[state.selection.activeFeatureId ?? ''];
  if (
    buildPopulationSource(state, useViewStateStore.getState().activeWorkspaceKey).source
      ?.datasetKey !== display.query.datasetKey
  )
    throw new Error(
      'The displayed population belongs to an earlier dataset or feature. Refresh before export.',
    );
  if (!set || !feature) throw new Error('A population dataset and feature are required.');
  const request = structuredClone(display.query.request);
  const revisions = new Map(
    display.data.sources.map((source) => [source.memberId, source.revision]),
  );
  if (revisions.size !== request.members.length)
    throw new Error('Refresh the population view before export.');
  const metadata = studioMetadata(set, request.workingMemberIds);
  const members = request.members.map((member) => {
    const revision = revisions.get(member.memberId);
    if (!revision || !/^[a-f0-9]{64}$/i.test(revision.sha256))
      throw new Error('Export requires verified source digests. Refresh the population view.');
    return { ...member, expectedSha256: revision.sha256 };
  });
  const mask = request.mask
    ? { ...request.mask, expectedSha256: display.data.maskRevision?.sha256 }
    : null;
  if (mask && (!mask.expectedSha256 || !/^[a-f0-9]{64}$/i.test(mask.expectedSha256)))
    throw new Error('Export requires a verified mask digest.');
  return structuredClone({
    population: { ...request, members, mask },
    context: {
      datasetId: set.id,
      datasetName: set.name,
      featureId: feature.id,
      featureLabel: feature.label,
      participantDefinition: structuredClone(state.population.participants),
      selectionContext: {
        working: state.population.working,
        referenceMode: state.population.referenceMode,
        compareCohortId: state.selection.compareCohortId,
        pinnedProbe: state.population.pinnedProbe,
        sessionRevision: state.population.sessionRevision,
      },
      metadata: metadata.issue
        ? null
        : Object.fromEntries(request.workingMemberIds.map((id) => [id, metadata.rows.get(id)])),
      metadataUnavailableReason: metadata.issue,
      displayScale: { effectLimit: display.effectLimit, summaryLimit: display.summaryLimit },
    },
  });
}
export const populationExportService = {
  async chooseAndExport(
    frozen: ReturnType<typeof freezePopulationExport>,
    signal: AbortSignal,
  ): Promise<PopulationExportResult | null> {
    const path = await getTransport().invoke<string | null>('plugin:dialog|open', {
      options: {
        directory: true,
        multiple: false,
        title: 'Choose a parent folder for the population export',
      },
    });
    if (!path || signal.aborted) return null;
    const ticket = { id: crypto.randomUUID(), expiresAtMs: Date.now() + 120_000 };
    const cancel = () => {
      void getTransport()
        .invoke('cancel_population_sample', { ticket })
        .catch((error) => console.warn('Export cancellation failed:', error));
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      return await getTransport().invoke<PopulationExportResult>('export_population_summary', {
        request: { ...frozen, destinationDirectory: path },
        ticket,
      });
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  },
};
