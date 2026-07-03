import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { nextImportRequestId } from '@/stores/setStudio/importMachine';
import type { StudioImportCandidate, StudioImportMode } from '@/types/studio';
import type {
  StudioImportCandidate as BackendStudioImportCandidate,
  StudioDiscoveryPromotionResult,
  StudioFolderOntologyPreviewRequest,
  StudioFolderOntologySummary,
  StudioImportPreviewRequest,
} from '@brainflow/api';

function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Effect interpreter for the import state machine's async lifecycle.
 *
 * The service dispatches the guarded `*_REQUESTED` event (carrying a request id
 * drawn from `nextImportRequestId`) before invoking the backend, and the
 * matching `*_SUCCEEDED` / `*_FAILED` event afterward. Staleness — dropping the
 * result when a newer request superseded it, the mode changed, or the discovery
 * root changed — lives entirely inside `importReducer`, so the service no longer
 * carries any `isStillCurrent` / fallback bookkeeping of its own.
 */
export class SetIngestionService {
  private transport: BackendTransport;
  private requestVersion = 0;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  async openImportPreview(mode: StudioImportMode): Promise<void> {
    const requestId = (this.requestVersion = nextImportRequestId());
    useSetStudioStore
      .getState()
      .dispatchImportEvent({ type: 'PREVIEW_REQUESTED', mode, requestId });

    try {
      const candidates = await this.transport.invoke<BackendStudioImportCandidate[]>(
        'preview_set_studio_imports',
        this.buildPreviewRequest(mode),
      );

      if (Array.isArray(candidates) && candidates.length > 0) {
        useSetStudioStore.getState().dispatchImportEvent({
          type: 'PREVIEW_SUCCEEDED',
          mode,
          requestId,
          candidates: candidates as StudioImportCandidate[],
          source: 'backend',
        });
        return;
      }

      throw new Error('Backend returned no import preview candidates.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backend preview failed.';
      useSetStudioStore.getState().dispatchImportEvent({
        type: 'PREVIEW_FAILED',
        mode,
        requestId,
        message,
        now: Date.now(),
      });
    }
  }

  async openFolderOntologyPreview(root?: string | null): Promise<void> {
    const requestId = (this.requestVersion = nextImportRequestId());
    useSetStudioStore
      .getState()
      .dispatchImportEvent({ type: 'ONTOLOGY_REQUESTED', root: root ?? null, requestId });
    const request = this.buildFolderOntologyRequest();

    try {
      const summary = await this.transport.invoke<StudioFolderOntologySummary>(
        'preview_folder_ontology',
        { request },
      );

      useSetStudioStore
        .getState()
        .dispatchImportEvent({ type: 'ONTOLOGY_SUCCEEDED', requestId, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Folder ontology preview failed.';
      useSetStudioStore
        .getState()
        .dispatchImportEvent({ type: 'ONTOLOGY_FAILED', requestId, message });
    }
  }

  async validateTablePreview(): Promise<void> {
    await this.openImportPreview('table');
  }

  async exportDiscoveryNeuroTabs(
    candidate: StudioImportCandidate,
  ): Promise<StudioDiscoveryPromotionResult> {
    const outputDir = discoveryExportDirectory(candidate);
    if (!outputDir) {
      throw new Error('NeuroTabs export is available only for local discovery roots.');
    }

    return this.transport.invoke<StudioDiscoveryPromotionResult>('promote_discovery_to_neurotabs', {
      request: {
        candidate: candidate as BackendStudioImportCandidate,
        outputDir,
      },
    });
  }

  private buildPreviewRequest(mode: StudioImportMode): { request: StudioImportPreviewRequest } {
    const dialog = useSetStudioStore.getState().importDialog;
    const wizard = dialog.tsvWizard;
    return {
      request: {
        mode,
        manifestPath: mode === 'manifest' ? dialog.manifestPath : null,
        discoveryRoot: mode === 'regex' ? dialog.discoveryRoot : null,
        filePattern: mode === 'regex' ? dialog.filePattern : null,
        discoveryMaxDepth: mode === 'regex' ? parsePositiveInteger(dialog.discoveryMaxDepth) : null,
        discoveryMaxFiles: mode === 'regex' ? parsePositiveInteger(dialog.discoveryMaxFiles) : null,
        discoveryIncludePatterns: null,
        discoveryExcludePatterns: null,
        discoveryRequiredRoles: mode === 'regex' ? dialog.discoveryRequiredRoles : null,
        discoveryRolePatterns: mode === 'regex' ? dialog.discoveryRolePatterns : null,
        discoveryDryRun: mode === 'regex' ? true : null,
        discoverySampleHeaders: mode === 'regex' ? dialog.discoverySampleHeaders : null,
        tableSourceLabel: mode === 'table' ? dialog.tsvWizard.tsvPath || 'pasted table' : null,
        tableHeaders: mode === 'table' ? wizard.headers : null,
        tableRows: mode === 'table' ? wizard.rows : null,
        tableFilePathColumn: mode === 'table' ? wizard.columnMapping.filePathColumn : null,
        tableSubjectIdColumn: mode === 'table' ? wizard.columnMapping.subjectIdColumn : null,
        tableExcludedColumns: mode === 'table' ? wizard.columnMapping.excludedColumns : null,
      },
    };
  }

  private buildFolderOntologyRequest(): StudioFolderOntologyPreviewRequest {
    const dialog = useSetStudioStore.getState().importDialog;
    return {
      root: dialog.discoveryRoot,
      maxDepth: parsePositiveInteger(dialog.discoveryMaxDepth),
      maxFiles: parsePositiveInteger(dialog.discoveryMaxFiles),
      includePatterns: [],
      excludePatterns: [],
    };
  }
}

export function discoveryExportDirectory(candidate: StudioImportCandidate): string | null {
  const root = candidate.discovery?.root?.trim();
  if (!root || root.includes('://')) {
    return null;
  }
  return root;
}

let instance: SetIngestionService | null = null;

export function getSetIngestionService(): SetIngestionService {
  if (!instance) {
    instance = new SetIngestionService();
  }

  return instance;
}
