/**
 * StoreServiceBridge - Connects stores with services via events
 * Implements the bridge pattern to keep stores and services decoupled
 */

import type { EventBus } from '$lib/events/EventBus';
import type { VolumeService } from '$lib/services/VolumeService';
import type { CrosshairService } from '$lib/services/CrosshairService';
import type { LayerService } from '$lib/services/LayerService';
import type { NotificationService } from '$lib/services/NotificationService';
import { useVolumeStore } from '$lib/stores/volumeStore';
import { crosshairSlice } from '$lib/stores/crosshairSlice';
import { useLayerStore } from '$lib/stores/layerStore';

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
    // Volume loaded - update store
    this.unsubscribes.push(
      this.config.eventBus.on('volume.loaded', ({ metadata }) => {
        // The current volumeStore only has an 'add' method for VolumeHandleInfo
        // metadata might be different, so we need to adapt
        if (metadata && metadata.id) {
          useVolumeStore.add(metadata as any);
        }
      })
    );
  }

  /**
   * Bridge Crosshair Store with Crosshair Service
   */
  private bridgeCrosshairStore() {
    // Crosshair updated - update store
    this.unsubscribes.push(
      this.config.eventBus.on('crosshair.updated', ({ worldCoord }) => {
        crosshairSlice.setCrosshairWorldCoord(worldCoord);
      })
    );
  }

  /**
   * Bridge Layer Store with Layer Service
   */
  private bridgeLayerStore() {
    // Layer events are already handled by the layerStore itself
    // through event listeners, so no additional bridging needed
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