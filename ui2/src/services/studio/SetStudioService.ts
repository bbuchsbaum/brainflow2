import type { FileTreeNode } from '@/types/filesystem';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useSetStudioStore } from '@/stores/setStudioStore';

export class SetStudioService {
  async openStudioWorkspace(): Promise<string> {
    return useWorkspaceStore.getState().applyWorkspacePreset('studio');
  }

  async openDemoInStudio(): Promise<string> {
    const workspaceId = await this.openStudioWorkspace();
    useSetStudioStore.getState().loadDemoSession();
    return workspaceId;
  }

  async openManifestInStudio(): Promise<string> {
    const workspaceId = await this.openStudioWorkspace();
    await getSetIngestionService().chooseManifestPreview();
    return workspaceId;
  }

  /** Compatibility entrance; filename regex is now an advanced review option. */
  async openRegexDiscoveryInStudio(
    options: { discoveryRoot?: string | null } = {},
  ): Promise<string> {
    return this.openFolderOntologyInStudio(options);
  }

  async openFolderOntologyInStudio(
    options: { discoveryRoot?: string | null } = {},
  ): Promise<string> {
    const workspaceId = await this.openStudioWorkspace();
    if (options.discoveryRoot)
      await getSetIngestionService().openFolderReview(options.discoveryRoot);
    else await getSetIngestionService().chooseFolderReview();
    return workspaceId;
  }

  async openTableImportInStudio(): Promise<string> {
    const workspaceId = await this.openStudioWorkspace();
    useSetStudioStore.getState().openImportDialog('table');
    return workspaceId;
  }
}

let instance: SetStudioService | null = null;

export function getSetStudioService(): SetStudioService {
  if (!instance) {
    instance = new SetStudioService();
  }

  return instance;
}

/** Only an explicitly selected directory is eligible; never substitute its mount root. */
export function selectedStudioFolder(
  entries: FileTreeNode[],
  selectedPath: string | null,
): FileTreeNode | null {
  if (!selectedPath) return null;
  for (const entry of entries) {
    if (entry.path === selectedPath) return entry.type === 'directory' ? entry : null;
    const found = entry.children && selectedStudioFolder(entry.children, selectedPath);
    if (found) return found;
  }
  return null;
}
