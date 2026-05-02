import type {
  AnalysisArtifact,
  AnalysisDescriptor,
  AnalysisJobStatus,
  AnalysisStartRequest,
} from '@brainflow/api';
import { getTransport } from '@/services/transport';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { getSurfaceLoadingService } from '@/services/SurfaceLoadingService';

export class AnalysisService {
  async listAnalyses(): Promise<AnalysisDescriptor[]> {
    return getTransport().invoke<AnalysisDescriptor[]>('list_analyses');
  }

  async startAnalysis(request: AnalysisStartRequest): Promise<string> {
    return getTransport().invoke<string>('start_analysis', { request });
  }

  async cancelAnalysis(jobId: string): Promise<boolean> {
    return getTransport().invoke<boolean>('cancel_analysis', { jobId });
  }

  async getJobStatus(jobId: string): Promise<AnalysisJobStatus | null> {
    const status = await getTransport().invoke<AnalysisJobStatus | null>('get_analysis_job_status', { jobId });
    return status;
  }

  async openArtifact(artifact: AnalysisArtifact): Promise<void> {
    switch (artifact.kind) {
      case 'volume':
      case 'file':
        await getFileLoadingService().loadFile(artifact.path, 'programmatic', 'add-layer');
        return;
      case 'surface':
        await getSurfaceLoadingService().loadSurfaceFile({
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
