/**
 * FileLoadingService
 *
 * Compatibility facade that delegates file lifecycle actions to
 * DisplayLifecycleOrchestrator. Kept to avoid broad call-site churn.
 */

import {
  getDisplayLifecycleOrchestrator,
  initializeDisplayLifecycleOrchestrator,
  type DisplayLoadIngress,
} from './DisplayLifecycleOrchestrator';

export class FileLoadingService {
  async loadFile(path: string, ingress: DisplayLoadIngress = 'programmatic'): Promise<void> {
    await getDisplayLifecycleOrchestrator().loadFile({ path, ingress });
  }

  async loadDroppedFile(file: File): Promise<void> {
    await getDisplayLifecycleOrchestrator().loadDroppedFile(file);
  }
}

let fileLoadingServiceInstance: FileLoadingService | null = null;

export function getFileLoadingService(): FileLoadingService {
  if (!fileLoadingServiceInstance) {
    fileLoadingServiceInstance = new FileLoadingService();
    initializeDisplayLifecycleOrchestrator();
  }
  return fileLoadingServiceInstance;
}

export function initializeFileLoadingService(): FileLoadingService {
  return getFileLoadingService();
}
