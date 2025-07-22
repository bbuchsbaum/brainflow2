/**
 * VolumeHandleStore - Stores volume metadata from the backend
 * This is needed to populate layer render properties properly
 */

import type { VolumeHandle } from './apiService';

class VolumeHandleStoreImpl {
  private volumeHandles = new Map<string, VolumeHandle>();
  
  /**
   * Store a volume handle
   */
  setVolumeHandle(volumeId: string, handle: VolumeHandle) {
    this.volumeHandles.set(volumeId, handle);
  }
  
  /**
   * Get a volume handle by ID
   */
  getVolumeHandle(volumeId: string): VolumeHandle | undefined {
    return this.volumeHandles.get(volumeId);
  }
  
  /**
   * Clear a volume handle
   */
  clearVolumeHandle(volumeId: string) {
    this.volumeHandles.delete(volumeId);
  }
  
  /**
   * Clear all volume handles
   */
  clearAll() {
    this.volumeHandles.clear();
  }
}

// Export singleton instance
export const VolumeHandleStore = new VolumeHandleStoreImpl();