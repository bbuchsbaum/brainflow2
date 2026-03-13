import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { StudioImportCandidate, StudioImportMode } from '@/types/studio';

export class SetIngestionService {
  private transport: BackendTransport;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  async openImportPreview(mode: StudioImportMode): Promise<void> {
    const store = useSetStudioStore.getState();
    store.beginImportPreview(mode);

    try {
      const candidates = await this.transport.invoke<StudioImportCandidate[]>(
        'preview_set_studio_imports',
        this.buildPreviewRequest(mode)
      );

      if (Array.isArray(candidates) && candidates.length > 0) {
        useSetStudioStore
          .getState()
          .setImportPreviewResult(mode, candidates, 'backend', null);
        return;
      }

      throw new Error('Backend returned no import preview candidates.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Backend preview failed; using local fallback.';
      this.applyFallbackPreview(mode, message);
    }
  }

  async validateTablePreview(): Promise<void> {
    await this.openImportPreview('table');
  }

  private getFallbackCandidates(mode: StudioImportMode): StudioImportCandidate[] {
    return Object.values(useSetStudioStore.getState().importCandidates).filter(
      (candidate) => candidate.mode === mode
    );
  }

  private applyFallbackPreview(mode: StudioImportMode, message: string) {
    const store = useSetStudioStore.getState();

    if (mode === 'table') {
      store.setImportPreviewError(message);
      store.buildTsvImportCandidate();
      return;
    }

    const fallbackCandidates = this.getFallbackCandidates(mode);
    store.setImportPreviewResult(mode, fallbackCandidates, 'fallback', message);
  }

  private buildPreviewRequest(mode: StudioImportMode) {
    const dialog = useSetStudioStore.getState().importDialog;
    const wizard = dialog.tsvWizard;
    return {
      request: {
        mode,
        manifestPath: mode === 'manifest' ? dialog.manifestPath : null,
        discoveryRoot: mode === 'regex' ? dialog.discoveryRoot : null,
        filePattern: mode === 'regex' ? dialog.filePattern : null,
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
}

let instance: SetIngestionService | null = null;

export function getSetIngestionService(): SetIngestionService {
  if (!instance) {
    instance = new SetIngestionService();
  }

  return instance;
}
