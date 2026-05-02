import { useWorkspaceStore } from '@/stores/workspaceStore';

export class AnalysisWorkbenchService {
  async openWorkspace(): Promise<string> {
    return useWorkspaceStore.getState().createWorkspace('analysis-workbench');
  }
}

let instance: AnalysisWorkbenchService | null = null;

export function getAnalysisWorkbenchService(): AnalysisWorkbenchService {
  if (!instance) {
    instance = new AnalysisWorkbenchService();
  }

  return instance;
}
