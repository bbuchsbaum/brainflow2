/**
 * AtlasPressureMonitor
 * Periodically queries atlas metrics and emits warnings when GPU atlas capacity is low.
 */

import { getApiService } from './apiService';
import { getEventBus } from '@/events/EventBus';
import type { AtlasStats } from '@/types/atlas';
import { useLayerStore } from '@/stores/layerStore';

type PressureLevel = 'warning' | 'critical' | 'recovered';

interface AtlasPressureEvent {
  level: PressureLevel;
  stats: AtlasStats;
  timestamp: number;
  reason: 'low-watermark' | 'full-event' | 'recovered';
}

const POLL_INTERVAL_MS = 5_000;
const LOW_WATERMARK_THRESHOLD = 2;

/**
 * Minimal hysteresis so we only emit when the number of free layers improves
 * by at least this amount. Prevents flapping when free layer count oscillates.
 */
const RECOVERY_MARGIN = 2;

export function getLowWatermarkNotification(stats: AtlasStats): {
  level: 'warning';
  message: string;
} {
  if (stats.freeLayers === 0) {
    return {
      level: 'warning',
      message: `GPU atlas is at capacity (${stats.usedLayers}/${stats.totalLayers}). Existing images may still display, but loading new layers may require releasing hidden layers.`,
    };
  }

  return {
    level: 'warning',
    message: `GPU atlas capacity low: ${stats.freeLayers} free of ${stats.totalLayers} layers remaining. Consider removing unused layers.`,
  };
}

export function shouldEmitLowWatermarkNotification(stats: AtlasStats): boolean {
  return !stats.is3D;
}

export class AtlasPressureMonitor {
  private timerId: number | null = null;
  private lastStats: AtlasStats | null = null;
  private lastWarnedFreeLayers: number | null = null;
  private lastFullEvents = 0;
  private readonly api = getApiService();
  private readonly eventBus = getEventBus();

  start() {
    if (this.timerId) {
      return;
    }

    // Kick off immediately, then poll on interval.
    void this.poll();
    this.timerId = window.setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
    console.log('[AtlasPressureMonitor] Started polling atlas metrics');
  }

  stop() {
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = null;
      console.log('[AtlasPressureMonitor] Stopped polling atlas metrics');
    }
  }

  private async poll() {
    try {
      const stats = await this.api.getAtlasStats();
      const timestamp = Date.now();

      this.emitMetrics(stats, timestamp);
      this.checkLowWatermark(stats, timestamp);
      this.checkFullEvents(stats, timestamp);

      this.lastStats = stats;
    } catch (error) {
      console.warn('[AtlasPressureMonitor] Failed to retrieve atlas stats', error);
    }
  }

  private emitMetrics(stats: AtlasStats, timestamp: number) {
    this.eventBus.emit('atlas.metrics', { stats, timestamp });
  }

  private checkLowWatermark(stats: AtlasStats, timestamp: number) {
    if (!shouldEmitLowWatermarkNotification(stats)) {
      this.lastWarnedFreeLayers = null;
      return;
    }

    // Ignore pressure warnings when no layers are loaded. At startup the atlas
    // may report 0 free / 1 total as a sentinel state, which is noisy if the
    // user has not uploaded any volumes yet.
    const layers = useLayerStore.getState().layers;
    if (!layers || layers.length === 0) {
      this.lastWarnedFreeLayers = null;
      return;
    }

    // Treat low-watermark warnings as noisy for single-layer sessions. On many
    // GPUs the atlas may be relatively small, so the very first allocation can
    // drop freeLayers below the LOW_WATERMARK_THRESHOLD. We only surface
    // yellow "capacity low" signals once the user is actually running a
    // multi-layer session.
    if (layers.length < 2) {
      this.lastWarnedFreeLayers = null;
      return;
    }

    if (stats.freeLayers <= LOW_WATERMARK_THRESHOLD) {
      const shouldNotify =
        this.lastWarnedFreeLayers === null || stats.freeLayers < this.lastWarnedFreeLayers;

      if (shouldNotify) {
        this.lastWarnedFreeLayers = stats.freeLayers;
        this.emitPressureEvent('warning', stats, timestamp, 'low-watermark');
        const notification = getLowWatermarkNotification(stats);

        this.eventBus.emit('ui.notification', {
          type: notification.level,
          message: notification.message,
        });
      }
      return;
    }

    // We have recovered above the threshold.
    if (
      this.lastWarnedFreeLayers !== null &&
      stats.freeLayers >= this.lastWarnedFreeLayers + RECOVERY_MARGIN
    ) {
      this.lastWarnedFreeLayers = null;
      this.emitPressureEvent('recovered', stats, timestamp, 'recovered');
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `GPU atlas capacity restored: ${stats.freeLayers} free layers available.`
      });
    }
  }

  private checkFullEvents(stats: AtlasStats, timestamp: number) {
    // Only react to full-events when there are layers in the session.
    // This prevents a spurious "GPU atlas is full" notification on startup
    // before the user has loaded any volumes.
    const layers = useLayerStore.getState().layers;
    if (!layers || layers.length === 0) {
      // Keep the internal counter in sync without emitting UI noise.
      this.lastFullEvents = stats.fullEvents;
      return;
    }

    if (stats.fullEvents > this.lastFullEvents) {
      const increment = stats.fullEvents - this.lastFullEvents;
      this.lastFullEvents = stats.fullEvents;

      this.emitPressureEvent('critical', stats, timestamp, 'full-event');
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: increment > 1
          ? `GPU atlas ran out of layers ${increment} times this session. Rendering may fail until layers are released.`
          : 'GPU atlas ran out of layers. Rendering may fail until layers are released.'
      });
    } else {
      this.lastFullEvents = stats.fullEvents;
    }
  }

  private emitPressureEvent(
    level: PressureLevel,
    stats: AtlasStats,
    timestamp: number,
    reason: AtlasPressureEvent['reason']
  ) {
    const payload: AtlasPressureEvent = { level, stats, timestamp, reason };
    this.eventBus.emit('atlas.pressure', payload);
  }
}

let atlasPressureMonitor: AtlasPressureMonitor | null = null;

export function getAtlasPressureMonitor(): AtlasPressureMonitor {
  if (!atlasPressureMonitor) {
    atlasPressureMonitor = new AtlasPressureMonitor();
  }
  return atlasPressureMonitor;
}

export function initializeAtlasPressureMonitor(): AtlasPressureMonitor {
  const monitor = getAtlasPressureMonitor();
  monitor.start();
  return monitor;
}
