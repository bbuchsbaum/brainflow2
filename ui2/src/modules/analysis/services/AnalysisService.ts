import type {
  AnalysisArtifact,
  AnalysisDescriptor,
  AnalysisJobStatus,
  AnalysisStartRequest,
} from '@brainflow/api';
import { bridgeClient, openFileAsLayer, openSurfaceFile } from '@/modules/api/host';

/** The analysis module's bridge commands (`module analysis` in command_list.rs). */
const bridge = bridgeClient('analysis');

export class AnalysisService {
  async listAnalyses(): Promise<AnalysisDescriptor[]> {
    return bridge.invoke<AnalysisDescriptor[]>('list_analyses');
  }

  async startAnalysis(request: AnalysisStartRequest): Promise<string> {
    return bridge.invoke<string>('start_analysis', { request });
  }

  async cancelAnalysis(jobId: string): Promise<boolean> {
    return bridge.invoke<boolean>('cancel_analysis', { jobId });
  }

  async getJobStatus(jobId: string): Promise<AnalysisJobStatus | null> {
    return bridge.invoke<AnalysisJobStatus | null>('get_analysis_job_status', { jobId });
  }

  async openArtifact(artifact: AnalysisArtifact): Promise<void> {
    switch (artifact.kind) {
      case 'volume':
      case 'file':
        await openFileAsLayer(artifact.path);
        return;
      case 'surface':
        await openSurfaceFile({
          path: artifact.path,
          displayName: artifact.name ?? undefined,
        });
        return;
      default:
        throw new Error(`Artifact kind '${artifact.kind}' is not directly openable yet`);
    }
  }
}

let instance: AnalysisService | null = null;

export function getAnalysisService(): AnalysisService {
  if (!instance) {
    instance = new AnalysisService();
  }

  return instance;
}
