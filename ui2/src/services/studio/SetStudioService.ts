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
    await getSetIngestionService().openImportPreview('manifest');
    return workspaceId;
  }

  async openRegexDiscoveryInStudio(options: { discoveryRoot?: string | null } = {}): Promise<string> {
    const workspaceId = await this.openStudioWorkspace();
    if (options.discoveryRoot) {
      useSetStudioStore.getState().setDiscoveryRoot(options.discoveryRoot);
    }
    await getSetIngestionService().openImportPreview('regex');
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
