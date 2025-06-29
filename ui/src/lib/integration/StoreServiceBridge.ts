/**
 * StoreServiceBridge - Connects stores with services via events
 * Implements the bridge pattern to keep stores and services decoupled
 */

import type { EventBus } from '$lib/events/EventBus';
import type { VolumeService } from '$lib/services/VolumeService';
import type { CrosshairService } from '$lib/services/CrosshairService';
import type { LayerService } from '$lib/services/LayerService';
import type { NotificationService } from '$lib/services/NotificationService';
import { useVolumeStore } from '$lib/stores/volumeStore.clean';
import { useCrosshairStore } from '$lib/stores/crosshairSlice.clean';
import { useLayerStore } from '$lib/stores/layerStore.clean';

export interface BridgeConfig {
  eventBus: EventBus;
  volumeService: VolumeService;
  crosshairService: CrosshairService;
  layerService: LayerService;
  notificationService: NotificationService;
}

export class StoreServiceBridge {
  private config: BridgeConfig;
  private unsubscribes: Array<() => void> = [];

  constructor(config: BridgeConfig) {
    this.config = config;
  }

  /**
   * Initialize all bridges
   */
  init() {
    this.bridgeVolumeStore();
    this.bridgeCrosshairStore();
    this.bridgeLayerStore();
    this.bridgeNotifications();
  }

  /**
   * Bridge Volume Store with Volume Service
   */
  private bridgeVolumeStore() {
    const volumeStore = useVolumeStore.getState();
    
    // Volume loaded - update store
    this.unsubscribes.push(
      this.config.eventBus.on('volume.loading', ({ path }) => {
        volumeStore.setLoading(path, true);
      })
    );
    
    this.unsubscribes.push(
      this.config.eventBus.on('volume.loaded', ({ metadata }) => {
        volumeStore.addVolume(metadata);
        volumeStore.setLoading(metadata.path, false);
      })
    );
    
    this.unsubscribes.push(
      this.config.eventBus.on('volume.load.failed', ({ path, error }) => {
        volumeStore.setLoading(path, false);
        // Store error by path temporarily
        this.config.notificationService.error(`Failed to load ${path}`, {
          message: error.message
        });
      })
    );
    
    this.unsubscribes.push(
      this.config.eventBus.on('volume.unloaded', ({ volumeId }) => {
        volumeStore.removeVolume(volumeId);
      })
    );
    
    // Subscribe to store changes
    this.unsubscribes.push(
      useVolumeStore.subscribe(
        (state) => state.activeVolumeId,
        (activeVolumeId) => {
          if (activeVolumeId) {
            this.config.eventBus.emit('volume.active.changed', { volumeId: activeVolumeId });
          }
        }
      )
    );
  }

  /**
   * Bridge Crosshair Store with Crosshair Service
   */
  private bridgeCrosshairStore() {
    const crosshairStore = useCrosshairStore.getState();
    
    // Crosshair updated - update store
    this.unsubscribes.push(
      this.config.eventBus.on('crosshair.updated', ({ worldCoord, voxelCoords, animated }) => {
        crosshairStore.setWorldCoord(worldCoord);
        crosshairStore.setAnimating(animated || false);
        
        // Update all voxel coordinates
        for (const [volumeId, coord] of voxelCoords) {
          crosshairStore.setVoxelCoord(volumeId, coord);
        }
      })
    );
    
    this.unsubscribes.push(
      this.config.eventBus.on('crosshair.voxel.updated', ({ volumeId, voxelCoord }) => {
        crosshairStore.setVoxelCoord(volumeId, voxelCoord);
      })
    );
    
    this.unsubscribes.push(
      this.config.eventBus.on('crosshair.visibility.changed', ({ visible }) => {
        crosshairStore.setVisible(visible);
      })
    );
    
    this.unsubscribes.push(
      this.config.eventBus.on('crosshair.appearance.changed', ({ color, thickness }) => {
        crosshairStore.setAppearance({ color, thickness });
      })
    );
    
    // Volume unloaded - remove voxel coords
    this.unsubscribes.push(
      this.config.eventBus.on('volume.unloaded', ({ volumeId }) => {
        crosshairStore.removeVoxelCoord(volumeId);
      })
    );
  }

  /**
   * Bridge Layer Store with Layer Service
   */
  private bridgeLayerStore() {
    // Layer GPU resources updated
    this.unsubscribes.push(
      this.config.eventBus.on('layer.gpu.request.start', ({ layerId }) => {
        // Update layer loading state
        this.config.eventBus.emit('layer.loading', { layerId, loading: true });
      })
    );
    
    this.unsubscribes.push(
      this.config.eventBus.on('layer.gpu.request.success', ({ layerId, gpuInfo }) => {
        // Update layer with GPU info
        this.config.eventBus.emit('layer.gpu.ready', { layerId, gpuInfo });
        this.config.eventBus.emit('layer.loading', { layerId, loading: false });
      })
    );
    
    this.unsubscribes.push(
      this.config.eventBus.on('layer.gpu.request.failed', ({ layerId, error }) => {
        this.config.eventBus.emit('layer.loading', { layerId, loading: false });
        this.config.eventBus.emit('layer.error', { layerId, error });
      })
    );
  }

  /**
   * Bridge notifications
   */
  private bridgeNotifications() {
    // Handle retry requests
    this.unsubscribes.push(
      this.config.eventBus.on('volume.retry', async ({ path }) => {
        try {
          await this.config.volumeService.loadVolume(path);
        } catch (error) {
          // Error will be handled by event handlers
        }
      })
    );
  }

  /**
   * Dispose of all bridges
   */
  dispose() {
    this.unsubscribes.forEach(unsub => unsub());
    this.unsubscribes = [];
  }
}

/**
 * Initialize the store-service bridge
 * Call this once during app initialization
 */
export async function initializeStoreServiceBridge(container: any) {
  const [
    eventBus,
    volumeService,
    crosshairService,
    layerService,
    notificationService
  ] = await container.resolveAll(
    'eventBus',
    'volumeService',
    'crosshairService',
    'layerService',
    'notificationService'
  );
  
  const bridge = new StoreServiceBridge({
    eventBus,
    volumeService,
    crosshairService,
    layerService,
    notificationService
  });
  
  bridge.init();
  
  return bridge;
}