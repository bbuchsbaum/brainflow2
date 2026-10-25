import { formatTauriError } from '@/utils/formatTauriError';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { describeFolderSource } from './folderSource';
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
  private activeFolderRequest: AbortController | null = null;
  private folderReviewViews = 0;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  async openImportPreview(mode: StudioImportMode): Promise<void> {
    const requestId = (this.requestVersion = nextImportRequestId());
    useSetStudioStore
      .getState()
      .dispatchImportEvent({ type: 'PREVIEW_REQUESTED', mode, requestId });

    try {
      const candidates = await this.invokePreview<BackendStudioImportCandidate[]>(
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
      const message = formatTauriError(error);
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
      const summary = await this.invokePreview<StudioFolderOntologySummary>(
        'preview_folder_ontology',
        { request },
      );

      useSetStudioStore
        .getState()
        .dispatchImportEvent({ type: 'ONTOLOGY_SUCCEEDED', requestId, summary });
    } catch (error) {
      const message = formatTauriError(error);
      useSetStudioStore
        .getState()
        .dispatchImportEvent({ type: 'ONTOLOGY_FAILED', requestId, message });
    }
  }

  /** Folder review is a draft; it never replaces the current study until confirmation. */
  async openFolderReview(root: string): Promise<void> {
    if (!root.trim()) return;
    useSetStudioStore.getState().dispatchImportEvent({
      type: 'FOLDER_REVIEW_OPENED',
      root,
      source: describeFolderSource(root, useFileBrowserStore.getState().entries),
    });
    await this.scanFolderReview();
  }

  async chooseFolderReview(): Promise<void> {
    const before = useSetStudioStore.getState().importDialog;
    try {
      const root = await this.transport.invoke<string | null>('plugin:dialog|open', {
        options: { directory: true, multiple: false, title: 'Choose a folder to open as a set' },
      });
      if (root && useSetStudioStore.getState().importDialog === before)
        await this.openFolderReview(root);
    } catch (error) {
      const state = useSetStudioStore.getState();
      if (state.importDialog !== before) return;
      state.dispatchImportEvent({ type: 'FOLDER_REVIEW_OPENED', root: before.discoveryRoot });
      state.setFolderOntologyPreviewError(formatTauriError(error));
    }
  }

  async scanFolderReview(): Promise<void> {
    const root = useSetStudioStore.getState().importDialog.discoveryRoot;
    if (!root.trim()) return;
    const pending = this.openFolderOntologyPreview(root);
    const version = this.requestVersion;
    await pending;
    if (version !== this.requestVersion) return;
    const state = useSetStudioStore.getState();
    const summary = state.importDialog.ontologyPreview;
    if (
      !state.importDialog.isOpen ||
      !state.importDialog.folderReview ||
      summary?.root !== root ||
      summary.truncated
    )
      return;
    const proposal = summary.candidates[0];
    if (proposal) await this.reviewOrganization(proposal.id);
  }

  async reviewOrganization(candidateId: string): Promise<void> {
    const state = useSetStudioStore.getState();
    state.applyFolderOntologyCandidate(candidateId);
    await this.openImportPreview('regex');
  }

  /** Defer final teardown through StrictMode's synchronous cleanup/remount pair. */
  retainFolderReview(): () => void {
    this.folderReviewViews += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.folderReviewViews -= 1;
      queueMicrotask(() => {
        const dialog = useSetStudioStore.getState().importDialog;
        if (this.folderReviewViews === 0 && dialog.isOpen && dialog.folderReview)
          this.cancelReview();
      });
    };
  }

  cancelReview(): void {
    this.activeFolderRequest?.abort();
    useSetStudioStore.getState().closeImportDialog();
  }
  async confirmReview(): Promise<void> {
    const state = useSetStudioStore.getState();
    const before = state.importDialog.selectedCandidateId
      ? state.importCandidates[state.importDialog.selectedCandidateId]
      : null;
    if (!state.importDialog.isOpen || !before?.contract.canImport || state.importDialog.isLoading)
      return;
    const pending = this.openImportPreview('regex');
    const version = this.requestVersion;
    await pending;
    const current = useSetStudioStore.getState();
    if (this.requestVersion !== version || !current.importDialog.isOpen) return;
    const after = current.importDialog.selectedCandidateId
      ? current.importCandidates[current.importDialog.selectedCandidateId]
      : null;
    if (!after?.contract.canImport) return;
    if (JSON.stringify(before.discovery?.groups) !== JSON.stringify(after.discovery?.groups)) {
      current.setImportPreviewError(
        'The files changed since the preview. Scan again and review the new assignments.',
      );
      return;
    }
    current.confirmImportCandidate();
  }
  editFolderReview(field: 'root' | 'pattern' | 'depth' | 'limit', value: string): void {
    this.activeFolderRequest?.abort();
    const state = useSetStudioStore.getState();
    if (field === 'root') state.setDiscoveryRoot(value);
    if (field === 'pattern') state.setFilePattern(value);
    if (field === 'depth') state.setDiscoveryMaxDepth(value);
    if (field === 'limit') state.setDiscoveryMaxFiles(value);
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

  private async invokePreview<T>(command: string, args: Record<string, unknown>): Promise<T> {
    this.activeFolderRequest?.abort();
    if (!useSetStudioStore.getState().importDialog.folderReview)
      return this.transport.invoke<T>(command, args);
    const controller = new AbortController();
    this.activeFolderRequest = controller;
    const ticket = { id: crypto.randomUUID(), expiresAtMs: Date.now() + 120_000 };
    const cancel = () => {
      void this.transport.invoke('cancel_population_sample', { ticket }).catch(() => {});
    };
    controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      return await this.transport.invoke<T>(command, { ...args, ticket });
    } finally {
      controller.signal.removeEventListener('abort', cancel);
      if (this.activeFolderRequest === controller) this.activeFolderRequest = null;
    }
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
