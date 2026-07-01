import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import { useSetStudioStore } from '@/stores/setStudioStore';
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

export class SetIngestionService {
  private transport: BackendTransport;
  private requestVersion = 0;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  async openImportPreview(mode: StudioImportMode): Promise<void> {
    const store = useSetStudioStore.getState();
    store.beginImportPreview(mode);
    const requestId = ++this.requestVersion;

    try {
      const candidates = await this.transport.invoke<BackendStudioImportCandidate[]>(
        'preview_set_studio_imports',
        this.buildPreviewRequest(mode)
      );

      if (!this.isStillCurrent(requestId, mode)) {
        return;
      }

      if (Array.isArray(candidates) && candidates.length > 0) {
        const studioCandidates = candidates as StudioImportCandidate[];
        useSetStudioStore
          .getState()
          .setImportPreviewResult(mode, studioCandidates, 'backend', null);
        return;
      }

      throw new Error('Backend returned no import preview candidates.');
    } catch (error) {
      if (!this.isStillCurrent(requestId, mode)) {
        return;
      }
      const message =
        error instanceof Error ? error.message : 'Backend preview failed.';
      this.applyFallbackPreview(mode, message);
    }
  }

  async openFolderOntologyPreview(root?: string | null): Promise<void> {
    const store = useSetStudioStore.getState();
    store.beginFolderOntologyPreview(root);
    const requestId = ++this.requestVersion;
    const request = this.buildFolderOntologyRequest();

    try {
      const summary = await this.transport.invoke<StudioFolderOntologySummary>(
        'preview_folder_ontology',
        { request }
      );

      if (!this.isStillCurrentFolderOntology(requestId, request.root)) {
        return;
      }

      useSetStudioStore.getState().setFolderOntologyPreviewResult(summary);
    } catch (error) {
      if (!this.isStillCurrentFolderOntology(requestId, request.root)) {
        return;
      }
      const message =
        error instanceof Error ? error.message : 'Folder ontology preview failed.';
      useSetStudioStore.getState().setFolderOntologyPreviewError(message);
    }
  }

  async validateTablePreview(): Promise<void> {
    await this.openImportPreview('table');
  }

  async exportDiscoveryNeuroTabs(
    candidate: StudioImportCandidate
  ): Promise<StudioDiscoveryPromotionResult> {
    const outputDir = discoveryExportDirectory(candidate);
    if (!outputDir) {
      throw new Error('NeuroTabs export is available only for local discovery roots.');
    }

    return this.transport.invoke<StudioDiscoveryPromotionResult>(
      'promote_discovery_to_neurotabs',
      {
        request: {
          candidate: candidate as BackendStudioImportCandidate,
          outputDir,
        },
      }
    );
  }

  /**
   * A preview request is "still current" only if no later request has been
   * issued AND the dialog is still asking for the same mode. The mode check
   * guards against the user switching tabs (manifest → regex → table) while
   * a stale request is in flight.
   */
  private isStillCurrent(requestId: number, mode: StudioImportMode): boolean {
    if (requestId !== this.requestVersion) {
      return false;
    }
    const dialogMode = useSetStudioStore.getState().importDialog.mode;
    return dialogMode === mode;
  }

  private isStillCurrentFolderOntology(requestId: number, root: string): boolean {
    if (requestId !== this.requestVersion) {
      return false;
    }
    const dialog = useSetStudioStore.getState().importDialog;
    return dialog.mode === 'regex' && dialog.discoveryRoot === root;
  }

  private applyFallbackPreview(mode: StudioImportMode, message: string) {
    const store = useSetStudioStore.getState();

    if (mode === 'table') {
      store.setImportPreviewError(message);
      store.buildTsvImportCandidate();
      return;
    }

    store.setImportPreviewResult(mode, [], 'fallback', message);
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
        discoveryMaxDepth:
          mode === 'regex' ? parsePositiveInteger(dialog.discoveryMaxDepth) : null,
        discoveryMaxFiles:
          mode === 'regex' ? parsePositiveInteger(dialog.discoveryMaxFiles) : null,
        discoveryIncludePatterns: null,
        discoveryExcludePatterns: null,
        discoveryRequiredRoles:
          mode === 'regex' ? dialog.discoveryRequiredRoles : null,
        discoveryRolePatterns:
          mode === 'regex' ? dialog.discoveryRolePatterns : null,
        discoveryDryRun: mode === 'regex' ? true : null,
        discoverySampleHeaders:
          mode === 'regex' ? dialog.discoverySampleHeaders : null,
        tableSourceLabel:
          mode === 'table' ? dialog.tsvWizard.tsvPath || 'pasted table' : null,
        tableHeaders: mode === 'table' ? wizard.headers : null,
        tableRows: mode === 'table' ? wizard.rows : null,
        tableFilePathColumn: mode === 'table' ? wizard.columnMapping.filePathColumn : null,
        tableSubjectIdColumn: mode === 'table' ? wizard.columnMapping.subjectIdColumn : null,
        tableExcludedColumns:
          mode === 'table' ? wizard.columnMapping.excludedColumns : null,
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
