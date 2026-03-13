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
import type { DisplayOpenIntent } from '@/types/loadIntent';

export class FileLoadingService {
  async loadFile(
    path: string,
    ingress: DisplayLoadIngress = 'programmatic',
    intent: DisplayOpenIntent = 'default'
  ): Promise<void> {
    await getDisplayLifecycleOrchestrator().loadFile({ path, ingress, intent });
  }

  async loadDroppedFile(file: File, intent: DisplayOpenIntent = 'add-layer'): Promise<void> {
    await getDisplayLifecycleOrchestrator().loadDroppedFile(file, intent);
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
