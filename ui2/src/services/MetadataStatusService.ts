/**
 * MetadataStatusService - Updates status bar with layer metadata
 * Shows dimensions and resolution for the selected layer
 */

import { useLayerStore } from '@/stores/layerStore';
import { useStatusUpdater } from '@/contexts/StatusContext';
import type { VolumeMetadata } from '@/stores/layerStore';

export class MetadataStatusService {
  private statusUpdater: ReturnType<typeof useStatusUpdater> | null = null;
  private unsubscribe: (() => void) | null = null;
  
  initialize() {
    console.log('[MetadataStatusService] Initializing');
    
    // Subscribe to layer store changes
    this.unsubscribe = useLayerStore.subscribe(
      (state) => ({ 
        selectedLayerId: state.selectedLayerId,
        layers: state.layers,
        layerMetadata: state.layerMetadata
      }),
      ({ selectedLayerId, layers, layerMetadata }) => {
        this.updateStatus(selectedLayerId, layers, layerMetadata);
      }
    );
    
    // Initial update
    const state = useLayerStore.getState();
    this.updateStatus(state.selectedLayerId, state.layers, state.layerMetadata);
  }
  
  setStatusUpdater(updater: ReturnType<typeof useStatusUpdater>) {
    this.statusUpdater = updater;
  }
  
  private updateStatus(
    selectedLayerId: string | null,
    layers: any[],
    layerMetadata: Map<string, VolumeMetadata>
  ) {
    if (!this.statusUpdater) return;
    
    if (!selectedLayerId) {
      this.statusUpdater.setValue('layer', 'No layer selected');
      return;
    }
    
    const layer = layers.find(l => l.id === selectedLayerId);
    const metadata = layerMetadata.get(selectedLayerId);
    
    if (!layer || !metadata) {
      this.statusUpdater.setValue('layer', 'Loading...');
      return;
    }
    
    // Format compact metadata display
    let statusText = layer.name;
    
    if (metadata.dimensions && metadata.spacing) {
      // Add dimensions and resolution
      const dims = metadata.dimensions.join('×');
      const res = metadata.spacing.map(s => s.toFixed(1)).join('×');
      statusText = `${layer.name} [${dims} @ ${res}mm]`;
    } else if (metadata.dimensions) {
      // Just dimensions if no spacing
      const dims = metadata.dimensions.join('×');
      statusText = `${layer.name} [${dims}]`;
    }
    
    // Add binary indicator if applicable
    if (metadata.isBinaryLike) {
      statusText += ' 🎭';
    }
    
    this.statusUpdater.setValue('layer', statusText);
  }
  
  destroy() {
    console.log('[MetadataStatusService] Destroying');
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.statusUpdater = null;
  }
}

// Create singleton instance
let instance: MetadataStatusService | null = null;

export function getMetadataStatusService(): MetadataStatusService {
  if (!instance) {
    instance = new MetadataStatusService();
  }
  return instance;
}